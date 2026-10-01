// Internal surface of the code sandbox, for the practice feature only. Other
// features reach practice through `features/practice/index.ts`.
export { SandboxTool, type SandboxToolProps } from './SandboxTool'
export {
  SANDBOX_TIME_LIMIT_MS,
  SandboxBusyError,
  SandboxUnavailableError,
  createSandboxRunner,
  getSharedSandboxRunner,
  type CreateSandboxRunnerOptions,
  type RunOptions,
  type SandboxRunner,
  type SandboxRunnerState,
  type SandboxStatus,
} from './sandbox-runner'
export type { OutputChunk, OutputStream, RunOutcome, RunResult } from './sandbox-protocol'
export { RESULT_DISPLAY_MAX_CHARS, RESULT_DISPLAY_MAX_LINES } from './result-truncation'
