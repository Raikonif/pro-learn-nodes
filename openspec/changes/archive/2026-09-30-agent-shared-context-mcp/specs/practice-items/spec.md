## ADDED Requirements

### Requirement: An item records who authored it
Every practice item SHALL record whether the learner or an agent authored it, and if an agent, which one. An item authored by an agent SHALL be presented as such wherever items are shown. Authorship SHALL NOT change how an item is answered or how its attempts are recorded.

#### Scenario: An agent-authored question is marked
- **WHEN** a node holds a question the learner wrote and one an agent wrote
- **THEN** the agent's question shows the agent's name and the learner's shows none

#### Scenario: Answering an agent's question is the same as answering the learner's
- **WHEN** the learner answers a question an agent wrote
- **THEN** an attempt is recorded exactly as for a question the learner wrote

### Requirement: A code exercise is solved in the Code tool and submitted as an attempt
A practice item MAY be a code exercise: a statement, starter code, and optionally the output a correct program prints. A code exercise SHALL be worked on in the Code tool, not answered in a text field. Submitting SHALL record an attempt holding the learner's code and the outcome and output of running it; where the exercise names an expected output, the attempt SHALL record whether the run's output matched it, and SHALL NOT imply any other judgement.

#### Scenario: Submitting a solution
- **WHEN** the learner submits their solution to a code exercise
- **THEN** an attempt is recorded with their code, the run's outcome, and its output, and earlier attempts are unchanged

#### Scenario: An expected output is checked, and nothing more is claimed
- **WHEN** a submitted run's output equals the exercise's expected output
- **THEN** the attempt is shown as matching the expected output, and no score or grade is shown
