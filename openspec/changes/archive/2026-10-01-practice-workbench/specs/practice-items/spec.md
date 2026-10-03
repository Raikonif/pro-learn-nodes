## ADDED Requirements

### Requirement: An item records the delivery that brought it
A practice item an agent adds during a turn SHALL record the delivery it arrived in, so that the items of one delivery can be told apart from those of another after a restart. An item the learner wrote SHALL record no delivery. Items that existed before deliveries were recorded on items SHALL be attributed to the delivery the conversation already records for them, where one exists.

#### Scenario: Items of one delivery stay together
- **WHEN** an agent adds three questions in one turn and two more in a later turn
- **THEN** the first three record one delivery and the other two record another

#### Scenario: Earlier items are attributed from the conversation
- **WHEN** the application starts on data whose items predate this requirement and whose conversation records the deliveries that brought them
- **THEN** each such item records the delivery the conversation names for it
