// The browser-facing control surface: catalog assembly against the live Agent
// registry, prompt admission, and the stable failure codes each answers with.
// The durable listing, continuation, and interrupt primitives they wrap have
// their own specs, so each case scripts them.

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, {
  SubagentError,
  type SubagentListEntry,
  type SubagentPromptRequestId,
} from '@deepseek-ai/dsh-subagent'
import { queueSubagentPrompt, type HostPromptQueue } from '@deepseek-ai/dsh-subagent/internal'

const PARENT = SessionId('parent')
const CHILD = SessionId('child')
const OTHER = SessionId('other')
const BROKEN = SessionId('broken')
const REQUEST_ID = 'req-1' as SubagentPromptRequestId
const signal = new AbortController().signal
/** Durable-reference base for the fake store; per-test ids and media types override. */
const IMAGE_REF = { attachmentId: 'att', mediaType: 'image/png', bytes: 2, width: 1, height: 1 }

/** The runtime plus a programmable live-Agent registry, omitted to compose none. */
async function bench(live?: Record<string, { status: 'running' | 'idle' }>) {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  if (live !== undefined) {
    ctx.provide('agents', { get: (id: SessionId) => live[id] } as never)
  }
  return { ctx, subagents: ctx.subagents }
}

/** Spy on the private human-Queue adapter without widening the public service. */
function promptDelivery(subagents: SubagentRuntime) {
  return vi.spyOn(subagents as unknown as HostPromptQueue, queueSubagentPrompt)
}

function childRow(id: SessionId, activity: 'running' | 'inactive'): SubagentListEntry {
  return { kind: 'child', id, mode: 'continuable', label: 'worker', activity, hasChildren: false }
}

function promptRequest(clientTimeZone?: string) {
  return {
    requestId: REQUEST_ID,
    parentSessionId: PARENT,
    childSessionId: CHILD,
    mode: 'continuable' as const,
    content: [{ type: 'text' as const, text: 'continue' }],
    ...clientTimeZone === undefined ? {} : { clientTimeZone },
  }
}

function emptyIdFailure(method: string, field: string) {
  return {
    code: 'gateway/bad-request',
    message: `invalid payload for ${method}`,
    details: {
      issues: [{
        origin: 'string',
        code: 'too_small',
        minimum: 1,
        inclusive: true,
        path: [field],
        message: 'Too small: expected string to have >=1 characters',
      }],
    },
  }
}

describe('subagent catalog Remote', () => {
  it('rejects an empty parent id before listing', async () => {
    const { subagents } = await bench()
    const listChildren = vi.spyOn(subagents, 'listChildren')

    await expect(subagents.remoteExportList(SessionId(''), signal))
      .rejects.toMatchObject(emptyIdFailure('subagent.list', 'parentSessionId'))
    expect(listChildren).not.toHaveBeenCalled()
  })

  it('samples row activity from the live Agent driver and reports parent availability', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' }, [CHILD]: { status: 'running' } })
    vi.spyOn(subagents, 'listChildren').mockResolvedValue([
      // The durable listing reports store presence; the browser row reports the driver.
      childRow(CHILD, 'inactive'),
      childRow(OTHER, 'running'),
      { kind: 'diagnostic', id: BROKEN, reason: 'corrupt' },
    ])

    await expect(subagents.remoteExportList(PARENT, signal)).resolves.toEqual({
      entries: [
        childRow(CHILD, 'running'),
        childRow(OTHER, 'inactive'),
        { kind: 'diagnostic', id: BROKEN, reason: 'corrupt' },
      ],
      parentAvailable: true,
    })
  })

  it('reports every row inactive and the parent unavailable without an Agent registry', async () => {
    const { subagents } = await bench()
    vi.spyOn(subagents, 'listChildren').mockResolvedValue([childRow(CHILD, 'running')])

    await expect(subagents.remoteExportList(PARENT, signal)).resolves.toEqual({
      entries: [childRow(CHILD, 'inactive')],
      parentAvailable: false,
    })
  })

  it('reports an unknown parent as unavailable while the registry serves other sessions', async () => {
    const { subagents } = await bench({ [CHILD]: { status: 'running' } })
    vi.spyOn(subagents, 'listChildren').mockResolvedValue([])

    await expect(subagents.remoteExportList(PARENT, signal))
      .resolves.toEqual({ entries: [], parentAvailable: false })
  })

  it('separates cancellation, the missing projections capability, and an unexplained read failure', async () => {
    const { subagents } = await bench()
    const listChildren = vi.spyOn(subagents, 'listChildren')

    const aborted = new AbortController()
    aborted.abort()
    listChildren.mockRejectedValue(new Error('read stopped'))
    await expect(subagents.remoteExportList(PARENT, aborted.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })

    listChildren.mockRejectedValue(new SubagentError('cancelled', 'CANCELLED'))
    await expect(subagents.remoteExportList(PARENT, signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })

    listChildren.mockRejectedValue(
      new SubagentError('no registry', 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE'),
    )
    await expect(subagents.remoteExportList(PARENT, signal)).rejects.toMatchObject({
      code: 'subagent/projections-unavailable',
      message: expect.stringContaining('sessionProjections') as unknown as string,
    })

    listChildren.mockRejectedValue(new Error('disk gone'))
    await expect(subagents.remoteExportList(PARENT, signal))
      .rejects.toMatchObject({ code: 'gateway/internal', message: 'subagent catalog read failed' })
  })
})

describe('subagent prompt Remote', () => {
  it('rejects empty parent and child ids before delivery', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    const delivery = promptDelivery(subagents)

    const cases: readonly {
      readonly field: 'parentSessionId' | 'childSessionId'
      readonly request: ReturnType<typeof promptRequest>
    }[] = [
      { field: 'parentSessionId', request: { ...promptRequest(), parentSessionId: SessionId('') } },
      { field: 'childSessionId', request: { ...promptRequest(), childSessionId: SessionId('') } },
    ]
    for (const { field, request } of cases) {
      await expect(subagents.prompt(request, signal))
        .rejects.toMatchObject(emptyIdFailure('subagent.prompt', field))
    }
    expect(delivery).not.toHaveBeenCalled()
  })

  it('admits ordered image parts into durable references before delivery', async () => {
    const { ctx, subagents } = await bench({ [PARENT]: { status: 'idle' } })
    const saveImages = vi.fn(async (inputs: readonly { mediaType: string }[]) =>
      inputs.map((input, index) => ({ ...IMAGE_REF, attachmentId: `att-${index}`, mediaType: input.mediaType })))
    ctx.provide('attachments', { saveImages } as never)
    const delivery = promptDelivery(subagents).mockResolvedValue('m-content' as MessageId)
    const content = [
      { type: 'text' as const, text: 'before' },
      { type: 'image' as const, mediaType: 'image/png' as const, data: 'aGk=' },
      { type: 'text' as const, text: 'after' },
    ]

    await expect(subagents.prompt({ ...promptRequest(), content }, signal))
      .resolves.toEqual({ messageId: 'm-content' })
    expect(delivery.mock.calls[0]?.[2]).toEqual([
      { type: 'text', text: 'before' },
      { type: 'image', attachment: { ...IMAGE_REF, attachmentId: 'att-0', mediaType: 'image/png' } },
      { type: 'text', text: 'after' },
    ])
  })

  it('maps a refused image batch to subagent/attachment-invalid and delivers nothing', async () => {
    const { ctx, subagents } = await bench({ [PARENT]: { status: 'idle' } })
    ctx.provide('attachments', {
      saveImages: async () => {
        throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
      },
    } as never)
    const delivery = promptDelivery(subagents)

    await expect(subagents.prompt({
      ...promptRequest(),
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'aGk=' }],
    }, signal)).rejects.toMatchObject({
      code: 'subagent/attachment-invalid', details: { reason: 'TOO_MANY_IMAGES' },
    })
    expect(delivery).not.toHaveBeenCalled()
  })

  it('maps non-canonical base64 to subagent/attachment-invalid without touching the store', async () => {
    const { ctx, subagents } = await bench({ [PARENT]: { status: 'idle' } })
    const saveImages = vi.fn()
    ctx.provide('attachments', { saveImages } as never)
    const delivery = promptDelivery(subagents)

    await expect(subagents.prompt({
      ...promptRequest(),
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'not base64!' }],
    }, signal)).rejects.toMatchObject({
      code: 'subagent/attachment-invalid', details: { reason: 'INVALID_IMAGE_BASE64' },
    })
    expect(saveImages).not.toHaveBeenCalled()
    expect(delivery).not.toHaveBeenCalled()
  })

  it('rejects an image prompt when no attachment store is composed', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    const delivery = promptDelivery(subagents)

    await expect(subagents.prompt({
      ...promptRequest(),
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'aGk=' }],
    }, signal)).rejects.toMatchObject({ code: 'gateway/internal', message: 'subagent prompt failed' })
    expect(delivery).not.toHaveBeenCalled()
  })

  it('maps a text-only child model refusal to subagent/attachment-invalid', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    promptDelivery(subagents).mockRejectedValue(
      new SubagentError('Model "text-only" does not support image input.', 'MODEL_DOES_NOT_SUPPORT_IMAGES'),
    )

    await expect(subagents.prompt(promptRequest(), signal)).rejects.toMatchObject({
      code: 'subagent/attachment-invalid', details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
    })
  })

  it('delivers the content under the caller-minted identity and canonical browser zone', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    const delivery = promptDelivery(subagents).mockResolvedValue('m-1' as MessageId)

    await expect(subagents.prompt(promptRequest('Asia/Shanghai'), signal))
      .resolves.toEqual({ messageId: 'm-1' })
    expect(delivery).toHaveBeenCalledWith(
      { status: 'idle' },
      CHILD,
      [{ type: 'text', text: 'continue' }],
      { kind: 'user', rpcId: REQUEST_ID, clientTimeZone: 'Asia/Shanghai' },
      signal,
    )
  })

  it('omits the zone from the durable source when the browser reported none', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    const delivery = promptDelivery(subagents).mockResolvedValue('m-2' as MessageId)

    await expect(subagents.prompt(promptRequest(), signal)).resolves.toEqual({ messageId: 'm-2' })
    expect(delivery.mock.calls[0]?.[3]).toEqual({ kind: 'user', rpcId: REQUEST_ID })
  })

  it('accepts UTC and rejects an empty, untrimmed, malformed, or unknown zone', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    promptDelivery(subagents).mockResolvedValue('m-3' as MessageId)

    await expect(subagents.prompt(promptRequest('UTC'), signal)).resolves.toEqual({ messageId: 'm-3' })
    for (const zone of ['', ' UTC', 'Shanghai', 'Nowhere/Nowhere']) {
      await expect(subagents.prompt(promptRequest(zone), signal)).rejects.toMatchObject({
        code: 'subagent/invalid-time-zone', details: { value: zone },
      })
    }
  })

  it('refuses delivery when the exact parent Agent is not live', async () => {
    const { subagents } = await bench()
    const delivery = promptDelivery(subagents)

    await expect(subagents.prompt(promptRequest(), signal)).rejects.toMatchObject({
      code: 'subagent/parent-unavailable', details: { parentSessionId: PARENT },
    })
    expect(delivery).not.toHaveBeenCalled()
  })

  it('maps each admission failure onto its stable code and hides the rest', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    const delivery = promptDelivery(subagents)
    const cases: readonly [string, string][] = [
      ['NOT_RESUMABLE', 'subagent/not-resumable'],
      ['UNAUTHORIZED', 'subagent/unauthorized'],
      ['DRAINING', 'subagent/delivery-unavailable'],
      ['ACTIVATION_CLOSING', 'subagent/delivery-unavailable'],
      ['NO_PROVIDER', 'gateway/internal'],
    ]
    for (const [thrown, code] of cases) {
      delivery.mockRejectedValue(new SubagentError('refused', thrown))
      await expect(subagents.prompt(promptRequest(), signal))
        .rejects.toMatchObject({ code })
    }

    delivery.mockRejectedValue(new Error('inbox exploded'))
    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ code: 'gateway/internal', message: 'subagent prompt failed' })
  })

  it('answers a caller-cancelled delivery as cancelled rather than a failure', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    const aborted = new AbortController()
    promptDelivery(subagents).mockImplementation(() => {
      aborted.abort()
      return Promise.reject(new SubagentError('gone', 'NOT_RESUMABLE'))
    })

    await expect(subagents.prompt(promptRequest(), aborted.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
  })

  it('preserves a cancellation reported by the continuation operation', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    promptDelivery(subagents)
      .mockRejectedValue(new SubagentError('stopped', 'CANCELLED'))

    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
  })
})

describe('subagent interrupt Remote', () => {
  it('rejects empty child and parent ids before interrupting', async () => {
    const { subagents } = await bench()
    const interrupt = vi.spyOn(subagents, 'interrupt')

    for (const [childSessionId, parentSessionId] of [
      [SessionId(''), PARENT],
      [CHILD, SessionId('')],
    ] as const) {
      const field = childSessionId.length === 0 ? 'childSessionId' : 'parentSessionId'
      expect(() => subagents.interruptByParent(childSessionId, parentSessionId, 'continuable'))
        .toThrow(expect.objectContaining(emptyIdFailure('subagent.interrupt', field)))
    }
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('admits the parent-addressed interrupt and acknowledges it', async () => {
    const { subagents } = await bench()
    const interrupt = vi.spyOn(subagents, 'interrupt').mockReturnValue()

    expect(subagents.interruptByParent(CHILD, PARENT, 'continuable')).toEqual({ accepted: true })
    expect(interrupt).toHaveBeenCalledWith(CHILD, { kind: 'user', parentSessionId: PARENT })
  })

  it('answers a foreign address as unauthorized and everything else as internal', async () => {
    const { subagents } = await bench()
    const interrupt = vi.spyOn(subagents, 'interrupt')

    interrupt.mockImplementation(() => { throw new SubagentError('not yours', 'UNAUTHORIZED') })
    expect(() => subagents.interruptByParent(CHILD, PARENT, 'continuable')).toThrow(
      expect.objectContaining({
        code: 'subagent/unauthorized',
        message: expect.any(String) as unknown as string,
        details: { childSessionId: CHILD },
      }),
    )

    interrupt.mockImplementation(() => { throw new Error('boom') })
    expect(() => subagents.interruptByParent(CHILD, PARENT, 'continuable')).toThrow(
      expect.objectContaining({ code: 'gateway/internal', message: 'subagent interrupt failed', details: {} }),
    )
  })
})

/**
 * P5-10 Usage — the control sequence decides on the REAL Remote surface.
 *
 * The Contract stage pinned the decisions and the Provider stage put an Agent
 * behind them. Neither could show that the shipped `subagent.prompt` consults
 * them: a browser reaching this service after an interrupt is the case
 * acceptance[0] is actually about, and until now the runtime had no memory that
 * an interrupt had happened at all.
 *
 * Every case here goes through the public methods and asserts on whether the
 * prompt was DELIVERED, not on a decision object.
 */
describe('P5-10 Usage — a prompt that races an interrupt', () => {
  it('acceptance[0]: after an interrupt, the next prompt is refused and never reaches the child', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    const delivery = promptDelivery(subagents)
    delivery.mockResolvedValue('m1' as MessageId)
    subagents.interruptByParent(CHILD, PARENT, 'continuable')

    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ code: 'subagent/not-resumable' })
    // The refusal is the whole claim: delivery was never attempted, so no
    // content was admitted and no turn could open.
    expect(delivery).not.toHaveBeenCalled()
  })

  it('a child that was never interrupted takes its prompt as before', async () => {
    // The control. Without it the case above would pass against a build that
    // refused every prompt.
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    const delivery = promptDelivery(subagents)
    delivery.mockResolvedValue('m1' as MessageId)
    await expect(subagents.prompt(promptRequest(), signal)).resolves.toMatchObject({ messageId: 'm1' })
    expect(delivery).toHaveBeenCalledTimes(1)
  })

  it('acceptance[2]: the same request id delivered twice opens one turn, not two', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    const delivery = promptDelivery(subagents)
    delivery.mockResolvedValue('m1' as MessageId)
    await expect(subagents.prompt(promptRequest(), signal)).resolves.toMatchObject({ messageId: 'm1' })
    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ code: 'subagent/duplicate-request' })
    expect(delivery).toHaveBeenCalledTimes(1)
  })

  it('a redelivery is refused as a DUPLICATE, not as a child that cannot resume', async () => {
    // Two different facts for the caller: "your message already arrived" and
    // "this child cannot take one". Collapsing them would send a caller
    // hunting for a lifecycle problem that does not exist.
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    promptDelivery(subagents).mockResolvedValue('m1' as MessageId)
    await subagents.prompt(promptRequest(), signal)
    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ code: 'subagent/duplicate-request' })
  })

  it('a DIFFERENT request id after a delivered one is a new prompt', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    const delivery = promptDelivery(subagents)
    delivery.mockResolvedValue('m1' as MessageId)
    await subagents.prompt(promptRequest(), signal)
    await expect(subagents.prompt(
      { ...promptRequest(), requestId: 'req-2' as SubagentPromptRequestId },
      signal,
    )).resolves.toMatchObject({ messageId: 'm1' })
    expect(delivery).toHaveBeenCalledTimes(2)
  })

  it('a FAILED delivery does not spend the request id, so the caller may retry it', async () => {
    // Idempotency protects against a repeated EFFECT. A delivery that was
    // refused had none, and burning the id there would make a transient
    // failure permanent.
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    const delivery = promptDelivery(subagents)
    delivery.mockRejectedValueOnce(new SubagentError('busy', 'DRAINING'))
    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ code: 'subagent/delivery-unavailable' })
    delivery.mockResolvedValue('m1' as MessageId)
    await expect(subagents.prompt(promptRequest(), signal)).resolves.toMatchObject({ messageId: 'm1' })
  })
})

/**
 * P5-10 Fault — control state is per child, and it is retained.
 *
 * must[2] asks for control messages to be idempotent. Idempotency held in one
 * shared ledger would be worse than none: one child's redelivery would suppress
 * another child's FIRST delivery of a message that happens to hash alike, and
 * the symptom would be a silently missing turn rather than an error.
 *
 * The second half of this stage is the cost of remembering: the runtime keeps a
 * control record for every child it has seen, and nothing releases it. That is
 * a real bound this slice does not close, pinned here rather than left for
 * someone to discover in a long-lived host.
 */
describe('P5-10 Fault — one child\'s control state cannot decide another\'s', () => {
  it('an interrupt on one child leaves a sibling promptable', async () => {
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    const delivery = promptDelivery(subagents)
    delivery.mockResolvedValue('m1' as MessageId)
    subagents.interruptByParent(CHILD, PARENT, 'continuable')

    await expect(subagents.prompt(
      { ...promptRequest(), childSessionId: OTHER },
      signal,
    )).resolves.toMatchObject({ messageId: 'm1' })
    expect(delivery).toHaveBeenCalledTimes(1)
  })

  it('the SAME request id delivered to two different children is two deliveries', async () => {
    // A shared ledger would swallow the second one, and the caller would see a
    // child that simply never answered.
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    const delivery = promptDelivery(subagents)
    delivery.mockResolvedValue('m1' as MessageId)
    await subagents.prompt(promptRequest(), signal)
    await expect(subagents.prompt(
      { ...promptRequest(), childSessionId: OTHER },
      signal,
    )).resolves.toMatchObject({ messageId: 'm1' })
    expect(delivery).toHaveBeenCalledTimes(2)
  })

  it('interrupting a child that was never prompted still refuses its next prompt', async () => {
    // The state is created on first use by either path, so an interrupt that
    // arrives before any prompt is not forgotten.
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    const delivery = promptDelivery(subagents)
    delivery.mockResolvedValue('m1' as MessageId)
    subagents.interruptByParent(CHILD, PARENT, 'continuable')
    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ code: 'subagent/not-resumable' })
    expect(delivery).not.toHaveBeenCalled()
  })

  it('KNOWN GAP: control state is retained for every child seen, and nothing releases it', async () => {
    // Asserts CURRENT behavior, not desired behavior. Each child that is
    // prompted or interrupted gains a record that lives as long as the service,
    // so a long-lived host accumulates one per child forever. Bounding it needs
    // the child-settlement path to release the record, which this slice does not
    // reach — `interrupt` delegates to the continuation manager and never learns
    // that a child finished.
    //
    // When a release lands, this case starts FAILING. That is the signal, not a
    // regression: delete it and assert the release instead.
    const { subagents } = await bench({ [PARENT]: { status: 'running' } })
    promptDelivery(subagents).mockResolvedValue('m1' as MessageId)
    subagents.interruptByParent(CHILD, PARENT, 'continuable')
    // Reading the private map is deliberate: the retention is not observable
    // through any public surface, which is precisely why it needs pinning.
    const retained = (subagents as unknown as { controlState: Map<unknown, unknown> }).controlState
    expect(retained.size).toBe(1)
    subagents.interruptByParent(OTHER, PARENT, 'continuable')
    expect(retained.size).toBe(2)
  })
})
