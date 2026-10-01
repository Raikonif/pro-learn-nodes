# account-profiles Specification

## Purpose

Lets one desktop install hold several learners' accounts, each with its own learning graph, so signing in as a different account presents a different body of work rather than a shared one.

## Requirements

### Requirement: An account is identified by its issuing provider and subject
The system SHALL identify an enrolled account by the pair of the issuing provider and the immutable subject identifier that provider assigns. Display information such as email address and display name SHALL NOT be used to identify an account, and a change to either SHALL update the existing account rather than produce a second one.

#### Scenario: Signing in twice with the same account
- **WHEN** a learner signs in with an account that has already enrolled on this device
- **THEN** the existing account is made active and no additional account is created

#### Scenario: Display information changes upstream
- **WHEN** a learner signs in with an already-enrolled account whose email address or display name has changed since enrollment
- **THEN** the stored display information is updated and the account remains the same account with the same data

#### Scenario: Same subject from a different provider
- **WHEN** two providers issue the same subject identifier to two different learners
- **THEN** they enroll as two distinct accounts

### Requirement: Exactly one account is active at a time
The system SHALL have at most one active account. Signing in SHALL make that account active and SHALL replace any previously active account.

#### Scenario: Signing in while another account is active
- **WHEN** a learner signs in while a different account is active
- **THEN** the newly signed-in account becomes the only active account

#### Scenario: Active account survives a restart
- **WHEN** a learner closes the application while an account is active and opens it again
- **THEN** that account is active again without a further sign-in

### Requirement: Each account has its own learning graph
The system SHALL scope every workspace, node, thread, message, selection anchor, and source to exactly one account. Data created while one account is active SHALL NOT be readable, searchable, or reachable while another account is active.

#### Scenario: Work does not cross between accounts
- **WHEN** a learner creates a node while one account is active and then signs in as a second account
- **THEN** that node is absent from the second account's graph, from its search results, and from every workspace response

#### Scenario: Returning to an account restores its graph
- **WHEN** a learner signs back in as an account used earlier on this device
- **THEN** that account's nodes, conversations, and restorable context are present as they were left

### Requirement: Signing out preserves the account's data
The system SHALL, on sign-out, end the active session and return to the signed-out state while retaining that account's enrollment and stored data on the device. Signing out SHALL NOT delete a learner's work.

#### Scenario: Signing out and back in
- **WHEN** a learner signs out and then signs in again as the same account
- **THEN** the account's graph and conversations are present unchanged

#### Scenario: Signing back in requires no network
- **WHEN** a learner signs back in as an account already enrolled on this device while the device has no network connection
- **THEN** the account becomes active and its graph is available

### Requirement: Deleting an account's data is explicit and separate from signing out
The system SHALL provide removal of an enrolled account together with its data only as a distinct action that states what will be destroyed and requires a confirmation naming that consequence. No sign-out, sign-in, or account switch SHALL destroy data.

#### Scenario: Removal is confirmed before it happens
- **WHEN** a learner asks to remove an enrolled account from the device
- **THEN** the system states that the account's graph and conversations will be permanently destroyed and proceeds only after the learner confirms

#### Scenario: Removal affects only the named account
- **WHEN** a learner confirms removal of one enrolled account
- **THEN** that account's enrollment and data are destroyed and every other enrolled account's data is unaffected

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
