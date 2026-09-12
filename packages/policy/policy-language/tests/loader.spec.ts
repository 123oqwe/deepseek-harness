/**
 * REAL-composition tier (packages/AGENTS.md) for Epic P2-10's Provider stage:
 * boot a real settings provider over a real document through the same app/boot
 * path a deployment uses, and observe what the policy namespace does when the
 * document is good, when it goes bad under a running harness, and when it is
 * already bad at start.
 *
 * These three are the whole of validation[2], and NONE of the behaviour is this
 * package's: `@deepseek-ai/dsh-settings` refuses a registration whose stored
 * section its owner cannot serve, and keeps a namespace's last good value when
 * a later document fails. This package contributes only the function that says
 * no. Observing it through a hand-built context would let the fixture supply
 * the answer it is checking.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

const processTimeoutMs = 60_000

interface PolicyLoaderReport {
  registered: string[]
  atBootIds: string[]
  afterBadEditIds: string[]
  afterGoodEditIds: string[]
  atBootPin?: string
  afterBadEditPin?: string
  afterGoodEditPin?: string
  afterWritePin?: string
  documentText: string
}

/** A document whose policy set this deployment accepts. */
const GOOD_DOCUMENT = [
  'policy-set:',
  '  policies:',
  '    baseline-permit: \'permit(principal, action, resource);\'',
  '',
].join('\n')

describe('P2-10 P: the policy set is a settings namespace, through a real boot', () => {
  it('registers the namespace, then keeps the last accepted set when the document goes bad and recovers when it is fixed', async () => {
    let report: PolicyLoaderReport | undefined
    const { stderr } = await runLoaderSmoke({
      label: 'policy-language loader smoke',
      tempDirPrefix: 'p2-10-policy-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      processTimeoutMs,
      prepare: async (cwd) => {
        await writeFile(join(cwd, 'settings.yaml'), GOOD_DOCUMENT, 'utf8')
      },
      inspect: async (cwd) => {
        report = JSON.parse(await readFile(join(cwd, 'policy-loader-report.json'), 'utf8')) as PolicyLoaderReport
      },
    })

    expect(stderr).not.toContain('UNHANDLED')
    expect(report?.registered).toContain('policy-set')
    expect(report?.atBootIds).toEqual(['baseline-permit'])
    // The bad edit names `context.tyop`, which no policy request carries. The
    // namespace keeps what it had rather than taking a set whose rule could
    // never match — and it is the previously ACCEPTED set that stays, not an
    // empty one, which is the difference between failing closed and failing off.
    expect(report?.afterBadEditIds).toEqual(['baseline-permit'])
    // Keeping the last good value is not latching: a document that becomes
    // acceptable again is taken.
    expect(report?.afterGoodEditIds).toEqual(['recovered'])
  }, processTimeoutMs + 15_000)

  it('carries the pin on the namespace value, so a reload that changed the set is visible as a changed pin', async () => {
    // The pin is read from the NAMESPACE at each step rather than from a return
    // value. That is the difference the Provider stage exists to make: a
    // consumer comparing two calls of `acceptPolicySet` would be comparing two
    // things it computed itself, and could not tell a reload happened at all.
    let report: PolicyLoaderReport | undefined
    await runLoaderSmoke({
      label: 'policy-language loader smoke (pin)',
      tempDirPrefix: 'p2-10-policy-loader-pin-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      processTimeoutMs,
      prepare: async (cwd) => {
        await writeFile(join(cwd, 'settings.yaml'), GOOD_DOCUMENT, 'utf8')
      },
      inspect: async (cwd) => {
        report = JSON.parse(await readFile(join(cwd, 'policy-loader-report.json'), 'utf8')) as PolicyLoaderReport
      },
    })

    expect(report?.atBootPin).toMatch(/^[0-9a-f]{64}$/)
    // The refused reload moved neither the set nor its pin — the pin is the
    // set's, not the document's, so a document that failed to be accepted
    // leaves it exactly where it was.
    expect(report?.afterBadEditPin).toBe(report?.atBootPin)
    // The accepted reload moved it, which is the whole point of carrying it.
    expect(report?.afterGoodEditPin).toMatch(/^[0-9a-f]{64}$/)
    expect(report?.afterGoodEditPin).not.toBe(report?.atBootPin)
    // A write THROUGH the service resolves to a new pin, which is the same
    // observation as the reload above reached by the other path.
    expect(report?.afterWritePin).toMatch(/^[0-9a-f]{64}$/)
    expect(report?.afterWritePin).not.toBe(report?.afterGoodEditPin)
    // The write reached the document. There is deliberately no assertion that
    // the document lacks a `pin`: `settings` persists the user section, so no
    // schema choice here could put one there, and a case that cannot fail is
    // worse than no case. The measurement behind that claim is recorded at
    // `policySetSchema`.
    expect(report?.documentText).toContain('written')
  }, processTimeoutMs + 15_000)

  it('refuses the boot outright when the stored policy set is already unacceptable', async () => {
    // The other direction of the same contract, and the reason the case above
    // is not the whole of validation[2]: at start there is no last good value
    // to keep, so a set the owner cannot serve fails the registration rather
    // than mounting a harness over a policy set it rejected.
    await expect(runLoaderSmoke({
      label: 'policy-language loader smoke (bad at boot)',
      tempDirPrefix: 'p2-10-policy-loader-bad-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      processTimeoutMs,
      prepare: async (cwd) => {
        await writeFile(join(cwd, 'settings.yaml'), [
          'policy-set:',
          '  policies:',
          '    typo: \'permit(principal, action, resource) when { context.tyop == 1 };\'',
          '',
        ].join('\n'), 'utf8')
      },
    // Matched on the refusal, not on "the process exited nonzero": a boot that
    // died for a missing file or a bad config path would satisfy the weaker
    // assertion and prove nothing about the policy set.
    })).rejects.toThrow(/policy set refused \(unknown-context-key\): typo: reads context\.tyop/)
  }, processTimeoutMs + 15_000)
})
