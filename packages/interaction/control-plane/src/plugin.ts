/**
 * `ctx.controlPlane`: the emergency stop and the human-question channel as a
 * mounted service (Epic P2-12, Usage stage).
 *
 * The channel itself is `./channel.ts` and is pure composition over three
 * injected seams. This module is what a deployment mounts: it opens the store
 * under the profile's storage root, publishes the control state onto every
 * agent the registry hands out, and answers `ask` through the user-questions
 * seam that already exists.
 *
 * **It creates no answerer.** Per the delegate's ruling on this epic's second
 * open question, P2-12 wires the answerers a profile already has — the Web
 * question answerer, the ACP and Web approval answerers — and adds none. A
 * surface with no answerer fails closed, which `dsh-user-questions` already
 * does by rejecting with `NO_PROVIDER`, and that refusal reaches the caller as
 * a `HumanChannelRefusal` rather than as a hang.
 *
 * @module @deepseek-ai/dsh-control-plane/plugin
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { openStopStore } from '@deepseek-ai/dsh-human-channel/store'
import type {
  ControlState,
  ControlVerb,
  HumanAnswer,
  HumanChannelRefusal,
  HumanQuestion,
  WaitingPointId,
} from '@deepseek-ai/dsh-human-channel/types'
// The empty type import is load-bearing: it executes `dsh-agent`'s declaration
// merge so `agents` is a key of `Context`. Without it `ctx.get('agents')` falls
// to cordis's untyped overload (`get(name: string): any`,
// vendor/cordis/src/reflect.ts:19) and ANY method name type-checks — measured
// here, where `registry.agents()` compiled cleanly and the real method is
// `list()`.
import type {} from '@deepseek-ai/dsh-agent'
// And the same for `userQuestions`: the seam's declaration merge lives in
// `dsh-user-questions`'s index, so without this `ctx.get('userQuestions')` is
// `any` and the answer it returns type-checks as anything. Third time this
// mechanism has bitten in this epic, which is why both imports carry a comment.
import type {} from '@deepseek-ai/dsh-user-questions'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import { createHumanChannel } from './channel.ts'
import type { ControlRequest, HumanChannel } from './channel.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    controlPlane: ControlPlaneService
  }
}

/** Where the stop record lives; a deployment that moves its storage root moves this with it. */
export interface Config {
  /** The directory holding `emergency-stop.json`. */
  storePath: string
}

/**
 * Put one control state on every agent given.
 *
 * Extracted from the service because a side effect inside a mounted method is
 * one nothing single-package can observe, and this one carries must[2]'s whole
 * reach: an agent that never receives the state is an agent whose gate reads
 * `'no-channel'` and dispatches. Measured reason to be careful here — a first
 * draft called `registry.agents()`, which does not exist (the method is
 * `list()`), and `ctx.get('agents')` is typed loosely enough that the compiler
 * accepted it. The failure would have been a runtime one on the first stop.
 * @param agents - the live agents to publish onto.
 * @param state - the state to publish.
 */
export function publishControlState(agents: readonly Agent[], state: ControlState): void {
  for (const agent of agents) agent.controlState = state
}

/**
 * `ctx.controlPlane`: the stop every worker consults, and the registry of
 * questions waiting for a human.
 *
 * **Mounted in `dsh-base`, which is a decision about acceptance[3].** A stop is
 * a cross-surface invariant: mounting it only where a question can be answered
 * would leave four of the five shipped profiles permanently unable to see a
 * stop, and "every surface agrees" would be true only because four of them
 * never hear anything. The question half is narrower by nature — `web` is the
 * only profile with a question answerer — and that asymmetry is recorded as a
 * limitation rather than hidden by mounting less.
 */
export class ControlPlaneService extends Service<Config> {
  /**
   * Runtime configuration schema, validated at mount from the profile's row.
   *
   * A STATIC member rather than a module-level `export const Config`. The two
   * plugin forms must not be mixed: a service package default-exports its class,
   * while a function plugin named-exports `name`/`inject`/`Config`/`apply`, and
   * a module doing both leaves the Loader discarding a namespace
   * (docs/postmortem/0001-acp-default-export-drops-inject.md). Measured here the
   * expensive way — with a module-level `Config` beside the default export,
   * every shipped profile's recorded replay failed with `cannot create effect on
   * inactive context`.
   */
  static Config = z.object({
    storePath: z.string().required(),
  }) as z<Config>

  private channel: HumanChannel | undefined
  /**
   * The waiting callers, keyed by the point each is waiting at.
   *
   * Host-side and this service's own, because a per-surface copy of who is
   * waiting is acceptance[3]'s failure in miniature: two surfaces holding their
   * own copies disagree exactly when it matters, and one question answered
   * twice looks reasonable to both.
   */
  private readonly askers = new Map<WaitingPointId, {
    readonly resolve: (answer: HumanAnswer) => void
    readonly reject: (refusal: HumanChannelRefusal) => void
  }>()

  /** The validated configuration, naming the directory the stop record lives in. */
  private readonly config: Config

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.controlPlane`.
   * @param config - the validated configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'controlPlane')
    this.config = config
  }

  /**
   * Open the store and build the channel once the mount is active.
   *
   * `Service.init` and not the constructor, and not a method named `start`:
   * cordis runs a symbol-keyed `[Service.init]` after construction
   * (`vendor/cordis/src/service.ts:13`), and `openStopStore` touches the
   * filesystem — a mount that failed in the constructor would fail while the
   * context cannot yet report it. `RunPlugin` restores its own store the same
   * way. A method called `start` is never called by anything, which is how the
   * first version of this looked correct and left every reader throwing.
   */
  protected [Service.init](): void {
    this.channel = createHumanChannel({
      store: openStopStore(this.config.storePath),
      // Every transition is published onto the agents the registry knows, which
      // is how a worker that never asked still sees the stop (must[1]). The
      // channel persists before it announces, so anything published here is
      // already durable.
      broadcast: (state) => { this.publish(state) },
      delivery: { deliver: answer => this.resumeAsker(answer) },
    })
  }

  /**
   * The channel, once the mount is active.
   *
   * Throws rather than returning undefined: a caller reaching the service before
   * its start ran has a mount-order problem, and answering "no stop is in force"
   * would be a fail-open answer to a question about the stop.
   * @returns the live channel.
   */
  private get live(): HumanChannel {
    if (this.channel === undefined) {
      throw new Error('ControlPlaneService was reached before its mount became active')
    }
    return this.channel
  }

  /**
   * The control state as it stands.
   * @returns whether a stop is in force, and the record when one is.
   */
  state(): ControlState {
    return this.live.state()
  }

  /**
   * Apply one control verb.
   * @param verb - the command.
   * @param request - who is asking and why, recorded on the stop.
   * @returns the transition the channel decided.
   */
  control(verb: ControlVerb, request: ControlRequest): ReturnType<HumanChannel['control']> {
    return this.live.control(verb, request)
  }

  /**
   * Ask one question and wait for the human's answer at the point that asked.
   *
   * **The asker's continuation is registered here, not discovered later.** An
   * answer arrives out of band — from a surface, on its own call stack — so the
   * only thing that can reunite it with the caller is the waiting point, and the
   * only moment that continuation exists is this one. A first draft of this
   * method registered the id and returned, leaving delivery to a function that
   * took the answer and ignored it: that is BLOCKED-215 rebuilt, and the unused
   * parameter was the whole tell.
   *
   * A refusal and an answer are separate fields rather than a rejected promise,
   * because a refusal is a decision this service made and a caller must branch
   * on it; only the waiting is asynchronous.
   * @param question - the question, naming the waiting point its answer must reach.
   * @param agent - the asking agent, which the user-questions seam checks is the exact live caller.
   * @returns the refusal, or the promise the matching settlement resolves.
   */
  ask(question: HumanQuestion, agent: Agent): { readonly refused: HumanChannelRefusal } | { readonly answer: Promise<HumanAnswer> } {
    const refused = this.live.ask(question)
    if (refused !== undefined) return { refused }
    const answer = new Promise<HumanAnswer>((resolve, reject) => {
      this.askers.set(question.waitingPoint, { resolve, reject })
    })
    // The question goes to the user-questions SEAM, not to a surface this
    // service knows about. Which answerer replies is the profile's business:
    // `web` has `ui-user-questions`, an SDK host answers through
    // `human/question`, and `headless` has none and fails closed. That is why no
    // bundle row wires a surface to this service — the seam already is the
    // wiring, and naming a surface here would make one profile's answerer a
    // dependency of every profile's stop.
    const seam = this.ctx.get('userQuestions')
    if (seam === undefined) {
      this.forget(question.waitingPoint)
      return { refused: { reason: 'no-answerer' } }
    }
    void seam.ask({
      agent,
      questions: [{
        id: String(question.waitingPoint),
        question: question.prompt,
        ...(question.options === undefined ? {} : { options: question.options.map(label => ({ label })) }),
      }],
    }).then(
      (given) => {
        // The seam answers per question id; this channel asks one at a time, so
        // the first answer is this waiting point's. Free text wins over the
        // selected labels because a human who typed chose to type.
        const first = given.answers[0]
        const text = first === undefined ? '' : first.custom ?? first.selected.join(', ')
        this.settle({ waitingPoint: question.waitingPoint, text })
      },
      () => {
        // Every refusal the seam can make — no answerer, a caller that is not
        // live, an aborted question — arrives here as one fact: nobody answered.
        // The waiting caller must learn that rather than wait forever, and the
        // point must leave the registry so a later answer for it is refused as
        // vanished rather than delivered to a caller that gave up.
        this.askers.get(question.waitingPoint)?.reject({ reason: 'no-answerer' })
        this.forget(question.waitingPoint)
      },
    )
    return { answer }
  }

  /**
   * Drop one waiting point from both the registry and the waiting callers.
   *
   * The registry closes the point through its own settlement so a later answer
   * for it is refused as VANISHED rather than as never registered: a surface
   * that replies after the asker gave up needs to learn which of those two
   * happened.
   * @param waitingPoint - the point to forget.
   */
  private forget(waitingPoint: WaitingPointId): void {
    this.askers.delete(waitingPoint)
    this.live.settle({ waitingPoint, text: '' })
  }

  /**
   * Deliver one answer, out of band from the asking call stack.
   * @param answer - the answer, carrying the waiting point it belongs to.
   * @returns the refusal, or undefined on delivery.
   */
  settle(answer: HumanAnswer): HumanChannelRefusal | undefined {
    return this.live.settle(answer)
  }

  /**
   * The waiting points still unanswered.
   * @returns the pending waiting points, for a surface that renders them.
   */
  pending(): readonly WaitingPointId[] {
    return this.live.pending()
  }

  /**
   * Put the control state on every agent the registry currently holds.
   *
   * Written onto the agent rather than read from this service at the gate, and
   * the reason is the dependency direction: `dsh-agent` is where dispatch
   * happens and this package already depends on it being mounted, so a gate
   * calling back into `ctx.controlPlane` would be an orchestration package
   * reaching for an interaction service mid-dispatch. The field's writer
   * contract names this method.
   * @param state - the state to publish.
   */
  private publish(state: ControlState): void {
    const registry = this.ctx.get('agents')
    if (registry === undefined) return
    publishControlState(registry.list(), state)
  }

  /**
   * Resume the caller that asked, by its own waiting point.
   *
   * This service never learns what an asker IS: it holds the continuation
   * {@link ControlPlaneService.ask} registered, keyed by the waiting point, and
   * an answer for a point it holds nothing for is refused rather than dropped.
   * A dropped answer is indistinguishable from a delivered one at the surface
   * that sent it, which is how "the human answered" becomes a fact nobody can
   * check.
   * @param answer - the answer to deliver.
   * @returns the refusal, or undefined once the asker has been resumed.
   */
  private resumeAsker(answer: HumanAnswer): HumanChannelRefusal | undefined {
    const waiting = this.askers.get(answer.waitingPoint)
    if (waiting === undefined) return { reason: 'unknown-waiting-point', waitingPoint: answer.waitingPoint }
    this.askers.delete(answer.waitingPoint)
    waiting.resolve(answer)
    return undefined
  }
}

export default ControlPlaneService
