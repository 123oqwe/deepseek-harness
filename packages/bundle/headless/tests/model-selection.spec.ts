/**
 * P9-03 Contract — parsing and validating `--model <provider:model>`.
 *
 * must[0] is one sentence with three obligations: parse, check the route
 * exists, and on failure list what does exist — all fail-closed. The obligation
 * most likely to be dropped is the third, because a refusal that merely says
 * "unknown model" still looks correct in a terminal and leaves the user with no
 * next move.
 */
import { describe, expect, it } from 'vitest'

import { ModelSelectionError, resolveModelSelection } from '../src/model-selection.ts'

const ROUTES = ['deepseek', 'mock']

describe('P9-03 Contract — --model resolution', () => {
  it('must[0]: splits a registered route from its model', () => {
    expect(resolveModelSelection('deepseek:deepseek-chat', ROUTES))
      .toStrictEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('must[0]: an unregistered route is refused AND the refusal names the routes that exist', () => {
    expect(() => resolveModelSelection('openai:gpt-4', ROUTES))
      .toThrow('--model names unregistered route "openai"; available routes: deepseek, mock')
  })

  it('must[0]: a missing separator is refused, because a bare model id names no adapter', () => {
    expect(() => resolveModelSelection('deepseek-chat', ROUTES))
      .toThrow('--model "deepseek-chat" must name a route and a model as "<provider>:<model>"')
  })

  it('an empty half is refused by the half that is empty, so the message says which one', () => {
    expect(() => resolveModelSelection(':deepseek-chat', ROUTES)).toThrow('has an empty provider half')
    expect(() => resolveModelSelection('deepseek:', ROUTES)).toThrow('has an empty model half')
  })

  it('only the FIRST colon separates: a model id may carry its own colons', () => {
    expect(resolveModelSelection('mock:vendor:model:v2', ROUTES))
      .toStrictEqual({ provider: 'mock', model: 'vendor:model:v2' })
  })

  it('the model half is NOT checked against a local list, so a route keeps its new models reachable', () => {
    expect(resolveModelSelection('mock:a-model-this-build-has-never-heard-of', ROUTES).model)
      .toBe('a-model-this-build-has-never-heard-of')
  })

  it('a profile with no registered route says so, instead of printing an empty list', () => {
    expect(() => resolveModelSelection('deepseek:deepseek-chat', []))
      .toThrow('no provider routes are registered in this profile')
  })

  it('the failure CARRIES the routes, so a caller cannot print a list different from the one checked', () => {
    try {
      resolveModelSelection('openai:gpt-4', ROUTES)
      expect.unreachable('an unregistered route must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ModelSelectionError)
      expect((error as ModelSelectionError).availableProviders).toStrictEqual(ROUTES)
    }
  })

  it('the carried list is detached: mutating the caller\'s array cannot rewrite a recorded failure', () => {
    const routes = ['mock']
    const error = new ModelSelectionError('probe', routes)
    routes.push('added-after')
    expect(error.availableProviders).toStrictEqual(['mock'])
  })
})
