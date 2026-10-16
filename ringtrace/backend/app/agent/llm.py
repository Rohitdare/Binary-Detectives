"""Centralized LLM client for RingTrace (Member B).

Per team architectural rules:
All AI and LLM calls MUST reside exclusively in this file.
No other module is allowed to call the model provider directly.

If GEMINI_API_KEY is not configured, or if the model call times out,
fails, or raises an error, an LLMCallError is raised so the agent loop
can gracefully fall back to the deterministic rule engine.
"""
import concurrent.futures
import os
from typing import Any, Callable, Dict, List, Optional

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None

DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
DEFAULT_TIMEOUT = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "10.0"))


class LLMCallError(Exception):
    """Raised when an LLM provider call fails, times out, or is unconfigured."""


class LLMTimeoutError(LLMCallError):
    """Raised when an LLM call exceeds the allowed response timeout."""


def get_api_key() -> str:
    """Retrieve Gemini API key from environment."""
    return os.getenv("GEMINI_API_KEY", "").strip()


def is_llm_available() -> bool:
    """Check if Gemini SDK is installed and an API key is present."""
    if genai is None:
        return False
    key = get_api_key()
    return bool(key and key != "your_actual_gemini_api_key_here")


def get_client() -> Any:
    """Get initialized google-genai Client."""
    if not is_llm_available():
        raise LLMCallError("Gemini LLM is not available: GEMINI_API_KEY is not set or SDK missing.")
    return genai.Client(api_key=get_api_key())


def generate_content_with_timeout(
    client: Any,
    model: str,
    contents: Any,
    config: Any,
    timeout_seconds: float = DEFAULT_TIMEOUT,
) -> Any:
    """Execute client.models.generate_content bounded by a hard timeout."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            client.models.generate_content,
            model=model,
            contents=contents,
            config=config,
        )
        try:
            return future.result(timeout=timeout_seconds)
        except concurrent.futures.TimeoutError:
            raise LLMTimeoutError(f"Gemini API call timed out after {timeout_seconds} seconds.")
        except Exception as e:
            raise LLMCallError(f"Gemini API call failed: {e}") from e
