# dev-port-allocation Specification

## Purpose

Gives the development loop deterministic, collision-tolerant ports: known defaults a developer can rely on, automatic fallback when those defaults are taken, and one clear rule for which process picks a port and which merely finds one already chosen.

## Requirements

### Requirement: Default development ports
The development frontend SHALL default to port `5177` and the development backend SHALL default to port `8009`. These defaults SHALL be used whenever the ports are available.

#### Scenario: Both defaults are free
- **WHEN** a developer starts the dev loop and neither `5177` nor `8009` is in use
- **THEN** the frontend serves on `5177` and the backend serves on `8009`

### Requirement: Automatic fallback to an available port
When a default port is unavailable, allocation SHALL select the next available port by scanning upward from the default. Scanning SHALL be bounded, and exhausting the bound SHALL fail with an error naming the port range that was tried. Allocation SHALL NOT silently reuse a port already held by another process.

#### Scenario: A default port is occupied
- **WHEN** another process is listening on `8009` and the developer starts the dev loop
- **THEN** the backend is allocated the next free port above `8009`, and the chosen port is reported to the developer

#### Scenario: Both defaults are occupied
- **WHEN** `5177` and `8009` are both in use
- **THEN** the frontend and backend are each allocated their own next free port, and neither collides with the other

#### Scenario: No port available in range
- **WHEN** every port in the scan range is occupied
- **THEN** startup fails with an error naming the range that was tried, rather than starting on an arbitrary port

### Requirement: A process allocates only the ports it binds, and discovers the rest
A process SHALL perform availability-based allocation only for ports it will itself bind. For a port bound by another process, it SHALL discover the value instead. Availability scanning SHALL NOT be used to determine where an already-running server is listening, because an occupied port is indistinguishable from the very server the consumer needs to reach.

Allocation SHALL complete before the allocating process binds, and SHALL happen once per process tree. No consumer SHALL discover a port by parsing another process's output, nor allocate independently when a value has already been supplied to it.

#### Scenario: Allocation precedes binding
- **WHEN** a process that will bind a port starts
- **THEN** it resolves that port before binding, and passes the resolved value to any process it spawns

#### Scenario: Supplied values are authoritative
- **WHEN** a consumer starts with a port value already present in its environment
- **THEN** it uses that value and does not perform its own allocation

#### Scenario: A consumer that only connects does not scan
- **WHEN** the dev server needs the backend's port and the backend is already running on it
- **THEN** the dev server discovers the running backend's port, rather than scanning for a free port and selecting a different one

#### Scenario: A standalone consumer allocates for its own process tree
- **WHEN** a consumer that starts both servers runs with no allocated values present, such as the E2E suite run directly
- **THEN** it performs one allocation and supplies those values to every process it starts

### Requirement: A bound backend port is discoverable across terminals
A process that binds the backend port SHALL record it where a separately launched process can read it. A consumer needing the backend SHALL resolve it in this order: an explicitly supplied value, then the recorded value, then the default.

A recorded value SHALL be verified before use by confirming the port serves this application's health endpoint. An unverified or unreachable candidate SHALL NOT be silently trusted; the consumer SHALL fall through to the next candidate, and SHALL warn naming each candidate it tried when none verifies.

#### Scenario: Backend started in a separate terminal is found
- **WHEN** the backend is started in one terminal on an allocated port, and the dev server is started in another
- **THEN** the dev server proxies to the port the backend actually bound

#### Scenario: A stale record is not trusted
- **WHEN** a recorded backend port is left behind by an exited process and nothing is listening there
- **THEN** the consumer does not use it, falls through to the default, and reports which candidates it tried

#### Scenario: An unrelated process holds the recorded port
- **WHEN** a process that is not this application's backend is listening on the recorded port
- **THEN** the health verification fails, the candidate is rejected, and the consumer falls through rather than proxying to an unrelated service

#### Scenario: Frontend-only work with the backend stopped
- **WHEN** the developer starts the dev server with no backend running at all
- **THEN** the dev server still starts, warns that no backend was verified, and leaves backend requests to fail visibly at request time

### Requirement: Allocated ports reach every consumer
The allocated frontend port SHALL be applied to the Vite dev server, the Tauri `devUrl`, and the Playwright `baseURL`. The allocated backend port SHALL be applied to the uvicorn command, the Vite proxy target, and the backend origin the Playwright suite waits on. No consumer SHALL retain a hardcoded port.

#### Scenario: Frontend port reaches its consumers
- **WHEN** the frontend port is allocated as something other than `5177`
- **THEN** Vite serves on that port, the Tauri window loads that origin, and the E2E suite navigates to that origin

#### Scenario: Backend port reaches its consumers
- **WHEN** the backend port is allocated as something other than `8009`
- **THEN** uvicorn binds that port and the Vite proxy forwards to that port

### Requirement: The frontend port is pinned once allocated
The Vite dev server SHALL be configured to fail rather than select a different port when its allocated port is unavailable at bind time. Allocation already established the port was free, so a conflict at bind time indicates a race or a stale process and SHALL surface as an error.

#### Scenario: Port taken between allocation and bind
- **WHEN** another process claims the allocated frontend port after allocation but before Vite binds
- **THEN** Vite fails with a port-conflict error rather than serving on a different port that no other consumer knows about

### Requirement: Allocated ports are reported to the developer
The dev loop SHALL print the allocated frontend and backend ports at startup, and SHALL indicate when a port differs from its default.

#### Scenario: Non-default port is surfaced
- **WHEN** the backend is allocated a port other than `8009`
- **THEN** startup output states which port was chosen and that the default was unavailable
