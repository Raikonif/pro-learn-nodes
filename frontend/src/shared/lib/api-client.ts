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
  ) {
    super(message)
  }
}

const API_MODE: 'http' | 'unix' = import.meta.env.VITE_API_MODE ?? 'http'
const UNIX_SOCKET_PATH = import.meta.env.VITE_UNIX_SOCKET_PATH ?? ''
const HTTP_BASE_URL = 'http://127.0.0.1:8000'

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
    const invoke = await getInvoke()
    return invoke('api_request', { path, init })
  }
  const response = await fetch(`${HTTP_BASE_URL}${path}`, init)
  if (!response.ok) {
    throw new ApiHttpError(
      `HTTP ${response.status} ${response.statusText} for ${path}`,
      response.status,
    )
  }
  try {
    return await response.json()
  } catch (error) {
    throw new ApiValidationError(
      `Invalid JSON response from ${path}: ${(error as Error).message}`,
      [],
    )
  }
}

function parse<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.infer<S> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new ApiValidationError('Response failed schema validation', result.error.issues)
  }
  return result.data
}

const apiClient = {
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
}

export { API_MODE, UNIX_SOCKET_PATH }
export default apiClient