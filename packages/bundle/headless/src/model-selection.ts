/**
 * Resolve the one-shot app's `--model` argument (Epic P9-03, Contract stage).
 *
 * The argument names a ROUTE and a model together, because a model id means
 * nothing without the adapter that interprets it: two providers may both accept
 * `deepseek-chat` and reach different endpoints. Splitting them here rather
 * than guessing a provider keeps the selection auditable — what the session
 * records is what the user typed.
 *
 * Contract stage only: a pure function over a caller-supplied route list. It
 * neither reads the registry nor logs the choice; the caller owns both.
 *
 * @module @deepseek-ai/dsh-headless/model-selection
 */

/** A parsed `--model` argument: which adapter route, and which model on it. */
export interface ModelSelection {
  /** Registered adapter route that will interpret {@link model}. */
  readonly provider: string
  /** Model id as the route understands it; never validated here. */
  readonly model: string
}

/**
 * A `--model` argument this build refuses, carrying what the caller may use.
 *
 * The available routes travel WITH the failure rather than being printed by
 * whoever catches it: a caller that has to re-derive the list can print a
 * different one than the check used, and then the message contradicts the
 * refusal it explains (must[0]).
 */
export class ModelSelectionError extends Error {
  /** Routes registered when the selection was refused, in registration order. */
  readonly availableProviders: readonly string[]

  /**
   * @param message - what was wrong with the argument.
   * @param availableProviders - routes registered at the moment of refusal.
   */
  constructor(message: string, availableProviders: readonly string[]) {
    super(availableProviders.length === 0
      ? `${message}; no provider routes are registered in this profile`
      : `${message}; available routes: ${availableProviders.join(', ')}`)
    this.name = 'ModelSelectionError'
    this.availableProviders = [...availableProviders]
  }
}

/**
 * Parse and validate `--model <provider:model>` against the registered routes.
 *
 * Fails closed (must[0]): every rejection throws, and no rejection falls back
 * to a default route. A run that asked for a specific model and silently got
 * another one is the outcome this argument exists to prevent, and it is the
 * outcome a caller could never detect from the output.
 *
 * The model half is deliberately NOT validated. Only the adapter knows which
 * model ids it accepts, and a route that gained a model since this build was
 * written must stay reachable; an unknown model fails at the request with the
 * provider's own message, which says more than a stale local list could.
 * @param raw - the argument as typed, `provider:model`.
 * @param availableProviders - routes with a registered adapter, in registration order.
 * @returns the route and model to run with.
 * @throws ModelSelectionError when the argument is malformed or names an unregistered route.
 */
export function resolveModelSelection(raw: string, availableProviders: readonly string[]): ModelSelection {
  const separator = raw.indexOf(':')
  if (separator === -1) {
    throw new ModelSelectionError(
      `--model "${raw}" must name a route and a model as "<provider>:<model>"`,
      availableProviders,
    )
  }
  // `indexOf` rather than a split: a model id may contain colons (a versioned
  // or namespaced id), and only the FIRST colon separates route from model.
  const provider = raw.slice(0, separator)
  const model = raw.slice(separator + 1)
  if (provider === '' || model === '') {
    throw new ModelSelectionError(
      `--model "${raw}" has an empty ${provider === '' ? 'provider' : 'model'} half`,
      availableProviders,
    )
  }
  if (!availableProviders.includes(provider)) {
    throw new ModelSelectionError(`--model names unregistered route "${provider}"`, availableProviders)
  }
  return { provider, model }
}
