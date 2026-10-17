# SPYNEX Railway Deployment

This guide records the deployment settings verified from the repository. It does not deploy services or change Railway project settings.

## Backend service

- **Repository root directory:** `SPYNEX/backend` after the requested folder rename.
- **Builder:** Railway Railpack (Python is detected from `requirements.txt`).
- **Python:** `3.11`, pinned in [`backend/.python-version`](../backend/.python-version). Python 3.10 reached end-of-life on 2026-10-01; this workspace only has 3.10 installed, so run the dependency/test suite on 3.11 before treating runtime compatibility as verified.
- **Install command:** leave blank for Railpack to install `requirements.txt`.
- **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Healthcheck path:** `/readyz`. This returns 200 only when the app can ping FalkorDB. `/healthz` is process liveness and does not test the database.
- **Public networking:** create a Railway HTTP domain for the API. Do not expose the database service publicly.
- **Replicas:** use one API replica while the scheduler, replay worker and investigation event listeners are in-process. Multiple replicas would each start their own scheduler and would not share in-memory task/SSE state.

The application entry point is `app.main:app` from this working directory. The `uvicorn` command binds to Railway's runtime `PORT`; port 8000 is only the existing local development default.

## Required backend variables

Configure values in the Railway backend service's Variables panel. Do not commit real values in either `.env` file.

| Variable | Purpose |
|---|---|
| `FALKORDB_HOST` | FalkorDB service's private hostname, for example `<database-service>.railway.internal`. |
| `FALKORDB_PORT` | Private FalkorDB port, normally `6379`; do not add a public TCP proxy. |
| `FALKORDB_USERNAME` | Optional ACL username, if configured on the database. Leave empty for password-only auth. |
| `FALKORDB_PASSWORD` | Database password; use the same value configured on the FalkorDB service. |
| `FALKORDB_TIMEOUT_SECONDS` | Socket and connect timeout; default `5`, must be greater than 0 and at most `30`. |
| `FALKORDB_GRAPH` | Transaction graph name, normally `txn`. |
| `FALKORDB_MEMORY_GRAPH` | Case and investigation memory graph name, normally `memory`. |
| `CORS_ORIGINS` | Comma-separated exact browser origins, including the deployed Vercel origin and any required preview origin. No wildcard. |
| `RINGTRACE_DEMO_KEY` | Strong secret sent in the `X-Demo-Key` header for scenario injection and demo reset. Required on Railway; missing configuration disables reset with 503. |
| `GEMINI_API_KEY` | Optional provider key for LLM investigations. The deterministic fallback remains available when the key is absent or the provider fails. |
| `GEMINI_MODEL` | Model name used by the existing agent, if the API key is configured. |
| `DETECTION_SCHEDULER_ENABLED` | Set to `false` to disable the in-process scheduler; otherwise it starts using existing scheduler defaults. |

`PORT` is injected by Railway and should not be set manually. The API accepts the prior `DEMO_KEY` as a compatibility fallback, but use only `RINGTRACE_DEMO_KEY` for new deployments.

The frontend currently reads `VITE_API_URL` at build time. In Vercel, set it to the public API base ending in `/api`, such as `https://<api-domain>/api`. Set the backend `CORS_ORIGINS` to the exact Vercel origin, such as `https://<frontend-domain>` (no path or trailing slash). Local Vite development continues to use `/api` and its existing proxy.

## FalkorDB service and persistence

Run FalkorDB as a separate Railway service in the same Railway environment as the API. Connect with its private hostname and port 6379. Keep public TCP proxying disabled.

For the `falkordb/falkordb-server` image, the current image documentation identifies `/var/lib/falkordb/data` as the data path. Attach a Railway Volume to that path. Verify the selected image tag's `FALKORDB_DATA_PATH` before mounting; do not mix the alternative `/data` examples from other FalkorDB image variants. Configure the server with `REDIS_ARGS` to require a strong password and enable append-only persistence, for example `--requirepass <secret> --appendonly yes --appendfsync everysec`. Do not place the literal password in a committed file. The API's `FALKORDB_PASSWORD` must match.

A mounted volume retains files across service restarts, but it is not a backup by itself. Enable Railway volume backups where available, keep an independent graph export outside the volume, and periodically test restoring a backup into a separate database before relying on it.

## Verified architecture and operating limits

- `backend/app/main.py` creates the single FastAPI application and registers detection, investigation and replay routers. The existing route paths remain available.
- `backend/app/db.py` is the only FalkorDB client. It now accepts optional username/password and bounded socket/connect timeouts from environment variables.
- `/healthz` is a no-database liveness check. `/readyz` pings the configured transaction graph and returns 503 without exposing the underlying exception. The legacy `/api/health` shape remains available with a generic error message.
- CORS uses explicit `CORS_ORIGINS`, with localhost development defaults. Credentials remain enabled only for those explicit origins.
- Both investigation and replay SSE routes emit `text/event-stream`, disable proxy buffering, and send periodic heartbeats. A disconnect or deploy still ends the connection; clients must reconnect.
- The scheduler, replay worker and active investigation/event queues are in process memory. They do not survive restarts and are not coordinated across replicas. Keep one replica unless the project later adopts shared/distributed task state.
- `POST /demo/reset` can clear memory data and delete `demo_` transaction data. On a Railway deployment it rejects requests with 503 if `RINGTRACE_DEMO_KEY` is missing and requires a matching `X-Demo-Key` otherwise. Scenario injection uses the same configured key. Other write endpoints retain their existing authorization behavior; this audit does not add a general authentication system.
- No Dockerfile or Compose file is present, so the backend can deploy directly from Railpack. Docker build validation is not available in this environment.

## References

- [Railway FastAPI host and port requirements](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Railway volumes](https://docs.railway.com/volumes)
- [Railway Python version configuration](https://github.com/railwayapp/railpack/blob/main/docs/src/content/docs/languages/python.md)
- [Python supported-version status](https://devguide.python.org/versions/)
- [FalkorDB server image storage path](https://hub.docker.com/r/falkordb/falkordb-server)
