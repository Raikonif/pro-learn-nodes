## Purpose

Defines the single contract every sign-in mechanism satisfies, so that account handling stays identical whether an identity comes from a hosted provider or from the built-in development sign-in used before any provider is configured.

## ADDED Requirements

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
