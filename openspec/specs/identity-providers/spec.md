# identity-providers Specification

## Purpose

Defines the single contract every sign-in mechanism satisfies, so that account handling stays identical whether an identity comes from a hosted provider or from the built-in development sign-in used before any provider is configured.

## Requirements

### Requirement: Every sign-in mechanism yields the same identity
The system SHALL express each sign-in mechanism as an interchangeable provider that yields an identity carrying a provider name, an immutable subject identifier, and optional display name, email address, and avatar reference. Account enrollment, activation, and data scoping SHALL depend only on that identity and SHALL NOT vary by mechanism.

#### Scenario: A newly added mechanism needs no account changes
- **WHEN** an additional sign-in mechanism is introduced that yields a conforming identity
- **THEN** enrollment, activation, sign-out, and data scoping behave exactly as they do for existing mechanisms, with no change to their contracts

#### Scenario: A mechanism that cannot supply a subject is rejected
- **WHEN** a sign-in attempt completes without an immutable subject identifier
- **THEN** no account is enrolled or activated and the learner is shown a recoverable sign-in failure

### Requirement: Development sign-in enrolls an account with no external service
The system SHALL provide a development sign-in that produces a conforming identity without contacting any external service, opening a browser, or requiring credentials registered with a third party. It SHALL be usable on a device with no network connection.

#### Scenario: Signing in with no provider configured
- **WHEN** a learner uses development sign-in on a device where no external identity provider has been configured
- **THEN** an account is enrolled and made active, and the workspace becomes available

#### Scenario: Development sign-in is repeatable
- **WHEN** development sign-in is used more than once with the same requested identity
- **THEN** the same account is made active and no additional account is created

### Requirement: Development sign-in is absent unless deliberately enabled
The system SHALL disable development sign-in by default and SHALL enable it only through explicit process configuration supplied at launch, never through a setting that can be carried inside a distributed build. While disabled, the development sign-in endpoint SHALL be indistinguishable from one that does not exist, rather than reporting that it exists but is refused.

#### Scenario: Default build does not offer development sign-in
- **WHEN** the application runs without development sign-in explicitly enabled and a request is made to the development sign-in endpoint
- **THEN** the response is the same not-found response the system gives for an unknown endpoint, and no account is enrolled or activated

#### Scenario: Enabling it is announced
- **WHEN** the application starts with development sign-in enabled
- **THEN** it records a startup warning stating that development sign-in is active

### Requirement: A development account holds no privileges beyond an ordinary account
An account enrolled through development sign-in SHALL have exactly the capabilities of any other account. The system SHALL NOT define a role, permission level, or administrative capability that distinguishes it, and SHALL record its originating provider so that it remains identifiable to the learner.

#### Scenario: A development account reaches only its own data
- **WHEN** an account enrolled through development sign-in is active
- **THEN** it reaches its own workspace data only, on the same terms as any other account

#### Scenario: The account is identifiable as a development account
- **WHEN** a learner views an account enrolled through development sign-in
- **THEN** its originating provider is shown, distinguishing it from an account enrolled through an external provider

### Requirement: At least one sign-in mechanism is always available
The system SHALL offer at least one sign-in mechanism in every build and on every device, without configuration, network access, or an external service. No build SHALL be capable of reaching a state in which a learner is shown a sign-in surface that offers no way to proceed.

The development gate governs the development mechanism alone. It SHALL NOT determine whether sign-in as such is possible.

#### Scenario: A default build is enterable
- **WHEN** the application starts with no environment variables set, no identity provider configured, and no network connection
- **THEN** the sign-in surface offers at least one mechanism the learner can complete, and completing it makes the workspace available

#### Scenario: Closing the development gate does not close the door
- **WHEN** development sign-in is disabled
- **THEN** sign-in remains possible through a mechanism that does not depend on that gate

### Requirement: Local sign-in enrolls an account from a name the learner supplies
The system SHALL provide a local sign-in that produces a conforming identity from a display name the learner types, contacting no external service, opening no browser, and requiring no credential registered with a third party. It SHALL be available whether or not the device has ever been online.

The subject it issues SHALL be immutable and SHALL NOT be derived from the display name, so that renaming an account never separates a learner from their graph.

#### Scenario: Creating a profile on a first launch
- **WHEN** a learner supplies a display name on a device where no account has been enrolled
- **THEN** an account is enrolled with the local provider, made active, and the workspace becomes available

#### Scenario: Renaming does not create a second account
- **WHEN** the display name of a locally enrolled account is changed
- **THEN** the same account remains active, its subject is unchanged, and its graph is unchanged

#### Scenario: Two profiles created with the same name stay distinct
- **WHEN** a learner creates two local profiles and supplies the same display name for both
- **THEN** two separate accounts exist with separate graphs, and each is individually selectable

### Requirement: A local account holds no privileges beyond an ordinary account
An account enrolled through local sign-in SHALL have exactly the capabilities of any other account, SHALL reach only its own data, and SHALL record its originating provider so that it remains distinguishable from an account enrolled through an external provider.

#### Scenario: A local account reaches only its own data
- **WHEN** an account enrolled through local sign-in is active
- **THEN** it reaches its own workspace data only, on the same terms as any other account

#### Scenario: The account is identifiable as local
- **WHEN** a learner views an account enrolled through local sign-in
- **THEN** its originating provider is shown, distinguishing it from an account enrolled through an external provider

### Requirement: The session report names every available mechanism
The system SHALL report which sign-in mechanisms this process offers, so a client presents only controls that can be completed. The report SHALL be reachable while signed out and SHALL NOT require the client to attempt a sign-in to discover whether it is possible.

#### Scenario: A client renders only mechanisms that work
- **WHEN** a client reads the session report on a process where one mechanism is registered and another is not
- **THEN** the report names the registered mechanism, omits the unregistered one, and the client offers only the former

#### Scenario: Discovery does not require an attempt
- **WHEN** a client determines which mechanisms are available
- **THEN** it does so without invoking any sign-in mechanism and without enrolling or activating an account
