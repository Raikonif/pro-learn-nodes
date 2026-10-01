## MODIFIED Requirements

### Requirement: First launch initializes a valid local workspace
The system SHALL initialize local application data on first launch with a valid empty workspace and restorable context for the account being enrolled. Runtime fixtures SHALL NOT be required to make the application bootable. Each account SHALL receive its own workspace and restorable context on first activation, and initializing one account's data SHALL NOT alter another's.

#### Scenario: First launch has no existing data
- **WHEN** the sidecar starts against a new local data location and an account is activated for the first time
- **THEN** bootstrap returns an initialized empty workspace and valid default context for that account

#### Scenario: A second account starts empty
- **WHEN** a second account is activated for the first time on a device that already holds another account's populated workspace
- **THEN** the second account receives its own initialized empty workspace and default context, and the first account's data is unchanged

## ADDED Requirements

### Requirement: An existing pre-account workspace is adopted, not orphaned
When local application data contains a workspace that predates account partitioning, the system SHALL attach that workspace to a single account on first launch after upgrade rather than leaving it unreachable or creating a second empty workspace beside it.

#### Scenario: Upgrading with existing local data
- **WHEN** the sidecar starts against local application data holding a workspace created before accounts existed
- **THEN** that workspace is attached to one account, and activating that account presents the same nodes, links, threads, messages, and anchors that were present before the upgrade

#### Scenario: Adoption happens once
- **WHEN** the sidecar starts again after an adoption has already occurred
- **THEN** no further adoption is performed and no additional account or workspace is created
