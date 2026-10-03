## Purpose

Lets a learner put a finished project away with the sessions it holds, so they leave the canvas and the history without being destroyed, and bring it back to exactly the state it was put away in. It builds on session archiving (`session-history`), which it leaves unchanged.

## ADDED Requirements

### Requirement: Archiving a project is a reversible state and never destroys data
The system SHALL record archived as a state on a project. Archiving a project SHALL NOT delete or alter its name or instructions, nor any member node's conversations, threads, messages, anchors, practice, membership, or links. Restoring SHALL return the project to the unarchived state with all of that intact. The default project SHALL NOT be archived.

#### Scenario: Archiving preserves everything
- **WHEN** a learner archives a project whose sessions hold conversations, practice, and links
- **THEN** the project and its sessions are archived and all of that is unchanged

#### Scenario: Archive state survives a restart
- **WHEN** a learner archives a project, closes the application, and opens it again
- **THEN** the project is still archived and its sessions are still archived

#### Scenario: The default project cannot be archived
- **WHEN** a learner attempts to archive the default project
- **THEN** the attempt is refused with the reason, and nothing is archived

### Requirement: An archived project leaves every listing and remains restorable
An archived project SHALL be absent from the project filter, from project choices when creating or moving a session, and from the palette's project commands. The left rail SHALL list archived projects separately, each with its number of sessions, and offer restoring each.

#### Scenario: An archived project is not a move destination
- **WHEN** a learner chooses a project to move a session into
- **THEN** archived projects are not offered

#### Scenario: Restoring from the archived list
- **WHEN** the learner restores a project from the archived projects list
- **THEN** it returns to the filter and its archived-with sessions return to the history and the canvas

### Requirement: Sessions archived with their project remain findable
Sessions archived with their project SHALL be returned by the history search when archived sessions are included, like any archived session. Restoring one of them while its project is archived SHALL be refused with an indication that the project must be restored first.

#### Scenario: Finding a session of an archived project
- **WHEN** the learner searches with archived sessions included for a phrase from a session of an archived project
- **THEN** that session is returned, marked archived

### Requirement: A project may be archived while it holds unarchived nodes, which are archived with it
The system SHALL permit archiving a project regardless of how many unarchived nodes it holds. Archiving a project SHALL archive every unarchived node whose membership is that project, and SHALL record that each such node was archived as a consequence of its project. A node that was already archived on its own before the project was archived SHALL NOT be recorded that way.

#### Scenario: Archiving a project takes its nodes with it
- **WHEN** a learner archives a project holding unarchived nodes
- **THEN** the project is archived, every one of those nodes is archived, and none of them is rendered on the canvas

#### Scenario: An already-archived node is distinguished
- **WHEN** a node is archived on its own and its project is archived afterwards
- **THEN** that node is not recorded as having been archived by its project

### Requirement: Restoring a project restores only the nodes it archived
The system SHALL, on restoring an archived project, restore exactly the nodes recorded as archived as a consequence of that project. A node archived on its own before the project was archived SHALL remain archived, and SHALL be restorable individually.

#### Scenario: Cascade is reversed exactly
- **WHEN** a learner restores a project that had archived three of its nodes and left one already-archived node alone
- **THEN** those three nodes are unarchived and the already-archived node remains archived

#### Scenario: An individually archived node is restorable on its own
- **WHEN** a learner restores a node that remained archived after its project was restored
- **THEN** that node is unarchived and returns to the canvas

### Requirement: A node may be archived and restored independently of its project
The system SHALL allow archiving a node whose project is not archived, and SHALL allow restoring an individually archived node whose project is not archived. Restoring a node whose project is still archived SHALL be refused with an indication that the project must be restored first, so a restored node is never stranded on a canvas its project has left.

#### Scenario: Archiving one node leaves the project alone
- **WHEN** a learner archives one node of an unarchived project
- **THEN** that node leaves the canvas and every other node of the project remains rendered

#### Scenario: Restoring under an archived project is refused
- **WHEN** a learner attempts to restore a node whose project is archived
- **THEN** the restore is refused with an indication that the project must be restored first, and the node remains archived

### Requirement: Archiving preserves links, including links that cross project lines
The system SHALL preserve every link attached to an archived node, whichever projects the two ends belong to. When one end of a link is archived and the other is not, the link SHALL remain stored and the unarchived end SHALL indicate that it has a link to archived material rather than presenting no link at all. Following such an indication SHALL offer to restore the archived end rather than reporting the link as missing. Restoring the archived end SHALL present the link normally again.

#### Scenario: A cross-project link survives archiving one side
- **WHEN** a node in one project is linked to a node in another project and the second project is archived
- **THEN** the link is still stored and the unarchived node indicates it has a link to archived material

#### Scenario: Following a link to archived material offers restore
- **WHEN** a learner follows a link from an unarchived node to an archived one
- **THEN** the system identifies the archived target and offers to restore it, and does not report the link as missing or broken

#### Scenario: Restoring both ends restores the drawn link
- **WHEN** the archived end of a cross-project link is restored
- **THEN** the canvas draws the link between the two nodes as it did before

### Requirement: Deleting a project is separate from archiving and never deletes a session
The system SHALL offer deleting a project as an action distinct from archiving, stating before it happens that the project's sessions will move to the default project, and requiring confirmation. On confirmation every member session, archived or not, SHALL move to the default project with its content and links intact, and the project SHALL be removed. Sessions SHALL remain undeletable. The default project SHALL NOT be deleted.

#### Scenario: Deletion names its consequence
- **WHEN** a learner asks to delete a project
- **THEN** the system states that its sessions will move to the default project and proceeds only after confirmation

#### Scenario: Sessions survive their project's deletion
- **WHEN** a learner confirms deleting a project holding archived and unarchived sessions
- **THEN** the project is gone, every one of its sessions belongs to the default project, and the archived ones are still archived
