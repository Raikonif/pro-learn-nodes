## ADDED Requirements

### Requirement: A session keeps each agent's own session, and returning to an agent continues it
The system SHALL keep, for each thread, the agent session of every agent that has run it. When a thread's node returns to an agent that already has a session for that thread, the system SHALL continue that agent's session and SHALL give it the messages recorded since that agent last took part — and only those — rather than the whole conversation. The conversation SHALL NOT show a continuity break when this succeeds.

Where the agent's session cannot be continued, the system SHALL fall back to establishing the conversation from the recorded transcript, and SHALL show the break, as `node-agent-sessions` already requires.

#### Scenario: Switching away and back
- **WHEN** a session runs a turn on one agent, then a turn on a second agent, then returns to the first
- **THEN** the first agent's own session is continued, it is given the second agent's exchange as what it missed, and no continuity break is shown

#### Scenario: An agent that missed nothing is given nothing extra
- **WHEN** a session sends consecutive turns to the same agent
- **THEN** each turn carries only the learner's new message

#### Scenario: Removing an agent keeps the session readable and runnable
- **WHEN** an agent that ran a session is removed and the session continues on another agent
- **THEN** every recorded message remains, and the conversation continues on the other agent
