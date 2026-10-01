# practice-delivery Specification

## Purpose

Makes practice an agent creates arrive where the learner does practice — the rail's Code, Q&A, or Quiz tool — rather than as text in the conversation, so that asking for an exercise or a quiz produces something to work on, not something to read.

## Requirements

### Requirement: Practice an agent creates is shown in its tool as it arrives
When an agent adds practice to the open session during a turn, the rail SHALL switch to the tool that practice belongs to — a code exercise to Code, a free-response question to Q&A, a multiple-choice question to Quiz — and SHALL present the new material highlighted, without the learner reloading or reopening the node.

#### Scenario: A quiz arrives in the Quiz tool
- **WHEN** an agent adds multiple-choice questions to the open session
- **THEN** the rail shows the Quiz tool with the new questions highlighted, while the turn is still in progress or as soon as it ends

#### Scenario: An exercise arrives in the Code tool
- **WHEN** an agent adds a code exercise to the open session
- **THEN** the rail shows the Code tool with that exercise open and its starter code in its buffer

#### Scenario: Practice for a session not on screen does not take over the rail
- **WHEN** practice is added to a session the learner is not viewing
- **THEN** the rail of the session on screen does not change, and the material is present when that session is opened

### Requirement: The conversation records what was delivered and leads to it
For each delivery, the conversation SHALL record which agent delivered how much of what to which tool, and activating that record SHALL show the delivered material in the rail.

#### Scenario: Following a delivery from the conversation
- **WHEN** the learner activates the record of a delivery in the conversation, including after a restart
- **THEN** the rail shows the tool holding that material, with it highlighted

### Requirement: Practice can be asked for by command or in plain words
The composer SHALL offer `/code`, `/qa`, and `/quiz` commands, each taking what the learner wants practice on, and each SHALL ask the agent to deliver that kind of practice to its tool rather than answer in the conversation. A request in plain words ("send it to Code", "quiz me on this") SHALL be able to produce a delivery as well.

#### Scenario: A command produces practice in its tool
- **WHEN** the learner sends `/quiz five questions on folds`
- **THEN** the turn asks the agent for multiple-choice questions on folds delivered to Quiz

#### Scenario: A command whose turn delivers nothing says so
- **WHEN** a turn started by `/code`, `/qa`, or `/quiz` ends without the agent delivering any practice
- **THEN** the conversation states that nothing was delivered to that tool, rather than leaving the learner to look for it
