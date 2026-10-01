## ADDED Requirements

### Requirement: An agent is offered only if its actions can be asked about first
The system SHALL offer an agent as a conversation backend only if the agent presents each write, each action outside the node's working directory, and each execution as a request the system can answer before the action takes place. An agent that acts first and reports afterwards SHALL NOT be offered, whatever warning accompanies it.

#### Scenario: An agent without a permission channel is not offered
- **WHEN** a candidate agent is found to write a file or run a command without first making a request the system can answer
- **THEN** it is not offered as a backend, and the reason is recorded rather than worked around

#### Scenario: A refused request does not happen
- **WHEN** the system refuses an agent's request to write or execute
- **THEN** the write or execution does not take place
