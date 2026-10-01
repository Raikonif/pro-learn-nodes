# code-sandbox Specification

## Purpose

A place inside a node where a learner writes Python, runs it, and sees exactly what it printed and what it failed with — without leaving the node, without sending the code anywhere, and without a runaway program taking the workspace down with it.

## Requirements

### Requirement: The sandbox runs the learner's program and shows what it wrote
The code sandbox SHALL present an editable code buffer and a control that runs its current contents. A completed run SHALL display everything the program wrote to its standard output and standard error, in the order the program produced it. A run that produces no output SHALL be reported as completed with no output, and SHALL NOT be reported as a failure.

#### Scenario: A program's output is shown
- **WHEN** the learner runs a program that prints two lines
- **THEN** both lines are displayed in the order the program printed them

#### Scenario: Silent success is reported as success
- **WHEN** the learner runs a program that produces no output and raises nothing
- **THEN** the run is reported as completed with no output and no error is shown

### Requirement: Failures are shown as failures, with the message and the location
When the program raises an uncaught error, the sandbox SHALL display the error's type, its message, and the line in the learner's code where it was raised, presented distinguishably from ordinary output. Output the program produced before the failure SHALL be retained and shown alongside it. Code that cannot be parsed SHALL be reported the same way and SHALL NOT execute any part of the program.

#### Scenario: An uncaught error is reported with prior output
- **WHEN** the learner runs a program that prints a line and then raises an uncaught error
- **THEN** the printed line is shown, and the error's type, message, and line number are shown as an error rather than as output

#### Scenario: Unparseable code runs nothing
- **WHEN** the learner runs code that cannot be parsed
- **THEN** the failure is reported with its message and location, and no statement of the program is executed

### Requirement: A run never freezes the workspace and can always be stopped
While a run is in progress, the node's conversation, the minimap, the left rail, and the other practice tools SHALL remain interactive. The sandbox SHALL show that a run is in progress and SHALL offer stopping it. Stopping SHALL end the run, report it as stopped by the learner, and show the output the program produced before it was stopped. A program that never terminates SHALL be subject to this requirement exactly as any other program is.

#### Scenario: A non-terminating program leaves the workspace usable
- **WHEN** the learner runs a program that loops forever
- **THEN** the sandbox shows a run in progress with a stop control, and the conversation, minimap, left rail, and other practice tools continue to respond

#### Scenario: Stopping a non-terminating program ends it
- **WHEN** the learner stops a run that would not have terminated on its own
- **THEN** the run is reported as stopped by the learner, any output produced before the stop is shown, and the sandbox accepts a new run immediately

### Requirement: A run that exceeds the time limit is terminated on its own
The sandbox SHALL enforce a fixed maximum duration on a run. A run that exceeds it SHALL be terminated without the learner acting, reported as timed out, and SHALL name the limit it exceeded. Output produced before the limit was reached SHALL be shown. The sandbox SHALL be immediately editable and runnable again afterwards.

#### Scenario: A long run is terminated and named as timed out
- **WHEN** a run exceeds the sandbox's maximum run duration
- **THEN** it is terminated, reported as timed out with the limit named, and any output it produced before the limit is shown

#### Scenario: The sandbox recovers after a timeout
- **WHEN** a run has been terminated for exceeding the time limit
- **THEN** the learner can edit the code and start a new run that reports its own result normally

### Requirement: One run at a time
While a run is in progress, the sandbox SHALL NOT start a second run. Activating the run control during a run SHALL NOT queue, duplicate, or interleave a run. The run control SHALL become available again once the run has completed, failed, been stopped, or timed out.

#### Scenario: A second run cannot be started during the first
- **WHEN** the learner activates the run control while a run is in progress
- **THEN** no additional run is started and the in-progress run is unaffected

### Requirement: Every run starts from a clean interpreter
Each run SHALL evaluate the whole current contents of the buffer from a fresh interpreter state. A run SHALL NOT observe variables, imports, definitions, or side effects established by any previous run, whether that run completed, failed, was stopped, or timed out. The buffer is the program; there is no session accumulated across runs.

#### Scenario: A name defined by an earlier run is not visible to a later one
- **WHEN** the learner runs code that binds a name, then removes that binding from the buffer and runs code that reads the name
- **THEN** the second run fails with an error reporting the name as undefined

#### Scenario: A stopped run leaves nothing behind
- **WHEN** the learner stops a run and then starts a new one
- **THEN** the new run behaves as though the stopped run had never executed

### Requirement: The code buffer persists with its node; a run's result does not
The sandbox's code buffer SHALL be persisted against the node it belongs to without the learner performing an explicit save, and SHALL be restored when the node is reopened and after the application is restarted. The result of a previous run — its output, its error, and its status — SHALL NOT be restored: reopening a node SHALL show the persisted code with no result until a run is performed.

#### Scenario: Code survives leaving and reopening the node
- **WHEN** the learner types code in the sandbox, opens another node, and returns to the first node
- **THEN** the sandbox shows the code exactly as it was left, with no explicit save having been performed

#### Scenario: Code survives a restart
- **WHEN** the learner types code in the sandbox and the application is closed and reopened
- **THEN** reopening that node shows the same code

#### Scenario: A previous run's result is not restored
- **WHEN** the learner runs code, leaves the node, and returns to it
- **THEN** the code is shown and no output, error, or run status from the earlier run is shown

### Requirement: Each node has its own sandbox
The sandbox buffer SHALL belong to exactly one node. Opening a different node SHALL show that node's buffer and SHALL NOT show, merge, or overwrite another node's. Editing one node's buffer SHALL leave every other node's unchanged.

#### Scenario: Two nodes hold different code
- **WHEN** the learner writes different code in the sandboxes of two nodes and revisits each
- **THEN** each node shows the code written in it and neither shows the other's

#### Scenario: A fresh node starts empty
- **WHEN** the learner opens the sandbox on a node that has never had code written in it
- **THEN** the buffer is empty rather than carrying the previously open node's code

### Requirement: Code runs on the learner's device and is not sent away to run
Executing the sandbox's code SHALL happen on the learner's own device. The code, its output, and its errors SHALL NOT be transmitted to any external service in order to run. A run SHALL succeed with no network connection available.

#### Scenario: Running works offline
- **WHEN** the learner runs sandbox code with no network connection available
- **THEN** the run completes and its output is shown

#### Scenario: Running makes no external request
- **WHEN** a sandbox run is performed
- **THEN** no request carrying the code, its output, or its errors is made to any service outside the learner's device

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
