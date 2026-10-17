"""Configuration for the periodic fraud detection scheduler."""
import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class SchedulerConfig:
    """Validated settings for the fraud detection scheduler."""

    enabled: bool = True
    interval_seconds: int = 300
    scan_on_startup: bool = False
    lookback_seconds: Optional[int] = None
    timeout_seconds: int = 120
    history_limit: int = 100

    @classmethod
    def from_env(cls) -> "SchedulerConfig":
        """Load and validate scheduler configuration from environment variables."""
        raw_enabled = os.getenv("DETECTION_SCHEDULER_ENABLED", "true").strip().lower()
        enabled = raw_enabled in {"1", "true", "yes", "on"}

        raw_interval = os.getenv("DETECTION_SCAN_INTERVAL_SECONDS", "300").strip()
        try:
            interval_seconds = int(raw_interval)
        except ValueError as err:
            raise ValueError(
                f"Invalid DETECTION_SCAN_INTERVAL_SECONDS '{raw_interval}': must be an integer"
            ) from err

        if interval_seconds <= 0:
            raise ValueError(
                f"Invalid DETECTION_SCAN_INTERVAL_SECONDS ({interval_seconds}): must be positive (> 0)"
            )

        raw_on_startup = os.getenv("DETECTION_SCAN_ON_STARTUP", "false").strip().lower()
        scan_on_startup = raw_on_startup in {"1", "true", "yes", "on"}

        raw_lookback = os.getenv("DETECTION_SCAN_LOOKBACK_SECONDS")
        lookback_seconds: Optional[int] = None
        if raw_lookback is not None and raw_lookback.strip():
            try:
                lookback_seconds = int(raw_lookback.strip())
                if lookback_seconds <= 0:
                    raise ValueError(
                        f"Invalid DETECTION_SCAN_LOOKBACK_SECONDS ({lookback_seconds}): must be positive"
                    )
            except ValueError as err:
                raise ValueError(
                    f"Invalid DETECTION_SCAN_LOOKBACK_SECONDS '{raw_lookback}': must be a positive integer"
                ) from err

        raw_timeout = os.getenv("DETECTION_SCAN_TIMEOUT_SECONDS", "120").strip()
        try:
            timeout_seconds = int(raw_timeout)
        except ValueError as err:
            raise ValueError(
                f"Invalid DETECTION_SCAN_TIMEOUT_SECONDS '{raw_timeout}': must be an integer"
            ) from err

        if timeout_seconds <= 0:
            raise ValueError(
                f"Invalid DETECTION_SCAN_TIMEOUT_SECONDS ({timeout_seconds}): must be positive (> 0)"
            )

        raw_history_limit = os.getenv("DETECTION_SCAN_HISTORY_LIMIT", "100").strip()
        try:
            history_limit = int(raw_history_limit)
        except ValueError as err:
            raise ValueError(
                f"Invalid DETECTION_SCAN_HISTORY_LIMIT '{raw_history_limit}': must be an integer"
            ) from err

        if history_limit <= 0:
            raise ValueError(
                f"Invalid DETECTION_SCAN_HISTORY_LIMIT ({history_limit}): must be positive (> 0)"
            )

        return cls(
            enabled=enabled,
            interval_seconds=interval_seconds,
            scan_on_startup=scan_on_startup,
            lookback_seconds=lookback_seconds,
            timeout_seconds=timeout_seconds,
            history_limit=history_limit,
        )
