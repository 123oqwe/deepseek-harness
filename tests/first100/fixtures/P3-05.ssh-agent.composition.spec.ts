/**
 * A-483 under P3-05 acceptance[0] (「测试进程不可见、不可 ptrace、不可连接 Docker/SSH socket。」),
 * the SSH-agent half: on the SHIPPED headless profile at its default preset, a
 * bash command run under the shipped local sandbox can still connect to an SSH
 * agent whose socket the host started. The driver also reports the sandbox
 * backend actually selected, which A-476's P3-05 could not read.
 *
 * `beforeAll` starts an `ssh-agent` on the host, adds a throwaway key, and
 * confirms the host itself can reach it; the socket path is passed to the
 * driver. `./loader/p3-05-ssh-agent/driver.ts` has the model run one probe
 * that connects to that socket under the sandbox. Only Linux runs this (it uses
 * `ssh-agent`/`ssh-add`); a host without those tools reports `absent` and the
 * cases note it rather than failing.
 * @module tests/first100/fixtures/P3-05.ssh-agent.composition
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p3-05-ssh-agent/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported. */
interface Report {
  readonly sock: string
  readonly text: string
  readonly backend: string
  readonly enforcement: string | null
}

const onLinux = process.platform === 'linux'

let report: Report | undefined
/** The host's own `ssh-add -l` exit code against the agent, or `absent` when no agent started. */
let hostRc: number | 'absent' = 'absent'
let agentPid: string | undefined
let keyDir: string | undefined

/**
 * Parse `ssh-agent -s` output into its socket path and pid.
 * @param out - the agent's stdout.
 * @returns the pair, or undefined when either is missing.
 */
function parseAgent(out: string): { readonly sock: string; readonly pid: string } | undefined {
  const sock = /SSH_AUTH_SOCK=(?<v>[^;]+);/u.exec(out)?.groups?.v
  const pid = /SSH_AGENT_PID=(?<v>\d+);/u.exec(out)?.groups?.v
  return sock !== undefined && pid !== undefined ? { sock, pid } : undefined
}

beforeAll(async () => {
  if (!onLinux) return
  // The socket lives OUTSIDE /tmp: the shipped workspace-write bwrap profile
  // overlays a fresh tmpfs on /tmp (`sandbox-local/src/profiles.ts:19`), which
  // hides ssh-agent's default /tmp socket by accident. A socket under the home
  // directory is bound read-only into the sandbox through `--ro-bind / /`, so
  // this measures whether the sandbox actually guards the socket rather than
  // whether /tmp happened to be shadowed.
  keyDir = mkdtempSync(join(homedir(), 'a483-'))
  const started = spawnSync('ssh-agent', ['-a', join(keyDir, 'agent.sock'), '-s'], { encoding: 'utf8' })
  const agent = started.status === 0 ? parseAgent(started.stdout) : undefined
  if (agent === undefined) return
  agentPid = agent.pid
  const env = { ...process.env, SSH_AUTH_SOCK: agent.sock }
  const keyPath = join(keyDir, 'id_ed25519')
  const keygen = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-f', keyPath], { encoding: 'utf8' })
  if (keygen.status === 0) spawnSync('ssh-add', [keyPath], { env, encoding: 'utf8' })
  hostRc = spawnSync('ssh-add', ['-l'], { env, encoding: 'utf8' }).status ?? 'absent'

  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P3-05 ssh agent',
    tempDirPrefix: 'p3-05-ssh-agent-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
    env: { A483_SSH_AUTH_SOCK: agent.sock },
  })
  const json = /P3-05-SSH (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

afterAll(() => {
  if (agentPid !== undefined) spawnSync('kill', [agentPid])
  if (keyDir !== undefined) rmSync(keyDir, { recursive: true, force: true })
})

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): Report {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

/**
 * The probe's exit code inside the sandbox: 0/1 connected, 2 could not connect, `absent` when ssh-add is missing.
 * @returns the code as a string.
 */
function sandboxRc(): string {
  return /A483-SSH rc=(?<rc>\w+)/u.exec(reported().text)?.groups?.rc ?? 'missing'
}

describe.skipIf(!onLinux)('P3-05 acceptance[0]: the SSH agent socket under the shipped local sandbox', () => {
  it('control: the host itself can reach the SSH agent it started', () => {
    // 0 has identities, 1 connected but none, 2 could not connect; `absent` = no
    // ssh-agent/ssh-keygen on this host, which is recorded, not failed.
    expect(hostRc === 'absent' || hostRc !== 2, `ssh-add -l exit ${String(hostRc)}`).toBe(true)
  })

  it('reports the sandbox backend actually in force, not null', ({ task }) => {
    // Recorded on the task so a green run still carries the measured values.
    Object.assign(task.meta, { a483: { backend: reported().backend, enforcement: reported().enforcement, hostRc: String(hostRc), sandboxRc: sandboxRc() } })
    expect(['bwrap', 'landlock', 'sandbox-exec', 'none'], JSON.stringify(reported())).toContain(reported().backend)
    expect(reported().backend, JSON.stringify(reported())).not.toBe('none')
  })

  it('the sandboxed command cannot connect to the SSH agent socket', () => {
    // Reachable when ssh-add connected (0 or 1); `absent`/`missing` means it
    // could not even try, recorded rather than a false red.
    const rc = sandboxRc()
    expect({ connected: rc === '0' || rc === '1' }, JSON.stringify(reported())).toEqual({ connected: false })
  })
})
