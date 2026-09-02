import { describe, expectTypeOf, it } from 'vitest'
import type { IdentityContext } from '@deepseek-ai/dsh-principal/types'
import type { HarnessSdkRequestMap, SessionPromptResult } from '../src/index.ts'

// The params type each client-to-server request method actually carries per
// HarnessSdkRequestMap (`shutdown`'s params is `undefined` — no fields to check).
type ClientInitializeParams = HarnessSdkRequestMap['initialize']['params']
type ClientSessionPromptParams = HarnessSdkRequestMap['session/prompt']['params']

describe('client-to-server request params', () => {
  it('carries no identity field on any client-to-server request param type (BLOCKED-025)', () => {
    expectTypeOf<'identity' extends keyof ClientInitializeParams ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'identity' extends keyof ClientSessionPromptParams ? true : false>().toEqualTypeOf<false>()
  })

  it('leaves SessionPromptResult.identity, the server-sourced field, unaffected', () => {
    expectTypeOf<SessionPromptResult['identity']>().toEqualTypeOf<IdentityContext | undefined>()
  })
})
