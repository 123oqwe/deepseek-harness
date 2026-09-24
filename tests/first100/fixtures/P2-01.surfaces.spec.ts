/**
 * Epic P2-01 acceptance[0], S7 tripwire: the shipped profile templates are
 * exactly the five that a host-user attribution case launches.
 *
 * This case does not test the clause's subject. It observes no action, no
 * identity and no session log; it compares the keys of `PROFILE_TEMPLATES`
 * (`packages/boot/app-boot/src/profile.ts:122-143`) with the profiles that
 * have a case launching them and reading `identity/attached` from what they
 * wrote. A sixth shipped template would have no such case, and this is where
 * that shows: the failure message names each covered profile's case, so the
 * profile missing from that list is the one whose case has to be written.
 * @module tests/first100/fixtures/P2-01.surfaces
 */

import { describe, expect, it } from 'vitest'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'

/** Each shipped profile, and the file and title of the case that launches it and reads its attribution. */
const ATTRIBUTION_CASES: Readonly<Record<string, string>> = {
  acp: 'apps/cli/tests/profiles/acp/tests/acp.e2e.ts: P2-01 acceptance[0]: a launched acp session acts as the host user, attached once',
  headless: 'apps/cli/tests/profiles/headless/tests/host-user.e2e.ts: P2-01 acceptance[0]: a launched headless run acts as the host user, attached once',
  sdk: 'apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts: P2-01 acceptance[0]: a launched sdk session acts as the host user, attached once',
  'sdk-minimal': 'apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts: P2-01 acceptance[0]: a launched sdk-minimal session acts as the host user, attached once',
  web: 'apps/cli/tests/profiles/web/tests/host-user.e2e.ts: P2-01 acceptance[0]: a web session created through the session controller acts as the host user, attached once',
}

describe('P2-01 surfaces: the shipped profile templates', () => {
  it('P2-01 acceptance[0]: every shipped profile template has a host-user attribution case', () => {
    const covered = Object.entries(ATTRIBUTION_CASES).map(([profile, title]) => `  ${profile}: ${title}`).join('\n')
    expect(
      Object.keys(PROFILE_TEMPLATES).sort(),
      `every shipped profile template needs a case that launches it and reads its identity/attached record; the covered templates are:\n${covered}`,
    ).toEqual(['acp', 'headless', 'sdk', 'sdk-minimal', 'web'])
  })
})
