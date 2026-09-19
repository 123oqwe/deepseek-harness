/**
 * The host emergency stop, as an ACP client learns it (P2-12 acceptance[3]).
 * @module @deepseek-ai/dsh-acp/host-control
 */

import type { Context } from '@deepseek-ai/cordis'
// A type-only edge, for two things at once: the `declare module` that puts
// `control/state-changed` on cordis' `Events` -- without it `ctx.on` falls back
// to an untyped listener and the event name goes unchecked -- and the service
// type, so a rename of `state()` is a compile error here rather than a `_meta`
// key that silently stops appearing. The peer is optional: a composition may
// mount no control plane, and this server must boot in one that does not.
import type ControlPlaneService from '@deepseek-ai/dsh-control-plane/plugin'

/**
 * The `_meta` key the host control state travels under.
 *
 * Namespaced, because ACP reserves `_meta` for exactly this and says
 * implementations must not assume anything about values at keys they do not
 * own. A bare `hostControl` would be a claim on a name the protocol did not
 * give us.
 */
export const HOST_CONTROL_META_KEY = 'com.deepseek.dsh/host-control'

/**
 * The control plane's own state type, taken from its reader rather than
 * restated.
 *
 * This server has no client compiler face, which is why it can carry the
 * internal type where `@deepseek-ai/dsh-api-session-controller` had to project
 * one: the Web projection exists because that package's `types.ts` is compiled
 * by a program that sees no interaction package. **The JSON is the same either
 * way** -- `StopRecord`'s four fields are exactly the four `HostStopRecord`
 * declares, and the brands it widens are strings on the wire -- so the two
 * surfaces publish one shape without a second declaration of it.
 */
type ControlState = ReturnType<ControlPlaneService['state']>

/**
 * The `_meta` fragment naming the host control state, or nothing.
 *
 * **Absence means UNKNOWN, and that is why this returns `undefined` rather
 * than `{ stopped: false }`** when no control plane is mounted. "No stop is in
 * force" and "nobody is watching" are different facts, and a client that
 * cannot tell them apart would read the second as the first — the reassurance
 * this whole clause exists to prevent.
 * @param ctx - the context the ACP server runs in.
 * @returns the fragment to spread into a message's `_meta`, or `undefined` when this composition mounts no control plane.
 */
export function hostControlMeta(ctx: Context): Record<string, ControlState> | undefined {
  const plane: ControlPlaneService | undefined = ctx.get('controlPlane')
  if (plane === undefined) return undefined
  return { [HOST_CONTROL_META_KEY]: plane.state() }
}

/**
 * The same fragment, as fields to spread into a response.
 *
 * Separate from {@link hostControlMeta} because `exactOptionalPropertyTypes`
 * makes `_meta: undefined` a different value from an absent `_meta`, and a
 * response that carries the key with no value would say "unknown" in a way the
 * protocol never defined.
 * @param meta - the fragment, or `undefined` when no control plane is mounted.
 * @returns `{ _meta }` when there is something to say, and nothing otherwise.
 */
export function metaOf(meta: Record<string, unknown> | undefined): { _meta?: Record<string, unknown> } {
  return meta === undefined ? {} : { _meta: meta }
}
