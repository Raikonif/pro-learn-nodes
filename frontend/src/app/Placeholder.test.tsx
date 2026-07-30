import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import Placeholder from './Placeholder'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Placeholder', () => {
  it('renders the app title and subtitle', () => {
    // Stub fetch to a never-settling promise so Placeholder stays in its
    // initial 'offline' state — the suite must not depend on a backend.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    render(<Placeholder />)
    expect(screen.getByRole('heading', { name: 'Learn Nodes' })).toBeInTheDocument()
    expect(screen.getByText('Phase 1 — Project Skeleton')).toBeInTheDocument()
  })

  it('shows "Backend online" when /health responds ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ status: 'ok', backend: 'fastapi' }))),
    )
    render(<Placeholder />)
    expect(await screen.findByText('Backend online')).toBeInTheDocument()
  })

  it('shows "Backend offline" when /health responds non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ detail: 'oops' }, false))),
    )
    render(<Placeholder />)
    expect(await screen.findByText('Backend offline')).toBeInTheDocument()
  })

  it('shows "Backend offline" when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    render(<Placeholder />)
    expect(await screen.findByText('Backend offline')).toBeInTheDocument()
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
    render(<Placeholder />)
    expect(await screen.findByText('Backend offline')).toBeInTheDocument()
  })
})