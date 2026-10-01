import { describe, expect, it } from 'vitest'

import { RUN_OUTPUT_MAX_CHARS, submissionFrom } from './submission'

describe('submissionFrom', () => {
  it('joins stdout and stderr in the order they were written', () => {
    expect(
      submissionFrom('code', {
        output: [
          { stream: 'stdout', text: 'a\n' },
          { stream: 'stderr', text: 'warn\n' },
          { stream: 'stdout', text: 'b\n' },
        ],
        outcome: { kind: 'completed' },
        outputTruncated: false,
      }),
    ).toEqual({ code: 'code', runOutcome: 'completed', runOutput: 'a\nwarn\nb\n' })
  })

  it("adds an uncaught error's type and message after the output", () => {
    expect(
      submissionFrom('1/0', {
        output: [{ stream: 'stdout', text: 'before' }],
        outcome: { kind: 'error', type: 'ZeroDivisionError', message: 'division by zero', line: 1 },
        outputTruncated: false,
      }),
    ).toEqual({ code: '1/0', runOutcome: 'error', runOutput: 'before\nZeroDivisionError: division by zero\n' })
  })

  it('names a timed-out or stopped run by its outcome', () => {
    const result = submissionFrom('x', {
      output: [],
      outcome: { kind: 'timed_out', limitMs: 10_000 },
      outputTruncated: false,
    })
    expect(result).toEqual({ code: 'x', runOutcome: 'timed_out', runOutput: '' })
  })

  it('cuts the recorded output to the bound', () => {
    const result = submissionFrom('x', {
      output: [{ stream: 'stdout', text: 'y'.repeat(RUN_OUTPUT_MAX_CHARS + 50) }],
      outcome: { kind: 'completed' },
      outputTruncated: false,
    })
    expect(result.runOutput).toHaveLength(RUN_OUTPUT_MAX_CHARS)
  })
})
