## Purpose

Lets a learner read the code that belongs to a node — what its agent wrote in the node's folder, its practice exercises, and code quoted in its conversation — as code: coloured by what each part is, with line numbers and the syntax problems a parser finds, in one read-only tab offered only when such code exists.

## ADDED Requirements

### Requirement: The Code tab is offered only when the node has code
The workspace SHALL offer a Code tab for an open node if and only if at least one code source exists for it: a code file in the node's working directory, a code exercise in its practice, or a code block in an agent message of its conversation. The Code tab SHALL NOT be offered, and SHALL NOT show an empty viewer, for a node with no code.

#### Scenario: A node without code has no Code tab
- **WHEN** the learner opens a node whose working directory holds no code file, whose practice has no code exercise, and whose conversation has no code block
- **THEN** no Code tab is offered

#### Scenario: Code written by the agent makes the tab appear
- **WHEN** the agent of the open node writes `loops.py` in the node's working directory
- **THEN** the Code tab is offered and lists `loops.py`

#### Scenario: A code block in the conversation makes the tab appear
- **WHEN** an agent message in the open node contains a fenced code block
- **THEN** the Code tab is offered and lists that block

### Requirement: Code sources are listed together, each labelled by where it comes from
The Code tab SHALL list every code source of the node, grouped as files in the node's folder, practice exercises, and code from the conversation. A practice exercise SHALL be listed once, from its practice record, even though a copy of it exists in the node's folder.

#### Scenario: The three kinds are listed apart
- **WHEN** a node has a file in its folder, a code exercise, and a code block in its conversation
- **THEN** the Code tab lists each under its own group, naming the file, the exercise, and the message the block came from

#### Scenario: An exercise is not listed twice
- **WHEN** a node has a code exercise, whose copy practice keeps in the node's folder
- **THEN** the exercise is listed once, under practice exercises, with the learner's current solution

### Requirement: Code is shown highlighted, numbered, read-only
Opening a code source SHALL show its content read-only, with line numbers and with keywords, functions, classes, strings, numbers, comments, and other token kinds coloured distinctly, for Python, JavaScript, TypeScript, JSON, HTML, CSS, and Markdown. Code in a language that is not recognised SHALL be shown with line numbers and without colouring, and SHALL say that its language is not recognised.

#### Scenario: A Python file is coloured by token kind
- **WHEN** the learner opens a Python file containing a class, a function, a string, and a comment
- **THEN** each is coloured as its kind, distinct from one another, and every line is numbered

#### Scenario: The viewer does not edit
- **WHEN** the learner types while a code source is open in the Code tab
- **THEN** the code is unchanged

#### Scenario: An unrecognised language is still readable
- **WHEN** the learner opens a file in a language the viewer does not recognise
- **THEN** the content is shown with line numbers, uncoloured, with a note that its language is not recognised

### Requirement: Syntax problems are shown as diagnostics
For a recognised language, the viewer SHALL show each syntax error the parser finds as a diagnostic: the range marked in the code, a marker beside its line number, and an entry in a list giving line and column. The viewer SHALL state that its checks are syntax checks.

#### Scenario: A syntax error is marked
- **WHEN** the learner opens a Python file with an unclosed parenthesis
- **THEN** the range is marked, its line carries a marker, and the list names the line and column of the syntax error

#### Scenario: Valid code shows no diagnostics
- **WHEN** the learner opens a file that parses without error
- **THEN** no diagnostic is shown, and the viewer states that no syntax problems were found

### Requirement: The viewer reads only within the node's folder
The system SHALL list and read only files whose resolved path, following links, lies within the open node's working directory, SHALL NOT list or read a file of another node, and SHALL NOT read a file larger than 1 MB or one that is not text, listing it instead as not viewable with the reason.

#### Scenario: A link leaving the folder is not followed
- **WHEN** the node's folder contains a link to a file outside it
- **THEN** that file is not listed and cannot be read through the Code tab

#### Scenario: Another account's node is unknown
- **WHEN** a request names a node of another account
- **THEN** it is answered as a node that does not exist

#### Scenario: A large file is listed but not opened
- **WHEN** the node's folder holds a 5 MB log file
- **THEN** it is listed as too large to view, and opening it shows that reason
