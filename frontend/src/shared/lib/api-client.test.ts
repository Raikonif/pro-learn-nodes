import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import apiClient, { ApiHttpError, ApiValidationError, HealthSchema } from './api-client'

// The Unix transport reaches Tauri's Rust side, which does not exist under
// jsdom. Mocking the module lets us assert the path it is handed.
const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
  invoke.mockReset()
})

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiClient', () => {
  it('returns parsed data when the response matches the schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ status: 'ok', backend: 'fastapi' }))),
    )
    const data = await apiClient.get('/health', { schema: HealthSchema })
    expect(data).toEqual({ status: 'ok', backend: 'fastapi' })
  })

  it('rejects with ApiValidationError when the body is malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('not json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
    await expect(
      apiClient.get('/health', { schema: HealthSchema }),
    ).rejects.toBeInstanceOf(ApiValidationError)
  })

  it('rejects with ApiValidationError when fields are wrong types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ status: 'no', backend: 'fastapi' }))),
    )
    await expect(
      apiClient.get('/health', { schema: HealthSchema }),
    ).rejects.toBeInstanceOf(ApiValidationError)
  })

  it('rejects with ApiHttpError (not ApiValidationError) for non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ detail: 'oops' }, false))),
    )
    const error = await apiClient
      .get('/health', { schema: HealthSchema })
      .catch((e) => e)
    expect(error).toBeInstanceOf(ApiHttpError)
    expect(error).not.toBeInstanceOf(ApiValidationError)
    expect((error as ApiHttpError).status).toBe(500)
  })

  it('forwards custom schemas without leaking internal types', async () => {
    const schema = z.object({ value: z.literal(42) })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ value: 42 }))),
    )
    const data = await apiClient.get('/echo', { schema })
    expect(data).toEqual({ value: 42 })
  })

  it('requests the relative /api path so dev traffic stays same-origin', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ status: 'ok', backend: 'fastapi' })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.get('/health', { schema: HealthSchema })

    // Relative, not an absolute backend origin — the browser must address the
    // dev server, which proxies and strips the prefix.
    expect(fetchMock).toHaveBeenCalledWith('/api/health', { method: 'GET' })
  })

  it('prefixes POST paths the same way', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ status: 'ok', backend: 'fastapi' })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.post('/health', { ping: true }, { schema: HealthSchema })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('leaves the Unix-socket transport unprefixed', async () => {
    vi.stubEnv('VITE_API_MODE', 'unix')
    invoke.mockResolvedValue({ status: 'ok', backend: 'fastapi' })
    // Re-import so the module re-reads API_MODE, which is captured at load.
    vi.resetModules()
    const { default: unixClient } = await import('./api-client')

    const data = await unixClient.get('/health', { schema: HealthSchema })

    expect(data).toEqual({ status: 'ok', backend: 'fastapi' })
    // The proxy namespace is a dev-only routing device; production talks to the
    // sidecar directly and must not see it.
    expect(invoke).toHaveBeenCalledWith('api_request', {
      path: '/health',
      init: { method: 'GET' },
    })
  })
  it('keeps the JSON error body so a structured detail reaches the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: { stage: 'launch', message: 'not found' } }), {
            status: 422,
          }),
        ),
      ),
    )

    const error = await apiClient.post('/agents', {}, { schema: z.unknown() }).catch((e) => e)

    expect(error).toBeInstanceOf(ApiHttpError)
    expect((error as ApiHttpError).status).toBe(422)
    expect((error as ApiHttpError).body).toEqual({
      detail: { stage: 'launch', message: 'not found' },
    })
  })

  it('resolves a 204 as undefined rather than failing to parse an empty body', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.delete('/agents/a-1', { schema: z.undefined() })).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/a-1', { method: 'DELETE' })
  })
})
describe('apiClient.getText', () => {
  it('reads a non-JSON body as text through the same /api prefix', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response('# Memory\n', { status: 200, headers: { 'Content-Type': 'text/markdown' } })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.getText('/memory/export')).resolves.toBe('# Memory\n')
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/export', { method: 'GET' })
  })

  it('rejects with ApiHttpError for non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))))

    await expect(apiClient.getText('/memory/export')).rejects.toBeInstanceOf(ApiHttpError)
  })

  it('takes the text the host returns over the Unix transport', async () => {
    vi.stubEnv('VITE_API_MODE', 'unix')
    invoke.mockResolvedValue('# Memory\n')
    vi.resetModules()
    const { default: unixClient } = await import('./api-client')

    await expect(unixClient.getText('/memory/export')).resolves.toBe('# Memory\n')
    expect(invoke).toHaveBeenCalledWith('api_request', { path: '/memory/export', init: { method: 'GET' } })
  })
})

describe('hostErrorFrom', () => {
  it('rebuilds a host refusal into the HTTP error the web transport throws', async () => {
    const { hostErrorFrom, ApiHttpError } = await import('./api-client')
    const error = hostErrorFrom(
      'backend returned HTTP 422: {"detail":{"stage":"launch","message":"not found"}}',
      '/agents',
    )
    expect(error).toBeInstanceOf(ApiHttpError)
    expect((error as InstanceType<typeof ApiHttpError>).status).toBe(422)
    expect((error as InstanceType<typeof ApiHttpError>).body).toEqual({
      detail: { stage: 'launch', message: 'not found' },
    })
  })

  it('passes a transport failure through untouched', async () => {
    const { hostErrorFrom } = await import('./api-client')
    expect(hostErrorFrom('unix connect to /x: refused', '/agents')).toBe('unix connect to /x: refused')
  })
})
