## ADDED Requirements

### Requirement: Enrolled accounts are selectable before one is active
The system SHALL present the accounts already enrolled on the device as selectable options while no account is active, alongside the means to enroll a new one. Selecting an enrolled account SHALL activate it and open its graph without repeating enrollment.

An account enrolled through a mechanism this process no longer offers SHALL still be listed and SHALL still be selectable, because its data is on disk and reaching it must not depend on how it was first created.

#### Scenario: Returning to an existing account
- **WHEN** a learner selects an already-enrolled account on the sign-in surface
- **THEN** that account becomes active and its graph opens, with no new account created

#### Scenario: A first launch offers only creation
- **WHEN** no account has been enrolled on the device
- **THEN** the sign-in surface offers enrollment and lists no accounts, rather than presenting an empty picker as a failure

#### Scenario: An account outlives the mechanism that created it
- **WHEN** an account was enrolled through a mechanism that is not registered in the running process
- **THEN** it is still listed, still selectable, and selecting it activates it and opens its graph

### Requirement: An account carries a display name the learner chooses
The system SHALL let a learner supply a display name when enrolling an account and SHALL use it to distinguish accounts wherever they are listed. The name SHALL be editable afterwards without affecting the account's identity or its data.

Where a mechanism reports a display name of its own, that report SHALL take precedence on each sign-in, because a name held by an external provider is that provider's to refresh.

#### Scenario: Naming distinguishes two accounts
- **WHEN** a learner has enrolled two accounts with different display names
- **THEN** both are listed under their respective names and the learner can tell which graph each opens

#### Scenario: Enrolling without a name still succeeds
- **WHEN** a learner enrolls an account without supplying a display name
- **THEN** the account is enrolled and made active, and is listed under a distinguishable fallback label
