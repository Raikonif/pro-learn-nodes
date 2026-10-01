## Purpose

Lets a node hold more than one conversation, so a learner can chase a tangent without creating a graph node for it — keeping the graph a record of sessions rather than of every passing question.

## ADDED Requirements

### Requirement: Every node opens with a main thread
Each node SHALL have exactly one thread designated `main`, created with the node. Opening a node SHALL render its `main` thread in the center region. The `main` thread SHALL NOT carry a selection anchor and SHALL NOT be deletable.

#### Scenario: Node opens on its main thread
- **WHEN** the learner opens a node
- **THEN** the center region renders that node's `main` thread

#### Scenario: Main thread has no anchor
- **WHEN** a node's `main` thread is inspected
- **THEN** it carries no selection anchor and offers no action to delete it

### Requirement: A spawned thread renders as a collapsed stub at its anchor
A thread created from a selection SHALL render, in the thread it was spawned from, as a collapsed stub positioned at its anchor. The stub SHALL show the thread's name and its message count. The stub SHALL remain visible whether or not the thread is currently expanded.

#### Scenario: Stub appears at the anchor after spawning
- **WHEN** the learner creates a thread from a selection
- **THEN** a collapsed stub showing the thread's name and message count appears at the selected text in the source thread

#### Scenario: Stub reflects thread activity
- **WHEN** messages are added to a spawned thread
- **THEN** the stub's message count reflects the thread's current message count

### Requirement: Expanding a thread takes the center and offers a back-link
Activating a thread stub SHALL render that thread in the center region in place of the thread it was spawned from. The expanded thread SHALL display a header naming the text it was spawned from, and activating that header SHALL return to the source thread scrolled to the anchor.

#### Scenario: Activating a stub expands the thread
- **WHEN** the learner activates a thread stub
- **THEN** the center region renders that thread in place of the source thread

#### Scenario: Back-link returns to the anchor
- **WHEN** the learner activates the back-link header of an expanded thread
- **THEN** the center region renders the source thread scrolled to the stub's anchor

### Requirement: Threads may spawn further threads
A selection made within a spawned thread SHALL offer the same two branch actions as a selection made in a `main` thread. A thread spawned from another thread SHALL belong to the same node.

#### Scenario: Nested thread creation
- **WHEN** the learner selects text inside a spawned thread and chooses "new chat"
- **THEN** a further thread is created on the same node, with a stub at the selection inside the spawned thread

#### Scenario: Node generation from a nested thread
- **WHEN** the learner selects text inside a spawned thread and chooses "generate a node"
- **THEN** a new node is created linked to the node that owns the thread

### Requirement: Threads are invisible to the graph and the left rail
A thread SHALL NOT be represented as a node in the graph, in the right-rail minimap, or in the left rail, regardless of how deeply it is nested. A node holding any number of threads SHALL be rendered as exactly one node in the graph.

#### Scenario: Spawned threads do not alter the graph
- **WHEN** the learner creates one or more threads on a node
- **THEN** the graph and the right-rail minimap still show exactly one node for that node, and no entries are added to the left rail

### Requirement: Threads inherit the node's configuration and cannot override it
A thread SHALL run with the mode, active skills, and MCP servers of the node that owns it. The workspace SHALL NOT present per-thread controls for mode, active skills, or MCP servers. Changing a node's configuration SHALL apply to every thread on that node.

#### Scenario: Thread runs with the node's configuration
- **WHEN** a thread is spawned on a node
- **THEN** it runs with that node's mode, active skills, and MCP servers, and the workspace offers no control to change them for that thread alone

#### Scenario: Node configuration change reaches every thread
- **WHEN** the learner changes the mode or active skills of a node holding several threads
- **THEN** every thread on that node runs with the changed configuration

### Requirement: Open threads are reachable from the node
While a node is open, the workspace SHALL present a way to reach every thread on that node without first locating each thread's stub. Selecting a thread from that surface SHALL expand it in the center region.

#### Scenario: All threads on a node are enumerable
- **WHEN** a node holding several nested threads is open
- **THEN** the workspace presents every thread on that node in one place, and selecting one expands it in the center region
