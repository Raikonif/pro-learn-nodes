## Purpose

Lets a learner choose where the application keeps everything it stores and can change, move it there whole without losing anything at either place, and get back a working graph when a folder goes missing or a move goes wrong.

## ADDED Requirements

### Requirement: The learner can see and change where the application's data is kept
The desktop application SHALL show the folder holding all of its modifiable data — the workspace database, its backups, and every node's working directory — and SHALL let the learner choose another folder. A folder that is not writable, is not empty, lies inside the current folder, or contains it SHALL be refused with the reason. Data kept in the platform keychain SHALL NOT be moved and SHALL be named as staying where it is.

#### Scenario: The current location is shown
- **WHEN** the learner opens the data location setting
- **THEN** the current folder's path is shown, with what it holds

#### Scenario: A folder that already holds files is refused
- **WHEN** the learner chooses a folder that is not empty
- **THEN** the move is refused, saying the folder must be empty, and nothing is copied

#### Scenario: The development build says the setting is unavailable
- **WHEN** the application runs in a browser rather than the desktop shell
- **THEN** the data location setting is shown as unavailable there, with the reason

### Requirement: Moving copies everything, verifies it, and switches only to a verified copy
Moving the data SHALL copy the entire contents of the current folder to the chosen folder, SHALL verify that every file arrived identical, and SHALL make the chosen folder the data folder only when the copy is verified and the application has started on it with its data reported usable. Until then the current folder SHALL remain the data folder, unchanged. The learner SHALL see the move's progress.

#### Scenario: A completed move continues where the learner was
- **WHEN** the learner moves the data to a new folder and the move completes
- **THEN** the application is running on the new folder with every session, practice item, and remembered decision it had before

#### Scenario: A copy that does not verify is abandoned
- **WHEN** a file copied to the new folder differs from the original
- **THEN** the move is abandoned, the application keeps running on the current folder, the partial copy is removed, and the learner is told the move did not happen and why

#### Scenario: A move interrupted by a crash is finished or undone at the next start
- **WHEN** the application stops during a move and is started again
- **THEN** a move that had not switched is undone, and one that had switched is verified and completed, before the workspace opens

### Requirement: The previous folder is emptied after the move, and a failure to do so is reported
After the application is running on the verified new folder, the system SHALL remove the previous folder's contents without following links out of it. If any of them cannot be removed, the system SHALL tell the learner which remain, SHALL offer to retry and to reveal the folder, and SHALL keep running on the new folder, which SHALL NOT depend on anything left behind.

#### Scenario: The previous folder is emptied
- **WHEN** a move completes and every file in the previous folder can be removed
- **THEN** the previous folder holds none of the application's data

#### Scenario: A file that cannot be removed is reported
- **WHEN** a file in the previous folder cannot be removed after a move
- **THEN** the learner is shown that file's path with Retry and Reveal, and the application keeps working on the new folder

#### Scenario: A link in the previous folder is removed, not followed
- **WHEN** the previous folder contains a link to a folder elsewhere
- **THEN** the link is removed and the folder it pointed to is untouched

### Requirement: Missing or damaged data is reported and restored when a good copy exists
At every start the system SHALL check that the data folder exists and its database opens and passes an integrity check. When it does not, the system SHALL NOT create an empty data folder in its place; it SHALL restore from the previous location if that still holds the data, or else from the newest backup that passes the integrity check, and SHALL tell the learner what was wrong, what was restored, and — for a backup — from when. When no good copy exists, the system SHALL show what is wrong and let the learner retry, choose another folder, or start on the default folder.

#### Scenario: A new folder that cannot be read falls back to the previous one
- **WHEN** the data was moved to a new folder whose database cannot be opened, while the previous folder still holds the data
- **THEN** the application returns to the previous folder, starts on it, and tells the learner why

#### Scenario: A damaged database is restored from a backup
- **WHEN** the database in the data folder fails its integrity check and a backup passes it
- **THEN** the newest such backup is restored, the application starts on it, and the learner is told when that backup was taken

#### Scenario: A missing folder is not replaced by an empty one
- **WHEN** the data folder is on a drive that is not connected and no other good copy exists
- **THEN** no empty data folder is created, and the learner is shown the missing folder with Retry, Choose another folder, and Start on the default folder

#### Scenario: A session whose agent cannot resume after a move continues
- **WHEN** after a move the learner continues a session whose agent cannot resume its own session at the node's new folder
- **THEN** the conversation continues, handed to the agent from the application's record, with the break marked in the conversation
