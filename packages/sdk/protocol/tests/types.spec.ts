import { describe, expectTypeOf, it } from 'vitest'
import type { IdentityContext } from '@deepseek-ai/dsh-principal/types'
import type { HarnessSdkRequestMap, SessionPromptResult } from '../src/index.ts'

// The params type each client-to-server request method actually carries per
// HarnessSdkRequestMap (`shutdown`'s params is `undefined` — no fields to check).
type ClientInitializeParams = HarnessSdkRequestMap['initialize']['params']
type ClientSessionPromptParams = HarnessSdkRequestMap['session/prompt']['params']

describe('client-to-server request params', () => {
  // Guard scope: this check is name-scoped, not type-scoped. `'identity' extends
  // keyof ...` detects only a field literally named `identity`; TypeScript's `keyof`
  // inspects key strings, never value types, so a differently-named field carrying
  // the same `IdentityContext` type (e.g. `principalContext: IdentityContext` or
  // `identityRef: IdentityContext`) on either params type would compile cleanly and
  // pass this test undetected. Accepted for this supplement's narrow purpose: it
  // pins BLOCKED-025's grep-verified finding, not a general-purpose anti-smuggling
  // gate, and the codebase's consistent `identity`-naming convention
  // (`SdkIdentityReference.identity`, `SessionPromptResult.identity`, the session
  // log's `identity/attached` event) makes a literally-named `identity` field the
  // realistic reintroduction vector this test actually catches. This name-scoped
  // limitation is tracked as BLOCKED-031 in spec/first100/exec/BLOCKED-QUEUE.md,
  // which requires whichever epic first does real work on P8-07 (or failing that
  // P8-06) to upgrade this guard from name-scoped to type-scoped, with a real
  // mutation-verification proof, as an explicit item on that epic's own Reviewer
  // checklist.
  it('carries no identity field on any client-to-server request param type (BLOCKED-025)', () => {
    expectTypeOf<'identity' extends keyof ClientInitializeParams ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'identity' extends keyof ClientSessionPromptParams ? true : false>().toEqualTypeOf<false>()
  })

  it('leaves SessionPromptResult.identity, the server-sourced field, unaffected', () => {
    expectTypeOf<SessionPromptResult['identity']>().toEqualTypeOf<IdentityContext | undefined>()
  })
})
