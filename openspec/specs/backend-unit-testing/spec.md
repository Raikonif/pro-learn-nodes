# Backend Unit Testing

## Purpose

Define how the FastAPI backend is unit- and integration-tested: pytest as the runner, async support via pytest-asyncio, in-process route testing via httpx, and unit tests co-located with the service and repository modules they cover.

## Requirements

### Requirement: Pytest Configured and Operational
The backend SHALL have Pytest configured in `pyproject.toml` under `[tool.pytest.ini_options]` or a separate `pytest.ini`. Running `pytest` SHALL execute all `test_*.py` files.

#### Scenario: pytest runs successfully
- **WHEN** a developer runs `pytest` in `backend/`
- **THEN** all `test_*.py` files are discovered and run, and pytest exits with code 0

### Requirement: pytest-asyncio Available
`pytest-asyncio` SHALL be installed and configured so async test functions (`async def test_`) are runnable. Configuration SHALL set `asyncio_mode` so async tests are collected without each one needing an explicit marker.

#### Scenario: Async test is collected and run
- **WHEN** a test is declared as `async def test_something()`
- **THEN** pytest-asyncio runs it on an event loop rather than skipping it or reporting it as an un-awaited coroutine

### Requirement: httpx AsyncClient Available
`httpx` SHALL be available so FastAPI routes can be integration-tested in-process, without binding a real port or issuing real network calls.

#### Scenario: Route tested without a live server
- **WHEN** a test drives the app through `httpx.AsyncClient` with `ASGITransport`
- **THEN** the request reaches the FastAPI app in-process and returns a response, with no server listening on a TCP port

### Requirement: Co-located Python Test Files
Each service module under `backend/service/` SHALL have a co-located `test_*.py` file. Each repository module under `backend/repository/` SHALL have a co-located `test_*.py` file.

> The top-level `backend/tests/` directory exists for shared fixtures and integration tests only; unit tests are co-located with source per this requirement.

#### Scenario: Unit test sits beside its module
- **WHEN** a module is added at `backend/service/node_service.py`
- **THEN** its unit test is created at `backend/service/test_node_service.py`, not under `backend/tests/`

#### Scenario: Choosing between co-located and tests directory
- **WHEN** a test exercises a single service or repository module in isolation
- **THEN** it is co-located with that module; and when a test drives an HTTP route end-to-end or needs shared fixtures, it belongs under `backend/tests/`

### Requirement: Backend Test Fixtures
A `backend/tests/conftest.py` SHALL provide shared fixtures, including an `AsyncClient` bound to the FastAPI app for route integration tests.

> A test-database fixture is NOT yet part of this capability: no database exists in the project. It is introduced by the phase that adds the data model and migrations, at which point this requirement is extended.

#### Scenario: AsyncClient fixture is injectable
- **WHEN** a test function declares an `async_client` parameter
- **THEN** pytest injects the shared fixture from `conftest.py`, and the test can issue requests against the app without constructing a client itself

### Requirement: First Tests Cover Skeleton
The initial test suite SHALL include:
- A smoke test for `GET /health` returning `{"status": "ok"}`
- A smoke test verifying FastAPI app initializes without errors

#### Scenario: Health endpoint integration test
- **WHEN** `pytest backend/tests/test_health.py` runs
- **THEN** there is a test that calls `GET /health` and asserts the response is `{"status": "ok", "backend": "fastapi"}`
