"""Deployment configuration checks that do not require FalkorDB or touch graph data."""
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi import HTTPException
from fastapi import BackgroundTasks

from app import db
from app.api.detection_routes import ScenarioRequest, inject_scenario
from app.api.stream_routes import reset_demo_environment
from app.main import app, configured_cors_origins, db_client, get_health, liveness_check, readiness_check


class DeploymentReadinessTests(unittest.TestCase):
    def test_app_import_and_existing_routes(self):
        paths = app.openapi()["paths"]
        registered_paths = {getattr(route, "path", None) for route in app.routes}
        self.assertIn("/healthz", registered_paths)
        self.assertIn("/readyz", registered_paths)
        for path in (
            "/api/health",
            "/api/v1/scan",
            "/api/v1/cases",
            "/api/v1/cases/{case_id}/investigations",
            "/api/v1/stream/events",
            "/api/v1/demo/reset",
        ):
            self.assertIn(path, paths)

    def test_cors_requires_explicit_origins_and_accepts_multiple(self):
        with patch.dict(os.environ, {"CORS_ORIGINS": "https://spynex.example, https://preview.example/"}, clear=True):
            self.assertEqual(
                configured_cors_origins(),
                ["https://spynex.example", "https://preview.example"],
            )
        with patch.dict(os.environ, {"CORS_ORIGINS": "*"}, clear=True):
            with self.assertRaises(ValueError):
                configured_cors_origins()

    def test_configured_local_origin_passes_cors(self):
        cors = next(middleware for middleware in app.user_middleware if middleware.cls.__name__ == "CORSMiddleware")
        self.assertIn("http://localhost:5173", cors.kwargs["allow_origins"])
        self.assertTrue(cors.kwargs["allow_credentials"])
        self.assertNotIn("*", cors.kwargs["allow_origins"])

    def test_liveness_does_not_use_database(self):
        with patch.object(db_client, "execute_query", side_effect=AssertionError("must not query DB")):
            self.assertEqual(liveness_check(), {"status": "ok"})

    def test_readiness_uses_database_and_fails_closed(self):
        with patch.object(db_client, "execute_query", return_value=SimpleNamespace(result_set=[[1]])):
            self.assertEqual(readiness_check(), {"status": "ready", "database": "connected"})
        with patch.object(db_client, "execute_query", side_effect=RuntimeError("private error details")):
            with self.assertRaises(HTTPException) as raised:
                readiness_check()
        self.assertEqual(raised.exception.status_code, 503)
        self.assertNotIn("private error details", str(raised.exception.detail))

    def test_legacy_health_sanitizes_database_exception(self):
        with patch.object(db_client, "execute_query", side_effect=RuntimeError("private error details")):
            response = get_health()
        self.assertEqual(response["status"], "degraded")
        self.assertFalse(response["falkordb_connected"])
        self.assertNotIn("private error details", response["error"])
        self.assertEqual(response["host"], "configured")

    def test_legacy_health_does_not_expose_database_host_when_connected(self):
        with patch.object(db_client, "host", "falkordb.internal"), patch.object(
            db_client, "execute_query", return_value=SimpleNamespace(result_set=[[1]])
        ):
            response = get_health()
        self.assertEqual(response["status"], "healthy")
        self.assertEqual(response["host"], "configured")

    def test_database_client_supports_secret_and_bounded_timeouts(self):
        with patch.object(db, "FalkorDB") as client_factory:
            client = db.FalkorDBClient(
                host="falkordb.railway.internal",
                port=6379,
                username="default",
                password="test-secret",
                timeout_seconds=3,
            )
            _ = client.client
        client_factory.assert_called_once_with(
            host="falkordb.railway.internal",
            port=6379,
            username="default",
            password="test-secret",
            socket_timeout=3,
            socket_connect_timeout=3,
        )
        with self.assertRaises(ValueError):
            db.FalkorDBClient(timeout_seconds=0)
        with self.assertRaises(ValueError):
            db.FalkorDBClient(timeout_seconds=float("inf"))

    def test_demo_reset_requires_key_in_railway_and_checks_configured_key(self):
        with patch.dict(os.environ, {"RAILWAY_ENVIRONMENT_NAME": "production"}, clear=True):
            with self.assertRaises(HTTPException) as missing:
                reset_demo_environment(x_demo_key=None).send(None)
        self.assertEqual(missing.exception.status_code, 503)

        with patch.dict(os.environ, {"RINGTRACE_DEMO_KEY": "expected"}, clear=True):
            with self.assertRaises(HTTPException) as invalid:
                reset_demo_environment(x_demo_key="wrong").send(None)
        self.assertEqual(invalid.exception.status_code, 401)

    def test_scenario_injection_rejects_missing_key_before_database_access(self):
        with patch.dict(os.environ, {}, clear=True):
            response = inject_scenario(
                body=ScenarioRequest(scenario_id="cycle"),
                request=None,
                background_tasks=BackgroundTasks(),
                x_demo_key=None,
            )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
