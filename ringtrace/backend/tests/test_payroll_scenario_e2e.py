"""End-to-End Validation for Payroll Fan-Out Scenario in RingTrace.

Validates the payroll-style fan-out scenario through RingTrace's actual detection
and case-management pipeline on isolated test graphs in FalkorDB:
1. Scenario injection (via API and graph query layer)
2. Fan-out detector execution and measurement verification
3. Case generation, scoring, and evidence traceability
4. Repeat-scan idempotency and analyst status preservation
5. Benign comparison (recurring verified baseline vs single-batch missing baseline)
"""
import os
import sys
import time
import unittest
import uuid
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.main import app
from app.db import FalkorDBClient
from app.api.detection_routes import SCENARIOS
from app.cases.builder import build_cases, persist_cases, load_account_types
from app.detectors.fan_out import detect_fan_out
from app.queries import (
    GET_CASES,
    GET_CASES_BY_SCORE,
    MERGE_ACCOUNTS,
    MERGE_TRANSACTIONS,
)
from app.scan_service import create_scan_job, run_scan


class TestPayrollScenarioEndToEnd(unittest.TestCase):
    """End-to-end tests for the payroll fan-out scenario."""

    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()
        cls.demo_key = "test_payroll_demo_key_secret"
        os.environ["RINGTRACE_DEMO_KEY"] = cls.demo_key

    def setUp(self):
        self.suffix = uuid.uuid4().hex[:8]
        self.txn_graph = f"test_payroll_txn_{self.suffix}"
        self.memory_graph = f"test_payroll_mem_{self.suffix}"
        self.prev_graph = getattr(app.state, "graph_name", "txn")
        self.prev_db = getattr(app.state, "db_client", None)
        app.state.graph_name = self.txn_graph
        app.state.db_client = self.db
        self.prev_mem_env = os.environ.get("FALKORDB_MEMORY_GRAPH")
        os.environ["FALKORDB_MEMORY_GRAPH"] = self.memory_graph
        self.client = TestClient(app)

    def tearDown(self):
        app.state.graph_name = self.prev_graph
        app.state.db_client = self.prev_db
        if self.prev_mem_env is not None:
            os.environ["FALKORDB_MEMORY_GRAPH"] = self.prev_mem_env
        else:
            os.environ.pop("FALKORDB_MEMORY_GRAPH", None)
        self.db.delete_graph(self.txn_graph, caller="test:payroll:cleanup")
        self.db.delete_graph(self.memory_graph, caller="test:payroll:cleanup")

    def test_01_payroll_scenario_catalog_and_classification(self):
        """Verify scenario definition in catalog: 9 accounts, 16 transactions across 30 days."""
        self.assertIn("payroll_fan_out", SCENARIOS)
        scenario = SCENARIOS["payroll_fan_out"]
        self.assertEqual(scenario["account_count"], 9)
        # 8 transfers at Day 0, 8 transfers at Day 30 -> 16 total
        self.assertEqual(len(scenario["transactions"]), 16)
        amounts = [tx[2] for tx in scenario["transactions"]]
        self.assertTrue(all(amt == 80000 for amt in amounts))
        origins = [tx[0] for tx in scenario["transactions"]]
        self.assertTrue(all(src == 0 for src in origins))
        receivers = {tx[1] for tx in scenario["transactions"]}
        self.assertEqual(receivers, set(range(1, 9)))

    def test_02_e2e_api_scenario_injection_and_case_pipeline(self):
        """Inject payroll scenario through API endpoint, execute scan, and verify case in memory graph."""
        # 1. Inject through API endpoint with X-Demo-Key
        headers = {"X-Demo-Key": self.demo_key}
        resp = self.client.post("/api/v1/scenarios/inject", json={"scenario_id": "payroll_fan_out"}, headers=headers)
        self.assertEqual(resp.status_code, 202, f"Injection failed: {resp.text}")
        data = resp.json()
        self.assertEqual(data["injected_accounts"], 9)
        self.assertEqual(data["injected_tx"], 16)
        self.assertIn("scan_id", data)

        # 2. In TestClient, FastAPI BackgroundTasks execute synchronously before response returns.
        # Verify scan job recorded in scan service
        scan_id = data["scan_id"]
        status_resp = self.client.get(f"/api/v1/scan/{scan_id}")
        self.assertEqual(status_resp.status_code, 200)
        job = status_resp.json()
        self.assertIn(job["status"], ("complete", "partial"))
        self.assertIn("fan_out", job["detectors_completed"])

        fan_out_report = job["detector_reports"]["fan_out"]
        self.assertGreaterEqual(fan_out_report["count"], 1)

        # 3. List cases through /api/v1/cases
        cases_resp = self.client.get("/api/v1/cases")
        self.assertEqual(cases_resp.status_code, 200)
        cases_data = cases_resp.json()
        cases = cases_data["items"]
        self.assertEqual(len(cases), 1, "Expected exactly 1 grouped case for the payroll scenario.")

        case = cases[0]
        case_id = case["case_id"]
        self.assertTrue(case_id.startswith("CASE_"))
        self.assertEqual(case["patterns"], ["dense_cluster", "fan_out"])
        self.assertEqual(case["account_count"], 9)
        self.assertEqual(case["tx_count"], 16)
        self.assertEqual(case["total_amount"], 1280000.0)
        self.assertEqual(case["status"], "open")

        # 4. Score breakdown verification:
        # severity_base=22 (max of fan_out=22, dense_cluster=18)
        # business_origin=payroll (-10) -> severity=12
        # total_amount=1,280,000 -> amount=16
        # duration ~ 30 days (> 7 days) -> velocity=2
        # account_count=9 -> account_count=6
        # corroboration=10 (2 non-hub patterns: (2-1)*10)
        # total = 12 + 16 + 2 + 6 + 10 = 46 ("medium")
        score_breakdown = case["score_breakdown"]
        self.assertEqual(score_breakdown["severity"], 12)
        self.assertEqual(score_breakdown["amount"], 16)
        self.assertEqual(score_breakdown["velocity"], 2)
        self.assertEqual(score_breakdown["account_count"], 6)
        self.assertEqual(score_breakdown["corroboration"], 10)
        self.assertEqual(score_breakdown["total"], 46)
        self.assertEqual(case["score"], 46)
        self.assertEqual(case["severity"], "medium")

        # 5. Fetch case details through /api/v1/cases/{case_id}
        detail_resp = self.client.get(f"/api/v1/cases/{case_id}")
        self.assertEqual(detail_resp.status_code, 200)
        detail = detail_resp.json()
        self.assertEqual(detail["case_id"], case_id)

        # Check hits within case
        hits = detail["hits"]
        self.assertGreaterEqual(len(hits), 2)
        hits_by_pattern = {hit["pattern"]: hit for hit in hits}
        self.assertIn("fan_out", hits_by_pattern)
        self.assertIn("dense_cluster", hits_by_pattern)

        fan_out_hits = [h for h in hits if h["pattern"] == "fan_out"]
        self.assertGreaterEqual(len(fan_out_hits), 1)
        for hit in fan_out_hits:
            meas = hit["measurements"]
            self.assertEqual(meas["origin_account_type"], "payroll")
            self.assertTrue(meas["is_recurring_payroll"], "Must empirically verify 30-day payroll recurrence.")
            self.assertEqual(meas["payroll_recurrence_status"], "verified")
            self.assertFalse(meas["suspicious"], "Verified recurring payroll with 0 structuring must evaluate to suspicious=False.")
            self.assertEqual(meas["distinct_receivers"], 8)
            self.assertEqual(meas["structuring_share"], 0.0)

        # dense_cluster is retained as structural evidence (suspicious=False)
        dense_hit = hits_by_pattern["dense_cluster"]
        self.assertFalse(dense_hit["measurements"]["suspicious"])

        # 6. Fetch case graph through /api/v1/cases/{case_id}/graph
        graph_resp = self.client.get(f"/api/v1/cases/{case_id}/graph")
        self.assertEqual(graph_resp.status_code, 200)
        case_graph = graph_resp.json()
        self.assertEqual(len(case_graph["nodes"]), 9)
        self.assertEqual(len(case_graph["edges"]), 16)
        edge_tx_ids = {e["tx_id"] for e in case_graph["edges"]}
        self.assertEqual(len(edge_tx_ids), 16)

    def test_03_repeat_scan_idempotency_and_analyst_decision_preservation(self):
        """Verify repeated scans do not create duplicate cases and preserve analyst status updates."""
        # 1. Inject scenario
        headers = {"X-Demo-Key": self.demo_key}
        self.client.post("/api/v1/scenarios/inject", json={"scenario_id": "payroll_fan_out"}, headers=headers)

        first_cases = self.client.get("/api/v1/cases").json()["items"]
        self.assertEqual(len(first_cases), 1)
        case_id = first_cases[0]["case_id"]
        self.assertEqual(first_cases[0]["status"], "open")

        # 2. Analyst updates status to 'dismissed' (benign payroll verified)
        update_query = "MATCH (c:Case {id: $case_id}) SET c.status = 'dismissed' RETURN c.status"
        res = self.db.execute_query(self.memory_graph, update_query, {"case_id": case_id})
        self.assertEqual(res.result_set[0][0], "dismissed")

        # Verify via GET endpoint
        detail = self.client.get(f"/api/v1/cases/{case_id}").json()
        self.assertEqual(detail["status"], "dismissed")

        # 3. Trigger second scan via /api/v1/scan
        scan_resp = self.client.post("/api/v1/scan")
        self.assertEqual(scan_resp.status_code, 202)
        second_scan_id = scan_resp.json()["scan_id"]

        for _ in range(30):
            job = self.client.get(f"/api/v1/scan/{second_scan_id}").json()
            if job["status"] in ("complete", "partial"):
                break
            time.sleep(0.1)

        # 4. Verify cases after repeat scan:
        second_cases = self.client.get("/api/v1/cases").json()["items"]
        self.assertEqual(len(second_cases), 1, "Duplicate cases must never be created on repeat scan.")
        self.assertEqual(second_cases[0]["case_id"], case_id, "Case ID must remain deterministic and stable.")
        self.assertEqual(second_cases[0]["status"], "dismissed", "Analyst status 'dismissed' must be preserved across rescans.")
        self.assertEqual(second_cases[0]["score"], 46, "Case score must remain stable.")

    def test_04_benign_comparison_single_batch_missing_baseline(self):
        """Compare recurring payroll (benign) vs single-batch payroll (missing historical baseline).

        When an account has only a single disbursement batch (e.g. newly created account,
        truncated observation window), empirical recurrence cannot be proven (min_gap 20-40 days).
        Under explicit detector rules, rapid multi-recipient dispersal (>=8 in <=24h) without
        verified recurrence evaluates to suspicious=True.
        """
        # Inject single-batch payroll into an isolated graph
        prefix = f"single_batch_{self.suffix}"
        accounts = [{"id": f"{prefix}_{index:02d}", "type": "payroll" if index == 0 else "personal", "community": -1, "created": "demo"}
                    for index in range(9)]
        # Only 8 transactions within 8 minutes, NO 30-day recurring counterpart
        now_ts = 1700000000
        transactions = [{"tx_id": f"TX_{prefix}_{index:02d}", "src": accounts[0]["id"], "dst": accounts[index]["id"],
                         "amount": 80000.0, "ts": now_ts + index * 60, "step": index + 1, "tx_type": "UPI"}
                        for index in range(1, 9)]

        self.db.execute_query(self.txn_graph, MERGE_ACCOUNTS, {"rows": accounts})
        self.db.execute_query(self.txn_graph, MERGE_TRANSACTIONS, {"rows": transactions})

        # Run detection pipeline
        scan_id = create_scan_job()
        run_scan(scan_id, self.db, graph_name=self.txn_graph, memory_graph=self.memory_graph)

        # Check fan_out hits
        hits = detect_fan_out(min_receivers=8, graph_name=self.txn_graph, db=self.db)
        self.assertEqual(len(hits), 1)
        hit = hits[0]
        meas = hit["measurements"]
        self.assertEqual(meas["origin_account_type"], "payroll")
        self.assertFalse(meas["is_recurring_payroll"], "Without 20-40 day secondary batch, recurrence cannot be verified.")
        self.assertEqual(meas["payroll_recurrence_status"], "not_observed")
        self.assertTrue(meas["suspicious"], "Single-batch rapid dispersal without verified recurrence must evaluate as suspicious.")

        # Check resulting Case
        cases = self.client.get("/api/v1/cases").json()["items"]
        self.assertEqual(len(cases), 1)
        single_case = cases[0]
        # Single batch: duration <= 3600s -> velocity=15!
        # total_amount = 640,000 -> amount = round(5 * log10(641)) = 14
        # severity = 22 - 10 = 12
        # account_count = 6
        # total = 12 + 14 + 15 + 6 = 47 ("medium")
        self.assertEqual(single_case["score"], 47)
        self.assertEqual(single_case["severity"], "medium")
        self.assertGreater(single_case["score"], 36, "Single batch without baseline receives higher priority score (47 vs 36).")


if __name__ == "__main__":
    unittest.main()
