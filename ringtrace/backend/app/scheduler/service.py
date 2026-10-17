"""Periodic fraud detection scheduler engine."""
import asyncio
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

try:
    from app.db import FalkorDBClient
    from app.scan_service import (
        execute_scan, get_active_scan_id, get_latest_scan_job, get_scan_job,
        is_scan_active, set_shutting_down, update_scan_job,
    )
    from app.scheduler.config import SchedulerConfig
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.scan_service import (
        execute_scan, get_active_scan_id, get_latest_scan_job, get_scan_job,
        is_scan_active, set_shutting_down, update_scan_job,
    )
    from backend.app.scheduler.config import SchedulerConfig

logger = logging.getLogger("ringtrace.scheduler")


class DetectionScheduler:
    """Manages the periodic execution of RingTrace fraud detectors."""

    def __init__(
        self,
        db_client: FalkorDBClient,
        graph_name: str = "txn",
        memory_graph: str = "memory",
        config: Optional[SchedulerConfig] = None,
    ):
        self.db_client = db_client
        self.graph_name = graph_name
        self.memory_graph = memory_graph
        self.config = config or SchedulerConfig.from_env()

        self._running: bool = False
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self._next_run_time: Optional[datetime] = None
        self._last_run_time: Optional[datetime] = None
        self._run_count: int = 0
        self._failure_count: int = 0
        self._skip_count: int = 0

    @property
    def is_running(self) -> bool:
        return self._running and self._task is not None and not self._task.done()

    @property
    def next_run_at(self) -> Optional[str]:
        if not self.is_running or not self._next_run_time:
            return None
        return self._next_run_time.isoformat().replace("+00:00", "Z")

    @property
    def last_run_at(self) -> Optional[str]:
        if not self._last_run_time:
            return None
        return self._last_run_time.isoformat().replace("+00:00", "Z")

    async def start(self) -> None:
        """Start the periodic scheduler loop if enabled."""
        if not self.config.enabled:
            logger.info("Detection scheduler is disabled by configuration (DETECTION_SCHEDULER_ENABLED=false)")
            return

        if self.is_running:
            logger.warning("Detection scheduler is already running; skipping duplicate start")
            return

        self._running = True
        self._stop_event.clear()
        set_shutting_down(False)

        # Calculate initial scheduled run time
        if self.config.scan_on_startup:
            self._next_run_time = datetime.now(timezone.utc)
        else:
            self._next_run_time = datetime.now(timezone.utc) + timedelta(seconds=self.config.interval_seconds)

        logger.info(
            "Starting fraud detection scheduler: interval=%ds, scan_on_startup=%s, next_run=%s",
            self.config.interval_seconds,
            self.config.scan_on_startup,
            self.next_run_at,
        )

        self._task = asyncio.create_task(self._run_loop(), name="ringtrace-detection-scheduler")

    async def stop(self, grace_period_seconds: float = 10.0) -> None:
        """Stop the scheduler and wait for any ongoing trigger within a grace period."""
        if not self._running and not self._task:
            return

        logger.info("Stopping fraud detection scheduler (grace_period=%.1fs)...", grace_period_seconds)
        self._running = False
        self._stop_event.set()
        set_shutting_down(True)

        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=grace_period_seconds)
            except asyncio.TimeoutError:
                logger.warning("Scheduler task did not stop within grace period; cancelling")
                self._task.cancel()
                try:
                    await self._task
                except (asyncio.CancelledError, Exception):
                    pass
            except asyncio.CancelledError:
                pass
            except Exception as err:
                logger.error("Error while stopping scheduler task: %s", err)

        self._task = None
        self._next_run_time = None
        logger.info("Fraud detection scheduler stopped cleanly")

    async def _run_loop(self) -> None:
        """Main periodic loop."""
        try:
            # 1. Startup scan if configured
            if self.config.scan_on_startup:
                await self._execute_scheduled_pass()

            # 2. Main periodic loop
            while self._running and not self._stop_event.is_set():
                now = datetime.now(timezone.utc)
                self._next_run_time = now + timedelta(seconds=self.config.interval_seconds)

                try:
                    # Wait for interval duration, or wake up immediately if stop was signaled
                    await asyncio.wait_for(self._stop_event.wait(), timeout=self.config.interval_seconds)
                    # If stop_event was signaled, break out cleanly
                    break
                except asyncio.TimeoutError:
                    # Timer expired, time to trigger a scan
                    if not self._running or self._stop_event.is_set():
                        break
                    await self._execute_scheduled_pass()

        except asyncio.CancelledError:
            logger.debug("Scheduler loop task received cancellation")
        except Exception as err:
            logger.exception("Unexpected exception in scheduler loop: %s", err)
            self._running = False
        finally:
            self._next_run_time = None

    async def _execute_scheduled_pass(self) -> Optional[str]:
        """Execute a single scheduled scan in a worker thread to keep asyncio responsive."""
        self._run_count += 1
        self._last_run_time = datetime.now(timezone.utc)
        logger.info("Triggering scheduled fraud detection scan (#%d)...", self._run_count)

        try:
            scan_id = await asyncio.wait_for(
                asyncio.to_thread(
                    execute_scan,
                    db=self.db_client,
                    graph_name=self.graph_name,
                    memory_graph=self.memory_graph,
                    trigger="scheduled",
                    lookback_seconds=self.config.lookback_seconds,
                ),
                timeout=float(self.config.timeout_seconds),
            )

            job = get_scan_job(scan_id)
            if job:
                status = job.get("status")
                if status == "skipped":
                    self._skip_count += 1
                    logger.warning("Scheduled scan %s was skipped: %s", scan_id, job.get("error_summary"))
                elif status == "failed":
                    self._failure_count += 1
                    logger.error("Scheduled scan %s failed: %s", scan_id, job.get("error_summary"))
                else:
                    hits = job.get("hits_found", 0)
                    cases = job.get("cases_created_or_updated", 0)
                    logger.info("Scheduled scan %s completed (status=%s, hits=%d, cases=%d)", scan_id, status, hits, cases)
            return scan_id

        except asyncio.TimeoutError:
            self._failure_count += 1
            logger.warning(
                "Scheduled scan iteration exceeded supervisory timeout of %ds. "
                "Note: A configured timeout cannot forcefully terminate a blocking database query thread; "
                "the scan thread will complete naturally at the next check or database boundary.",
                self.config.timeout_seconds,
            )
            active_id = get_active_scan_id()
            if active_id:
                update_scan_job(active_id, {
                    "error_summary": (
                        f"Supervisory scheduler timeout exceeded ({self.config.timeout_seconds}s). "
                        "Query thread is running to completion in background."
                    )
                })
            return None

        except Exception as err:
            self._failure_count += 1
            logger.exception("Scheduled detection scan iteration failed: %s", err)
            return None

    def get_status(self) -> Dict[str, Any]:
        """Return diagnostic state of the scheduler and latest run information."""
        latest = get_latest_scan_job()
        return {
            "enabled": self.config.enabled,
            "running": self.is_running,
            "interval_seconds": self.config.interval_seconds,
            "scan_on_startup": self.config.scan_on_startup,
            "next_run_at": self.next_run_at,
            "last_run_at": self.last_run_at,
            "run_count": self._run_count,
            "failure_count": self._failure_count,
            "skip_count": self._skip_count,
            "is_scan_active": is_scan_active(),
            "active_scan_id": get_active_scan_id(),
            "latest_scan": latest,
        }


# Global singleton instance managed by FastAPI lifespan
_global_scheduler: Optional[DetectionScheduler] = None
_global_scheduler_lock = threading.Lock()


def get_scheduler() -> Optional[DetectionScheduler]:
    """Return the global scheduler instance if initialized."""
    with _global_scheduler_lock:
        return _global_scheduler


def init_scheduler(
    db_client: FalkorDBClient,
    graph_name: str = "txn",
    memory_graph: str = "memory",
    config: Optional[SchedulerConfig] = None,
) -> DetectionScheduler:
    """Initialize or update the global scheduler instance."""
    global _global_scheduler
    with _global_scheduler_lock:
        if _global_scheduler is not None and _global_scheduler.is_running:
            return _global_scheduler
        _global_scheduler = DetectionScheduler(
            db_client=db_client,
            graph_name=graph_name,
            memory_graph=memory_graph,
            config=config,
        )
        return _global_scheduler


async def shutdown_scheduler(grace_period: float = 10.0) -> None:
    """Shut down the global scheduler gracefully."""
    global _global_scheduler
    set_shutting_down(True)
    with _global_scheduler_lock:
        scheduler = _global_scheduler
        _global_scheduler = None

    if scheduler:
        await scheduler.stop(grace_period_seconds=grace_period)
