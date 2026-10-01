# unified-dev-launch Specification

## Purpose

Brings up the entire development stack with one command, in an order that satisfies the dependency between the processes, so that a working session begins with a running app rather than with diagnosing which half of it failed to start.

## Requirements

### Requirement: One command starts the whole development stack
The system SHALL provide a single command that starts every process a developer needs to run the application locally. Running it on a freshly prepared checkout SHALL open the application window without any further command, environment variable, or terminal.

The existing per-process commands SHALL remain available and SHALL keep their current behavior, so that work on one side of the stack alone does not require running the other.

#### Scenario: A fresh checkout reaches the workspace
- **WHEN** a developer with installed dependencies runs the combined command on a checkout that has never been run
- **THEN** every required process starts, the application window opens, and the developer can complete sign-in and reach the workspace

#### Scenario: Single-process commands are unaffected
- **WHEN** a developer runs a per-process development command on its own
- **THEN** it behaves exactly as it did before the combined command existed

### Requirement: Dependent processes start only after what they depend on is answering
The system SHALL start each process only once the processes it must reach are confirmed to be serving, verified by a response that identifies the expected service rather than by an elapsed delay or an open socket.

Starting them concurrently SHALL NOT be treated as acceptable: a consumer that resolves its dependency by verifying a health response will resolve it as absent if it looks before that response is available, and will then run in a degraded mode that reports nothing about why.

#### Scenario: A slow dependency is waited for, not raced
- **WHEN** a depended-upon process takes several seconds to begin serving
- **THEN** the dependent process is not started until the dependency answers, and the started application reaches it successfully

#### Scenario: An occupied port is not mistaken for the dependency
- **WHEN** an unrelated process holds the port the dependency would normally use
- **THEN** the wait is not satisfied by that process, because the check requires a response identifying the expected service

### Requirement: A failed start names the process that failed and stops
The system SHALL report which process failed to start, SHALL surface that process's own error output, and SHALL stop rather than continue into a partially running stack. It SHALL NOT leave a started process running after the combined command has given up.

#### Scenario: A dependency never becomes available
- **WHEN** a required process fails to start or never begins serving within a bounded wait
- **THEN** the command reports which process failed and why, does not start the dependent processes, and exits with a failure status

#### Scenario: No orphans are left behind
- **WHEN** the combined command exits for any reason, including interruption by the developer
- **THEN** every process it started has been stopped, and no started process outlives the command

### Requirement: The developer is told where each process is listening
The system SHALL report, at startup, the address each started process is serving on, and SHALL state when a process landed somewhere other than its default.

#### Scenario: Startup reports the allocated addresses
- **WHEN** the combined command starts the stack
- **THEN** it prints the address of each started process before handing the terminal over to their output

#### Scenario: A moved port is called out
- **WHEN** a process's default address was unavailable and another was allocated
- **THEN** the report states both the allocated address and that the default was unavailable
