"""Integration tests for RingTrace Simulator and FalkorDB Data Loader."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

# Ensure backend root is on sys.path
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.db import FalkorDBClient
from app.simulator_adapter import SimulatorAdapter, ValidationError
from app.data_loader import RingTraceDataLoader
from app.queries import COUNT_ACCOUNTS, COUNT_SENT, LABEL_LEAKAGE_CHECK


class TestSimulatorIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()
        cls.test_dir = tempfile.mkdtemp(prefix="ringtrace_test_")
        cls.sim_script = os.path.join(BACKEND_DIR, "simulate.py")
        cls.python_exe = sys.executable

    @classmethod
    def tearDownClass(cls):
        if os.path.exists(cls.test_dir):
            shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_01_simulator_execution_and_determinism(self):
        """Verify simulator runs cleanly on minimal config and produces deterministic output."""
        out_dir_1 = os.path.join(self.test_dir, "run1")
        cmd1 = [
            self.python_exe, self.sim_script,
            "--seed", "42",
            "--accounts", "350",
            "--days", "60",
            "--tx-per-account", "2.0",
            "--fraud-per-pattern", "1",
            "--benign-per-kind", "1",
            "--out", out_dir_1
        ]
        res1 = subprocess.run(cmd1, capture_output=True, text=True)
        self.assertEqual(res1.returncode, 0, f"Sim run 1 failed: {res1.stderr}")

        # Check all required files are generated
        required_files = [
            "accounts.csv", "transactions.csv", "alerts.csv",
            "alert_accounts.csv", "alert_transactions.csv", "meta.json"
        ]
        for f in required_files:
            p = os.path.join(out_dir_1, f)
            self.assertTrue(os.path.exists(p), f"Missing generated file: {f}")
            self.assertGreater(os.path.getsize(p), 0, f"File is empty: {f}")

        # Run 2 with identical seed
        out_dir_2 = os.path.join(self.test_dir, "run2")
        cmd2 = list(cmd1)
        cmd2[-1] = out_dir_2
        res2 = subprocess.run(cmd2, capture_output=True, text=True)
        self.assertEqual(res2.returncode, 0)

        with open(os.path.join(out_dir_1, "meta.json")) as f1, open(os.path.join(out_dir_2, "meta.json")) as f2:
            m1 = json.load(f1)
            m2 = json.load(f2)
            self.assertEqual(m1["transactions_sha256"], m2["transactions_sha256"], "Determinism failed: SHA mismatch")

        # Run 3 with different seed
        out_dir_3 = os.path.join(self.test_dir, "run3")
        cmd3 = list(cmd1)
        cmd3[3] = "43"
        cmd3[-1] = out_dir_3
        res3 = subprocess.run(cmd3, capture_output=True, text=True)
        self.assertEqual(res3.returncode, 0)

        with open(os.path.join(out_dir_3, "meta.json")) as f3:
            m3 = json.load(f3)
            self.assertNotEqual(m1["transactions_sha256"], m3["transactions_sha256"], "Seeds 42 and 43 produced identical output")

    def test_02_adapter_validation_and_error_handling(self):
        """Verify simulator adapter enforces schemas and handles corrupt/missing inputs."""
        run1_dir = os.path.join(self.test_dir, "run1")
        adapter = SimulatorAdapter(run1_dir)

        # Valid data checks
        accs = adapter.load_and_validate_accounts()
        self.assertGreater(len(accs), 0)
        acc_ids = {a["id"] for a in accs}

        txs = adapter.load_and_validate_transactions(acc_ids)
        self.assertGreater(len(txs), 0)
        tx_ids = {t["tx_id"] for t in txs}

        alerts, members = adapter.load_and_validate_labels(acc_ids, tx_ids)
        self.assertEqual(len(alerts), 14)  # 8 fraud + 6 benign
        self.assertGreater(len(members), 0)

        # Missing file handling
        empty_dir = os.path.join(self.test_dir, "empty")
        os.makedirs(empty_dir, exist_ok=True)
        bad_adapter = SimulatorAdapter(empty_dir)
        with self.assertRaises(FileNotFoundError):
            bad_adapter.load_and_validate_accounts()

        # Corrupted transaction validation (duplicate tx_id)
        corrupt_dir = os.path.join(self.test_dir, "corrupt")
        shutil.copytree(run1_dir, corrupt_dir)
        tx_path = os.path.join(corrupt_dir, "transactions.csv")
        with open(tx_path, "a", newline="", encoding="utf-8") as f:
            f.write("TX_0000001,ACC_00001,ACC_00002,100.00,2026-01-01T00:00:00Z,1767225600,0,UPI\n")

        corrupt_adapter = SimulatorAdapter(corrupt_dir)
        with self.assertRaises(ValidationError):
            corrupt_adapter.load_and_validate_transactions(acc_ids)

    def test_03_falkordb_isolated_import_and_reconciliation(self):
        """Verify importation into dedicated test graphs (test_txn and test_labels), reconciliation, and leakage check."""
        run1_dir = os.path.join(self.test_dir, "run1")
        test_txn_graph = "test_txn"
        test_labels_graph = "test_labels"

        loader = RingTraceDataLoader(db=self.db)
        result = loader.load_dataset(
            data_dir=run1_dir,
            txn_graph=test_txn_graph,
            labels_graph=test_labels_graph,
            replay_fraction=0.10,
            full=False,
            reset=True
        )

        self.assertEqual(result["status"], "success")
        self.assertGreater(result["accounts_loaded"], 0)
        self.assertGreater(result["transactions_loaded"], 0)
        self.assertGreater(result["transactions_held_back"], 0)
        self.assertEqual(result["label_leakage_detected"], 0)

        # Direct database query reconciliation
        db_accs = self.db.execute_query(test_txn_graph, COUNT_ACCOUNTS, caller="test:verify_accs").result_set[0][0]
        db_txs = self.db.execute_query(test_txn_graph, COUNT_SENT, caller="test:verify_txs").result_set[0][0]
        leakage = self.db.execute_query(test_txn_graph, LABEL_LEAKAGE_CHECK, caller="test:verify_leakage").result_set[0][0]

        self.assertEqual(db_accs, result["accounts_loaded"])
        self.assertEqual(db_txs, result["transactions_loaded"])
        self.assertEqual(leakage, 0)

        # Replay file existence
        replay_file = os.path.join(run1_dir, "replay.csv")
        self.assertTrue(os.path.exists(replay_file))

        # Cleanup test graphs after test completes
        self.db.delete_graph(test_txn_graph, caller="test:teardown")
        self.db.delete_graph(test_labels_graph, caller="test:teardown")


if __name__ == "__main__":
    unittest.main()
