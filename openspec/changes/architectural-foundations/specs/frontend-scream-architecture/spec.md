## ADDED Requirements

### Requirement: Feature-First Directory Structure
The frontend codebase SHALL organize all feature-specific code under `frontend/src/features/` directories named after what the application does (e.g., `graph-navigation`, `node-chat`, `study-launcher`, `settings`, `practice`).

### Requirement: Feature Module Public Surface
Each feature directory SHALL contain an `index.ts` file that exports the public API of that feature, hiding internal implementation details from other features.

### Requirement: Shared Cross-Cutting Code
All code that is not feature-specific SHALL live in `frontend/src/shared/` subdirectories: `shared/components/` for generic UI components, `shared/hooks/` for reusable React hooks, and `shared/lib/` for utility functions.

### Requirement: App Shell Isolation
The frontend routing and application entry point SHALL live in `frontend/src/app/` separate from feature code, containing `App.tsx` and route definitions.

#### Scenario: Feature accesses another feature
- **WHEN** a component in `features/graph-navigation/` needs to use a component from `features/node-chat/`
- **THEN** it SHALL import via the `node-chat` feature's `index.ts` public surface, not via internal paths

#### Scenario: App shell accesses feature
- **WHEN** `App.tsx` renders the node chat panel
- **THEN** it SHALL import `NodeChatPanel` from `features/node-chat/` public surface only

#### Scenario: Shared component used in feature
- **WHEN** a feature component needs a button
- **THEN** it SHALL use `shared/components/Button` not implement its own button
