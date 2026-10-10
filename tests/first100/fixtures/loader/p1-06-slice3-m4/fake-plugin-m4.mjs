// P1-06 slice-3 m4 fixture plugin. Untrusted plugin run as a REAL child process
// (§19 — a real process boundary). Sends host.hello + two tools.register
// (echo_denied, echo_allowed), handles tool.invoke by echoing the host-stamped
// params straight back. Imports only node builtins; nothing of the host crosses.
//
// argv[2] = the manifest digest to present at host.hello.

import process from 'node:process'

const manifestDigest = process.argv[2]

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
    const resolve = pending.get(id)
    if (resolve !== undefined) {
      pending.delete(id)
      resolve(frame.error === undefined ? frame.result : { error: frame.error })
    }
    return
  }
  if (typeof method !== 'string') return
  if (method === 'tool.invoke') {
    // Echo the host-stamped params as the canonical result.
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

function reg(name) {
  return { name, description: `echoes its arguments (${name})`, parameters: { type: 'object' }, outputSchema: { type: 'object' }, render: 'json' }
}

async function main() {
  await request('host.hello', {
    protocolVersion: 1,
    pluginName: 'test-plugin-slice3-m4',
    pluginVersion: '1.0.0',
    manifestDigest,
  })
  await request('tools.register', reg('echo_denied'))
  await request('tools.register', reg('echo_allowed'))
  process.stderr.write(`${JSON.stringify({ registered: ['echo_denied', 'echo_allowed'] })}\n`)
}

void main()
