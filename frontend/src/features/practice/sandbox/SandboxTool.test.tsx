import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { createFakeWorkerFactory, type FakeSandboxWorker } from './fake-sandbox-worker'
import { RESULT_DISPLAY_MAX_CHARS, RESULT_DISPLAY_MAX_LINES } from './result-truncation'
import { createSandboxRunner, type SandboxRunner } from './sandbox-runner'
import { SandboxTool } from './SandboxTool'

const INDEX_URL = 'http://127.0.0.1:5177/pyodide/'

function setupRunner(options: { timeoutMs?: number } = {}) {
  const factory = createFakeWorkerFactory()
  const runner = createSandboxRunner({ createWorker: factory.createWorker, indexURL: INDEX_URL, ...options })
  return { factory, runner }
}

/** Let the runner's promises and React's updates settle. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
  })
}

async function renderReady(props: Partial<Parameters<typeof SandboxTool>[0]> = {}) {
  const harness = setupRunner()
  const onCodeChange = vi.fn()
  const view = render(
    <SandboxTool
      nodeId="node-1"
      code={'print("hi")'}
      onCodeChange={onCodeChange}
      runner={harness.runner}
      {...props}
    />,
  )
  await act(async () => harness.factory.current.ready())
  await settle()
  return { ...harness, onCodeChange, view }
}

async function clickRun() {
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
  await settle()
}

async function answer(worker: FakeSandboxWorker, fn: (worker: FakeSandboxWorker) => void) {
  await act(async () => fn(worker))
  await settle()
}

function resultRegion() {
  return screen.getByRole('region', { name: 'Run result' })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SandboxTool — buffer, run control, result (9.1)', () => {
  it('renders the persisted buffer, a run control, and an empty result region', async () => {
    await renderReady()

    expect(screen.getByRole('textbox', { name: 'Python code' })).toHaveValue('print("hi")')
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
    expect(resultRegion()).toHaveTextContent('Run the code to see its output here.')
  })

  it('hands every edit to the store without a save action', async () => {
    const { onCodeChange } = await renderReady()

    fireEvent.change(screen.getByRole('textbox', { name: 'Python code' }), {
      target: { value: 'print(2)' },
    })

    expect(onCodeChange).toHaveBeenCalledWith('print(2)')
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('runs the current buffer and shows its output in order', async () => {
    const { factory } = await renderReady({ code: 'print("a")' })

    await clickRun()
    const worker = factory.current
    expect(worker.runs[0].code).toBe('print("a")')
    await answer(worker, (w) => {
      w.output({ stream: 'stdout', text: 'a\n' }, { stream: 'stderr', text: 'careful\n' })
      w.output({ stream: 'stdout', text: 'b\n' })
      w.done()
    })

    const region = resultRegion()
    expect(region).toHaveTextContent(/a\s*careful\s*b/)
    expect(within(region).getByText('careful', { exact: false })).toHaveAttribute('data-stream', 'stderr')
    expect(region).toHaveTextContent('Completed.')
  })

  it('reports a silent success as completed with no output, not as an error', async () => {
    const { factory } = await renderReady()

    await clickRun()
    await answer(factory.current, (w) => w.done())

    expect(resultRegion()).toHaveTextContent('Completed with no output.')
    expect(within(resultRegion()).queryByRole('alert')).toBeNull()
  })

  it('shows an uncaught error as an error, with type, message, line and prior output', async () => {
    const { factory } = await renderReady()

    await clickRun()
    await answer(factory.current, (w) => {
      w.output({ stream: 'stdout', text: 'before\n' })
      w.done({ type: 'ZeroDivisionError', message: 'division by zero', line: 3 })
    })

    expect(resultRegion()).toHaveTextContent('before')
    const error = within(resultRegion()).getByRole('alert')
    expect(error).toHaveTextContent('ZeroDivisionError')
    expect(error).toHaveTextContent('division by zero')
    expect(error).toHaveTextContent('line 3')
  })

  it('shows live output while running and turns Run into Stop', async () => {
    const { factory } = await renderReady()

    await clickRun()
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Running…')
    await answer(factory.current, (w) => w.output({ stream: 'stdout', text: 'tick\n' }))

    expect(resultRegion()).toHaveTextContent('tick')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })

  it('stops a run, keeps its output, says the learner stopped it, and can run again', async () => {
    const { factory } = await renderReady()
    await clickRun()
    const worker = factory.current
    await answer(worker, (w) => w.output({ stream: 'stdout', text: 'tick\n' }))

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await settle()

    expect(worker.terminated).toBe(true)
    expect(resultRegion()).toHaveTextContent('tick')
    expect(resultRegion()).toHaveTextContent('Stopped by you.')
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Python code' })).not.toHaveAttribute('readonly')
  })

  it('names the limit when a run times out, and runs normally afterwards', async () => {
    vi.useFakeTimers()
    const factory = createFakeWorkerFactory()
    const runner = createSandboxRunner({ createWorker: factory.createWorker, indexURL: INDEX_URL })
    render(<SandboxTool nodeId="n" code="while True: pass" onCodeChange={() => {}} runner={runner} />)
    await act(async () => factory.current.ready())
    await act(async () => vi.advanceTimersByTimeAsync(0))

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await act(async () => vi.advanceTimersByTimeAsync(10_000))

    expect(resultRegion()).toHaveTextContent('Timed out after 10 s')

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await act(async () => factory.current.ready())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => factory.current.done())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(resultRegion()).toHaveTextContent('Completed with no output.')
  })

  it('clears the result when another node is shown', async () => {
    const { factory, runner, onCodeChange, view } = await renderReady()
    await clickRun()
    await answer(factory.current, (w) => {
      w.output({ stream: 'stdout', text: 'from node one\n' })
      w.done()
    })
    expect(resultRegion()).toHaveTextContent('from node one')

    view.rerender(<SandboxTool nodeId="node-2" code="" onCodeChange={onCodeChange} runner={runner} />)

    expect(resultRegion()).not.toHaveTextContent('from node one')
    expect(resultRegion()).toHaveTextContent('Run the code to see its output here.')
  })

  it('ends its run when the node changes, so the next node can run immediately', async () => {
    const { factory, runner, onCodeChange, view } = await renderReady()
    await clickRun()
    const worker = factory.current

    view.rerender(<SandboxTool nodeId="node-2" code="" onCodeChange={onCodeChange} runner={runner} />)
    await settle()

    expect(worker.terminated).toBe(true)
    expect(runner.isRunInProgress()).toBe(false)
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
  })

  it('ends its run when unmounted', async () => {
    const { factory, runner, view } = await renderReady()
    await clickRun()

    view.unmount()

    expect(factory.workers[0].terminated).toBe(true)
    expect(runner.isRunInProgress()).toBe(false)
  })
})

describe('SandboxTool — the workspace stays interactive while a run is in progress (9.2)', () => {
  function Workspace({ runner }: { runner: SandboxRunner }) {
    const [message, setMessage] = useState('')
    const [clicks, setClicks] = useState(0)
    return (
      <div>
        <label>
          Message
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <button type="button" onClick={() => setClicks((c) => c + 1)}>
          Minimap node ({clicks})
        </button>
        <button type="button">Left rail</button>
        <button type="button">Quiz</button>
        <SandboxTool nodeId="n" code="while True: pass" onCodeChange={() => {}} runner={runner} />
      </div>
    )
  }

  it('takes no global lock: controls outside the sandbox keep working during a run', async () => {
    const { factory, runner } = setupRunner()
    render(<Workspace runner={runner} />)
    await act(async () => factory.current.ready())
    await settle()

    await clickRun()
    expect(runner.isRunInProgress()).toBe(true)

    // Nothing outside the tool is disabled, made inert, or marked busy…
    for (const name of [/Minimap node/, 'Left rail', 'Quiz']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
    expect(document.querySelector('[inert], [aria-busy="true"]')).toBeNull()
    // …and they still respond.
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /Minimap node/ }))
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello')
    expect(screen.getByRole('button', { name: 'Minimap node (1)' })).toBeInTheDocument()
    // The run itself is untouched by that activity.
    expect(runner.isRunInProgress()).toBe(true)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })
})

describe('SandboxTool — preparing is distinct from unavailable (9.3)', () => {
  it('shows that Python is preparing, and nothing about it being unavailable', () => {
    const { runner } = setupRunner()
    render(<SandboxTool nodeId="n" code="" onCodeChange={() => {}} runner={runner} />)

    expect(screen.getByRole('status')).toHaveTextContent('Preparing Python…')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('starts preparing the runtime only once the tool is shown', () => {
    const { factory, runner } = setupRunner()
    expect(factory.workers).toHaveLength(0)

    render(<SandboxTool nodeId="n" code="" onCodeChange={() => {}} runner={runner} />)

    expect(factory.workers).toHaveLength(1)
  })

  it('names what is unavailable, offers no run control, and retries', async () => {
    const { factory, runner } = setupRunner()
    render(<SandboxTool nodeId="n" code="print(1)" onCodeChange={() => {}} runner={runner} />)

    await act(async () => factory.current.unavailable('WebAssembly is not supported'))
    await settle()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Python code cannot be run here.')
    expect(alert).toHaveTextContent('WebAssembly is not supported')
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    expect(screen.queryByText('Preparing Python…')).toBeNull()
    // The buffer is still the learner's: it stays editable.
    expect(screen.getByRole('textbox', { name: 'Python code' })).toHaveValue('print(1)')

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await settle()
    expect(screen.getByRole('status')).toHaveTextContent('Preparing Python…')
    await act(async () => factory.current.ready())
    await settle()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
  })
})

describe('SandboxTool — oversized results (9.7)', () => {
  it('truncates output past the line limit and says so', async () => {
    const { factory } = await renderReady()
    const lines = Array.from({ length: RESULT_DISPLAY_MAX_LINES + 500 }, (_, i) => `line ${i}\n`).join('')

    await clickRun()
    await answer(factory.current, (w) => {
      w.output({ stream: 'stdout', text: lines })
      w.done()
    })

    const region = resultRegion()
    expect(region).toHaveTextContent(`line ${RESULT_DISPLAY_MAX_LINES - 1}`)
    expect(region).not.toHaveTextContent(`line ${RESULT_DISPLAY_MAX_LINES + 1}`)
    expect(region).toHaveTextContent(/Output truncated/)
    expect(region).toHaveTextContent('Completed.')
  })

  it('truncates output past the character limit and says so', async () => {
    const { factory } = await renderReady()

    await clickRun()
    await answer(factory.current, (w) => {
      w.output({ stream: 'stdout', text: 'x'.repeat(RESULT_DISPLAY_MAX_CHARS + 10_000) })
      w.done()
    })

    const pre = within(resultRegion()).getByTestId('sandbox-output')
    expect(pre.textContent?.length).toBeLessThanOrEqual(RESULT_DISPLAY_MAX_CHARS)
    expect(resultRegion()).toHaveTextContent(/Output truncated/)
  })

  it('says so when the program wrote more than the worker forwards', async () => {
    const { factory } = await renderReady()

    await clickRun()
    await answer(factory.current, (w) => {
      w.output({ stream: 'stdout', text: 'x\n' })
      w.respond({ type: 'output-truncated', runId: w.lastRunId })
      w.done()
    })

    expect(resultRegion()).toHaveTextContent(/Output truncated/)
  })

  it('does not claim truncation for ordinary output', async () => {
    const { factory } = await renderReady()

    await clickRun()
    await answer(factory.current, (w) => {
      w.output({ stream: 'stdout', text: 'short\n' })
      w.done()
    })

    expect(resultRegion()).not.toHaveTextContent(/truncated/i)
  })
})

describe('SandboxTool — submitting a solution (code exercises)', () => {
  it('offers no Submit control unless the caller takes submissions', async () => {
    await renderReady()

    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
  })

  it('runs the buffer on Submit and hands over the code with the finished run', async () => {
    const onSubmit = vi.fn()
    const { factory } = await renderReady({ code: 'print(55)', onSubmit })

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await settle()
    expect(onSubmit).not.toHaveBeenCalled()
    await answer(factory.current, (w) => {
      w.output({ stream: 'stdout', text: '55\n' })
      w.done()
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      code: 'print(55)',
      result: expect.objectContaining({
        outcome: { kind: 'completed' },
        output: [{ stream: 'stdout', text: '55\n' }],
      }),
    })
    // The run is shown as any run is.
    expect(resultRegion()).toHaveTextContent('55')
  })

  it('an ordinary Run is never submitted', async () => {
    const onSubmit = vi.fn()
    const { factory } = await renderReady({ onSubmit })

    await clickRun()
    await answer(factory.current, (w) => w.done())

    expect(onSubmit).not.toHaveBeenCalled()
  })
})
