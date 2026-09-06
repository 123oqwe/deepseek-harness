/**
 * Ready-to-paste route templates, one per wire protocol (Epic P9-02).
 *
 * The route engine already ships: `PiAiProviderProfile` accepts every field a
 * custom route needs, and the config schema already validates them. What is
 * missing is the starting point — a user adding an OpenAI-compatible gateway
 * has to know which of ~20 optional fields are the required ones, and the
 * schema can only tell them after they have guessed.
 *
 * So this is deliberately thin: named skeletons naming exactly the fields
 * must[0] requires — protocol, endpoint, model, credential reference, timeout —
 * and nothing else. Every remaining field keeps the behaviour it already has.
 *
 * **A template never carries a key.** `apiKeyEnv` names the environment
 * variable a key is read from, and {@link instantiateTemplate} refuses a
 * literal secret rather than passing it through to a profile that would be
 * written back to a settings file (must[2]).
 *
 * **A template is an option, not a choice.** Nothing here selects a route for a
 * request; that is the Model Router's decision (P5-02), and a template that
 * ranked or defaulted itself would be making it early and invisibly (must[5]).
 *
 * @module @deepseek-ai/dsh-llm-pi-ai/templates
 */

import type { PiAiProviderProfile } from './config.ts'

/** A route template's name, as a user names it when asking for one. */
export type RouteTemplateName = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

/** What a caller must supply for a template to become a usable route. */
export interface RouteTemplateInputs {
  /** The gateway's base URL. */
  readonly baseURL: string
  /** One model id this gateway serves. */
  readonly model: string
  /** The environment variable holding the key; never the key itself. */
  readonly apiKeyEnv: string
  /** Request timeout in milliseconds; the template's default when absent. */
  readonly timeoutMs?: number
}

/**
 * A template refused before it became a route.
 *
 * Carries the field at fault, because must[1] asks for a message that names it:
 * "invalid provider configuration" sends a user back to a page of optional
 * fields with no way to tell which one they got wrong.
 */
export class RouteTemplateError extends Error {
  /** The input field the refusal is about. */
  readonly field: string

  /**
   * @param field - the offending input field.
   * @param detail - what is wrong with it.
   */
  constructor(field: string, detail: string) {
    super(`llm-pi-ai route template: ${field} ${detail}`)
    this.name = 'RouteTemplateError'
    this.field = field
  }
}

/**
 * The default request timeout a template applies.
 *
 * A template that set none would leave a new route on whatever the transport
 * defaults to, which differs per protocol — the one place a starting point is
 * least useful is the one where behaviour varies by which template you picked.
 */
export const DEFAULT_TEMPLATE_TIMEOUT_MS = 120_000

/** Each template's protocol, keyed by the name a user asks for. */
const TEMPLATE_PROTOCOL: Record<RouteTemplateName, string> = {
  'openai-completions': 'openai-completions',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic-messages',
}

/** Every template name, in the order a listing shows them. */
export const ROUTE_TEMPLATE_NAMES: readonly RouteTemplateName[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
]

/**
 * Whether `value` names a template.
 * @param value - the raw name.
 * @returns whether a template exists for it.
 */
export function isRouteTemplateName(value: string): value is RouteTemplateName {
  return (ROUTE_TEMPLATE_NAMES as readonly string[]).includes(value)
}

/**
 * Anything that looks like a secret rather than a variable name.
 *
 * Deliberately a shape test rather than a vendor-prefix list: a check that knew
 * `sk-` would pass every other vendor's key format, and the point is to refuse
 * the CLASS of mistake — pasting the key where the variable name goes — not to
 * recognize particular issuers.
 * @param apiKeyEnv - the supplied value.
 * @returns whether it cannot be an environment variable name.
 */
function looksLikeALiteralKey(apiKeyEnv: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)
}

/**
 * Build one route profile from a template (must[0], must[1], must[2]).
 *
 * Fails closed: every rejection throws with the offending field named, and no
 * rejection produces a partial profile. A route that mounted with a missing
 * endpoint would fail later, on a request, in a place that says nothing about
 * the configuration that caused it.
 * @param name - which template.
 * @param inputs - the values only the deployment knows.
 * @returns a profile ready to place under a `providers` key.
 * @throws RouteTemplateError when an input is missing, empty, or malformed.
 */
export function instantiateTemplate(name: RouteTemplateName, inputs: RouteTemplateInputs): PiAiProviderProfile {
  if (inputs.baseURL.trim() === '') throw new RouteTemplateError('baseURL', 'is required')
  let parsed: URL
  try {
    parsed = new URL(inputs.baseURL)
  } catch {
    throw new RouteTemplateError('baseURL', `is not a URL: ${JSON.stringify(inputs.baseURL)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RouteTemplateError('baseURL', `must be http or https, got ${JSON.stringify(parsed.protocol)}`)
  }
  if (inputs.model.trim() === '') throw new RouteTemplateError('model', 'is required')
  if (inputs.apiKeyEnv.trim() === '') throw new RouteTemplateError('apiKeyEnv', 'is required')
  if (looksLikeALiteralKey(inputs.apiKeyEnv)) {
    // The value is NOT echoed: if this really is a key, repeating it in an
    // error puts it in a terminal, a log, and a bug report.
    throw new RouteTemplateError('apiKeyEnv', 'must be an environment variable NAME, not a key value')
  }
  const timeoutMs = inputs.timeoutMs ?? DEFAULT_TEMPLATE_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RouteTemplateError('timeoutMs', 'must be a positive whole number of milliseconds')
  }
  return {
    api: TEMPLATE_PROTOCOL[name],
    baseURL: inputs.baseURL,
    apiKeyEnv: inputs.apiKeyEnv,
    models: [{ id: inputs.model }],
    timeoutMs,
  }
}
