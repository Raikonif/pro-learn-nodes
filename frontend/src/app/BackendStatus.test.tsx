import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import BackendStatus from './BackendStatus'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('BackendStatus', () => {
  it('shows "Backend online" when /health responds ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ status: 'ok', backend: 'fastapi' }))),
    )
    render(<BackendStatus />)
    expect(await screen.findByText('Backend online')).toBeInTheDocument()
  })

  it('renders a green dot in the online state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ status: 'ok', backend: 'fastapi' }))),
    )
    const { container } = render(<BackendStatus />)
    await screen.findByText('Backend online')
    expect(container.querySelector('#backend-status')?.className).toContain('bg-green-500')
  })

  it('shows "Backend offline" when /health responds non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ detail: 'oops' }, false))),
    )
    render(<BackendStatus />)
    expect(await screen.findByText('Backend offline')).toBeInTheDocument()
  })

  it('renders a red dot in the offline state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    const { container } = render(<BackendStatus />)
    await screen.findByText('Backend offline')
    expect(container.querySelector('#backend-status')?.className).toContain('bg-red-500')
  })

  it('shows "Backend offline" when /health returns malformed JSON', async () => {
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
    render(<BackendStatus />)
    expect(await screen.findByText('Backend offline')).toBeInTheDocument()
  })

  it('does not poll — /health is called exactly once', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(jsonResponse({ status: 'ok', backend: 'fastapi' })),
    )
    vi.stubGlobal('fetch', fetchSpy)
    render(<BackendStatus />)
    await screen.findByText('Backend online')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
