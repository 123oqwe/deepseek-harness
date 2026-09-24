/**
 * A stand-in model endpoint that decides each answer from the request it
 * received, not from the order requests arrive in.
 *
 * `startStubModelServer` (`@deepseek-ai/dsh-session-snapshot`) answers the Nth
 * request with the Nth scripted entry, which is exact while one agent loop is
 * the only caller. It is not exact on the `headless` and `web` profiles:
 * `dsh-base` mounts `session-title-first-prompt-llm`
 * (`packages/bundle/base/cordis.patch.yml:55`), whose one title request per
 * root session starts from the loop's first model request and races it
 * (`packages/session/session-title/src/index.ts:368-371`, `:539-575`), and a detached
 * workflow run adds a delegated child's requests beside its launcher's. This
 * endpoint answers from what each request carries instead, and writes the same
 * fragment of the streaming chat-completions wire that one does.
 *
 * @module apps/cli/tests/profiles/routing-stub-model
 */

import { createServer } from 'node:http'
import type { StubToolCall } from '@deepseek-ai/dsh-session-snapshot'

/** One chat-completions message, as a request body carries it. */
export interface StubRequestMessage {
  /** `system`, `user`, `assistant` or `tool`. */
  readonly role?: string
  /** A string, or content parts. */
  readonly content?: unknown
}

/** The members of a request body an answer is decided from. */
export interface StubRequest {
  /**
   * The tools offered. An agent loop's request carries at least one; the
   * session-title request carries none, and the DeepSeek adapter then omits
   * the member (`packages/llm/llm-deepseek/src/serialize.ts:366`).
   */
  readonly tools?: readonly unknown[]
  /** The conversation, system prompt first. */
  readonly messages?: readonly StubRequestMessage[]
}

/** A running endpoint and every request it has answered. */
export interface RoutingStubModelServer {
  /** Value for the child's `DEEPSEEK_BASE_URL`. */
  readonly baseUrl: string
  /** Every request body received so far, parsed, in arrival order. */
  readonly requests: readonly StubRequest[]
  /** Stop listening. Safe to call after the child has already exited. */
  close(): Promise<void>
}

/**
 * Start an endpoint on a loopback port the OS picks.
 * @param answer - the tool call to answer one request with, or `undefined` to answer it with the text `done`.
 * @returns the running endpoint, its recorded requests, and its shutdown.
 */
export async function startRoutingStubModelServer(
  answer: (request: StubRequest) => StubToolCall | undefined,
): Promise<RoutingStubModelServer> {
  const requests: StubRequest[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body) as StubRequest
      requests.push(parsed)
      const toolCall = answer(parsed)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
      if (toolCall === undefined) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'done' } }] })}\n\n`)
      } else {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
          index: 0,
          id: `routed-${requests.length}`,
          type: 'function',
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
        }] } }] })}\n\n`)
      }
      response.write(`data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: toolCall === undefined ? 'stop' : 'tool_calls' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('routing stub model server did not bind a TCP port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => { await new Promise<void>(resolve => server.close(() => { resolve() })) },
  }
}

/**
 * Whether a request is an agent loop's first model step after a user prompt
 * that contains `marker`: it offers tools, and no tool result follows that
 * prompt yet. The step after a tool result, a context message the harness adds
 * without the marker, and the session-title request (no tools) all answer
 * `false`, so a scenario that calls one tool per prompt ends its turn.
 * @param request - the request body.
 * @param marker - text only the scenario's own prompt contains.
 * @returns whether this request should be answered with the prompt's tool call.
 */
export function isFirstStepAfterPrompt(request: StubRequest, marker: string): boolean {
  if ((request.tools?.length ?? 0) === 0) return false
  const messages = request.messages ?? []
  const lastPrompt = messages.findLastIndex(message => message.role === 'user' && JSON.stringify(message.content ?? '').includes(marker))
  const lastResult = messages.findLastIndex(message => message.role === 'tool')
  return lastPrompt > lastResult
}

/**
 * The text of the request's last tool result, as serialized.
 * @param request - the request body.
 * @returns the last `tool` message's content as JSON text, or `undefined` when the request carries none.
 */
export function lastToolResult(request: StubRequest): string | undefined {
  const results = (request.messages ?? []).filter(message => message.role === 'tool')
  const last = results.at(-1)
  return last === undefined ? undefined : JSON.stringify(last.content ?? '')
}
