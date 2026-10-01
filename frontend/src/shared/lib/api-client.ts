import type { invoke as invokeFn } from '@tauri-apps/api/core'
import { z } from 'zod'

/**
 * Typed error thrown when an IPC response fails to validate against the
 * caller's Zod schema. Distinct from HTTP transport errors so callers can
 * tell "the server replied with something we cannot parse" apart from
 * "the server replied with a non-2xx status".
 */
export class ApiValidationError extends Error {
  override readonly name = 'ApiValidationError'
  constructor(
    message: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message)
  }
}

/**
 * Typed error thrown when an HTTP response is outside the 2xx range.
 * Callers can read `status` to distinguish "not found" from "server down"
 * without having to switch on a generic `Error.message`.
 */
export class ApiHttpError extends Error {
  override readonly name = 'ApiHttpError'
  constructor(
    message: string,
    readonly status: number,
    /**
     * The parsed JSON error body, when the server sent one. FastAPI puts a
     * structured `detail` there (e.g. the staged `{ stage, message }` of a
     * refused agent registration), which a caller needs to show the learner
     * *why* — the status alone only says *that*.
     */
    readonly body: unknown = undefined,
  ) {
    super(message)
  }
}

const API_MODE: 'http' | 'unix' = import.meta.env.VITE_API_MODE ?? 'http'
const UNIX_SOCKET_PATH = import.meta.env.VITE_UNIX_SOCKET_PATH ?? ''

/**
 * Namespace the dev server proxies to the backend.
 *
 * Relative, not an absolute origin: the browser addresses the Vite dev server's
 * own origin, which keeps dev traffic same-origin (no CORS, no preflight) and
 * means a moving backend port is Node configuration rather than browser-enforced
 * policy. Vite strips the prefix in transit, so the backend keeps serving
 * `/health` at `/health`.
 *
 * Applied here and nowhere else — callers pass `/health` and never learn about
 * it.
 */
const HTTP_PATH_PREFIX = '/api'

/**
 * Health endpoint response contract. Kept narrow on purpose — anything
 * more than `status` and `backend` should land in a separate schema.
 *
 * Mirrors backend/api/routes/health.py::Health so the wire format is
 * validated identically on both sides of the IPC boundary.
 */
export const HealthSchema = z.object({
  status: z.literal('ok'),
  backend: z.literal('fastapi'),
})

export type Health = z.infer<typeof HealthSchema>

type RequestOptions<S extends z.ZodTypeAny> = {
  schema: S
}

// Cached so the dynamic import only runs once per session, not per request
// (rule `js-cache-function-results`).
let cachedInvoke: Promise<typeof invokeFn> | null = null
function getInvoke(): Promise<typeof invokeFn> {
  if (!cachedInvoke) {
    cachedInvoke = import('@tauri-apps/api/core').then((m) => m.invoke)
  }
  return cachedInvoke
}

async function request<S extends z.ZodTypeAny>(
  path: string,
  init: RequestInit,
  { schema }: RequestOptions<S>,
): Promise<z.infer<S>> {
  const raw = await dispatch(path, init)
  return parse(raw, schema)
}

async function dispatch(path: string, init: RequestInit): Promise<unknown> {
  if (API_MODE === 'unix') {
    // The Tauri Rust side owns the Unix socket transport (see design.md
    // Decision 5). Phase 4 swaps the placeholder for a real `api_request`
    // command; Phase 1 falls back to HTTP if the command is missing so the
    // suite stays green before the sidecar lands.
    // Deliberately unprefixed: the socket transport reaches the sidecar
    // directly, so the proxy namespace has no meaning in production.
    const invoke = await getInvoke()
    try {
      return await invoke('api_request', { path, init })
    } catch (error) {
      throw hostErrorFrom(error, path)
    }
  }
  const response = await fetch(httpUrl(path), init)
  if (!response.ok) throw await httpErrorFrom(response, path)
  // No Content has no body to parse; `undefined` lets a `z.undefined()` or
  // `z.unknown()` schema accept it rather than failing on empty JSON.
  if (response.status === 204) return undefined
  try {
    return await response.json()
  } catch (error) {
    throw new ApiValidationError(
      `Invalid JSON response from ${path}: ${(error as Error).message}`,
      [],
    )
  }
}

/**
 * Resolves an API path to the URL the browser fetches in HTTP mode.
 *
 * Exported for the one caller that cannot go through `request` — a streamed
 * response (`sse.ts`) must read the body incrementally rather than as JSON —
 * so the proxy prefix is still applied in exactly one place.
 */
export function httpUrl(path: string): string {
  return `${HTTP_PATH_PREFIX}${path}`
}

/** Builds the typed error for a non-2xx response, keeping its JSON body if any. */
/**
 * The Rust host reports a refusal as `backend returned HTTP <status>: <body>`.
 * Rebuilt into the same `ApiHttpError` the HTTP transport throws, so a caller
 * reading `status` or a structured `detail` behaves identically in the
 * desktop build — anything else is a transport failure and passes through.
 */
export function hostErrorFrom(error: unknown, path: string): unknown {
  const message = error instanceof Error ? error.message : String(error)
  const match = /^backend returned HTTP (\d{3}):?\s*([\s\S]*)$/.exec(message)
  if (!match) return error
  let body: unknown = undefined
  try {
    body = JSON.parse(match[2])
  } catch {
    // Not JSON: the status is all there is to report.
  }
  return new ApiHttpError(`HTTP ${match[1]} for ${path}`, Number(match[1]), body)
}

export async function httpErrorFrom(response: Response, path: string): Promise<ApiHttpError> {
  let body: unknown = undefined
  try {
    body = await response.json()
  } catch {
    // Not JSON (or empty): the status is all there is to report.
  }
  return new ApiHttpError(
    `HTTP ${response.status} ${response.statusText} for ${path}`,
    response.status,
    body,
  )
}

function parse<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.infer<S> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new ApiValidationError('Response failed schema validation', result.error.issues)
  }
  return result.data
}

/**
 * A GET whose body is text, not JSON (e.g. `text/markdown`). The HTTP path
 * reads the body as-is; the Unix transport is handed the same request and
 * its result taken as text — a string as returned, anything else serialized.
 */
async function getText(path: string): Promise<string> {
  const init: RequestInit = { method: 'GET' }
  if (API_MODE === 'unix') {
    const invoke = await getInvoke()
    let raw: unknown
    try {
      raw = await invoke('api_request', { path, init })
    } catch (error) {
      throw hostErrorFrom(error, path)
    }
    return typeof raw === 'string' ? raw : JSON.stringify(raw)
  }
  const response = await fetch(httpUrl(path), init)
  if (!response.ok) throw await httpErrorFrom(response, path)
  return response.text()
}

const apiClient = {
  getText,
  get<S extends z.ZodTypeAny>(path: string, options: RequestOptions<S>): Promise<z.infer<S>> {
    return request(path, { method: 'GET' }, options)
  },
  post<S extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    options: RequestOptions<S>,
  ): Promise<z.infer<S>> {
    return request(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      options,
    )
  },
  put<S extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    options: RequestOptions<S>,
  ): Promise<z.infer<S>> {
    return request(
      path,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      options,
    )
  },
  delete<S extends z.ZodTypeAny>(path: string, options: RequestOptions<S>): Promise<z.infer<S>> {
    return request(path, { method: 'DELETE' }, options)
  },
}

export { API_MODE, UNIX_SOCKET_PATH }
export default apiClient
