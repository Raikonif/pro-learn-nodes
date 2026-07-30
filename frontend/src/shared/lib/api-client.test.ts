import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import apiClient, { ApiHttpError, ApiValidationError, HealthSchema } from './api-client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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
})