## Purpose

Lets a node conversation run on an external agent the learner already installed and already authenticated, so the app is usable without holding an API key, and so adding another agent is configuration rather than code.

## ADDED Requirements

### Requirement: A conversation backend is either stateless or session-stateful
The system SHALL distinguish two kinds of conversation backend and SHALL NOT require them to behave identically. A **stateless** backend receives the full conversation on every turn and holds nothing between them. A **session-stateful** backend owns the conversation and receives only what is new.

Every feature that depends on the application assembling context — hierarchical compaction and inference-time skill merging among them — SHALL be declared available on stateless backends and unavailable on session-stateful ones, rather than approximated on the latter.

#### Scenario: An unavailable feature is stated, not simulated
- **WHEN** a node runs on a session-stateful backend and the learner looks for a feature that requires application-assembled context
- **THEN** the workspace states that the feature is unavailable on this backend and names the backend as the reason, and does not present a control that would produce an approximation

#### Scenario: Switching a node's backend changes what is available
- **WHEN** a node's backend is changed between the two kinds
- **THEN** the set of available features changes accordingly and the learner is shown what changed before the change takes effect

### Requirement: An agent is configured by command, never bundled or credentialed
The system SHALL let a learner register an agent by supplying the command that launches it, together with any arguments and environment it needs. The system SHALL NOT distribute agent software, and SHALL NOT request, store, read, or transmit any credential belonging to an agent or to the service behind it.

An agent that requires authentication SHALL be authenticated through its own mechanism, outside this application.

#### Scenario: Registering an installed agent
- **WHEN** a learner registers an agent by naming a command that is installed on the device
- **THEN** the agent becomes selectable as a node's backend, with no credential requested at any point

#### Scenario: An unauthenticated agent is reported, not worked around
- **WHEN** a registered agent reports that it is not authenticated
- **THEN** the workspace reports that state and directs the learner to authenticate through the agent's own mechanism, and does not offer to supply a credential on its behalf

#### Scenario: A missing command fails at registration
- **WHEN** a learner registers a command that cannot be launched
- **THEN** the failure is reported at registration with the underlying error, and the agent is not offered as a backend

### Requirement: What an agent can do is negotiated, never assumed
The system SHALL determine each agent's capabilities by negotiation when the connection is established, and SHALL rely only on capabilities that agent reported. Behavior that depends on an optional capability SHALL have a defined path for an agent that lacks it.

#### Scenario: An optional capability is absent
- **WHEN** a connected agent does not report an optional capability the system would otherwise use
- **THEN** the system takes its defined alternative path and the conversation remains usable

#### Scenario: Capabilities are re-negotiated per connection
- **WHEN** an agent is replaced by a different version that reports different capabilities
- **THEN** the newly reported capabilities govern, without any stored result of an earlier negotiation being reused

### Requirement: An agent's reachability is testable before a conversation depends on it
The system SHALL offer a way to verify a configured agent — that it launches, negotiates, and is authenticated — and SHALL report the outcome without creating a node, a thread, or a message.

#### Scenario: Verifying a working agent
- **WHEN** a learner tests a correctly configured and authenticated agent
- **THEN** the result reports success along with the agent's reported identity and capabilities, and no conversation material is created

#### Scenario: Verifying a broken agent names the stage that failed
- **WHEN** a test fails
- **THEN** the report distinguishes a command that would not launch, a connection that would not negotiate, and an agent that is not authenticated

### Requirement: Agent processes do not outlive the application
The system SHALL stop every agent process it started when the application stops, including on abnormal termination, and SHALL NOT accumulate agent processes across restarts of the backend during development.

#### Scenario: Shutdown stops every agent
- **WHEN** the application stops for any reason
- **THEN** no agent process it started remains running

#### Scenario: A development reload does not accumulate agents
- **WHEN** the backend restarts repeatedly during development while agents are connected
- **THEN** the number of running agent processes does not grow across restarts

### Requirement: An agent that dies mid-conversation is reported, not hidden
The system SHALL detect an agent process that exits or stops responding, SHALL report it in the conversation where it occurred, and SHALL preserve every message already recorded. A subsequent turn SHALL be able to re-establish the connection without the learner recreating the node or the thread.

#### Scenario: The agent exits during a turn
- **WHEN** an agent process exits while a turn is in progress
- **THEN** the conversation reports the interruption, every message already received is retained, and the partial turn is marked as incomplete rather than presented as an answer

#### Scenario: Recovering after a crash
- **WHEN** the learner sends a further message after an agent crashed
- **THEN** the connection is re-established and the conversation continues, with no node or thread recreated

### Requirement: A default agent serves nodes that have not chosen one
The system SHALL let a learner mark one registered agent as the account's default. A root node created without an explicit backend SHALL run on the default agent, and the learner SHALL be able to change a node's backend afterwards. The default SHALL be scoped to the active account.

A node SHALL NOT require the learner to choose a backend before its first message can be written.

#### Scenario: A new root node runs on the default agent
- **WHEN** a learner with a default agent creates a root node and sends a first message
- **THEN** the turn runs on the default agent without any backend choice being presented

#### Scenario: No agent is registered
- **WHEN** a learner with no registered agent sends a message
- **THEN** the message is recorded, the turn is not attempted, and the workspace directs the learner to register an agent

#### Scenario: A default does not cross accounts
- **WHEN** a different account becomes active
- **THEN** the previous account's registered agents and default are not in effect

### Requirement: A permission request never leaves a turn waiting unseen
The system SHALL answer every permission request an agent makes. Where a request is not decided by a presented prompt, it SHALL be refused, and the refusal SHALL be recorded in the conversation where the learner can see what was asked.

#### Scenario: An agent asks to act with no prompt available
- **WHEN** an agent requests permission for an action and no prompt decides it
- **THEN** the request is refused, the turn continues, and the conversation shows what the agent asked to do and that it was refused
