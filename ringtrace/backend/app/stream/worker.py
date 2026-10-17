"""Replay Worker and Event Stream Manager (Member B).

Handles:
  - Reading held-back transactions from `data/sim/replay.csv` (or slicing from `transactions.csv`).
  - Inserting replay transaction batches into the `txn` FalkorDB graph.
  - Streaming real-time SSE events on `/api/v1/stream/events`:
      - stream_status ({state, sent, total})
      - tx_batch ({count, tx_ids})
      - case_created ({case_id, score, patterns})
      - case_updated ({case_id, score})
      - heartbeat ({ts})
  - Replay controls: start, pause, resume, stop, reset, status.
  - Clean state survival across pause/resume and full restore via demo/reset.
"""
import asyncio
import csv
import json
import os
import sys
import time
from typing import Any, AsyncGenerator, Dict, List, Optional

try:
    from app.db import FalkorDBClient
    from app.memory.graph import TXN_GRAPH
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.memory.graph import TXN_GRAPH

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPLAY_CSV_PATH = os.path.join(BACKEND_DIR, "data", "sim", "replay.csv")
TRANSACTIONS_CSV_PATH = os.path.join(BACKEND_DIR, "data", "sim", "transactions.csv")


INSERT_REPLAY_BATCH_CYPHER = """
UNWIND $rows AS r
MERGE (s:Account {id: r.src})
MERGE (d:Account {id: r.dst})
MERGE (s)-[t:SENT {tx_id: r.tx_id}]->(d)
SET t.amount = r.amount,
    t.ts = r.ts,
    t.step = r.step,
    t.tx_type = r.tx_type
"""


class ReplayWorker:
    def __init__(self, db: Optional[FalkorDBClient] = None, txn_graph: str = TXN_GRAPH):
        self.db = db or FalkorDBClient()
        self.txn_graph = txn_graph
        self.state: str = "idle"  # 'idle' | 'running' | 'paused' | 'stopped'
        self.current_index: int = 0
        self.sent: int = 0
        self.batch_size: int = 50
        self.interval_seconds: float = 1.0

        self.transactions: List[Dict[str, Any]] = []
        self._load_transactions()

        self.listeners: List[asyncio.Queue] = []
        self._task: Optional[asyncio.Task] = None

    def _load_transactions(self):
        """Loads transactions from replay.csv, or creates it by slicing from transactions.csv."""
        if os.path.exists(REPLAY_CSV_PATH):
            with open(REPLAY_CSV_PATH, newline="") as f:
                reader = csv.DictReader(f)
                self.transactions = list(reader)
        elif os.path.exists(TRANSACTIONS_CSV_PATH):
            with open(TRANSACTIONS_CSV_PATH, newline="") as f:
                all_txs = list(csv.DictReader(f))
            all_txs.sort(key=lambda r: (int(r.get("ts_epoch", 0)), r.get("tx_id", "")))
            cut = int(len(all_txs) * 0.9)
            self.transactions = all_txs[cut:]
            # Save for future replay runs
            os.makedirs(os.path.dirname(REPLAY_CSV_PATH), exist_ok=True)
            with open(REPLAY_CSV_PATH, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=list(all_txs[0].keys()), lineterminator="\n")
                writer.writeheader()
                writer.writerows(self.transactions)

        self.total = len(self.transactions)

    def publish_event(self, event_type: str, payload: Dict[str, Any]):
        """Publishes an event to all connected SSE clients."""
        msg = {"event": event_type, "data": payload}
        for q in list(self.listeners):
            try:
                q.put_nowait(msg)
            except Exception:
                pass

    def get_status(self) -> Dict[str, Any]:
        """Returns the current replay state and progress."""
        return {
            "state": self.state,
            "sent": self.sent,
            "total": self.total,
            "batch_size": self.batch_size,
            "current_index": self.current_index,
        }

    async def _run_loop(self):
        """Background asynchronous replay loop."""
        try:
            while self.state == "running" and self.current_index < self.total:
                batch = self.transactions[self.current_index : self.current_index + self.batch_size]
                if not batch:
                    break

                # Format rows for FalkorDB insertion
                formatted_rows = [
                    {
                        "tx_id": t["tx_id"],
                        "src": t["src"],
                        "dst": t["dst"],
                        "amount": float(t["amount"]),
                        "ts": int(t.get("ts_epoch", t.get("ts", 0))),
                        "step": int(t.get("step", 0)),
                        "tx_type": t.get("tx_type", "payment"),
                    }
                    for t in batch
                ]

                # Insert into FalkorDB txn graph
                self.db.execute_query(
                    self.txn_graph,
                    INSERT_REPLAY_BATCH_CYPHER,
                    {"rows": formatted_rows},
                    caller="stream:replay_batch",
                )

                self.current_index += len(batch)
                self.sent += len(batch)

                # Emit tx_batch SSE event
                self.publish_event(
                    "tx_batch",
                    {
                        "count": len(batch),
                        "tx_ids": [r["tx_id"] for r in formatted_rows],
                        "sent": self.sent,
                        "total": self.total,
                    },
                )

                # Check if replay completed
                if self.current_index >= self.total:
                    self.state = "stopped"
                    self.publish_event("stream_status", self.get_status())
                    break

                await asyncio.sleep(self.interval_seconds)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self.state = "stopped"
            self.publish_event("error", {"message": str(e)})

    def start(self, batch_size: int = 50, interval_seconds: float = 1.0) -> Dict[str, Any]:
        """Starts or restarts replay from current index."""
        if self.state == "running":
            return self.get_status()

        self.batch_size = max(1, min(batch_size, 500))
        self.interval_seconds = max(0.1, min(interval_seconds, 10.0))
        self.state = "running"

        if self._task and not self._task.done():
            self._task.cancel()

        self._task = asyncio.create_task(self._run_loop())
        self.publish_event("stream_status", self.get_status())
        return self.get_status()

    def pause(self) -> Dict[str, Any]:
        """Pauses the replay loop without resetting position."""
        if self.state == "running":
            self.state = "paused"
            if self._task and not self._task.done():
                self._task.cancel()
            self.publish_event("stream_status", self.get_status())
        return self.get_status()

    def resume(self) -> Dict[str, Any]:
        """Resumes playback from the paused index."""
        if self.state == "paused":
            return self.start(self.batch_size, self.interval_seconds)
        return self.get_status()

    def stop(self) -> Dict[str, Any]:
        """Stops the playback loop."""
        self.state = "stopped"
        if self._task and not self._task.done():
            self._task.cancel()
        self.publish_event("stream_status", self.get_status())
        return self.get_status()

    def reset(self) -> Dict[str, Any]:
        """Resets replay progress back to 0 and sets state to idle."""
        self.stop()
        self.current_index = 0
        self.sent = 0
        self.state = "idle"
        self.publish_event("stream_status", self.get_status())
        return self.get_status()

    async def event_generator(self) -> AsyncGenerator[str, None]:
        """Yields SSE events to a connected client with heartbeats."""
        q: asyncio.Queue = asyncio.Queue()
        self.listeners.append(q)

        # Initial connection status event
        yield f"event: stream_status\ndata: {json.dumps(self.get_status())}\n\n"

        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    evt_type = msg.get("event")
                    evt_data = msg.get("data")
                    yield f"event: {evt_type}\ndata: {json.dumps(evt_data)}\n\n"
                except asyncio.TimeoutError:
                    heartbeat_data = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
                    yield f"event: heartbeat\ndata: {json.dumps(heartbeat_data)}\n\n"
        finally:
            if q in self.listeners:
                self.listeners.remove(q)


# Global singleton instance for the FastAPI app
replay_worker = ReplayWorker()


def publish_event(event_type: str, payload: Dict[str, Any]):
    """Global hook for external modules (e.g. Member A scenario injection) to publish SSE events."""
    replay_worker.publish_event(event_type, payload)
