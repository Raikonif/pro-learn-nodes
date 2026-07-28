## ADDED Requirements

### Requirement: API Layer Handles HTTP Semantics Only
The `backend/api/` layer SHALL contain only HTTP-related code: FastAPI routers in `api/routes/`, Pydantic request/response schemas in `api/schemas/`, and FastAPI dependencies in `api/dependencies/`. Business logic SHALL NOT live here.

### Requirement: Service Layer Contains Business Logic
The `backend/service/` layer SHALL contain all business logic independent of HTTP concerns. Services SHALL be plain Python classes/functions that take domain objects and return domain objects. Services SHALL NOT import FastAPI dependencies or routers.

### Requirement: Repository Layer Handles Data Access
The `backend/repository/` layer SHALL handle all database access. Repositories SHALL contain SQLModel queries and CRUD operations. Repositories SHALL NOT contain business logic.

### Requirement: Models Define Domain Entities
The `backend/models/` layer SHALL contain SQLModel class definitions representing domain entities (Node, ChatMessage, Correction, etc.). Models SHALL be importable from all other layers.

### Requirement: Core Contains Shared Infrastructure
The `backend/core/` layer SHALL contain shared infrastructure: `config.py` for settings, `database.py` for the SQLite connection, and `exceptions.py` for domain-specific exceptions.

### Requirement: Layer Dependency Direction
Layer dependencies SHALL flow in this order: `api` → `service` → `repository` → `models`. The `core/` layer is shared and may be imported from any layer. Direct calls from `api` to `repository` SHALL NOT occur.

#### Scenario: API calls service
- **WHEN** a FastAPI route handler needs to create a node
- **THEN** it SHALL call `node_service.create_node(...)` and return the result formatted as a Pydantic response schema

#### Scenario: Service calls repository
- **WHEN** `NodeService.create_node()` needs to persist a node
- **THEN** it SHALL call `node_repo.create(...)` with a domain object, not construct SQL directly

#### Scenario: Repository accesses database
- **WHEN** `node_repo.create()` runs
- **THEN** it SHALL use the SQLModel session to persist the Node model and return the created entity

#### Scenario: Direct API-to-repository call
- **WHEN** a route handler attempts to call `node_repo.create()` directly
- **THEN** a linting rule SHALL flag this as a violation of layer boundaries
