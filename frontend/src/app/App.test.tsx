import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByText('Learn Nodes')).toBeInTheDocument()
  })

  it('shows backend status checking', () => {
    render(<App />)
    expect(screen.getByText(/checking\.\.\./)).toBeInTheDocument()
  })
})
