## ADDED Requirements

### Requirement: Feature-First Directory Structure
The frontend codebase SHALL organize all feature-specific code under `frontend/src/features/` directories named after what the application does (e.g., `graph-navigation`, `node-chat`, `study-launcher`, `settings`, `practice`).

#### Scenario: Developer locates graph code
- **WHEN** a developer opens `frontend/src/features/`
- **THEN** the directory names describe what the app does, and graph visualization code is found under `graph-navigation/` rather than scattered across `components/` and `hooks/`

### Requirement: Feature Module Public Surface
Each feature directory SHALL contain an `index.ts` file that exports the public API of that feature, hiding internal implementation details from other features.

#### Scenario: Feature accesses another feature
- **WHEN** a component in `features/graph-navigation/` needs a component from `features/node-chat/`
- **THEN** it SHALL import via the `node-chat` feature's `index.ts` public surface, not via an internal path

#### Scenario: App shell accesses feature
- **WHEN** `App.tsx` renders the node chat panel
- **THEN** it SHALL import `NodeChatPanel` from the `features/node-chat/` public surface only

### Requirement: Shared Cross-Cutting Code
All code that is not feature-specific SHALL live in `frontend/src/shared/` subdirectories: `shared/components/` for generic UI components, `shared/hooks/` for reusable React hooks, and `shared/lib/` for utility functions.

#### Scenario: Shared component used in feature
- **WHEN** a feature component needs a button
- **THEN** it SHALL use `shared/components/Button` rather than implementing its own button

#### Scenario: Deciding where a hook belongs
- **WHEN** a hook is useful to more than one feature
- **THEN** it SHALL live in `shared/hooks/` rather than being duplicated or imported across feature boundaries

### Requirement: App Shell Isolation
The frontend routing and application entry point SHALL live in `frontend/src/app/` separate from feature code, containing `App.tsx` and route definitions under `app/routes/`.

#### Scenario: App shell relocation
- **WHEN** this change is complete
- **THEN** `App.tsx` lives at `frontend/src/app/App.tsx`, and `frontend/src/main.tsx` imports it from that path

#### Scenario: Route definitions
- **WHEN** a new route is added
- **THEN** it SHALL be defined under `frontend/src/app/routes/` and not inside a feature directory
