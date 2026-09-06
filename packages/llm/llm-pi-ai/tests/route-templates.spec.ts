/**
 * P9-02 Contract — route templates that fail closed and never hold a key.
 *
 * The route engine already accepts every field a custom route needs, so what is
 * under test here is not "can pi-ai serve a gateway" but the two obligations a
 * starting point carries: must[1] — a refusal names the field at fault — and
 * must[2] — a key reaches a route only through the credential path, never as a
 * value a template writes into a settings file.
 */
import { describe, expect, it } from 'vitest'

import { resolveProfiles } from '../src/config.ts'
import {
  DEFAULT_TEMPLATE_TIMEOUT_MS,
  instantiateTemplate,
  isRouteTemplateName,
  ROUTE_TEMPLATE_NAMES,
  RouteTemplateError,
} from '../src/templates.ts'

const VALID = { baseURL: 'https://gateway.example/v1', model: 'some-model', apiKeyEnv: 'GATEWAY_KEY' }

describe('P9-02 Contract — route templates', () => {
  it('must[0]: each protocol template carries protocol, endpoint, model, credential ref, and timeout', () => {
    for (const name of ROUTE_TEMPLATE_NAMES) {
      const profile = instantiateTemplate(name, VALID)
      expect(profile.api).toBe(name)
      expect(profile.baseURL).toBe(VALID.baseURL)
      expect(profile.models).toStrictEqual([{ id: 'some-model' }])
      expect(profile.apiKeyEnv).toBe('GATEWAY_KEY')
      expect(profile.timeoutMs).toBe(DEFAULT_TEMPLATE_TIMEOUT_MS)
    }
  })

  it('must[0]: all three protocol families have a template, and they are distinct', () => {
    const protocols = ROUTE_TEMPLATE_NAMES.map(name => instantiateTemplate(name, VALID).api)
    expect(new Set(protocols).size).toBe(ROUTE_TEMPLATE_NAMES.length)
    expect(protocols).toContain('openai-completions')
    expect(protocols).toContain('openai-responses')
    expect(protocols).toContain('anthropic-messages')
  })

  it('must[2]: a key pasted where the variable NAME goes is refused', () => {
    expect(() => instantiateTemplate('openai-completions', { ...VALID, apiKeyEnv: 'sk-live-abc123' }))
      .toThrow('must be an environment variable NAME, not a key value')
  })

  it('must[2]: the refusal does NOT echo the suspected key back into a log or a bug report', () => {
    // Captured rather than asserted inside the catch: `expect.unreachable()`
    // throws, and a catch that also inspects it would swallow the very failure
    // that says "this did not throw at all" — the assertion would then hold for
    // an implementation with no check in it.
    const thrown = (() => {
      try {
        instantiateTemplate('openai-completions', { ...VALID, apiKeyEnv: 'sk-live-secret-value' })
        return undefined
      } catch (error) { return error as Error }
    })()
    expect(thrown).toBeInstanceOf(RouteTemplateError)
    expect(thrown?.message).not.toContain('secret-value')
  })

  it('must[2]: a template never carries an inline key field of any kind', () => {
    const profile = instantiateTemplate('anthropic-messages', VALID)
    expect(JSON.stringify(profile)).not.toContain('apiKey"')
    expect(Object.keys(profile)).not.toContain('apiKey')
  })

  it('must[1]: a missing endpoint names baseURL rather than failing later on a request', () => {
    const error = (() => {
      try {
        instantiateTemplate('openai-completions', { ...VALID, baseURL: '' })
        return undefined
      } catch (thrown) { return thrown as RouteTemplateError }
    })()
    expect(error).toBeInstanceOf(RouteTemplateError)
    expect(error?.field).toBe('baseURL')
  })

  it('must[1]: a malformed URL is refused, and so is one with a protocol nothing can call', () => {
    expect(() => instantiateTemplate('openai-completions', { ...VALID, baseURL: 'not a url' }))
      .toThrow('is not a URL')
    expect(() => instantiateTemplate('openai-completions', { ...VALID, baseURL: 'ftp://gateway.example' }))
      .toThrow('must be http or https')
  })

  it('must[1]: an empty model and a non-positive timeout each name their own field', () => {
    expect(() => instantiateTemplate('openai-responses', { ...VALID, model: '  ' })).toThrow('model is required')
    expect(() => instantiateTemplate('openai-responses', { ...VALID, timeoutMs: 0 }))
      .toThrow('timeoutMs must be a positive whole number')
    expect(() => instantiateTemplate('openai-responses', { ...VALID, timeoutMs: 1.5 }))
      .toThrow('timeoutMs must be a positive whole number')
  })

  it('an explicit timeout overrides the default rather than being ignored', () => {
    expect(instantiateTemplate('openai-completions', { ...VALID, timeoutMs: 5_000 }).timeoutMs).toBe(5_000)
  })

  it('must[5]: a template ranks nothing and defaults no route — selection stays the router\'s', () => {
    const profile = instantiateTemplate('openai-completions', VALID)
    // No priority, weight, or default marker: a template that carried one would
    // be making the Model Router's decision (P5-02) early and invisibly.
    const keys = Object.keys(profile)
    expect(keys).not.toContain('priority')
    expect(keys).not.toContain('default')
    expect(keys).not.toContain('weight')
  })

  it('an unknown template name is not a template name', () => {
    expect(isRouteTemplateName('openai-completions')).toBe(true)
    expect(isRouteTemplateName('bedrock')).toBe(false)
  })
})

/**
 * P9-02 Provider — a template's output is a route the real config layer accepts.
 *
 * The Contract cases check the SHAPE this module produces, and a shape can be
 * internally consistent and still be rejected by the resolver that has to
 * consume it. These run the profile through `resolveProfiles`, the one explicit
 * resolve step, so "the template works" means the product's own validator said
 * so rather than that two of my own functions agreed with each other.
 */
describe('P9-02 Provider — templates resolve through the real config layer', () => {
  it('acceptance[0]: a settings fragment built from a template resolves to a usable route', () => {
    for (const name of ROUTE_TEMPLATE_NAMES) {
      const resolved = resolveProfiles({ [`gw-${name}`]: instantiateTemplate(name, VALID) })
      const route = resolved.get(`gw-${name}`)
      expect(route).toBeDefined()
      expect(route?.baseURL).toBe(VALID.baseURL)
    }
  })

  it('acceptance[2]: no configured route at all is the dormant posture, not an error', () => {
    // The route a user has not written yet must not break the mount, which is
    // what makes "add one settings fragment" a safe thing to try.
    expect(resolveProfiles(undefined).size).toBe(0)
    expect(resolveProfiles({}).size).toBe(0)
  })

  it('acceptance[2]: a template route resolves alongside a hand-written route without disturbing it', () => {
    // The neighbour is written by hand rather than from a template, because a
    // second template route would only prove templates coexist with each other.
    const existing = {
      api: 'openai-completions',
      baseURL: 'https://existing.example/v1',
      models: [{ id: 'existing-model' }],
    }
    const resolved = resolveProfiles({ existing, 'my-gateway': instantiateTemplate('openai-completions', VALID) })
    expect(resolved.size).toBe(2)
    // The pre-existing route keeps its own endpoint: adding a template route
    // must not rewrite what was already configured.
    expect(resolved.get('existing')?.baseURL).toBe('https://existing.example/v1')
    expect(resolved.get('my-gateway')?.baseURL).toBe(VALID.baseURL)
  })

  it('the credential stays a REFERENCE through resolution, never a materialized value', () => {
    const route = resolveProfiles({ gw: instantiateTemplate('openai-completions', VALID) }).get('gw')
    expect(route?.apiKeyEnv).toBe('GATEWAY_KEY')
    expect(JSON.stringify(route)).not.toContain('sk-')
  })
})
