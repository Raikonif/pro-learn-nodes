# Backend Layered Architecture

## Purpose

Define clear boundaries between HTTP handling, business logic, persistence, domain models, and shared infrastructure in the backend.

## Requirements

### Requirement: API Layer Handles HTTP Semantics Only
The `backend/api/` layer SHALL contain only HTTP-related code: FastAPI routers in `api/routes/`, Pydantic request/response schemas in `api/schemas/`, and FastAPI dependencies in `api/dependencies/`. Business logic SHALL NOT live here.

#### Scenario: API calls service
- **WHEN** a FastAPI route handler needs to create a node
- **THEN** it SHALL call `node_service.create_node(...)` and return the result formatted as a Pydantic response schema

#### Scenario: Health route placement
- **WHEN** the `/health` endpoint is layered
- **THEN** its handler lives in `backend/api/routes/health.py` as an `APIRouter`, and `backend/main.py` mounts it rather than defining it inline

### Requirement: Service Layer Contains Business Logic
The `backend/service/` layer SHALL contain all business logic independent of HTTP concerns. Services SHALL be plain Python classes/functions that take domain objects and return domain objects. Services SHALL NOT import FastAPI dependencies or routers.

#### Scenario: Service calls repository
- **WHEN** `NodeService.create_node()` needs to persist a node
- **THEN** it SHALL call `node_repo.create(...)` with a domain object, not construct SQL directly

#### Scenario: Service stays HTTP-agnostic
- **WHEN** a service module is imported
- **THEN** it SHALL NOT import `fastapi`, `Request`, `Depends`, or any router

#### Scenario: Trivial endpoint needs no service
- **WHEN** an endpoint such as `/health` returns a static payload with no business logic
- **THEN** no service module SHALL be created for it — the route is the whole implementation

### Requirement: Repository Layer Handles Data Access
The `backend/repository/` layer SHALL handle all database access. Repositories SHALL contain SQLModel queries and CRUD operations. Repositories SHALL NOT contain business logic.

#### Scenario: Repository accesses database
- **WHEN** `node_repo.create()` runs
- **THEN** it SHALL use the SQLModel session to persist the Node model and return the created entity

### Requirement: Models Define Domain Entities
The `backend/models/` layer SHALL contain SQLModel class definitions representing domain entities (Node, ChatMessage, Correction, etc.). Models SHALL be importable from all other layers.

#### Scenario: Model imported across layers
- **WHEN** a service, repository, or route needs the `Node` type
- **THEN** it SHALL import it from `backend/models/` without violating layer rules

### Requirement: Core Contains Shared Infrastructure
The `backend/core/` layer SHALL contain shared infrastructure: `config.py` for settings, `database.py` for the SQLite connection, and `exceptions.py` for domain-specific exceptions. Within this change these modules SHALL be minimal placeholders; real database wiring is deferred to the data-model phase.

#### Scenario: Core created as placeholders
- **WHEN** `backend/core/` is created by this change
- **THEN** `config.py`, `database.py`, and `exceptions.py` exist with minimal contents and no live SQLite connection is established

### Requirement: Layer Dependency Direction
Layer dependencies SHALL flow in this order: `api` → `service` → `repository` → `models`. The `core/` layer is shared and may be imported from any layer. Direct calls from `api` to `repository` SHALL NOT occur.

#### Scenario: Direct API-to-repository call
- **WHEN** a route handler calls `node_repo.create()` directly, bypassing the service layer
- **THEN** this is a violation of layer boundaries and SHALL be rejected in code review. Automated enforcement via an import-linter rule is deferred to a later phase and is NOT part of this change.

### Requirement: Main Remains The ASGI Entry Point
`backend/main.py` SHALL remain the ASGI entry point exposing `app`, so that `uvicorn main:app` continues to work. It SHALL be reduced to app construction, middleware registration, and router mounting.

#### Scenario: Entry point stability after layering
- **WHEN** the backend is restructured into layers
- **THEN** `uv run uvicorn main:app` from `backend/` still starts the server, and `backend/tests/` continues to import the app successfully
