import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import CodeView from './CodeView'

const PYTHON = 'class Greeter:\n    def greet(self):\n        return "hola"  # hi\n'

describe('CodeView', () => {
  it('numbers every line and colours tokens by kind', () => {
    const { container } = render(<CodeView code={PYTHON} language="python" label="greeter.py" />)

    const view = screen.getByRole('figure', { name: 'greeter.py' })
    expect(view.querySelectorAll('[data-line]')).toHaveLength(4)
    expect(container.querySelector('.tok-keyword')?.textContent).toBe('class')
    expect(container.querySelector('.tok-className')?.textContent).toBe('Greeter')
    expect(container.querySelector('.tok-function')?.textContent).toBe('greet')
    expect(container.querySelector('.tok-string')?.textContent).toBe('"hola"')
    expect(container.querySelector('.tok-comment')?.textContent).toBe('# hi')
    expect(within(view).getByText('Python')).toBeInTheDocument()
  })

  it('is read-only: nothing is editable and typing changes nothing', () => {
    const { container } = render(<CodeView code={PYTHON} language="python" label="greeter.py" />)

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    fireEvent.keyDown(screen.getByRole('figure'), { key: 'x' })
    expect(screen.getByRole('figure').textContent).toContain('return "hola"')
  })

  it('says it ran syntax checks and found nothing in valid code', () => {
    render(<CodeView code={PYTHON} language="python" label="greeter.py" />)

    expect(screen.getByText('Syntax checks only.')).toBeInTheDocument()
    expect(screen.getByText('No syntax problems found.')).toBeInTheDocument()
    expect(screen.queryByTestId('diagnostic-marker')).toBeNull()
  })

  it('marks a syntax error in the code, beside its line, and in the list', () => {
    const { container } = render(<CodeView code={'x = 1\nprint((x\n'} language="python" label="broken.py" />)

    const problems = screen.getByRole('list', { name: 'Syntax problems' })
    expect(problems.textContent).toMatch(/Line \d+, column \d+: Syntax error/)
    expect(screen.getAllByTestId('diagnostic-marker').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-diagnostic="true"]')).not.toBeNull()
    expect(screen.queryByText('No syntax problems found.')).toBeNull()
  })

  it('shows an unrecognised language uncoloured, numbered, and says so', () => {
    const { container } = render(<CodeView code={'fn main() {}\n'} language={null} label="main.rs" />)

    expect(screen.getByTestId('language-not-recognised')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-line]')).toHaveLength(2)
    expect(container.querySelector('[class*="tok-"] span[class*="tok-"]')).toBeNull()
    expect(screen.queryByTestId('diagnostics')).toBeNull()
  })

  it('drops the notes in compact mode', () => {
    render(<CodeView code="print(1)" language="python" label="preview" compact />)

    expect(screen.queryByText('Syntax checks only.')).toBeNull()
    expect(screen.getByRole('figure', { name: 'preview' })).toBeInTheDocument()
  })
})
