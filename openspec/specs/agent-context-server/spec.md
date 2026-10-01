# agent-context-server Specification

## Purpose

Gives every agent a learner works with the same view of that learner's local material — their sessions, their practice, and the memory they have accepted — so that what one agent learns about the learner another can use, without any of it leaving the device or any agent gaining the power to change or remove what the learner made.

## Requirements

### Requirement: Every agent session is given the context server
The system SHALL make the context server available to every agent session it opens or resumes, without the learner configuring anything. An agent that cannot connect to it SHALL still be able to run the conversation.

#### Scenario: A new session can reach the context server
- **WHEN** a conversation turn opens a new agent session
- **THEN** the agent can call the context server's tools during that turn

#### Scenario: A resumed session can reach it again
- **WHEN** the application restarts and a session is resumed
- **THEN** the agent can call the context server's tools in the resumed session

### Requirement: A call is admitted only with a live credential for its session
The context server SHALL accept connections only from the local device, and SHALL admit a call only when it carries a credential issued by the application for a session that is currently open. A call without a credential, with an unknown one, or with one from before the application last started SHALL be refused, and no data SHALL be returned with the refusal.

#### Scenario: A local process without a credential is refused
- **WHEN** a process on the device calls the context server without a credential
- **THEN** the call is refused and returns no learner data

#### Scenario: A credential does not survive a restart
- **WHEN** a credential issued before the application restarted is presented
- **THEN** the call is refused

### Requirement: What an agent can read is its learner's, and only its learner's
A call SHALL be scoped to the account and the session its credential was issued for. Reading SHALL reach that account's unarchived sessions, their conversations, their practice material, and its accepted memory. Nothing belonging to another account SHALL be reachable by any call.

#### Scenario: Reading another session of the same learner
- **WHEN** an agent in one session asks for a different session of the same account
- **THEN** that session's conversation is returned

#### Scenario: Another account is unreachable
- **WHEN** an agent asks for a session that belongs to another account
- **THEN** it is answered exactly as a session that does not exist

#### Scenario: Archived sessions stay out of reach
- **WHEN** an agent lists or searches sessions
- **THEN** archived sessions are not returned

### Requirement: What an agent can write is additive and confined to its own session
The context server SHALL offer writing only as additions: a practice question on the session the credential was issued for, a memory proposal, and a title for that session. It SHALL NOT offer any way to update, overwrite, or remove a session, message, practice item, attempt, sandbox code, memory, or title chosen by the learner. A title SHALL be set only while the session has no title the learner chose or gave as a topic.

#### Scenario: Adding a question to the current session
- **WHEN** an agent adds a practice question
- **THEN** it appears among the current session's practice items, marked as written by that agent

#### Scenario: Writing to another session is not possible
- **WHEN** an agent attempts to add material to a session other than its own
- **THEN** the call is refused and nothing is written

#### Scenario: A learner's title is not replaced
- **WHEN** an agent sets the title of a session whose title the learner chose
- **THEN** the call is refused and the title is unchanged

### Requirement: What an agent did through the context server is visible
Each call an agent makes to the context server SHALL appear in the conversation as that agent's tool activity, and each thing it wrote SHALL name the agent that wrote it.

#### Scenario: A question written by an agent is attributed
- **WHEN** the learner looks at a practice question an agent added
- **THEN** it is shown as written by that agent, distinguishable from one the learner wrote

### Requirement: Reading is progressive — previews first, full content on request
The context server SHALL let an agent find material without receiving all of it at once: searching and listing SHALL return previews with identifiers; reading a session SHALL return an outline of its messages, each shortened, with identifiers; and full message text SHALL be returned only for the messages an agent asks for by identifier. Every response SHALL be bounded in size, and a response that was shortened SHALL say so.

#### Scenario: From a search to the full message
- **WHEN** an agent searches, reads the outline of a returned session, and asks for one message by its identifier
- **THEN** it receives previews, then a shortened outline, then that message's full text — and at no step the whole session

#### Scenario: A long session is outlined in bounded pages
- **WHEN** an agent reads the outline of a session longer than one response allows
- **THEN** it receives one bounded page, marked as partial, with a way to ask for the next
