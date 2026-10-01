## Purpose

Lets a learner start a new root session from the window — either at once, to write immediately, or with a topic and learning mode chosen first — so that the first conversation of a fresh install, and every later one, has somewhere to happen.

## ADDED Requirements

### Requirement: A root session can be started quickly
The workspace SHALL offer a control that creates a new root session and opens it with its conversation ready to write, asking the learner for nothing first. The session SHALL run on the account's default agent under the rules of `agent-backends`, and SHALL use the default learning mode.

#### Scenario: Starting a quick session
- **WHEN** the learner activates the quick-start control
- **THEN** a new root session with a main thread is created, it opens in the center region, and the composer is focused and ready to send

#### Scenario: Writing in a new session reaches the agent
- **WHEN** the learner sends a first message in a newly created session and a default agent is registered
- **THEN** the turn runs on the default agent and its reply is recorded in that session

### Requirement: A root session can be started with a topic and a mode
The workspace SHALL offer a detailed start that asks for a topic and a learning mode (Explore, Deepen, Review, Practice, or Quiz) before the session is created. The topic SHALL become the session's title. Neither field SHALL be required to have been changed from its default for creation to proceed, except that an empty topic SHALL fall back to automatic titling.

#### Scenario: Starting a detailed session
- **WHEN** the learner enters a topic, chooses a mode, and confirms
- **THEN** a root session titled with the topic and set to that mode is created and opened

#### Scenario: Abandoning a detailed start creates nothing
- **WHEN** the learner opens the detailed start and dismisses it without confirming
- **THEN** no session is created

### Requirement: An empty workspace offers both starts
When the active account has no sessions, the center region SHALL present both the quick and the detailed start in place of an empty graph.

#### Scenario: A new account sees how to begin
- **WHEN** a learner signs in to an account with no sessions
- **THEN** the center region offers a quick start and a detailed start, and no empty graph is shown in their place

### Requirement: An untitled session is titled from its first message
A session created without a topic SHALL carry a provisional title until its first learner message is recorded, and SHALL then be titled from that message. A title the learner set SHALL NOT be replaced automatically.

#### Scenario: A quick session takes its title from the first message
- **WHEN** the learner sends the first message in a quick session
- **THEN** the session's title is derived from that message and appears in the session history

#### Scenario: A learner's title is kept
- **WHEN** the learner renames a session and later sends further messages
- **THEN** the session keeps the learner's title

### Requirement: A session can be renamed
The learner SHALL be able to rename a session. An empty title SHALL be refused.

#### Scenario: Renaming a session
- **WHEN** the learner renames a session
- **THEN** the new title appears wherever the session is shown, and persists across a restart
