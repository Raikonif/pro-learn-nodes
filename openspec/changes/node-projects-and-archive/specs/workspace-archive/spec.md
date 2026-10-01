## Purpose

Lets a learner retire a finished project or node so it leaves the canvas and the recency listing without being destroyed — archived material stays searchable, keeps every link it had, and can be restored to exactly the state it was retired in.

## ADDED Requirements

### Requirement: Archiving is a reversible state and never destroys data
The system SHALL record archived as a state on a project and on a node. Archiving SHALL NOT delete or alter the archived item's title, body, mode, instructions, attached sources, threads, messages, selection anchors, project membership, or links. Restoring SHALL return the item to the unarchived state with all of that intact.

#### Scenario: Archiving preserves everything
- **WHEN** a learner archives a node holding conversations, anchors, and links
- **THEN** the node is marked archived and its conversations, anchors, project membership, and links are unchanged

#### Scenario: Restoring returns the item as it was
- **WHEN** a learner restores a previously archived node
- **THEN** the node is unarchived and presents the same conversations, anchors, membership, and links it had before archiving

#### Scenario: Archive state survives a restart
- **WHEN** a learner archives a project, closes the application, and opens it again
- **THEN** the project is still archived and its nodes are still archived

### Requirement: Archived material leaves the canvas, the recency listing, and every default listing
The system SHALL exclude archived nodes from the graph canvas, from the left rail's recency listing, and from every listing that does not explicitly ask for archived material. The system SHALL exclude archived projects from project listings and SHALL NOT offer an archived project as a destination when moving a node. Restoring an item SHALL return it to those surfaces.

#### Scenario: An archived node leaves the canvas
- **WHEN** a learner archives a node that was rendered on the canvas
- **THEN** the canvas no longer renders a card for it and the left rail's recency listing no longer lists it

#### Scenario: An archived project is not a move destination
- **WHEN** a learner chooses a project to move a node into
- **THEN** archived projects are not offered as destinations

#### Scenario: Restoring returns the node to the canvas
- **WHEN** a learner restores an archived node
- **THEN** the canvas renders it again and it becomes eligible for the recency listing

### Requirement: Archived material remains findable by explicit search and openable from the results
The system SHALL include archived nodes and archived projects in search results when the learner asks for archived material, and SHALL mark each such result as archived. Opening an archived item from search SHALL present it and SHALL NOT change its archived state; only an explicit restore SHALL unarchive it.

#### Scenario: Search finds an archived node when asked
- **WHEN** a learner searches for a term matching an archived node and asks for archived material to be included
- **THEN** the node appears in the results marked as archived

#### Scenario: Default search omits archived material
- **WHEN** a learner searches without asking for archived material
- **THEN** archived nodes and archived projects are absent from the results

#### Scenario: Opening does not restore
- **WHEN** a learner opens an archived node from search results
- **THEN** the node is presented, is indicated as archived, and remains archived until the learner restores it

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

### Requirement: Deletion stays a separate, confirmed action distinct from archiving
The system SHALL offer deletion of a project or a node as an action distinct from archiving, stating what will be destroyed and requiring a confirmation that names that consequence. Archiving SHALL NOT be presented as, or implemented as, a step towards deletion, and no archive or restore SHALL destroy data. Deleting an archived item SHALL require the same confirmation as deleting an unarchived one.

#### Scenario: Archiving asks for no destructive confirmation
- **WHEN** a learner archives a project
- **THEN** the system archives it without warning of data loss, because none occurs

#### Scenario: Deletion names its consequence
- **WHEN** a learner asks to delete an archived node
- **THEN** the system states that the node's conversations will be permanently destroyed and proceeds only after the learner confirms

#### Scenario: Archived material is not swept
- **WHEN** material has been archived for any length of time
- **THEN** it is not deleted by the system, and remains searchable and restorable until a learner explicitly deletes it
