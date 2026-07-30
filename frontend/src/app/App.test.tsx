import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import App from './App'

describe('App', () => {
  it('renders the placeholder surface', () => {
    // Stub fetch to a never-settling promise so Placeholder stays in its
    // initial 'checking' state — the suite must not depend on a backend.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Learn Nodes' })).toBeInTheDocument()
  })
})
