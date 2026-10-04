## Purpose

Groups a learner's nodes into named projects within one account's workspace, so a growing graph can be organised without severing the links that make it a graph — a node belongs to exactly one project, while a link between nodes may cross project lines.

## ADDED Requirements

### Requirement: A project belongs to exactly one workspace
The system SHALL scope every project to the workspace of the account that created it. A project SHALL NOT be global, SHALL NOT be shared between accounts, and SHALL NOT hold a node belonging to a different workspace.

#### Scenario: Projects are listed per account
- **WHEN** a learner lists projects while one account is active
- **THEN** only projects created within that account's workspace are returned

#### Scenario: Another account's projects are unreachable
- **WHEN** a learner creates a project while one account is active and then signs in as a second account
- **THEN** that project is absent from the second account's project list and from every response the second account receives

### Requirement: The workspace a project operates in is derived, and a named project is confirmed before use
The system SHALL derive the workspace of every project operation from the active account rather than from the request. Where a request names a project, the system SHALL honour that name only after confirming the project belongs to the active account's workspace. A project belonging to another account and a project that does not exist SHALL be refused identically, so the refusal does not reveal whether the named project exists.

#### Scenario: Request names no workspace
- **WHEN** the frontend creates a project while an account is active
- **THEN** the project is created in that account's workspace without the request having named a workspace

#### Scenario: Naming another account's project
- **WHEN** a request names a project belonging to an account other than the active one
- **THEN** the request is refused as not found, no project data is returned, and nothing is written to that project

#### Scenario: Refusal does not reveal existence
- **WHEN** one request names a project belonging to another account and another request names a project identifier that exists nowhere
- **THEN** both are refused identically

### Requirement: Every node belongs to exactly one project
The system SHALL record exactly one project membership for every node. A node SHALL NOT belong to two projects, and a node SHALL NOT be without a project. Every response that describes a node SHALL state which project it belongs to.

#### Scenario: A created node reports its project
- **WHEN** a node is created
- **THEN** the created node reports exactly one project membership

#### Scenario: Membership cannot be doubled
- **WHEN** a node already belonging to one project is placed in another
- **THEN** it belongs only to the newly named project and no longer to the previous one

### Requirement: A workspace has a default project that receives nodes with no chosen project
The system SHALL provide every workspace with exactly one default project, present from the moment the workspace exists. A node created without a named project SHALL belong to the default project. The default project SHALL NOT be deleted and SHALL NOT be archived, so a node always has a project to belong to.

#### Scenario: Node created without naming a project
- **WHEN** a node is created and no project is named
- **THEN** the node belongs to the workspace's default project and reports that membership like any other node

#### Scenario: A new workspace already has its default project
- **WHEN** an account's workspace is initialized
- **THEN** the default project exists before any node is created

#### Scenario: The default project resists removal
- **WHEN** a learner attempts to delete or archive the default project
- **THEN** the attempt is refused and the default project remains available

### Requirement: A node link may join nodes in different projects
The system SHALL permit a link between two nodes whose project memberships differ. Creating a link SHALL NOT be refused, altered, or duplicated because the two nodes belong to different projects, and moving a node between projects SHALL NOT delete or rewrite any link attached to it. A node SHALL remain reachable from every parent it is linked to, whatever project each parent belongs to.

#### Scenario: Linking across projects succeeds
- **WHEN** a link is created between a node in one project and a node in another project of the same workspace
- **THEN** the link is created and both nodes report the other as linked

#### Scenario: A shared child is reachable from parents in two projects
- **WHEN** one node is linked as a child of a parent in one project and of a parent in a second project
- **THEN** the child keeps its single project membership and is reachable from both parents

#### Scenario: Moving a node preserves its links
- **WHEN** a node that has parent and child links is moved into a different project
- **THEN** every one of those links still exists and still joins the same two nodes

### Requirement: A node is moved between projects without altering its content
The system SHALL allow a node to be moved from its current project to any other project in the same workspace. The move SHALL change only the node's project membership: its title, body, mode, threads, messages, selection anchors, and links SHALL be unchanged. Moving a node into a project it already belongs to SHALL succeed and change nothing.

#### Scenario: Move changes membership only
- **WHEN** a learner moves a node from one project to another
- **THEN** the node reports the new project and its conversations, anchors, and links are unchanged

#### Scenario: Moving into the current project is accepted
- **WHEN** a learner moves a node into the project it already belongs to
- **THEN** the request succeeds and the node's membership is unchanged

#### Scenario: Move to another account's project is refused
- **WHEN** a learner attempts to move a node into a project that is not in the active account's workspace
- **THEN** the request is refused as not found and the node's membership is unchanged

### Requirement: A branched node inherits its source node's project
When a node is created by branching from an existing node, the system SHALL give the new node the source node's project unless the learner names a different project at creation. Naming a different project SHALL be accepted, and the resulting parent-child link SHALL cross project lines rather than being refused.

#### Scenario: Branch without an override
- **WHEN** a learner branches a new node from a node in a project and names no project
- **THEN** the new node belongs to the source node's project

#### Scenario: Branch with a project override
- **WHEN** a learner branches a new node from a node in one project and names a different project at creation
- **THEN** the new node belongs to the named project and the link back to the source node is created and preserved

### Requirement: Projects are reached from the left rail and the command palette
The left rail SHALL offer a project filter above the session history — all projects, or one — and SHALL offer creating, renaming, archiving, and deleting a project, editing its instructions, and moving a session to another project. The command palette SHALL offer showing one project or all, creating a project, and moving the open session to a project. The filter SHALL be a view preference of this device and SHALL NOT change any node.

#### Scenario: Filtering the history to one project
- **WHEN** the learner chooses one project in the filter
- **THEN** the history lists only that project's sessions, still grouped by day, and the canvas and search are unchanged

#### Scenario: Moving the open session from the palette
- **WHEN** a node is open and the learner invokes "Move session to Algebra" in the palette
- **THEN** the node belongs to Algebra and its conversations and links are unchanged

#### Scenario: The filter survives a restart
- **WHEN** the learner filters to a project and restarts the application
- **THEN** the history is still filtered to that project

