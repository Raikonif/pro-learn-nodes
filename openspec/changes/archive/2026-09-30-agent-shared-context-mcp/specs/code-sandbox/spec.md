## ADDED Requirements

### Requirement: Each code exercise has its own buffer, beside the node's free one
The Code tool SHALL keep, for each code exercise on the node, a buffer holding the learner's solution, starting from the exercise's starter code, and SHALL keep the node's free buffer separate from all of them. Editing one SHALL leave every other unchanged, and each SHALL persist as the free buffer does. Only the learner SHALL write to a buffer.

#### Scenario: Switching between an exercise and the free sandbox
- **WHEN** the learner edits an exercise's buffer, switches to the free sandbox, and back
- **THEN** each shows what the learner last wrote in it

#### Scenario: A new exercise starts from its starter code
- **WHEN** the learner opens an exercise for the first time
- **THEN** its buffer holds the starter code the exercise came with

### Requirement: The node's agent can read the exercises and the learner's solutions as files
The system SHALL make each code exercise's statement and the learner's current solution available as files within the node's working directory, kept current as the learner edits, so the agent running the node's conversation can read them with its own tools. Changes made to those files by anything other than the learner's editing SHALL NOT change the learner's buffer.

#### Scenario: The agent reads the learner's solution
- **WHEN** the learner has written a solution and asks the agent to review it
- **THEN** the agent can read that solution from the node's directory

#### Scenario: Writing the file does not write the buffer
- **WHEN** a solution file in the node's directory is modified by anything other than the learner's editing
- **THEN** the learner's buffer is unchanged, and the file is rewritten from the buffer on the learner's next edit
