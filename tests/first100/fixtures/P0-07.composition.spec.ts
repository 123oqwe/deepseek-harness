/**
 * P0-07 U-stage composition contract: `package.json` wires `pnpm evidence:collect`/
 * `pnpm evidence:verify` to the real P-stage scripts (`scripts/release/collect-evidence.mjs`,
 * `scripts/release/verify-evidence.mjs`), mirroring the established
 * `baseline:capture`/`baseline:verify` npm-script contract in
 * `tests/release/baseline-fingerprint.spec.ts` (P0-01): a fixture `package.json` points
 * the same script names at the real scripts, and `pnpm run` is invoked as a genuine
 * subprocess so a passing test proves pnpm's script resolution, not just a JSON string
 * equality assertion. `docs/testing.md` and `AGENTS.md` document the mechanism and the
 * acceptance[2] reporting convention (cite the evidence package's real path and its
 * `accepted` status when reporting a gate result).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const collectScriptPath = join(repoRoot, 'scripts/release/collect-evidence.mjs')
const verifyScriptPath = join(repoRoot, 'scripts/release/verify-evidence.mjs')
const baselineScriptPath = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
  }).trim()
}

function write(root: string, relPath: string, content: string): void {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

describe('release/evidence-package npm-script contract (Epic P0-07 U-stage)', () => {
  it('wires evidence:collect/evidence:verify in the real package.json to the real P-stage scripts', () => {
    const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(rootPackageJson.scripts?.['evidence:collect']).toBe('node scripts/release/collect-evidence.mjs')
    expect(rootPackageJson.scripts?.['evidence:verify']).toBe('node scripts/release/verify-evidence.mjs')
  })

  it('pnpm run evidence:collect/evidence:verify actually execute the real scripts end-to-end against a throwaway fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-evidence-npm-script-'))
    fixtureRoots.push(root)
    git(root, ['init', '--initial-branch=main'])
    git(root, ['config', 'user.email', 'evidence-npm-script-fixture@example.com'])
    git(root, ['config', 'user.name', 'Evidence NPM Script Fixture'])
    git(root, ['config', 'commit.gpgsign', 'false'])
    write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
    write(root, 'packages/bundle/base/cordis.patch.yml', 'rows:\n  - id: row-alpha\n')
    write(root, 'packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n}\n')
    write(root, 'packages/core/session/src/known-event-types.ts', "export type KnownEventType = 'session.start'\n")
    write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages: {}\n")
    write(
      root,
      'package.json',
      `${JSON.stringify(
        {
          name: '@fixture/root',
          private: true,
          packageManager: 'pnpm@11.7.0',
          scripts: {
            'baseline:capture': `node ${baselineScriptPath} capture`,
            'evidence:collect': `node ${collectScriptPath}`,
            'evidence:verify': `node ${verifyScriptPath}`,
          },
        },
        null,
        2,
      )}\n`,
    )
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'fixture baseline'])
    const baseSha = git(root, ['rev-parse', 'HEAD'])
    // `collect-evidence init` requires a real captured baseline whose gitSha equals the
    // current HEAD, so a real second commit must land, and `baseline:capture` must run,
    // before `init` -- same shape as the P-stage contract's own fixture. Capture runs
    // through `pnpm run` (not a direct node invocation) so pnpm's own first-touch of
    // `pnpm-lock.yaml` (its content settles on pnpm's first invocation in a fresh
    // checkout) happens before the baseline is captured, not after -- otherwise
    // `evidence:collect init`'s own first `pnpm run` would drift the just-captured
    // baseline's `pnpmLockHash`, exactly as `baseline-fingerprint.spec.ts`'s own
    // npm-script contract test captures AND verifies through `pnpm run` for the same
    // reason.
    write(root, 'lib/index.js', "console.log('build output')\n")
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'add build output'])

    const captureResult = spawnSync('pnpm', ['run', 'baseline:capture', '--repo-root', root], { cwd: root, encoding: 'utf8' })
    expect(captureResult.status, `pnpm run baseline:capture stderr: ${captureResult.stderr}`).toBe(0)

    const initResult = spawnSync(
      'pnpm',
      ['run', 'evidence:collect', 'init', '--repo-root', root, '--base-sha', baseSha, '--required-gate', 'smoke'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(initResult.status, `pnpm run evidence:collect init stderr: ${initResult.stderr}`).toBe(0)

    const runResult = spawnSync(
      'pnpm',
      ['run', 'evidence:collect', 'run', '--repo-root', root, '--gate-id', 'smoke', '--required', '--', process.execPath, '-e', "console.log('ok')"],
      { cwd: root, encoding: 'utf8' },
    )
    expect(runResult.status, `pnpm run evidence:collect run stderr: ${runResult.stderr}`).toBe(0)

    const evidencePath = join(root, '.dsh/evidence/evidence.json')
    expect(existsSync(evidencePath), 'pnpm run evidence:collect must write .dsh/evidence/evidence.json').toBe(true)

    const verifyResult = spawnSync(
      'pnpm',
      ['run', 'evidence:verify', '--repo-root', root, '--evidence', '.dsh/evidence/evidence.json'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(verifyResult.status, `pnpm run evidence:verify stderr: ${verifyResult.stderr}`).toBe(0)
  }, 30_000)
})

describe('P0-07 U-stage documentation (release evidence package)', () => {
  it('docs/testing.md documents the pnpm evidence:collect/evidence:verify commands', () => {
    const testingMd = readFileSync(join(repoRoot, 'docs/testing.md'), 'utf8')
    expect(testingMd).toContain('pnpm evidence:collect')
    expect(testingMd).toContain('pnpm evidence:verify')
  })

  it('AGENTS.md states the evidence-gate reporting convention (acceptance[2]: cite package path and accepted status)', () => {
    const agentsMd = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('Evidence-gate reporting')
    expect(agentsMd).toMatch(/`accepted`\s*status/)
  })
})

/** One workflow step, as far as these cases read it. */
interface WorkflowStep {
  readonly name?: string
  readonly run?: string
  readonly uses?: string
  readonly if?: string
  readonly 'continue-on-error'?: unknown
  readonly shell?: string
}

/** A publish workflow, as far as these cases read it. */
interface PublishWorkflow {
  readonly jobs: {
    readonly pack: { readonly steps: readonly WorkflowStep[]; readonly 'continue-on-error'?: unknown }
    readonly publish: { readonly needs: string | readonly string[] }
  }
}

/*
 * Validation[2] (S2) on the real publish paths: a release workflow cannot be
 * triggered from a test, so its structure is read. The evidence package is
 * verified after every step that collects into it and before the upload the
 * publish job waits for, and the verify step runs only the verify command,
 * with no condition and no `continue-on-error` on the step or its job, so a
 * failed verify fails the job.
 */
/** The verify step's whole command: the verify command and one evidence path, nothing after it. */
const VERIFY_COMMAND = /^(?:pnpm run evidence:verify|node scripts\/release\/verify-evidence\.mjs) --evidence \S+$/u

/** The step finder the cases share: the one step that verifies the evidence package. */
const VERIFY_STEP = /evidence:verify --evidence|scripts\/release\/verify-evidence\.mjs --evidence/

/**
 * What would let a failed verify pass its step.
 * @param step - the verify step.
 * @returns one entry per problem; empty when only the verify command decides the step.
 */
function verifyStepProblems(step: WorkflowStep | undefined): string[] {
  const problems: string[] = []
  if (step?.if !== undefined) problems.push('if')
  if (step?.['continue-on-error'] !== undefined) problems.push('continue-on-error')
  // The step's whole command is the verify command: `|| true`, a pipe, a
  // second command or `set +e` would each let a failed verify pass the step.
  if (!VERIFY_COMMAND.test(step?.run?.trim() ?? '')) problems.push('command')
  return problems
}

/** The verify command the release workflows run, as a fragment writes it. */
const VERIFY_RUN = 'pnpm run evidence:verify --evidence .dsh/evidence/evidence.json'

describe('P0-07 validation[2] -- the publish workflows verify the evidence package before they upload it', () => {
  it.each(['release-publish.yml', 'release-vendor-publish.yml', 'node-addon-system-release.yml'])('%s verifies the evidence package in a step that runs only the verify command, after every collect step and before the upload its publish job needs', (file) => {
    const workflow = load(readFileSync(join(repoRoot, '.github/workflows', file), 'utf8')) as PublishWorkflow
    const steps = workflow.jobs.pack.steps
    const verify = steps.findIndex(step => VERIFY_STEP.test(step.run ?? ''))
    expect(verify, `${file}: no step verifies the evidence package`).toBeGreaterThanOrEqual(0)

    const collects = steps.flatMap((step, index) => /collect-evidence\.mjs/.test(step.run ?? '') ? [index] : [])
    expect(collects.length).toBeGreaterThan(0)
    expect(collects.filter(index => index > verify)).toEqual([])
    expect(verifyStepProblems(steps[verify]), `${file}: what would let a failed verify pass the step`).toEqual([])
    expect(workflow.jobs.pack['continue-on-error'], `${file}: the pack job may fail softly`).toBeUndefined()

    const upload = steps.findIndex(step => (step.uses ?? '').startsWith('actions/upload-artifact'))
    expect(upload).toBeGreaterThan(verify)
    expect(steps[upload]?.if).toBeUndefined()
    for (const step of steps.slice(verify + 1, upload)) {
      expect(step.if, `${file}: ${step.name ?? '(unnamed step)'}`).toBe('always()')
      expect(step.run ?? '').not.toMatch(/collect-evidence/)
    }

    const needs = workflow.jobs.publish.needs
    expect(typeof needs === 'string' ? [needs] : needs).toContain('pack')
  })

  it('the verify-step rule accepts a step that runs only the verify command', () => {
    const steps = load(`- run: ${VERIFY_RUN}\n`) as WorkflowStep[]
    expect(verifyStepProblems(steps.find(step => VERIFY_STEP.test(step.run ?? '')))).toEqual([])
  })

  it.each([
    ['||true glued to the path', `- run: ${VERIFY_RUN}||true\n`],
    [';true glued to the path', `- run: ${VERIFY_RUN};true\n`],
    ['|tee glued to the path', `- run: ${VERIFY_RUN}|tee\n`],
    ['& glued to the path', `- run: ${VERIFY_RUN}&\n`],
    ['a shell: override', `- run: ${VERIFY_RUN}\n  shell: bash {0}\n`],
  ])('the verify-step rule refuses a verify step with %s', (_label, fragment) => {
    const steps = load(fragment) as WorkflowStep[]
    const verify = steps.find(step => VERIFY_STEP.test(step.run ?? ''))
    expect(verify, fragment).toBeDefined()
    expect(verifyStepProblems(verify), fragment).not.toEqual([])
  })
})
