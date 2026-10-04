# command-registry Specification

## Purpose

The single runtime list of commands Learn Nodes offers — from the workspace, practice, the open session's controls, and the open node's agent — so that every surface that offers commands names the same ones, and an action that cannot run now says why instead of disappearing.

## Requirements

### Requirement: One registry backs every command surface
The application SHALL hold one list of commands, assembled at runtime from the workspace's actions, practice's add entries, the open session's controls, and the commands the open node's agent announced. Every surface that offers commands SHALL read that list, and a command SHALL behave the same whichever surface invokes it.

#### Scenario: A workspace action is a command
- **WHEN** the learner looks for "New session" in the palette
- **THEN** it is listed, and invoking it starts a session exactly as the New session button does

#### Scenario: A workbench entry is a command
- **WHEN** a node is open and the learner invokes "Write a quiz question" from the palette
- **THEN** the learner's own quiz block opens with its form open, as from the workbench's add control

### Requirement: The agent's announced commands and skills are commands
The registry SHALL include every command the open node's agent last announced for its session, including the learner's skills, grouped under the agent's name and described as the agent describes them. A command the agent announces later SHALL appear without any change to the application. An announced command sharing a name with one of Learn Nodes' own commands SHALL be left out.

#### Scenario: A skill the agent announces is listed
- **WHEN** the open node's agent announces a skill the learner installed
- **THEN** the registry lists it under the agent's name

#### Scenario: A reserved name stays Learn Nodes'
- **WHEN** the agent announces a command named `quiz`
- **THEN** the registry lists only Learn Nodes' `/quiz`

### Requirement: Sendable commands are placed in the composer, never sent
Invoking `/code`, `/qa`, `/quiz`, or an agent's command from anywhere other than the composer SHALL place it in the open conversation's composer, focused, replacing nothing but the draft, and SHALL NOT send a message or start a turn.

#### Scenario: Invoking an agent's skill from the palette
- **WHEN** the learner invokes the agent's `/compact` from the palette
- **THEN** the composer holds `/compact ` with the cursor after it, and no turn starts

### Requirement: Session choices are commands, and acting without asking still needs confirmation
The registry SHALL offer each model, effort, and fast-mode value the session's agent offers, and each permission mode that asks or only edits, as commands that make the same choice the session controls make. A permission mode that acts without asking SHALL be listed but unavailable, with the reason that it is chosen and confirmed in the session controls.

#### Scenario: Choosing a model from the palette
- **WHEN** the learner invokes "Model: Smart 2" on a node whose agent offers it
- **THEN** the node's model choice is Smart 2, as if chosen in the session controls

#### Scenario: An unasked mode is not set from the palette
- **WHEN** the learner looks for the mode that bypasses permissions
- **THEN** it is listed as unavailable, with the reason pointing to the session controls, and invoking it changes nothing

### Requirement: Unavailable commands are listed with the reason, not hidden
A command that cannot run in the current state SHALL be listed as unavailable together with the reason: it needs an open node, or the session's agent has not yet reported what it offers. Invoking an unavailable command SHALL do nothing.

#### Scenario: No node open
- **WHEN** no node is open
- **THEN** practice and session commands are listed as unavailable with the reason that they need an open session, and invoking one creates nothing

#### Scenario: The agent has not been reached
- **WHEN** a node is open whose agent has not yet reported what it offers
- **THEN** session commands are listed as unavailable with the reason that a message must be sent first

### Requirement: Command identifiers are stable and unique
Every command SHALL have an identifier unique within the registry and stable across renders and restarts for the same underlying action.

#### Scenario: Two agents' commands do not collide
- **WHEN** the learner switches the node to another agent that announces a command with the same name
- **THEN** the registry lists it once, under the new agent's name
