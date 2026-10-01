import assert from 'node:assert/strict'
import net from 'node:net'
import path from 'node:path'
import test from 'node:test'

import {
  BACKEND_PORT_ENV,
  DEFAULT_BACKEND_PORT,
  DEFAULT_FRONTEND_PORT,
  DEV_HOST,
  FRONTEND_PORT_ENV,
  describePorts,
  findFreePort,
  isPortFree,
  waitForHealthy,
  resolvePorts,
} from './dev-ports.mjs'

/** Hold a real socket so the allocator sees a genuinely occupied port. */
function occupy(port, host = DEV_HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen({ port, host, exclusive: true }, () =>
      resolve(() => new Promise((done) => server.close(done))),
    )
  })
}

/** A port we can safely squat on, well away from the real defaults. */
async function sparePort() {
  return findFreePort(45000, { limit: 500 })
}

test('isPortFree reports an occupied port as unavailable', async () => {
  const port = await sparePort()
  assert.equal(await isPortFree(port), true)

  const release = await occupy(port)
  try {
    assert.equal(await isPortFree(port), false)
  } finally {
    await release()
  }
})

test('findFreePort returns the preferred port when it is free', async () => {
  const port = await sparePort()
  assert.equal(await findFreePort(port, { limit: 5 }), port)
})

test('findFreePort moves to the next port when the preferred one is taken', async () => {
  const port = await sparePort()
  const release = await occupy(port)
  try {
    const chosen = await findFreePort(port, { limit: 5 })
    assert.ok(chosen > port, `expected a port above ${port}, got ${chosen}`)
    assert.equal(await isPortFree(chosen), true)
  } finally {
    await release()
  }
})

test('findFreePort skips consecutive occupied ports', async () => {
  const first = await sparePort()
  const releases = [await occupy(first), await occupy(first + 1)]
  try {
    assert.equal(await findFreePort(first, { limit: 10 }), first + 2)
  } finally {
    for (const release of releases) await release()
  }
})

test('findFreePort honours the exclude list', async () => {
  const port = await sparePort()
  // Free, but claimed by the other consumer — the allocator must not hand the
  // same port to both.
  assert.equal(await findFreePort(port, { limit: 5, exclude: [port] }), port + 1)
})

test('findFreePort throws naming the range when it is exhausted', async () => {
  const first = await sparePort()
  const releases = [
    await occupy(first),
    await occupy(first + 1),
    await occupy(first + 2),
  ]
  try {
    await assert.rejects(
      () => findFreePort(first, { limit: 3 }),
      (error) => {
        assert.match(error.message, new RegExp(`${first}-${first + 2}`))
        return true
      },
    )
  } finally {
    for (const release of releases) await release()
  }
})

test('resolvePorts uses the documented defaults when both are free', async () => {
  const defaultsFree =
    (await isPortFree(DEFAULT_FRONTEND_PORT)) && (await isPortFree(DEFAULT_BACKEND_PORT))
  if (!defaultsFree) {
    // Asserting the exact defaults would make this test depend on the
    // developer's machine being quiet. Skip rather than assert something
    // weaker and call it a pass.
    return
  }

  const env = {}
  const ports = await resolvePorts({ env })

  assert.equal(ports.frontend, DEFAULT_FRONTEND_PORT)
  assert.equal(ports.backend, DEFAULT_BACKEND_PORT)
  assert.equal(ports.frontendIsDefault, true)
  assert.equal(ports.backendIsDefault, true)
})

test('resolvePorts falls back when a default is occupied', async () => {
  if (!(await isPortFree(DEFAULT_BACKEND_PORT))) return

  const release = await occupy(DEFAULT_BACKEND_PORT)
  try {
    const env = {}
    const ports = await resolvePorts({ env })

    assert.ok(ports.backend > DEFAULT_BACKEND_PORT)
    assert.equal(ports.backendIsDefault, false)
    assert.equal(await isPortFree(ports.backend), true)
  } finally {
    await release()
  }
})

test('resolvePorts never assigns the same port to both consumers', async () => {
  const env = {}
  const ports = await resolvePorts({ env })
  assert.notEqual(ports.frontend, ports.backend)
})

test('resolvePorts returns supplied values without allocating', async () => {
  // Both supplied, and both deliberately occupied: if the allocator were
  // checking availability here it would move off them, which is exactly the
  // behaviour "supplied values are authoritative" forbids.
  const frontend = await sparePort()
  const backend = await findFreePort(frontend + 10, { limit: 50 })
  const releases = [await occupy(frontend), await occupy(backend)]

  try {
    const env = {
      [FRONTEND_PORT_ENV]: String(frontend),
      [BACKEND_PORT_ENV]: String(backend),
    }
    const ports = await resolvePorts({ env })

    assert.equal(ports.frontend, frontend)
    assert.equal(ports.backend, backend)
  } finally {
    for (const release of releases) await release()
  }
})

test('resolvePorts honours a partially supplied environment', async () => {
  const backend = await sparePort()
  const env = { [BACKEND_PORT_ENV]: String(backend) }

  const ports = await resolvePorts({ env })

  assert.equal(ports.backend, backend)
  assert.ok(Number.isInteger(ports.frontend))
})

test('resolvePorts writes the result back for child processes to inherit', async () => {
  const env = {}
  const ports = await resolvePorts({ env })

  assert.equal(env[FRONTEND_PORT_ENV], String(ports.frontend))
  assert.equal(env[BACKEND_PORT_ENV], String(ports.backend))
})

test('resolvePorts rejects a non-numeric port in the environment', async () => {
  await assert.rejects(
    () => resolvePorts({ env: { [FRONTEND_PORT_ENV]: 'not-a-port' } }),
    /must be an integer/,
  )
})

test('resolvePorts rejects an out-of-range port in the environment', async () => {
  await assert.rejects(
    () => resolvePorts({ env: { [BACKEND_PORT_ENV]: '70000' } }),
    /must be an integer/,
  )
})

test('describePorts marks a port that moved off its default', () => {
  const output = describePorts({
    frontend: DEFAULT_FRONTEND_PORT,
    backend: DEFAULT_BACKEND_PORT + 3,
    frontendIsDefault: true,
    backendIsDefault: false,
  })

  assert.match(output, new RegExp(`frontend\\s+${DEFAULT_FRONTEND_PORT}`))
  assert.match(output, new RegExp(`backend\\s+${DEFAULT_BACKEND_PORT + 3}`))
  assert.match(output, /default 8009 unavailable/)
  // The line that did not move carries no annotation.
  assert.doesNotMatch(output, /default 5177 unavailable/)
})

// ── Discovery ────────────────────────────────────────────────────────────

import fs from 'node:fs'
import os from 'node:os'

import {
  DEFAULT_BACKEND_PORT as BACKEND_DEFAULT,
  discoverBackendPort,
  readRecordedBackendPort,
  recordBackendPort,
} from './dev-ports.mjs'

function tempRecord() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devports-')), '.dev-ports.json')
}

/** Stand-in for the real /health probe: only these ports "are" our backend. */
const backendOn = (...ports) => async (port) => ports.includes(port)

test('recordBackendPort round-trips through the record file', () => {
  const file = tempRecord()
  recordBackendPort(8042, file)
  assert.equal(readRecordedBackendPort(file), 8042)
})

test('readRecordedBackendPort returns undefined for a missing or corrupt record', () => {
  assert.equal(readRecordedBackendPort(tempRecord()), undefined)

  const file = tempRecord()
  fs.writeFileSync(file, 'not json at all')
  assert.equal(readRecordedBackendPort(file), undefined)
})

test('discoverBackendPort finds a backend recorded by another terminal', async () => {
  const file = tempRecord()
  recordBackendPort(8042, file)

  const found = await discoverBackendPort({ env: {}, file, verify: backendOn(8042) })

  assert.equal(found.port, 8042)
  assert.equal(found.source, 'recorded')
  assert.equal(found.verified, true)
})

test('discoverBackendPort prefers an explicitly supplied port', async () => {
  const file = tempRecord()
  recordBackendPort(8042, file)

  const found = await discoverBackendPort({
    env: { [BACKEND_PORT_ENV]: '8055' },
    file,
    verify: backendOn(8042, 8055),
  })

  assert.equal(found.port, 8055)
  assert.equal(found.source, 'environment')
})

test('discoverBackendPort trusts a supplied port without probing it', async () => {
  // A launcher starts its children concurrently, so the backend it allocated
  // may not be listening yet. Probing here would reject a port that is about
  // to become correct and fall back to one that is merely already occupied —
  // which is how the E2E suite came to proxy at a squatter and report green.
  const file = tempRecord()
  recordBackendPort(8042, file)

  let probes = 0
  const found = await discoverBackendPort({
    env: { [BACKEND_PORT_ENV]: '8055' },
    file,
    verify: async () => {
      probes += 1
      return false
    },
  })

  assert.equal(found.port, 8055)
  assert.equal(found.verified, true)
  assert.equal(found.probed, false)
  assert.equal(probes, 0, 'a supplied port must not be probed at all')
})

test('discoverBackendPort falls through a stale record to the default', async () => {
  const file = tempRecord()
  recordBackendPort(8042, file) // process exited; nothing listens there now

  const found = await discoverBackendPort({
    env: {},
    file,
    verify: backendOn(BACKEND_DEFAULT),
  })

  assert.equal(found.port, BACKEND_DEFAULT)
  assert.equal(found.source, 'default')
  assert.equal(found.verified, true)
})

test('discoverBackendPort rejects an unrelated process holding the recorded port', async () => {
  const file = tempRecord()
  recordBackendPort(8042, file)

  // Something answers on 8042, but it is not us — the exact failure that
  // motivated this change. Health verification must reject it.
  const found = await discoverBackendPort({
    env: {},
    file,
    verify: async (port) => port === BACKEND_DEFAULT,
  })

  assert.notEqual(found.port, 8042)
  assert.equal(found.port, BACKEND_DEFAULT)
})

test('discoverBackendPort warns instead of failing when nothing verifies', async () => {
  const file = tempRecord()
  recordBackendPort(8042, file)

  const found = await discoverBackendPort({ env: {}, file, verify: async () => false })

  assert.equal(found.verified, false)
  assert.equal(found.port, BACKEND_DEFAULT)
  assert.match(found.warning, /8042 \(recorded\)/)
  assert.match(found.warning, new RegExp(`${BACKEND_DEFAULT} \\(default\\)`))
})

test('discoverBackendPort does not list the default twice', async () => {
  // A record that happens to hold the default must not produce two identical
  // candidates and two wasted probes.
  const file = tempRecord()
  recordBackendPort(BACKEND_DEFAULT, file)

  let probes = 0
  const found = await discoverBackendPort({
    env: {},
    file,
    verify: async () => {
      probes += 1
      return false
    },
  })

  assert.equal(found.tried.length, 1)
  assert.equal(probes, 1)
})

// ── Waiting for a backend that is still starting ──────────────────────────

import http from 'node:http'

/** A server that answers `/health` with whatever payload the caller names. */
function serveHealth(port, payload, host = DEV_HOST) {
  const server = http.createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port, host }, () =>
      resolve(() => new Promise((done) => server.close(done))),
    )
  })
}

test('waitForHealthy resolves once the payload identifies this backend', async () => {
  // Two probes find nothing, the third finds the backend — the ordinary shape
  // of waiting on a process that is still booting.
  let probes = 0
  const result = await waitForHealthy(8042, {
    verify: async () => {
      probes += 1
      return probes === 3
    },
    intervalMs: 1,
    timeoutMs: 2000,
  })

  assert.equal(result.port, 8042)
  assert.equal(probes, 3)
})

test('waitForHealthy rejects on a bounded timeout naming the port', async () => {
  await assert.rejects(
    () => waitForHealthy(8042, { verify: async () => false, intervalMs: 5, timeoutMs: 50 }),
    (error) => {
      assert.match(error.message, /8042/)
      return true
    },
  )
})

test('waitForHealthy accepts a real backend answering the health payload', async () => {
  const port = await sparePort()
  const release = await serveHealth(port, { status: 'ok', backend: 'fastapi' })
  try {
    const result = await waitForHealthy(port, { intervalMs: 10, timeoutMs: 2000 })
    assert.equal(result.port, port)
  } finally {
    await release()
  }
})

test('waitForHealthy is not satisfied by an unrelated process holding the port', async () => {
  // The squatter answers 200 with valid JSON. Only the payload distinguishes it
  // from the backend, so only the payload may end the wait.
  const port = await sparePort()
  const release = await serveHealth(port, { status: 'ok', service: 'someone-else' })
  try {
    await assert.rejects(
      () => waitForHealthy(port, { intervalMs: 10, timeoutMs: 120 }),
      /did not answer/,
    )
  } finally {
    await release()
  }
})
