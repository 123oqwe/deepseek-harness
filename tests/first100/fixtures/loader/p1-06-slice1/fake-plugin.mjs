// Staging fixture for P1-06 slice 1 (RF1-4): an untrusted plugin, run as a REAL
// child process speaking newline-delimited JSON-RPC over stdin/stdout (§19 — a
// real process boundary, not an in-process double). Plain .mjs so it runs under
// `node <path>` with no tsx/TypeScript loader; it imports only node builtins and
// never a workspace package, so nothing of the host crosses to it.
//
// argv[2] = scenario: rf1 | rf2 | rf3 | rf4 | risk
// argv[3] = the manifest digest to present at host.hello.
//
// The plugin SENDS host.hello and tools.register (plugin→host requests) and
// HANDLES tool.invoke / host.shutdown (host→plugin requests). On tool.invoke it
// echoes the received params back as the result, so the host-side test can
// assert on the four-element identity frame the plugin actually received (RF3).

import process from 'node:process'

const scenario = process.argv[2]
const manifestDigest = process.argv[3]

let nextId = 0
const pending = new Map()

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function request(method, params) {
  return new Promise((resolve) => {
    const id = `plugin_${nextId++}`
    pending.set(id, resolve)
    write({ jsonrpc: '2.0', id, method, params })
  })
}

function handleIncoming(frame) {
  const { id, method } = frame
  if ((typeof id === 'string' || typeof id === 'number') && typeof method !== 'string') {
    // A response to one of the plugin's own requests.
    const resolve = pending.get(id)
    if (resolve !== undefined) {
      pending.delete(id)
      resolve(frame.error === undefined ? frame.result : { error: frame.error })
    }
    return
  }
  if (typeof method !== 'string') return
  if (method === 'tool.invoke') {
    // Echo the host-stamped params straight back as the canonical result, so the
    // test reads exactly what crossed to the plugin.
    write({ jsonrpc: '2.0', id, result: frame.params })
    return
  }
  if (method === 'host.shutdown') {
    write({ jsonrpc: '2.0', id, result: {} })
    process.exit(0)
    return
  }
  // tool.cancel / event.deliver are notifications; ignore.
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    let frame
    try {
      frame = JSON.parse(line)
    } catch {
      continue
    }
    if (frame && typeof frame === 'object') handleIncoming(frame)
  }
})

function registrationParams() {
  const base = { name: 'echo', description: 'echoes its arguments', parameters: { type: 'object' }, outputSchema: { type: 'object' } }
  switch (scenario) {
    case 'rf1':
      // A valid, registrable frame (name + two serializable schemas + a valid
      // render enum) that ALSO smuggles callback-named fields a function cannot
      // actually cross as JSON. The host must register the pure data and strip
      // the smuggled fields, so the proxy's callbacks stay host-fixed and no
      // plugin-provided value reaches them.
      return { ...base, render: 'json', finalizeContent: { __invoke: 'tamper' }, presentationMeta: { __invoke: 'tamper' }, isConcurrencySafe: { __invoke: 'tamper' } }
    case 'rf2':
      // A tool name the manifest does not declare.
      return { ...base, name: 'not-declared', render: 'json' }
    case 'risk':
      // A declared tool carrying a risk-domain tag (riskDomainTags coverage).
      return { ...base, render: 'json', riskDomainTags: ['filesystem-read'] }
    default:
      // rf3 / rf4: a plain, valid, declared tool.
      return { ...base, render: 'json' }
  }
}

async function main() {
  await request('host.hello', {
    protocolVersion: 1,
    pluginName: 'test-plugin',
    pluginVersion: '1.0.0',
    manifestDigest,
  })
  // rf2 registers a valid declared tool FIRST so the subsequent undeclared-name
  // refusal has a prior registration to revoke on the fail-closed close.
  if (scenario === 'rf2') {
    await request('tools.register', { name: 'echo', description: 'echoes its arguments', parameters: { type: 'object' }, outputSchema: { type: 'object' }, render: 'json' })
  }
  const result = await request('tools.register', registrationParams())
  // Report the registration outcome on stderr (host treats stderr as log only,
  // never control) so the driver can wait for the plugin to have finished
  // registering before it observes the inventory.
  process.stderr.write(`${JSON.stringify({ registered: result })}\n`)
}

void main()
