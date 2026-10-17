"""Isolated replay throttling tests; no live transaction graph is touched."""
import asyncio
import os
import sys
import unittest
from unittest.mock import patch

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.stream.worker import ReplayWorker


class FakeDB:
    def execute_query(self, *args, **kwargs):
        return None


def rows(prefix, count=1):
    return [{"src": f"ACC_{prefix}_{i}", "dst": f"ACC_{prefix}_{i + 1}"} for i in range(count)]


class ReplayThrottleTests(unittest.IsolatedAsyncioTestCase):
    def worker(self):
        worker = ReplayWorker(db=FakeDB())
        worker.transactions = []
        worker.total = 0
        worker.batch_size = 1
        worker.interval_seconds = 0.001
        return worker

    async def test_twenty_batches_start_at_most_four_scans(self):
        worker = self.worker()
        started = []

        async def fake_scan(accounts):
            started.append(accounts)
            await asyncio.sleep(0)

        worker._scan_once = fake_scan
        with patch("app.stream.worker.BATCH_INTERVAL", 5):
            for i in range(20):
                await worker._after_batch(rows(str(i)))
                await asyncio.sleep(0)
            await worker._flush_pending()
        self.assertEqual(len(started), 4)

    async def test_batches_during_scan_are_kept_for_next_scan(self):
        worker = self.worker()
        started = []
        release = asyncio.Event()

        async def fake_scan(accounts):
            started.append(accounts)
            if len(started) == 1:
                await release.wait()

        worker._scan_once = fake_scan
        with patch("app.stream.worker.BATCH_INTERVAL", 1):
            await worker._after_batch(rows("first"))
            await asyncio.sleep(0)
            await worker._after_batch(rows("pending"))
            self.assertTrue(worker.is_scan_running)
            self.assertIn("ACC_pending_0", worker._pending_accounts)
            release.set()
            await asyncio.gather(*tuple(worker._scan_tasks))
            await worker._after_batch(rows("next"))
            await worker._flush_pending()
        self.assertEqual(len(started), 3)
        self.assertIn("ACC_pending_0", started[1])
        self.assertIn("ACC_next_0", started[2])

    async def test_scans_never_overlap_and_batch_callback_does_not_wait(self):
        worker = self.worker()
        active = 0
        peak = 0

        async def fake_scan(accounts):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.04)
            active -= 1

        worker._scan_once = fake_scan
        with patch("app.stream.worker.BATCH_INTERVAL", 1):
            await worker._after_batch(rows("a"))
            started_at = asyncio.get_running_loop().time()
            for i in range(5):
                await worker._after_batch(rows(f"fast{i}"))
            callback_duration = asyncio.get_running_loop().time() - started_at
            await worker._flush_pending()
        self.assertLess(callback_duration, 0.02)
        self.assertEqual(peak, 1)

    async def test_final_flush_scans_leftover_accounts(self):
        worker = self.worker()
        started = []

        async def fake_scan(accounts):
            started.append(accounts)

        worker._scan_once = fake_scan
        with patch("app.stream.worker.BATCH_INTERVAL", 5):
            for i in range(3):
                await worker._after_batch(rows(f"tail{i}"))
            await worker._flush_pending()
        self.assertEqual(len(started), 1)
        self.assertIn("ACC_tail0_0", started[0])
        self.assertIn("ACC_tail2_1", started[0])


if __name__ == "__main__":
    unittest.main()
