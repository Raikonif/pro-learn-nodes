## Purpose

Establishes that the data a workspace request may reach is determined by the active account on the server side, so that naming another account's data in a request cannot reach it.

## ADDED Requirements

### Requirement: The data scope of a request is derived from the active account
The system SHALL derive the workspace a request operates on from the active account. A workspace identifier supplied by the caller SHALL NOT determine which data is read or written.

#### Scenario: Request carries no workspace identifier
- **WHEN** the frontend requests workspace data while an account is active
- **THEN** the response contains that account's workspace without the request having named it

#### Scenario: Caller names another account's workspace
- **WHEN** a request names a workspace belonging to an account other than the active one
- **THEN** the request is refused as not found, no data from that workspace is returned, and no data is written to it

#### Scenario: Refusal does not reveal existence
- **WHEN** a request names a workspace that belongs to another account, and a request names a workspace that does not exist
- **THEN** both are refused identically, so the response does not reveal whether the named workspace exists

### Requirement: Workspace operations require an active account
The system SHALL refuse every workspace read and write while no account is active, and SHALL distinguish that refusal from a refusal caused by missing or invalid data so the frontend can direct the learner to sign in.

#### Scenario: Workspace request while signed out
- **WHEN** a workspace request is made while no account is active
- **THEN** it is refused with an indication that authentication is required, and no workspace data is returned

#### Scenario: Signing out ends access immediately
- **WHEN** a learner signs out and a further workspace request is made
- **THEN** that request is refused, without relying on any expiry interval having elapsed

### Requirement: Derived search and retrieval data stay within the active account
The system SHALL confine search and retrieval results to sources belonging to the active account's workspace, including results served from any derived or rebuilt index.

#### Scenario: Search does not span accounts
- **WHEN** a learner searches while one account is active and a matching passage exists only in another account's source
- **THEN** that passage is absent from the results

#### Scenario: Rebuilding an index preserves confinement
- **WHEN** a derived retrieval index is rebuilt and a search is then performed
- **THEN** results remain confined to the active account's workspace
