# project-instructions Specification

## Purpose

Lets a learner give a project standing instructions — how to teach, what to assume, what to avoid — that the agent of every session in that project receives, without repeating them in each conversation.

## Requirements

### Requirement: A project carries instructions the learner can edit
A project SHALL hold instructions written by the learner, empty by default, editable at any time. Editing them SHALL change no node, message, or link.

#### Scenario: Writing a project's instructions
- **WHEN** the learner writes instructions for a project and saves them
- **THEN** the project holds those instructions, including after a restart

### Requirement: A new agent session receives its project's instructions
When a node's agent starts a new session for one of its conversations, the first prompt SHALL include the instructions of the project the node belongs to, labelled with the project's name, before the conversation's own context. A project with no instructions SHALL add nothing.

#### Scenario: First message in a project with instructions
- **WHEN** the learner sends the first message of a session whose project has instructions
- **THEN** the agent receives those instructions, labelled with the project's name, in that turn's prompt

#### Scenario: A project without instructions adds nothing
- **WHEN** the learner sends the first message of a session whose project has no instructions
- **THEN** the prompt contains no project instructions

### Requirement: A change of instructions or project reaches the agent once
When a session's project instructions have changed since its agent was last told them — because they were edited, or the node moved to another project — the next turn SHALL tell the agent the current project and its instructions once, before the learner's message. A turn with nothing changed SHALL add nothing.

#### Scenario: Instructions edited mid-session
- **WHEN** the learner edits the project's instructions and then sends a message in an ongoing session
- **THEN** that turn carries the new instructions once, and the following turn does not repeat them

#### Scenario: Moving a session to another project
- **WHEN** the learner moves a node to another project and sends a message
- **THEN** the agent is told the new project and its instructions, or that it has none

### Requirement: Membership decides which instructions apply, not reachability
The instructions that apply to a node SHALL be those of the project the node belongs to. A node reached by a link from a node in another project SHALL NOT receive the linking node's project instructions.

#### Scenario: A shared child keeps its own project's instructions
- **WHEN** a node in project A is the child of a node in project B and the learner messages it
- **THEN** the agent receives project A's instructions and not project B's

### Requirement: The agent and the learner can see which project governs a session
The context server's session description SHALL include the session's project name and instructions. The open session's header SHALL name its project and offer its instructions.

#### Scenario: The agent asks where it is
- **WHEN** the agent calls the context server's current-session tool
- **THEN** the result names the session's project and includes its instructions

#### Scenario: The learner sees the governing project
- **WHEN** a node is open
- **THEN** its header names the project it belongs to, and activating that name shows the project's instructions
