## Purpose

The single runtime set of invocable commands that every command surface renders, derived from the loaded skill catalogue rather than hand-maintained, so installing a skill folder makes it invocable and a skill that failed to load says so instead of disappearing.

## ADDED Requirements

### Requirement: One registry backs every command surface
The system SHALL maintain exactly one set of invocable commands. Every surface that offers commands SHALL offer that same set: a command reachable from one surface SHALL be reachable from every other, with the same name, the same availability, and the same effect. No surface SHALL define, hide, or add a command of its own.

#### Scenario: The two surfaces agree on the command set
- **WHEN** a learner opens the command palette and then opens the composer command menu in the same workspace state
- **THEN** both offer the same commands with the same names and the same availability

#### Scenario: A command added to the registry appears in both surfaces
- **WHEN** the registry gains a command
- **THEN** that command is offered by the palette and by the composer command menu without either surface being changed

### Requirement: Skill commands are derived from the loaded catalogue
The system SHALL derive the registry's skill commands from the set of skills loaded from the skills directory. Adding a valid skill folder SHALL make its commands appear once the catalogue is next read, and removing a skill folder SHALL remove its commands. The registry SHALL NOT require a per-skill declaration anywhere else in order for a skill to be invocable.

#### Scenario: A newly installed skill becomes invocable
- **WHEN** a learner places a valid skill folder in the skills directory and the catalogue is read again
- **THEN** that skill's commands are offered by every command surface

#### Scenario: A removed skill stops being offered
- **WHEN** a skill folder is removed from the skills directory and the catalogue is read again
- **THEN** that skill's commands are no longer offered by any command surface, and invoking one by its former name reports that the command no longer exists

#### Scenario: The catalogue is re-read without restarting
- **WHEN** a learner installs a skill while the application is running and asks the workspace to reload the catalogue
- **THEN** the new skill's commands are offered without the application being restarted and without the open conversation being lost

### Requirement: A loaded skill contributes exactly two commands
For each loaded skill the registry SHALL contain exactly two commands: one that runs the skill once against the open conversation, and one that toggles the skill's activation for the open node. Both SHALL be named after the skill and SHALL carry the skill's description from its definition, so the two are distinguishable by name alone.

#### Scenario: Both commands are present for one skill
- **WHEN** a skill named `quiz-master` is loaded
- **THEN** the registry contains a command that runs `quiz-master` once and a command that toggles `quiz-master` for the open node, and each names the skill and shows its description

#### Scenario: The toggle command names its current direction
- **WHEN** a skill is already active on the open node
- **THEN** its toggle command is presented as deactivating that skill, and when it is not active it is presented as activating it

### Requirement: A command declares whether it needs an open node
Every command SHALL declare whether it requires an open node. A command requiring one SHALL be available only while a node is open. A command not requiring one SHALL be available whenever a command surface is open.

#### Scenario: Skill commands require an open node
- **WHEN** the registry is inspected while no node is open
- **THEN** every skill command reports itself as unavailable and states that it requires an open node

#### Scenario: Navigation commands do not require an open node
- **WHEN** a command that opens a node or a project is inspected while no node is open
- **THEN** it reports itself as available

### Requirement: Unavailable commands are listed, not hidden
The system SHALL include unavailable commands in the results a command surface renders, marked as unavailable and accompanied by the reason. An unavailable command SHALL NOT be omitted from results, SHALL NOT be activatable, and activating it SHALL restate the reason without performing any action.

#### Scenario: An unavailable command is still discoverable
- **WHEN** a learner searches for a skill command while no node is open
- **THEN** the command is listed, marked unavailable, and the listing states that an open node is required

#### Scenario: Activating an unavailable command does nothing
- **WHEN** a learner attempts to activate a command marked unavailable
- **THEN** no conversation is started, no node is created, no node configuration changes, and the reason is restated

### Requirement: A skill that failed to load is reported, never silently absent
When a folder in the skills directory cannot be loaded, the system SHALL record an entry naming the folder and the reason it was rejected, and SHALL present that entry among the registry's results as permanently unavailable. A rejected folder SHALL NOT prevent other skills from loading and SHALL NOT prevent a conversation from running.

#### Scenario: A malformed skill is named rather than dropped
- **WHEN** a skill folder is present whose definition is missing or invalid
- **THEN** the registry reports an entry naming that folder and the reason it was rejected, and that entry is marked unavailable

#### Scenario: One bad skill does not suppress the good ones
- **WHEN** the skills directory holds one valid skill and one that cannot be loaded
- **THEN** the valid skill's commands are offered and the invalid folder is reported alongside them

#### Scenario: A rejected skill cannot be invoked
- **WHEN** a learner attempts to activate the entry for a rejected skill folder
- **THEN** no skill is run or activated and the recorded reason is restated

### Requirement: Command names are stable and unique
Each command SHALL have an identifier that is stable across catalogue reads and unique within the registry. Two skills SHALL NOT produce commands with the same identifier. When two loaded skills would collide on a name, the system SHALL report the collision as a load rejection for the later folder rather than silently overriding the earlier one.

#### Scenario: An identifier survives a catalogue reload
- **WHEN** the catalogue is read again with the same skills present
- **THEN** each skill's commands keep the identifiers they had before

#### Scenario: A name collision is reported
- **WHEN** two skill folders declare the same skill name
- **THEN** one is loaded, the other is reported as rejected naming the collision, and neither silently replaces the other
