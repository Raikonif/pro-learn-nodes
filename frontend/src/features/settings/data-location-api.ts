/**
 * Where the application's data is kept, and moving it (change
 * `code-viewer-and-data-location`). The desktop shell owns all of it — it
 * stops and restarts the backend around a move — so this talks to Tauri
 * commands, never to the backend. In the browser build there is no shell,
 * and the setting says so.
 */

export type DataStatus =
  | { status: 'ok' }
  | { status: 'missing' | 'damaged' | 'unreachable'; detail: string }

export type StartOutcome =
  | { outcome: 'ready'; path: string; notices: string[] }
  | { outcome: 'failed'; path: string; problem: DataStatus; notices: string[] }

export type DataContents = {
  databaseBytes: number
  backups: number
  backupBytes: number
  nodeFolders: number
  totalBytes: number
}

export type DataLocationInfo = {
  available: boolean
  unavailableReason: string | null
  path: string | null
  isDefault: boolean
  contents: DataContents | null
  startup: StartOutcome | null
  /** What a completed move could not remove from the previous folder. */
  leftovers: string[]
  previous: string | null
  moving: boolean
}

export type TargetCheck = { ok: boolean; reason: string | null; warnings: string[]; neededBytes: number }

export type MoveOutcome =
  | { outcome: 'completed'; path: string; leftovers: string[] }
  | { outcome: 'abandoned'; reason: string }

export type MoveProgress = { copiedBytes: number; totalBytes: number }

export type RecoveryAction = 'retry' | 'folder' | 'default'

/** The desktop build talks to its backend through the shell; only there can data move. */
export function dataLocationAvailableHere(): boolean {
  return import.meta.env.VITE_API_MODE === 'unix'
}

const BROWSER_REASON =
  'This is a development build: its backend is started on its own (pnpm all:dev or pnpm backend:dev), so the app cannot stop it to move its data. Open the installed app — built with pnpm tauri build — to change where your data is kept.'

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

export async function getDataLocation(): Promise<DataLocationInfo> {
  if (!dataLocationAvailableHere()) {
    return {
      available: false,
      unavailableReason: BROWSER_REASON,
      path: null,
      isDefault: true,
      contents: null,
      startup: null,
      leftovers: [],
      previous: null,
      moving: false,
    }
  }
  return invoke<DataLocationInfo>('data_location_info')
}

/** A folder picked in the system dialog, or null when the learner cancelled. */
export async function chooseFolder(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, multiple: false, title })
  return typeof picked === 'string' ? picked : null
}

export function checkTarget(target: string): Promise<TargetCheck> {
  return invoke<TargetCheck>('data_location_check', { target })
}

/** Move the data, reporting progress until the move ends. */
export async function moveData(target: string, onProgress: (progress: MoveProgress) => void): Promise<MoveOutcome> {
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<MoveProgress>('data-location-progress', (event) => onProgress(event.payload))
  try {
    return await invoke<MoveOutcome>('data_location_move', { target })
  } finally {
    unlisten()
  }
}

export function retryRemoval(): Promise<string[]> {
  return invoke<string[]>('data_location_retry_removal')
}

export function revealFolder(path: string): Promise<void> {
  return invoke<void>('data_location_reveal', { path })
}

export function dismissStartupNotices(): Promise<void> {
  return invoke<void>('data_location_dismiss')
}

export function recoverStartup(action: RecoveryAction, folder?: string): Promise<StartOutcome> {
  return invoke<StartOutcome>('data_startup_recover', { action, folder: folder ?? null })
}

export function describeProblem(problem: DataStatus): string {
  switch (problem.status) {
    case 'ok':
      return 'The data is usable.'
    case 'missing':
      return `The data folder is missing. ${problem.detail}`.trim()
    case 'damaged':
      return `The data could not be read. ${problem.detail}`.trim()
    case 'unreachable':
      return `Learn Nodes could not start its backend. ${problem.detail}`.trim()
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
