// Public surface for the account feature.
// Import this feature only via this file; internal paths are private.
export { default as AccountAffordance } from './components/AccountAffordance'
export { default as SignInSurface } from './components/SignInSurface'
export { selectIsSignedIn, useAccountStore } from './account-store'
export type { AccountState, Profile, SessionStatus } from './account-store'
export type { Session } from './account-api'
