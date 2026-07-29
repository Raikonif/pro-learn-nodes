import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

// A fetch that never settles, so App stays in its initial 'checking' state.
// Unit tests must never touch the network: a real request makes the suite
// depend on a running backend and leaks past teardown.
const pendingFetch = () => new Promise(() => {})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('renders the app title', () => {
    vi.stubGlobal('fetch', vi.fn(pendingFetch))
    render(<App />)
    expect(screen.getByText('Learn Nodes')).toBeInTheDocument()
  })

  it('shows "checking..." until the health request settles', () => {
    vi.stubGlobal('fetch', vi.fn(pendingFetch))
    render(<App />)
    expect(screen.getByText('checking...')).toBeInTheDocument()
  })

  it('reports the backend as connected when /health responds ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect(await screen.findByText('connected')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/health')
  })

  it('reports the backend as unavailable when /health responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<App />)
    expect(await screen.findByText('unavailable')).toBeInTheDocument()
  })

  it('reports the backend as unavailable when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    render(<App />)
    expect(await screen.findByText('unavailable')).toBeInTheDocument()
  })
})
