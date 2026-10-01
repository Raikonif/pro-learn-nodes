# session-history Specification

## Purpose

Makes every past session findable: listed by when it was last used, grouped by day, previewed, searchable by what was said in it, and retired by archiving rather than deletion — so the history grows without anything being lost or becoming unreachable.

## Requirements

### Requirement: Sessions are listed by their last activity
The session history SHALL list the active account's unarchived sessions ordered by last activity, most recent first. Opening a session and recording a message in any of its threads SHALL each count as activity. The order SHALL be the same after a restart.

#### Scenario: Opening a session moves it to the top
- **WHEN** the learner opens a session that is not the most recent
- **THEN** it becomes the first entry in the session history

#### Scenario: Writing moves a session to the top
- **WHEN** a message is recorded in a session other than the first entry
- **THEN** that session becomes the first entry

#### Scenario: Order survives a restart
- **WHEN** the application restarts
- **THEN** the session history lists sessions in the same order as before

### Requirement: The history is grouped by day and previews each session
Entries SHALL be grouped as Today, Yesterday, Previous 7 days, and Older, by the learner's local date of last activity, and an empty group SHALL NOT be shown. Each entry SHALL show the session's title, the beginning of its most recent message, and the name of the agent it last ran on, if any.

#### Scenario: Grouping by day
- **WHEN** the learner has sessions last used today, yesterday, four days ago, and a month ago
- **THEN** each appears under Today, Yesterday, Previous 7 days, and Older respectively

#### Scenario: An entry previews its last message and agent
- **WHEN** a session's most recent message was an agent reply produced by a registered agent
- **THEN** its entry shows the beginning of that reply and the agent's name

### Requirement: Message content is searchable
Searching the session history SHALL match session titles and the content of messages in any thread of a session, and SHALL return the matching sessions with the matching passage shown. Activating a result SHALL open that session at the matching message. Search SHALL run entirely on the device.

#### Scenario: Finding a session by something said in it
- **WHEN** the learner searches for a phrase that appears only in a message, not in any title
- **THEN** the session containing it is returned with the passage, and activating it opens the session with that message in view

#### Scenario: Search reflects messages as they are recorded
- **WHEN** a message is recorded and the learner then searches for a phrase from it
- **THEN** the session is returned

#### Scenario: Search stays within the account
- **WHEN** the learner searches for a phrase that appears only in another account's session
- **THEN** no result is returned

### Requirement: Sessions are archived, not deleted, from the history
The session history SHALL offer archiving and SHALL NOT offer deletion. An archived session SHALL leave the history and the graph, SHALL keep its conversations, threads, links, and agent sessions intact, SHALL be returned by search when the learner explicitly includes archived sessions, and SHALL be restorable, after which it reappears in the history in its activity order.

#### Scenario: Archiving removes a session from view without losing it
- **WHEN** the learner archives a session
- **THEN** it no longer appears in the history or on the graph, and its messages are unchanged

#### Scenario: Finding and restoring an archived session
- **WHEN** the learner searches with archived sessions included and restores a result
- **THEN** the session reappears in the history and on the graph with its conversations intact

#### Scenario: Archiving a parent keeps its children reachable
- **WHEN** the learner archives a session that has child sessions
- **THEN** the children remain in the history and on the graph
