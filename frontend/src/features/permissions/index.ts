// Public surface for the permissions feature.
// Import this feature only via this file; internal paths are private.
export { default as PermissionIndicator, PENDING_POLL_MS } from './components/PermissionIndicator'
export { default as PermissionRequestCard } from './components/PermissionRequestCard'
export type { PermissionRequestView } from './components/PermissionRequestCard'
export { default as RememberedPermissions } from './components/RememberedPermissions'
export { usePermissionsStore } from './permissions-store'
export type { PermissionsState } from './permissions-store'
export { kindPhrase, rememberLabel } from './permissions-api'
export type { PendingPermission, RememberedPermission } from './permissions-api'
