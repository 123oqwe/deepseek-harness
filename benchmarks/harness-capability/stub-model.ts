/**
 * A stub model for the Harness capability benchmark's security lane (Epic
 * P0-08): a minimal OpenAI-compatible chat-completions endpoint on a loopback
 * port that the shipped DeepSeek client reaches through `DEEPSEEK_BASE_URL`.
 *
 * Each request is answered with the tool calls the trial's script returns for
 * it, all in one step, or with the text `done` when the script returns none.
 * It holds no key and reaches no network; the benchmark's README states that
 * the model is this stub and the client is the shipped one.
 * @module benchmarks/harness-capability/stub-model
 */

import { createServer } from 'node:http'

/** One tool call the stub answers with. */
export interface StubToolCall {
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

/** One request body as the client sent it; only the fields a script reads. */
export interface StubRequest {
  /** The tool schemas offered; a request made for another purpose (a session title) offers none. */
  readonly tools?: readonly unknown[]
  readonly messages?: readonly { readonly role?: string; readonly content?: unknown }[]
}

/** A running stub. */
export interface StubModel {
  /** The value `DEEPSEEK_BASE_URL` takes. */
  readonly baseUrl: string
  /** Every request body received, in order. */
  readonly requests: readonly StubRequest[]
  /** Stop listening. */
  close(): Promise<void>
}

/**
 * One server-sent event line.
 * @param data - the event's JSON payload.
 * @returns the line, with its blank-line terminator.
 */
function event(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

/**
 * Start the stub on a loopback port the OS picks.
 * @param answer - the tool calls to answer one request with, in one step; an empty list answers with the text `done`.
 * @returns the running stub.
 */
export async function startStubModel(answer: (request: StubRequest) => readonly StubToolCall[]): Promise<StubModel> {
  const requests: StubRequest[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body) as StubRequest
      requests.push(parsed)
      const calls = answer(parsed)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(event({ choices: [{ delta: { role: 'assistant', content: null } }] }))
      response.write(event({ choices: [{ delta: calls.length === 0
        ? { content: 'done' }
        : { tool_calls: calls.map((call, index) => ({
          index,
          id: `stub-${String(requests.length)}-${String(index)}`,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })) } }] }))
      response.write(event({
        choices: [{ delta: {}, finish_reason: calls.length === 0 ? 'stop' : 'tool_calls' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }))
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('benchmark stub model did not bind a TCP port')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}
