# react-flow-node-canvas Specification

## Purpose

Presents the learning-session graph as a navigable canvas of recognisable chat cards, so learners can understand and move among branches without losing their place.

## Requirements

### Requirement: Canvas renders every workspace node and branch as a chat-like graph
The workspace SHALL render every workspace node as one compact chat-like card and every node link as one directed connection from parent to child. A node card SHALL show the node title and a visual cue for its configured mode. The canvas SHALL NOT render conversation threads as graph nodes.

#### Scenario: A branched graph is rendered
- **WHEN** the workspace graph contains a parent node, child nodes, and side threads on either node
- **THEN** the canvas renders one card per node, one connection per parent-child link, and no card for a side thread

### Requirement: Canvas provides viewport navigation without editing graph connections
The graph canvas SHALL let a learner pan, zoom, and fit the visible graph. The canvas SHALL NOT offer controls for manually drawing, reconnecting, or deleting graph connections.

#### Scenario: Learner navigates a graph larger than the viewport
- **WHEN** the graph does not fit in the visible canvas region
- **THEN** the learner can pan or zoom the canvas and can return to a view containing the whole graph

#### Scenario: Learner cannot manually change graph topology
- **WHEN** the learner interacts with a node or connection in the canvas
- **THEN** no gesture creates, reconnects, or deletes a parent-child connection

### Requirement: Canvas supplies representative graph fixtures
The development fixture graph SHALL include at least five nodes, at least two parent-child branch points, and at least two side threads across the graph. The fixture data SHALL let a learner observe that side threads do not become graph nodes.

#### Scenario: Fixture graph demonstrates branching and threads
- **WHEN** the workspace starts with its development fixture graph
- **THEN** the canvas shows multiple levels of node branches and the associated conversations include side threads without extra graph cards
