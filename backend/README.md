# Backend — Learn Nodes

FastAPI + SQLModel + Python 3.13+. Package management via [uv](https://docs.astral.sh/uv/).

## Scripts

| Command | What it does |
|---|---|
| `uv sync` | Install runtime dependencies |
| `uv sync --extra test` | Install runtime + test dependencies |
| `uv run uvicorn main:app --reload --port 8000` | Run the API on `localhost:8000` |
| `uv run pytest` | Run the test suite |

## Testing

- **Runner:** `pytest` with `pytest-asyncio` (asyncio mode = auto) and `httpx` for in-process route testing.
- **Discovery:** `test_*.py` under `tests/` (configured in `[tool.pytest.ini_options]`).

### Layout — two kinds of tests, two locations

| Kind | Location | Pattern |
|---|---|---|
| **Unit tests** | Co-located with the source under test | `backend/service/test_*.py`, `backend/repository/test_*.py` |
| **Integration tests** | `backend/tests/` | `backend/tests/test_*.py` (httpx `AsyncClient` against the FastAPI app) |

The top-level `backend/tests/` directory exists for **shared fixtures (`conftest.py`) and integration tests only** — it is not a general "all backend tests" directory. Unit tests live next to the module they cover.

### Fixtures (`backend/tests/conftest.py`)
- `async_client` — `httpx.AsyncClient` wired to the FastAPI app via `ASGITransport`. Use for any test that exercises routes without a real network.

### Conventions
- **Co-locate unit tests.** Adding a service or repository module requires a sibling `test_*.py`. New unit tests go next to the module they test.
- **Test services and repositories, not routes.** Routes are thin and change often; the business logic lives in services. Exercise logic through the service layer and use httpx for the request/response contract.
- **Mock only external dependencies.** LLM providers, MCP servers, the network. Internal services should be exercised through real call paths.
- **Async by default.** Test functions may be `async def` — `pytest-asyncio` is in auto mode, no decorator required.

### CI — GitHub Actions
- `.github/workflows/test.yml` runs `uv run pytest` on every PR.