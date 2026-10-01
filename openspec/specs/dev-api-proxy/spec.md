# dev-api-proxy Specification

## Purpose

Defines how the frontend reaches the backend during development: through the Vite dev-server proxy under an `/api` prefix, so browser traffic stays same-origin and cross-origin permissions are not part of the normal dev loop.

## Requirements

### Requirement: Development frontend requests are same-origin
In development, the browser SHALL issue backend requests to the Vite dev server's own origin. The browser SHALL NOT be the party that contacts the backend origin directly. The dev server SHALL forward those requests to the backend server-side.

#### Scenario: Browser talks only to the dev server
- **WHEN** the frontend requests `/health` in development
- **THEN** the browser issues the request to the Vite dev server origin, and the Vite dev server forwards it to the backend

#### Scenario: No preflight in the dev loop
- **WHEN** the frontend issues any backend request through the dev server in development
- **THEN** the browser treats it as same-origin and performs no CORS preflight

### Requirement: Backend requests are namespaced under /api and rewritten in transit
Frontend requests SHALL be addressed to paths prefixed with `/api`. The dev server SHALL strip that prefix before forwarding, so the backend continues to serve its routes at their existing paths. Backend route definitions and their tests SHALL NOT change to accommodate the prefix.

#### Scenario: Prefix is stripped in transit
- **WHEN** the frontend requests `/api/health`
- **THEN** the dev server forwards a request for `/health` to the backend, and the backend responds from its existing `/health` route

#### Scenario: Backend routes are unchanged
- **WHEN** the backend test suite exercises `/health` directly
- **THEN** it passes unchanged, because the prefix exists only between the browser and the dev server

### Requirement: Only the API client constructs backend paths
The single API client module SHALL be the only place that applies the `/api` prefix. Feature code SHALL continue to pass unprefixed paths such as `/health`. No feature code SHALL construct an absolute backend origin or apply the prefix itself.

#### Scenario: Caller passes an unprefixed path
- **WHEN** a caller invokes the API client with `/health`
- **THEN** the client issues the request to `/api/health` in development, and the caller is unaware of the prefix

#### Scenario: Production transport is unaffected
- **WHEN** the app runs from a bundled build using the Unix socket transport
- **THEN** the client reaches the backend over the socket and the `/api` prefix and proxy play no part

### Requirement: Credentialed cross-origin requests are not permitted
The backend SHALL NOT enable credentialed cross-origin requests. No feature SHALL depend on cookies crossing an origin boundary.

#### Scenario: Credentials are disabled
- **WHEN** the backend's CORS middleware is configured
- **THEN** credentials are disabled, and no response advertises that credentialed cross-origin requests are accepted

### Requirement: The cross-origin allowlist is configurable and defaults to the allocated frontend origin
The backend's permitted origins SHALL be configurable through the environment. When unset, the allowlist SHALL default to the allocated frontend origin on both `localhost` and `127.0.0.1`, which are distinct origins to a browser. The allowlist SHALL NOT be a hardcoded literal port, and SHALL NOT be a wildcard.

#### Scenario: Default allowlist follows the allocated port
- **WHEN** the frontend is allocated a port and no origin override is set
- **THEN** the backend permits that origin on both `localhost` and `127.0.0.1`

#### Scenario: Direct access bypassing the proxy still works
- **WHEN** a developer points the frontend at the backend origin directly instead of through the proxy
- **THEN** the request is permitted, because the allocated frontend origin is on the allowlist

#### Scenario: Wildcard is rejected
- **WHEN** the backend's permitted origins are configured
- **THEN** the configuration is an explicit list of origins and never a wildcard
