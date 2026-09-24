/**
 * A local stand-in for the model endpoint, so a launcher e2e can drive a real
 * turn — including real tool calls — without a provider key and without network
 * egress. The child is pointed at it with `DEEPSEEK_BASE_URL`; the placeholder
 * `DEEPSEEK_API_KEY` the adapter checks for at apply time is never used.
 *
 * It speaks only the fragment of the streaming chat-completions wire the
 * harness consumes: an assistant role opener, either a tool call or a content
 * delta, a terminating chunk carrying `finish_reason` and `usage`, and
 * `[DONE]`. It is not a model and not a fixture — a scenario that needs a
 * recorded conversation belongs in the snapshot tier.
 *
 * @module @deepseek-ai/dsh-session-snapshot/stub-model
 */

import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'

/** One tool call the stub emits instead of assistant text, in turn order. */
export interface StubToolCall {
  /** Tool name as the harness registered it, for example `bash`. */
  readonly name: string
  /** Arguments object, serialized into the wire's `function.arguments` string. */
  readonly arguments: Record<string, unknown>
  /**
   * The call's wire id. Defaults to `stub-<arrival index>`, which repeats when
   * one session is driven through two stubs in turn.
   */
  readonly id?: string
}

/** What the stub sends, and how it ends the turn once the script runs out. */
export interface StubModelOptions {
  /**
   * What to answer each request with, indexed by arrival: an entry emits that
   * tool call, a hole or the end of the list answers with
   * {@link StubModelOptions.content}.
   *
   * Per REQUEST, not per turn, because a tool result comes back as one more
   * request — so one turn that calls a tool once is `[call, undefined]`, and a
   * hole is how a turn ends and the next one begins.
   */
  readonly toolCalls?: readonly (StubToolCall | undefined)[]
  /** Assistant text for a request the script does not cover. Defaults to `done`. */
  readonly content?: string
  /**
   * `finish_reason` for a request the script does not cover. Defaults to
   * `stop`; `length` is what a max-token case needs.
   */
  readonly finishReason?: string
  /**
   * 1-based arrival index of one request the stub records and never answers,
   * so a case can stop a turn at a known model call and kill its host there.
   * The response stays open until {@link StubModelServer.close}. Absent, every
   * request is answered.
   */
  readonly holdRequest?: number
}

/** A running stand-in endpoint, and the requests it has been sent. */
export interface StubModelServer {
  /** Value for the child's `DEEPSEEK_BASE_URL`. */
  readonly baseUrl: string
  /** Every request body received so far, parsed, in arrival order. */
  readonly requests: readonly Record<string, unknown>[]
  /**
   * Resolves with the held request's parsed body when it arrives. Never
   * settles when {@link StubModelOptions.holdRequest} is absent or that request
   * never comes.
   */
  readonly held: Promise<Record<string, unknown>>
  /** Stop listening, ending the held response first. Safe to call after the child has already exited. */
  close(): Promise<void>
}

/**
 * Start a stand-in model endpoint on a loopback port the OS picks.
 * @param options - the scripted tool calls and how to end an unscripted turn.
 * @returns the running endpoint, its recorded requests, and its shutdown.
 */
export async function startStubModelServer(options: StubModelOptions = {}): Promise<StubModelServer> {
  const requests: Record<string, unknown>[] = []
  const toolCalls = options.toolCalls ?? []
  const held = Promise.withResolvers<Record<string, unknown>>()
  const heldResponses: ServerResponse[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body) as Record<string, unknown>
      requests.push(parsed)
      if (requests.length === options.holdRequest) {
        heldResponses.push(response)
        held.resolve(parsed)
        return
      }
      const toolCall = toolCalls[requests.length - 1]
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
      if (toolCall === undefined) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: options.content ?? 'done' } }] })}\n\n`)
      } else {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
          index: 0,
          id: toolCall.id ?? `stub-${requests.length}`,
          type: 'function',
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
        }] } }] })}\n\n`)
      }
      response.write(`data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: toolCall === undefined ? options.finishReason ?? 'stop' : 'tool_calls' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('stub model server did not bind a TCP port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    held: held.promise,
    close: async () => {
      // A held response keeps its connection open, and `server.close` waits
      // for every connection to end.
      for (const response of heldResponses.splice(0)) response.destroy()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    },
  }
}
