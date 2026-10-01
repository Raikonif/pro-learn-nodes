## Purpose

The inline command menu that appears when a learner types a slash in a conversation composer, so commands are reachable at the moment of writing without leaving the conversation, while an ordinary message that happens to begin with a slash still sends as written.

## ADDED Requirements

### Requirement: The composer menu offers the same commands as the palette
The composer command menu SHALL offer the registry's commands, with the same names, the same descriptions, and the same availability the palette shows. It SHALL NOT offer nodes or projects, which are destinations rather than commands, and it SHALL NOT define a command the palette does not have.

#### Scenario: A skill reachable in the palette is reachable in the composer
- **WHEN** a skill's commands are listed in the palette
- **THEN** the same commands are listed in the composer command menu under the same names

#### Scenario: Destinations are not offered inline
- **WHEN** the composer command menu is open
- **THEN** no node and no project is listed among its entries

### Requirement: The menu opens only on a leading slash in an empty composer
The composer SHALL open the command menu when the learner types `/` as the first character of an otherwise empty composer. A `/` typed at any other position SHALL NOT open the menu. The menu SHALL be available in the composer of every thread on a node, whether that thread is the node's main thread or a spawned one.

#### Scenario: Leading slash opens the menu
- **WHEN** the learner types `/` into an empty composer
- **THEN** the command menu opens listing the registry's commands

#### Scenario: A slash inside a sentence does not open the menu
- **WHEN** the learner types `see the note in docs/setup`
- **THEN** no command menu opens at any point

#### Scenario: The menu is available in a spawned thread
- **WHEN** the learner types `/` into the empty composer of a spawned thread
- **THEN** the command menu opens with the same entries it offers in the node's main thread

### Requirement: The typed token filters by name prefix and the menu closes when nothing matches
While the menu is open, the text following the leading `/` SHALL filter the entries to those whose command name begins with that text. The menu SHALL close as soon as the typed text matches no command name and SHALL NOT reopen while the composer content continues from that text. Text containing whitespace SHALL close the menu.

#### Scenario: Typing narrows the menu
- **WHEN** the learner has typed `/qu` and a command named `quiz-master` exists
- **THEN** the menu lists that command

#### Scenario: A path-like message closes the menu and stays text
- **WHEN** the learner types `/usr/bin/env` starting from an empty composer and no command name begins with `usr`
- **THEN** the menu closes at the point nothing matches and the composer holds the literal text `/usr/bin/env`

#### Scenario: A space closes the menu
- **WHEN** the learner types `/quiz me on this` starting from an empty composer
- **THEN** the menu closes when the space is typed and the composer holds the literal text

### Requirement: The composer never rewrites what the learner typed
The composer SHALL send exactly the characters the learner typed. It SHALL NOT strip, escape, or transform a leading `/`, and SHALL NOT require an escape sequence to send a message beginning with one. A message SHALL be sent only by an explicit send, and a command SHALL be invoked only by explicitly choosing a menu entry.

#### Scenario: A message beginning with a slash is sendable
- **WHEN** the learner types `/` followed by text that matches no command and sends the message
- **THEN** the message is sent with its leading `/` intact and no command runs

#### Scenario: Dismissing the menu leaves the text
- **WHEN** the learner types `/quiz`, presses Escape, and sends the message
- **THEN** the menu closes, the composer still holds `/quiz`, the message `/quiz` is sent, and no command runs

### Requirement: Enter chooses the highlighted command while the menu is open
While the menu is open with at least one entry, the first available entry SHALL be highlighted, the arrow keys SHALL move the highlight, and Enter SHALL invoke the highlighted command instead of sending a message. While the menu is closed, Enter SHALL send the message. Escape SHALL close the menu without invoking anything and without clearing the composer.

#### Scenario: Enter invokes rather than sends
- **WHEN** the learner types `/quiz` and presses Enter while the menu lists `quiz-master` as highlighted
- **THEN** the `quiz-master` command is invoked and no message is added to the conversation

#### Scenario: Enter sends once the menu is closed
- **WHEN** the learner types `/quiz`, presses Escape, and presses Enter
- **THEN** the text `/quiz` is sent as an ordinary message

#### Scenario: Escape preserves the composer content
- **WHEN** the learner presses Escape while the command menu is open
- **THEN** the menu closes and the composer still holds every character the learner typed

### Requirement: Invoking a command from the composer clears the token and sends no message
When a command is invoked from the composer menu, the system SHALL remove the typed command token from the composer and SHALL NOT add that token to the conversation as a message. Any message the invoked command produces SHALL be attributable to the command rather than to text the learner appeared to send.

#### Scenario: The token does not become a message
- **WHEN** the learner invokes a command from the composer menu
- **THEN** the composer is empty and the conversation contains no message consisting of the command token

### Requirement: Unavailable commands are shown inline with their reason
The composer menu SHALL list unavailable commands, marked as unavailable with the reason, in the same way the palette does. An unavailable entry SHALL NOT be the highlighted entry and Enter SHALL NOT invoke it.

#### Scenario: A rejected skill is visible from the composer
- **WHEN** a skill folder failed to load and the learner opens the composer command menu
- **THEN** an entry naming that folder and the reason it was rejected is listed and marked unavailable

#### Scenario: An unavailable entry is never the Enter target
- **WHEN** the menu's only entries are unavailable and the learner presses Enter
- **THEN** no command is invoked
