/**
 * A keyless model route that records every request it receives, for Epic
 * P0-02's model-visible-text case.
 *
 * Each request's model-visible fields (`system`, `messages`, `tools`) and its
 * `purpose` are appended as one JSON line to {@link MODEL_INPUT_FILE} in the
 * launch's working directory. A conversation request is answered with one
 * `read` call for {@link PROBE_FILE} until a request carries that call's
 * result, and then with final text; an auxiliary request (one with a
 * `purpose`) is answered with text. `read` is the tool
 * `@deepseek-ai/dsh-tool-fs` registers (`packages/fs/tool-fs/src/read.ts`),
 * mounted by `dsh-base` on every base-backed profile.
 *
 * At mount the plugin also writes {@link KERNEL_OBSERVATION_FILE}: whether
 * `ctx.get('trustKernel')` returns a kernel inside the launched tree.
 * @module apps/cli/tests/fixtures/recording-llm
 */

import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  ReasoningEffortId,
  ToolCallId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

/** The route this fixture registers; the case names it in `--model`. */
export const RECORDING_ROUTE = 'p0-02-recorder'

/** JSON-lines file of every request the route received, in the launch's working directory. */
export const MODEL_INPUT_FILE = 'p0-02-model-inputs.jsonl'

/** JSON file of what the plugin observed at mount, in the launch's working directory. */
export const KERNEL_OBSERVATION_FILE = 'p0-02-kernel-observation.json'

/** The file the model asks `read` for, relative to the launch's working directory. */
export const PROBE_FILE = 'p0-02-probe.txt'

/** Contents the case stages in {@link PROBE_FILE}; only the tool result can carry it to the model. */
export const PROBE_TEXT = 'P0-02 M2 probe file content'

/** The id of the one tool call the route makes. */
export const PROBE_CALL_ID = 'p0-02-read-probe'

const PROBE_CALL = ToolCallId(PROBE_CALL_ID)

/** Records each request, calls `read` once, then answers. */
class RecordingAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    appendFileSync(join(process.cwd(), MODEL_INPUT_FILE), `${JSON.stringify({
      purpose: options.purpose ?? null,
      system: options.system ?? null,
      messages: options.messages,
      tools: options.tools ?? [],
    })}\n`)
    const answered = options.messages.some(message => message.content.some(block =>
      block.type === 'tool-result' && block.toolCallId === PROBE_CALL))
    if (options.purpose === undefined && !answered) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: PROBE_CALL, name: 'read', arguments: JSON.stringify({ file_path: PROBE_FILE }) },
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = options.purpose === undefined ? 'P0-02 M2 done' : 'P0-02 M2'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'p0-02-recording-llm'
export const inject = ['llm']

/**
 * Record whether the kernel is pinned in this tree, and register the route.
 * @param ctx - plugin context carrying the llm registry.
 */
export function apply(ctx: Context): void {
  writeFileSync(
    join(process.cwd(), KERNEL_OBSERVATION_FILE),
    `${JSON.stringify({ trustKernelPinned: ctx.get('trustKernel') !== undefined })}\n`,
  )
  ctx.llm.registerAdapter([RECORDING_ROUTE], new RecordingAdapter())
}
