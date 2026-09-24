/**
 * A minimal stdio MCP server for Epic P4-11's reconnect case: one tool and no
 * SDK, so plain Node runs it from a package that does not depend on the MCP
 * SDK. Each process appends `start <pid>` when it starts and `list <pid>` when
 * it answers `tools/list` to the journal named by its first argument, which is
 * how the driver tells the generation it killed from the one the supervisor
 * reconnected. It exits when its stdin closes.
 */

import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const journal = process.argv[2]
if (journal === undefined) throw new Error('p4-11 MCP server requires a journal path')
appendFileSync(journal, `start ${process.pid}\n`)

/**
 * Write one JSON-RPC message as a line on stdout.
 * @param {Record<string, unknown>} message - the id and the result or error.
 */
function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue
  const request = JSON.parse(line)
  // A notification carries no id and takes no answer.
  if (request.id === undefined) continue
  if (request.method === 'initialize') {
    send({
      id: request.id,
      result: {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'p4-11-mcp', version: '1.0.0' },
      },
    })
  } else if (request.method === 'tools/list') {
    appendFileSync(journal, `list ${process.pid}\n`)
    send({
      id: request.id,
      result: { tools: [{ name: 'ping', description: 'Answers pong.', inputSchema: { type: 'object', properties: {} } }] },
    })
  } else {
    send({ id: request.id, error: { code: -32601, message: `method not found: ${request.method}` } })
  }
}
