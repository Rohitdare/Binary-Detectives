"""Comprehensive test suite for RingTrace periodic detection scheduler and concurrency coordinator."""
import asyncio
import os
import sys
import threading
import time
import unittest
import uuid
from unittest.mock import MagicMock, patch

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient
from app import scan_service
from app.api.models import ScanStatus, SchedulerStatusResponse
from app.cases.builder import build_cases, persist_cases
from app.db import FalkorDBClient
from app.detectors.graph_pattern_utils import PatternDetectionResult
from app.main import app
from app.queries import GET_CASE_BY_ID, GET_CASE_HITS, MERGE_ACCOUNTS, MERGE_TRANSACTIONS
from app.scan_service import (
    DETECTOR_REGISTRY,
    create_scan_job,
    execute_scan,
    get_active_scan_id,
    get_latest_scan_job,
    get_scan_job,
    is_scan_active,
    list_scan_jobs,
    run_scan,
)
from app.scheduler.config import SchedulerConfig
from app.scheduler.service import DetectionScheduler, init_scheduler, shutdown_scheduler


def _make_mock_hit(hit_id: str, pattern: str, accounts: list, tx_ids: list, amount: float = 10000.0, ts: int = 1700000000):
    txs = [{
        "tx_id": tid,
        "src": accounts[i % len(accounts)],
        "dst": accounts[(i + 1) % len(accounts)],
        "amount": amount,
        "ts": ts + i * 100,
        "step": 1,
        "tx_type": "UPI"
    } for i, tid in enumerate(tx_ids)]
    return {
        "hit_id": hit_id,
        "pattern": pattern,
        "account_ids": list(accounts),
        "account_roles": {accounts[0]: "origin"},
        "tx_ids": list(tx_ids),
        "transactions": txs,
        "measurements": {"suspicious": True},
        "explanation": f"Test {pattern} hit",
    }


class TestSchedulerConfig(unittest.TestCase):
    """Configuration validation and environment loading tests."""

    def test_default_configuration_values(self):
        with patch.dict(os.environ, {}, clear=True):
            cfg = SchedulerConfig.from_env()
            self.assertTrue(cfg.enabled)
            self.assertEqual(cfg.interval_seconds, 300)
            self.assertFalse(cfg.scan_on_startup)
            self.assertIsNone(cfg.lookback_seconds)
            self.assertEqual(cfg.timeout_seconds, 120)
            self.assertEqual(cfg.history_limit, 100)

    def test_custom_environment_configuration(self):
        env = {
            "DETECTION_SCHEDULER_ENABLED": "false",
            "DETECTION_SCAN_INTERVAL_SECONDS": "60",
            "DETECTION_SCAN_ON_STARTUP": "true",
            "DETECTION_SCAN_LOOKBACK_SECONDS": "86400",
            "DETECTION_SCAN_TIMEOUT_SECONDS": "45",
            "DETECTION_SCAN_HISTORY_LIMIT": "50",
        }
        with patch.dict(os.environ, env, clear=True):
            cfg = SchedulerConfig.from_env()
            self.assertFalse(cfg.enabled)
            self.assertEqual(cfg.interval_seconds, 60)
            self.assertTrue(cfg.scan_on_startup)
            self.assertEqual(cfg.lookback_seconds, 86400)
            self.assertEqual(cfg.timeout_seconds, 45)
            self.assertEqual(cfg.history_limit, 50)

    def test_rejects_negative_or_zero_interval(self):
        with patch.dict(os.environ, {"DETECTION_SCAN_INTERVAL_SECONDS": "0"}):
            with self.assertRaises(ValueError) as ctx:
                SchedulerConfig.from_env()
            self.assertIn("must be positive", str(ctx.exception))

        with patch.dict(os.environ, {"DETECTION_SCAN_INTERVAL_SECONDS": "-10"}):
            with self.assertRaises(ValueError):
                SchedulerConfig.from_env()

        with patch.dict(os.environ, {"DETECTION_SCAN_INTERVAL_SECONDS": "not-an-int"}):
            with self.assertRaises(ValueError):
                SchedulerConfig.from_env()

    def test_rejects_invalid_lookback_or_timeout(self):
        with patch.dict(os.environ, {"DETECTION_SCAN_LOOKBACK_SECONDS": "-5"}):
            with self.assertRaises(ValueError):
                SchedulerConfig.from_env()

        with patch.dict(os.environ, {"DETECTION_SCAN_TIMEOUT_SECONDS": "0"}):
            with self.assertRaises(ValueError):
                SchedulerConfig.from_env()


class TestSchedulerLifecycleAndConcurrency(unittest.IsolatedAsyncioTestCase):
    """Scheduler lifecycle, concurrency lock, and overlap prevention tests."""

    async def asyncSetUp(self):
        self.mock_db = MagicMock(spec=FalkorDBClient)
        self.config = SchedulerConfig(
            enabled=True,
            interval_seconds=1,  # Short deterministic interval for tests
            scan_on_startup=False,
            history_limit=10,
        )
        self.scheduler = DetectionScheduler(
            db_client=self.mock_db,
            graph_name="test_txn",
            memory_graph="test_memory",
            config=self.config,
        )

    async def asyncTearDown(self):
        if self.scheduler.is_running:
            await self.scheduler.stop()
        await shutdown_scheduler(grace_period=1.0)

    async def test_scheduler_starts_and_stops_cleanly(self):
        """Scheduler starts periodic task and shuts down without leaking tasks."""
        self.assertFalse(self.scheduler.is_running)
        await self.scheduler.start()
        self.assertTrue(self.scheduler.is_running)
        self.assertIsNotNone(self.scheduler.next_run_at)

        await self.scheduler.stop(grace_period_seconds=1.0)
        self.assertFalse(self.scheduler.is_running)
        self.assertIsNone(self.scheduler.next_run_at)

    async def test_scheduler_disabled_mode_does_not_start(self):
        """When disabled, start() is a no-op."""
        disabled_config = SchedulerConfig(enabled=False, interval_seconds=10)
        scheduler = DetectionScheduler(self.mock_db, config=disabled_config)
        await scheduler.start()
        self.assertFalse(scheduler.is_running)
        self.assertIsNone(scheduler.next_run_at)

    async def test_duplicate_start_does_not_create_multiple_loops(self):
        """Calling start() twice does not spawn duplicate tasks."""
        await self.scheduler.start()
        first_task = self.scheduler._task
        await self.scheduler.start()
        self.assertIs(self.scheduler._task, first_task)
        await self.scheduler.stop()

    def test_concurrent_scans_prevent_overlap_and_record_skipped(self):
        """A new scan triggered while another is active is marked as skipped and does not overlap."""
        mock_db = MagicMock(spec=FalkorDBClient)
        txn_graph = f"test_txn_{uuid.uuid4().hex[:8]}"
        mem_graph = f"test_mem_{uuid.uuid4().hex[:8]}"

        scan_1_started = threading.Event()
        scan_1_proceed = threading.Event()

        def slow_detector(limit, graph_name, db, edge_snapshot):
            scan_1_started.set()
            scan_1_proceed.wait(timeout=5.0)
            return PatternDetectionResult([], edges_scanned=1)

        scan_1_id = create_scan_job(trigger="manual")
        scan_2_id = create_scan_job(trigger="scheduled")

        with patch.object(scan_service, "DETECTOR_REGISTRY", (("cycle", slow_detector),)):
            # Start slow scan 1 in background thread
            t1 = threading.Thread(
                target=run_scan,
                args=(scan_1_id, mock_db, txn_graph, mem_graph),
                kwargs={"trigger": "manual"},
            )
            t1.start()

            # Wait until scan 1 acquires the lock
            self.assertTrue(scan_1_started.wait(timeout=3.0))
            self.assertTrue(is_scan_active())
            self.assertEqual(get_active_scan_id(), scan_1_id)

            # Trigger scan 2 while scan 1 is still running
            run_scan(scan_2_id, mock_db, txn_graph, mem_graph, trigger="scheduled")

            # Verify scan 2 was skipped due to concurrency lock
            job_2 = get_scan_job(scan_2_id)
            self.assertEqual(job_2["status"], "skipped")
            self.assertEqual(job_2["trigger"], "scheduled")
            self.assertIn("currently executing", job_2["error_summary"])

            # Let scan 1 finish
            scan_1_proceed.set()
            t1.join(timeout=3.0)

            # Verify scan 1 finished and lock was released
            self.assertFalse(is_scan_active())
            self.assertIsNone(get_active_scan_id())
            job_1 = get_scan_job(scan_1_id)
            self.assertIn(job_1["status"], {"complete", "partial"})

    def test_lock_released_on_unhandled_exception(self):
        """The execution lock is reliably released even if an unhandled exception occurs."""
        mock_db = MagicMock(spec=FalkorDBClient)
        mock_db.execute_query.side_effect = RuntimeError("Fatal DB Crash")

        scan_id = create_scan_job(trigger="manual")
        # Should not raise to caller, should record failed status and release lock
        run_scan(scan_id, mock_db, "bad_graph", "bad_mem")

        self.assertFalse(is_scan_active())
        self.assertIsNone(get_active_scan_id())

        job = get_scan_job(scan_id)
        self.assertEqual(job["status"], "failed")
        self.assertIn("Fatal DB Crash", job["error_summary"])

        # Confirm a subsequent scan can immediately acquire the lock
        next_scan_id = create_scan_job(trigger="manual")
        with patch.object(scan_service, "read_pattern_edges", return_value=([], False, 0)):
            with patch.object(scan_service, "load_account_types", return_value={}):
                with patch.object(scan_service, "DETECTOR_REGISTRY", ()):
                    run_scan(next_scan_id, mock_db, "txn", "memory")

        next_job = get_scan_job(next_scan_id)
        self.assertEqual(next_job["status"], "complete")


class TestDetectionPipelineIntegration(unittest.TestCase):
    """End-to-end execution, failure isolation, and idempotency tests against FalkorDB."""

    def setUp(self):
        self.db = FalkorDBClient()
        self.txn_graph = f"test_sched_txn_{uuid.uuid4().hex[:10]}"
        self.memory_graph = f"test_sched_mem_{uuid.uuid4().hex[:10]}"

        # Seed minimal transaction graph
        accounts = [
            {"id": "ACC_A", "type": "personal", "community": 1},
            {"id": "ACC_B", "type": "personal", "community": 1},
        ]
        tx = {
            "tx_id": "TX_SCHED_01",
            "src": "ACC_A",
            "dst": "ACC_B",
            "amount": 25000.0,
            "ts": 1705000000,
            "step": 1,
            "tx_type": "NEFT",
        }
        self.db.execute_query(self.txn_graph, MERGE_ACCOUNTS, {"rows": accounts}, caller="test:seed_accounts")
        self.db.execute_query(self.txn_graph, MERGE_TRANSACTIONS, {"rows": [tx]}, caller="test:seed_tx")

    def tearDown(self):
        self.db.delete_graph(self.txn_graph, caller="test:cleanup_txn")
        self.db.delete_graph(self.memory_graph, caller="test:cleanup_mem")

    def test_pipeline_invokes_all_registered_detectors(self):
        """All detectors in DETECTOR_REGISTRY are called during execution."""
        called_detectors = set()

        def instrumented_detector(name):
            def _det(limit, graph_name, db, edge_snapshot, **kwargs):
                called_detectors.add(name)
                return PatternDetectionResult([], edges_scanned=1)
            return _det

        test_registry = tuple((name, instrumented_detector(name)) for name, _ in DETECTOR_REGISTRY)

        with patch.object(scan_service, "DETECTOR_REGISTRY", test_registry):
            scan_id = execute_scan(self.db, self.txn_graph, self.memory_graph, trigger="scheduled")
            job = get_scan_job(scan_id)

            self.assertEqual(job["status"], "complete")
            self.assertEqual(called_detectors, {name for name, _ in DETECTOR_REGISTRY})
            self.assertEqual(len(job["detectors_completed"]), len(DETECTOR_REGISTRY))
            self.assertEqual(job["detectors_failed"], [])
            self.assertIsNotNone(job["duration_ms"])
            self.assertIsNotNone(job["effective_window_start"])
            self.assertIsNotNone(job["effective_window_end"])

    def test_isolated_detector_failure_records_partial_scan(self):
        """An individual detector failure records errors and marks status='partial' without halting others."""
        def failing_detector(**kwargs):
            raise RuntimeError("Specific detector algorithm timed out")

        def good_detector(**kwargs):
            test_hit = _make_mock_hit("HIT_OK", "relay_chain", ["ACC_A", "ACC_B"], ["TX_SCHED_01"])
            return PatternDetectionResult([test_hit], edges_scanned=1)

        test_registry = (
            ("bad_engine", failing_detector),
            ("good_engine", good_detector),
        )

        with patch.object(scan_service, "DETECTOR_REGISTRY", test_registry):
            scan_id = execute_scan(self.db, self.txn_graph, self.memory_graph, trigger="scheduled")
            job = get_scan_job(scan_id)

            self.assertEqual(job["status"], "partial")
            self.assertIn("bad_engine", job["detectors_failed"])
            self.assertIn("good_engine", job["detectors_completed"])
            self.assertIn("Specific detector algorithm timed out", job["detector_errors"]["bad_engine"])
            self.assertEqual(job["hits_found"], 1)
            self.assertEqual(job["cases_created_or_updated"], 1)

    def test_repeated_runs_over_overlapping_windows_are_idempotent(self):
        """Rescanning does not create duplicate cases and preserves existing analyst decisions."""
        test_hit = _make_mock_hit("HIT_IDEMP", "relay_chain", ["ACC_A", "ACC_B"], ["TX_SCHED_01"])

        def fixture_detector(**kwargs):
            return PatternDetectionResult([test_hit], edges_scanned=1)

        with patch.object(scan_service, "DETECTOR_REGISTRY", (("relay_chain", fixture_detector),)):
            # Run 1: First scan creates the case
            scan_1 = execute_scan(self.db, self.txn_graph, self.memory_graph, trigger="scheduled")
            job_1 = get_scan_job(scan_1)
            self.assertEqual(job_1["case_count"], 1)

            # Simulate analyst decision on the created case
            case_id = build_cases([test_hit])["cases"][0]["case_id"]
            self.db.execute_query(
                self.memory_graph,
                "MATCH (c:Case {id: $case_id}) SET c.status = 'escalated'",
                {"case_id": case_id},
                caller="test:analyst_decision",
            )

            # Run 2: Second scan over overlapping window
            scan_2 = execute_scan(self.db, self.txn_graph, self.memory_graph, trigger="scheduled")
            job_2 = get_scan_job(scan_2)
            self.assertEqual(job_2["case_count"], 1)

            # Verify only 1 Case node exists in graph and status='escalated' was preserved
            res = self.db.execute_query(
                self.memory_graph,
                GET_CASE_BY_ID,
                {"case_id": case_id},
                caller="test:verify_idempotency",
            )
            self.assertEqual(len(res.result_set), 1)
            self.assertEqual(res.result_set[0][1], "escalated")

            # Verify Hit nodes were merged without duplicates
            hits_res = self.db.execute_query(
                self.memory_graph,
                GET_CASE_HITS,
                {"case_id": case_id},
                caller="test:verify_hits",
            )
            self.assertEqual(len(hits_res.result_set), 1)


class TestObservabilityEndpoints(unittest.TestCase):
    """API endpoints for scheduler status, latest scan, and scan history."""

    def setUp(self):
        scan_service.reset_scan_service_state()
        self.client = TestClient(app)

    def tearDown(self):
        scan_service.reset_scan_service_state()

    def test_scheduler_status_endpoint(self):
        """GET /api/v1/scheduler/status returns diagnostic state without triggering a scan."""
        resp = self.client.get("/api/v1/scheduler/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertIn("enabled", data)
        self.assertIn("running", data)
        self.assertIn("interval_seconds", data)
        self.assertIn("is_scan_active", data)
        self.assertIn("run_count", data)

    def test_scans_latest_and_history_endpoints(self):
        """GET /api/v1/scans/latest and /api/v1/scans return historical run records."""
        # 1. Create a dummy scan job record
        scan_id = create_scan_job(trigger="manual")

        # 2. Latest scan endpoint
        resp_latest = self.client.get("/api/v1/scans/latest")
        self.assertEqual(resp_latest.status_code, 200)
        latest_data = resp_latest.json()
        self.assertEqual(latest_data["scan_id"], scan_id)
        self.assertEqual(latest_data["trigger"], "manual")

        # 3. Scans list endpoint
        resp_list = self.client.get("/api/v1/scans?limit=5")
        self.assertEqual(resp_list.status_code, 200)
        scans = resp_list.json()
        self.assertIsInstance(scans, list)
        self.assertGreaterEqual(len(scans), 1)
        self.assertEqual(scans[0]["scan_id"], scan_id)

    def test_manual_scan_endpoint_returns_skipped_when_another_scan_is_active(self):
        """POST /api/v1/scan returns status='skipped' with active_scan_id and message."""
        active_id = create_scan_job(trigger="scheduled")
        # Simulate active scan running
        with patch("app.api.detection_routes.is_scan_active", return_value=True):
            with patch("app.api.detection_routes.get_active_scan_id", return_value=active_id):
                resp = self.client.post("/api/v1/scan")
                self.assertEqual(resp.status_code, 202)
                data = resp.json()
                self.assertEqual(data["status"], "skipped")
                self.assertEqual(data["active_scan_id"], active_id)
                self.assertIn("Scan skipped", data["message"])
                self.assertIsNotNone(data["scan_id"])

                job = get_scan_job(data["scan_id"])
                self.assertEqual(job["status"], "skipped")
                self.assertIn("currently executing", job["error_summary"])

    def test_scheduler_status_shows_active_scan(self):
        """GET /api/v1/scheduler/status reflects active scan ID and state."""
        with patch("app.api.detection_routes.is_scan_active", return_value=True):
            with patch("app.api.detection_routes.get_active_scan_id", return_value="SCAN_ACTIVE_123"):
                resp = self.client.get("/api/v1/scheduler/status")
                self.assertEqual(resp.status_code, 200)
                data = resp.json()
                self.assertTrue(data["is_scan_active"])
                self.assertEqual(data["active_scan_id"], "SCAN_ACTIVE_123")


class TestOperationalCautions(unittest.TestCase):
    """Specific verifications for shutdown interruption, timeout behavior, and single-process lock."""

    def setUp(self):
        scan_service.reset_scan_service_state()

    def tearDown(self):
        scan_service.reset_scan_service_state()

    def test_cooperative_shutdown_halts_at_detector_boundary_and_releases_lock(self):
        """When shutdown is signaled, in-flight scan stops before next detector and releases lock safely."""
        mock_db = MagicMock(spec=FalkorDBClient)
        called = []

        def det1(**kwargs):
            called.append("det1")
            scan_service.set_shutting_down(True)
            return PatternDetectionResult([], edges_scanned=1)

        def det2(**kwargs):
            called.append("det2")
            return PatternDetectionResult([], edges_scanned=1)

        registry = (("det1", det1), ("det2", det2))
        with patch.object(scan_service, "DETECTOR_REGISTRY", registry):
            with patch.object(scan_service, "read_pattern_edges", return_value=([], False, 0)):
                with patch.object(scan_service, "load_account_types", return_value={}):
                    with patch("app.cases.builder.build_cases", return_value={"cases": [], "non_case_generating_hit_ids": [], "skipped_oversized_hit_ids": []}):
                        with patch("app.cases.builder.persist_cases", return_value=0):
                            scan_id = execute_scan(mock_db, trigger="scheduled")

        # det1 ran and set shutdown; det2 must have been skipped
        self.assertEqual(called, ["det1"])
        job = get_scan_job(scan_id)
        self.assertEqual(job["status"], "partial")
        self.assertIn("shutdown", job["detector_errors"])
        self.assertIn("interrupted_by_shutdown", job["detectors_failed"])

        # Crucially: scan execution lock must be released!
        self.assertFalse(is_scan_active())
        self.assertIsNone(get_active_scan_id())

    def test_supervisory_timeout_flags_active_job_without_crashing_loop(self):
        """Supervisory timeout records the timeout threshold in the job without uncaught exceptions."""
        mock_db = MagicMock(spec=FalkorDBClient)
        cfg = SchedulerConfig(enabled=True, interval_seconds=10, timeout_seconds=1)
        scheduler = DetectionScheduler(mock_db, config=cfg)

        async def run_timeout_test():
            active_id = create_scan_job(trigger="scheduled")
            with patch("app.scheduler.service.get_active_scan_id", return_value=active_id):
                with patch("app.scheduler.service.execute_scan", side_effect=lambda **kw: time.sleep(2.0)):
                    # Execute pass with a 1-second timeout against a 2-second sleep
                    result = await scheduler._execute_scheduled_pass()
                    self.assertIsNone(result)

            job = get_scan_job(active_id)
            self.assertIn("Supervisory scheduler timeout exceeded", job["error_summary"])
            self.assertEqual(scheduler._failure_count, 1)

        asyncio.run(run_timeout_test())


if __name__ == "__main__":
    unittest.main()

