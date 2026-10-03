## Purpose

Lets a learner run each session the way they would in the agent's own client — choosing its model, how hard it thinks, how fast it answers, and how much it may do without asking — and reach the agent's own commands and skills, including compaction, from the conversation.

## ADDED Requirements

### Requirement: A session's model, effort, and fast mode can be chosen from what its agent offers
The workspace SHALL let the learner choose, for the open session, a model, a reasoning effort, and fast mode, from the values the session's agent reports offering, and SHALL NOT offer values the agent did not report. Where the agent's offer is not yet known on this device, the workspace SHALL say so rather than present an empty or guessed choice.

#### Scenario: Choosing a model
- **WHEN** the learner chooses a model the session's agent offers
- **THEN** the session's next turn runs on that model

#### Scenario: Choosing effort and fast mode
- **WHEN** the learner chooses a reasoning effort and turns fast mode on
- **THEN** the session's next turn runs at that effort with fast mode on

#### Scenario: An agent whose offer is not known yet
- **WHEN** the learner opens a session whose agent has not yet been reached on this device
- **THEN** the workspace states that the choices appear once the agent has been reached

### Requirement: Permission modes are offered with what they allow, and acting without asking needs confirmation
The workspace SHALL offer the permission modes the session's agent reports, each described by what it allows: asking before acting, editing within the session's folder without asking, or acting on the learner's system without asking. Choosing a mode that acts without asking SHALL require an explicit confirmation that names what it allows, and while such a mode is active the session SHALL be visibly marked. A mode the application does not recognise SHALL be treated as acting without asking. A session SHALL start in its agent's default mode, and the application SHALL never select a mode that acts without asking on the learner's behalf.

#### Scenario: Choosing a mode that asks
- **WHEN** the learner chooses a mode in which the agent asks before acting
- **THEN** it takes effect on the next turn with no confirmation

#### Scenario: Choosing a mode that acts without asking
- **WHEN** the learner chooses a mode such as bypassing permissions
- **THEN** the workspace asks for confirmation stating that the agent may act on their system without asking, applies it only if confirmed, and marks the session while it is active

#### Scenario: The agent's own default acts without asking
- **WHEN** a session's agent starts it in a mode that acts without asking, set in the agent's own configuration
- **THEN** the session is marked as acting without asking from its first turn, and the learner can choose a mode that asks

#### Scenario: An unrecognised mode
- **WHEN** an agent reports a mode the application does not recognise and the learner chooses it
- **THEN** it is confirmed and marked as acting without asking

### Requirement: The agent's commands and skills are reachable from the composer
The composer's command menu SHALL list the commands the session's agent announces, including the learner's installed skills, labelled as the agent's and described as the agent describes them, alongside the application's own commands. Choosing one SHALL send it to the agent in the form the agent announced. The list SHALL follow what the agent last announced for the session.

#### Scenario: Running an agent's command
- **WHEN** the learner chooses the agent's `/compact` from the menu and sends it
- **THEN** the agent receives `/compact`, and the turn's outcome is shown like any other

#### Scenario: The learner's skills are listed
- **WHEN** the session's agent announces the learner's installed skills
- **THEN** they appear in the menu under that agent's name

#### Scenario: The application's commands stay distinct
- **WHEN** the menu lists both the agent's commands and `/code`, `/qa`, `/quiz`
- **THEN** each is labelled with where it comes from, and the application's commands keep their behaviour

### Requirement: Context usage is shown when the agent reports it
When the session's agent reports how much of its context window is used, the workspace SHALL show that usage for the session and keep it current as reports arrive.

#### Scenario: A session filling up
- **WHEN** the agent reports its context usage during a turn
- **THEN** the session shows the used and total context

### Requirement: Choices are kept with the session and applied every time it runs
A session's choices SHALL persist across restarts and SHALL be applied whenever the session's agent session is opened, loaded, or continued, before the turn is sent. A session with no choice SHALL run on its agent's defaults. A choice the agent no longer offers SHALL NOT be sent, and the workspace SHALL say it is no longer offered.

#### Scenario: Choices survive a restart
- **WHEN** the learner chooses a model and a mode, restarts the application, and writes in the session
- **THEN** the turn runs with the chosen model and mode

#### Scenario: A value the agent stopped offering
- **WHEN** a session's chosen model is no longer among the values its agent reports
- **THEN** the turn runs on the agent's default, and the workspace says the chosen model is no longer offered

### Requirement: Switching a session's agent clears its choices
When a session's agent is changed, its choices SHALL be cleared, and the session SHALL run on the new agent's defaults until the learner chooses again.

#### Scenario: Moving a session to another agent
- **WHEN** the learner changes a session from one agent to another
- **THEN** its choices are cleared and its next turn uses the new agent's defaults
