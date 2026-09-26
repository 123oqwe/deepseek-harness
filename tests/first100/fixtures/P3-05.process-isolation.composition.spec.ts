/**
 * A-476 under P3-05 acceptance[0] (「测试进程不可见、不可 ptrace、不可连接 Docker/SSH socket。」):
 * on the SHIPPED headless profile at its default preset, a bash command run
 * under the shipped local sandbox can neither see nor signal the host process,
 * and cannot connect to the Docker daemon's socket.
 *
 * `./loader/p3-05-process-isolation/driver.ts` runs one probe command naming
 * the host's pid; the cases read the line the probe prints. Signal
 * reachability stands in for ptrace. Which Linux backend ran (bwrap hides
 * processes, landlock does not) is recorded from the result event's
 * `enforcement` field.
 * @module tests/first100/fixtures/P3-05.process-isolation.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p3-05-process-isolation/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The driver's report. */
interface Report {
  readonly hostPid: number
  readonly text: string
  readonly resultEvents: readonly string[]
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P3-05 process isolation',
    tempDirPrefix: 'p3-05-process-isolation-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P3-05-ISOLATION (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The probe's findings and the backend that ran it.
 * @returns what the probe printed, or `null` fields when it printed nothing.
 */
function probe(): { readonly signal: string | null; readonly seen: string | null; readonly docker: string | null; readonly enforcement: string | null } {
  if (report === undefined) throw new Error('the driver reported nothing')
  const line = /A476-PROBE signal=(?<signal>\w+) seen=(?<seen>\w+) docker=(?<docker>\w+)/u.exec(report.text)?.groups
  const enforcement = /\\"enforcement\\":\\"(?<name>[^"\\]+)\\"|"enforcement":"(?<plain>[^"]+)"/u.exec(report.resultEvents.join('\n'))?.groups
  return {
    signal: line?.signal ?? null,
    seen: line?.seen ?? null,
    docker: line?.docker ?? null,
    enforcement: enforcement?.name ?? enforcement?.plain ?? null,
  }
}

describe('P3-05 acceptance[0]: a command under the shipped local sandbox reaches no host process and no Docker socket', () => {
  it('control: the probe runs under the sandbox and reports', () => {
    expect(probe().signal, JSON.stringify(report)).not.toBeNull()
  })

  it('the sandboxed command can neither see nor signal the host process', () => {
    const found = probe()
    expect({ seen: found.seen, signal: found.signal }, JSON.stringify({ ...found, hostPid: report?.hostPid })).toEqual({ seen: 'no', signal: 'no' })
  })

  it('the sandboxed command cannot connect to the Docker daemon socket', () => {
    const found = probe()
    expect({ dockerConnected: found.docker === 'connected' }, JSON.stringify(found)).toEqual({ dockerConnected: false })
  })
})
