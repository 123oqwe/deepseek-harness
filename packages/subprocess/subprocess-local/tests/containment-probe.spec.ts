/**
 * What containment mode this runner actually selects, recorded where a run's
 * own artifact can be read.
 *
 * This is an observation, not a gate. Two green gate runs showed no fallback
 * warning, and that reading has two explanations which cannot be told apart
 * from outside: the runner selected `linux-scope`, or nothing was ever
 * probed. `linux-scope.spec.ts` mocks `node:child_process` for the whole
 * file, and both probes are `spawnSync` calls, so its probe cases answer the
 * mock — which leaves this file as the only place the question gets a real
 * answer.
 *
 * The answer travels in the case's NAME, because a name reaches
 * `vitest-report.json`, which the workflow uploads and signs. A console line
 * carries the same reading for a reader with the raw log, but nothing depends
 * on whether the reporter forwards it.
 *
 * Nothing here may turn a platform's own answer into a red run: the
 * assertions are that the selection is one of the three modes, and that a
 * fallback says so.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { probeLinuxManager, probeLinuxNative } from '../src/linux-scope.ts'
import { probeWindowsJob } from '../src/windows-job.ts'

/** The selection this runtime makes, reached the way the spawn paths reach it. */
type SelectContainmentMode = (kind: 'ordinary' | 'terminal') => 'linux-scope' | 'windows-job' | 'fallback'

/** The part of the fallback warning that does not change with the platform's own reason. */
const FALLBACK_WARNING = 'using weaker process-tree containment'

/** What one real selection on this runner answered. */
interface Observation {
  readonly mode: 'linux-scope' | 'windows-job' | 'fallback'
  readonly linuxNative: string
  readonly linuxManager: string
  readonly windowsJob: string
  readonly warnings: readonly string[]
}

/**
 * Mount the runtime and make one real selection.
 *
 * Nothing is mocked and `internals.platform` is left alone, so the probes run
 * against this runner. The logger is collected rather than silenced: the
 * fallback warning is half of what is being observed.
 * @returns the mode selected, what each applicable probe answered, and every warning the mount and selection produced.
 */
async function observe(): Promise<Observation> {
  const context = new Context()
  const warnings: string[] = []
  vi.spyOn(context.logger, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(argument => String(argument)).join(' '))
  })
  const fiber = await context.plugin(LocalSubprocessRuntime)
  try {
    const runtime = context.subprocess as InstanceType<typeof LocalSubprocessRuntime>
    const select = (runtime as unknown as { selectContainmentMode: SelectContainmentMode }).selectContainmentMode.bind(runtime)
    const mode = select('ordinary')
    return {
      mode,
      // Asked again by name so the record says WHICH prerequisite decided it,
      // not only what was decided. A probe that does not apply to this
      // platform is not called at all.
      linuxNative: process.platform === 'linux' ? String(probeLinuxNative()) : 'n/a',
      linuxManager: process.platform === 'linux' ? String(probeLinuxManager()) : 'n/a',
      windowsJob: process.platform === 'win32' ? String(probeWindowsJob()) : 'n/a',
      warnings,
    }
  } finally {
    await fiber.dispose()
  }
}

const observed = await observe()

describe('containment mode on this runner', () => {
  it(`selects ${observed.mode} on ${process.platform}: linuxNative=${observed.linuxNative} linuxManager=${observed.linuxManager} windowsJob=${observed.windowsJob} warnings=${String(observed.warnings.length)}`, () => {
    console.log(`[containment-probe] platform=${process.platform} mode=${observed.mode} linuxNative=${observed.linuxNative} `
      + `linuxManager=${observed.linuxManager} windowsJob=${observed.windowsJob} warnings=${String(observed.warnings.length)}`)
    for (const warning of observed.warnings) console.log(`[containment-probe] warning: ${warning}`)

    expect(['linux-scope', 'windows-job', 'fallback']).toContain(observed.mode)
    const fellBack = observed.warnings.filter(warning => warning.includes(FALLBACK_WARNING))
    // Only the fallback warning is judged: an unrelated warning from the mount
    // is not this observation's business, and treating one as a failure would
    // make a diagnostic able to redden a run.
    if (observed.mode === 'fallback') expect(fellBack.length).toBeGreaterThan(0)
    else expect(fellBack).toStrictEqual([])
  })
})
