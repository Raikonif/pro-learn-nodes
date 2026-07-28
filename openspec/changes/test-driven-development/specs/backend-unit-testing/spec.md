## ADDED Requirements

### Requirement: Pytest Configured and Operational
The backend SHALL have Pytest configured in `pyproject.toml` under `[tool.pytest.ini_options]` or a separate `pytest.ini`. Running `pytest` SHALL execute all `*.test.py` files.

### Requirement: pytest-asyncio Available
`pytest-asyncio` SHALL be installed and configured so async test functions (`async def test_`) are runnable with the `@pytest.mark.asyncio` decorator.

### Requirement: httpx AsyncClient Available
`httpx` with `pytest-httpx` or `httpx.AsyncClient` SHALL be available for integration testing FastAPI routes without making real HTTP calls.

### Requirement: Co-located Python Test Files
Each service module under `backend/service/` SHALL have a co-located `test_*.py` file. Each repository module under `backend/repository/` SHALL have a co-located `test_*.py` file.

### Requirement: Backend Test Fixtures
A `backend/tests/conftest.py` SHALL provide shared fixtures:
- A test database (SQLite in-memory or temporary file)
- An `AsyncClient` for route integration tests

### Requirement: First Tests Cover Skeleton
The initial test suite SHALL include:
- A smoke test for `GET /health` returning `{"status": "ok"}`
- A smoke test verifying FastAPI app initializes without errors

#### Scenario: pytest runs successfully
- **WHEN** a developer runs `pytest` in `backend/`
- **THEN** all `*.test.py` files are discovered and run, and pytest exits with code 0

#### Scenario: Health endpoint integration test
- **WHEN** `pytest backend/tests/test_api_routes.py` runs
- **THEN** there is a test that calls `GET /health` and asserts the response is `{"status": "ok", "backend": "fastapi"}`
