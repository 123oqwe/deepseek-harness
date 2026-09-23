/**
 * Whether this runner's user manager both ACCEPTS and ENFORCES the three scope
 * properties a resource ceiling would be spelled with.
 *
 * P3-10.P's first phase turns `systemd-run --user --scope` into a hard limit
 * with `-p TasksMax`, `-p MemoryMax` and `-p CPUQuota`. Acceptance is not the
 * question: a user manager can take the property and exit zero while the
 * matching cgroup controller was never delegated to that level, and the limit
 * then exists only in the unit file. So each dimension is read twice — what
 * the manager answered, and what the scope's own cgroup says from inside it.
 *
 * It cannot be answered by reading documentation, and not at all on a macOS
 * checkout, which is why it is a case that asks the runner rather than a note
 * in a plan.
 *
 * This is an observation, not a gate. Every outcome passes — accepted or not,
 * enforced or not, or a platform where the question does not apply — and the
 * answer travels in the case's name so it reaches the JSON report rather than
 * depending on whether the reporter forwards a console line.
 *
 * The plain scope, with no property, is the control: a rejection says nothing
 * about a property when the scope itself could not start.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

/** What the manager did with the property. */
type Acceptance = 'accepted' | 'rejected' | 'not-applicable'

/**
 * What the scope's own cgroup says the limit is.
 *
 * `foreign-cgroup` and `no-unified-cgroup` are kept apart from `unreadable`
 * because they say something different: the first means the readback happened
 * somewhere other than the scope this probe started — a reading about another
 * cgroup, however well it parsed — and the second means the machine has no
 * unified hierarchy to read at all (cgroup v1 or hybrid), where the whole
 * question is differently shaped.
 */
type Enforcement = 'enforced' | 'not-enforced' | 'unreadable' | 'foreign-cgroup' | 'no-unified-cgroup' | 'not-applicable'

/** One dimension's two readings. */
interface DimensionProbe {
  readonly property: string
  readonly acceptance: Acceptance
  readonly enforcement: Enforcement
  /**
   * The cgroup path the readback actually ran in, from `/proc/self/cgroup`.
   *
   * The instrument's own self-check: a limit read from a path that is not this
   * probe's scope is a reading about something else, and without recording the
   * path nothing in the output could tell the two apart.
   */
  readonly path: string
  /** Whether that path is this probe's own scope, by its unit name. */
  readonly inScope: boolean
  /** The controllers delegated at the scope's own level, verbatim, or why they could not be read. */
  readonly controllers: string
  /** The limit file's content read from inside the scope, or the read's own error. */
  readonly value: string
  /** The manager's first line of diagnostics, empty when it said nothing. */
  readonly diagnostic: string
}

/** Each property, the cgroup file that would carry it, and the value that file shows when the limit is real. */
const DIMENSIONS = [
  { property: 'TasksMax=64', file: 'pids.max', expected: '64' },
  { property: 'MemoryMax=256M', file: 'memory.max', expected: '268435456' },
  { property: 'CPUQuota=50%', file: 'cpu.max', expected: '50000 100000' },
] as const

/**
 * Read one value out of the scope's own cgroup, from inside the scope.
 *
 * `/proc/self/cgroup` names the path the scope actually landed in, which is
 * the only way to read the limit that applies to it: a path guessed from the
 * unit name would be wrong whenever the manager placed the scope elsewhere.
 */
function readbackScript(file: string): string {
  return [
    'p=$(sed -n "s/^0:://p" /proc/self/cgroup)',
    'echo "path=$p"',
    'cat "/sys/fs/cgroup$p/cgroup.controllers" 2>&1 | sed "s/^/controllers=/"',
    `cat "/sys/fs/cgroup$p/${file}" 2>&1 | sed "s/^/value=/"`,
  ].join('; ')
}

/** One line of the readback script's output, without its prefix. */
function field(stdout: string, prefix: string): string {
  const line = stdout.split('\n').find(candidate => candidate.startsWith(`${prefix}=`))
  return line === undefined ? '' : line.slice(prefix.length + 1).trim()
}

/**
 * What one readback says about the limit, in the order the questions stop
 * being answerable: no unified hierarchy to read, a reading from someone
 * else's cgroup, a file that would not open, and only then the value itself.
 * @param path - the cgroup path the readback ran in.
 * @param inScope - whether that path is this probe's own scope.
 * @param value - the limit file's content, or the read's error text.
 * @param expected - the content this property produces when the limit is real.
 * @returns the enforcement reading for this dimension.
 */
function classifyEnforcement(path: string, inScope: boolean, value: string, expected: string): Enforcement {
  if (path === '') return 'no-unified-cgroup'
  if (!inScope) return 'foreign-cgroup'
  if (value === '' || value.startsWith('cat:')) return 'unreadable'
  return value === expected ? 'enforced' : 'not-enforced'
}

/** Run one transient scope carrying `properties`, reading `file` back from inside it. */
function probeScope(properties: readonly string[], file: string, expected: string): Omit<DimensionProbe, 'property'> {
  if (process.platform !== 'linux') {
    return {
      acceptance: 'not-applicable',
      enforcement: 'not-applicable',
      path: '',
      inScope: false,
      controllers: '',
      value: '',
      diagnostic: `platform ${process.platform}`,
    }
  }
  const unit = `dsh-scope-limit-probe-${String(process.pid)}-${randomBytes(6).toString('hex')}`
  const result = spawnSync('systemd-run', [
    '--user',
    '--scope',
    '--quiet',
    '--collect',
    '--expand-environment=no',
    `--unit=${unit}`,
    ...properties.flatMap(value => ['-p', value]),
    '--',
    '/bin/sh',
    '-c',
    readbackScript(file),
  ], { env: { ...process.env, LC_ALL: 'C', SYSTEMD_LOG_TARGET: 'null' }, encoding: 'utf8', timeout: 15_000 })

  const diagnostic = result.error?.message ?? ((result.stderr ?? '').trim().split('\n')[0] ?? '')
  if (result.error !== undefined || result.status !== 0) {
    return { acceptance: 'rejected', enforcement: 'not-applicable', path: '', inScope: false, controllers: '', value: '', diagnostic }
  }
  const stdout = result.stdout ?? ''
  const path = field(stdout, 'path')
  const inScope = path.includes(unit)
  const controllers = field(stdout, 'controllers')
  const value = field(stdout, 'value')
  const enforcement = classifyEnforcement(path, inScope, value, expected)
  return { acceptance: 'accepted', enforcement, path, inScope, controllers, value, diagnostic }
}

const control = probeScope([], 'cgroup.controllers', '')
const probes: DimensionProbe[] = DIMENSIONS.map(dimension => (
  control.acceptance === 'accepted'
    ? { property: dimension.property, ...probeScope([dimension.property], dimension.file, dimension.expected) }
    : {
      property: dimension.property,
      acceptance: control.acceptance,
      enforcement: 'not-applicable',
      path: '',
      inScope: false,
      controllers: '',
      value: '',
      diagnostic: `scope control: ${control.diagnostic}`,
    }
))

const summary = probes
  .map(probe => `${probe.property.split('=')[0] ?? probe.property}=${probe.acceptance}/${probe.enforcement}/${probe.inScope ? 'in-scope' : 'not-in-scope'}`)
  .join(' ')

describe('scope resource properties on this runner', () => {
  it(`user scope on ${process.platform}: control=${control.acceptance} ${summary}`, () => {
    console.log(`[scope-limits-probe] platform=${process.platform} control=${control.acceptance} ${summary}`)
    console.log(`[scope-limits-probe] control path=${control.path || '(none)'} inScope=${String(control.inScope)} controllers=${control.controllers || '(unread)'}`)
    for (const probe of probes) {
      console.log(`[scope-limits-probe] ${probe.property}: path=${probe.path || '(none)'} inScope=${String(probe.inScope)} value=${probe.value || '(unread)'} controllers=${probe.controllers || '(unread)'}`)
      if (probe.diagnostic !== '') console.log(`[scope-limits-probe] ${probe.property}: ${probe.diagnostic}`)
    }

    expect(['accepted', 'rejected', 'not-applicable']).toContain(control.acceptance)
    for (const probe of probes) {
      expect(['accepted', 'rejected', 'not-applicable']).toContain(probe.acceptance)
      expect(['enforced', 'not-enforced', 'unreadable', 'foreign-cgroup', 'no-unified-cgroup', 'not-applicable']).toContain(probe.enforcement)
      // Enforcement is a reading taken inside a scope that started: a property
      // the manager refused cannot also have been observed in the cgroup.
      if (probe.acceptance !== 'accepted') expect(probe.enforcement).not.toBe('enforced')
      // And a limit read somewhere other than this probe's own scope is a
      // reading about another cgroup, whatever value it carried.
      if (!probe.inScope) expect(probe.enforcement).not.toBe('enforced')
    }
    if (control.acceptance !== 'accepted') {
      expect(probes.every(probe => probe.acceptance !== 'accepted')).toBe(true)
    }
  })
})

/**
 * The swap ceiling rides with every memory ceiling (`scopeLimitProperties`
 * pairs `MemoryMax` with `MemorySwapMax=0`), because a ceiling that swap can
 * extend is not a memory ceiling. This reads whether the runner's manager
 * accepts it and whether the scope's own `memory.swap.max` shows 0 from
 * inside, with the same two readings and the same plain-scope control as the
 * three properties above. A separate case, so the titles above are unchanged.
 */
const swap: DimensionProbe = control.acceptance === 'accepted'
  ? { property: 'MemorySwapMax=0', ...probeScope(['MemorySwapMax=0'], 'memory.swap.max', '0') }
  : {
    property: 'MemorySwapMax=0',
    acceptance: control.acceptance,
    enforcement: 'not-applicable',
    path: '',
    inScope: false,
    controllers: '',
    value: '',
    diagnostic: `scope control: ${control.diagnostic}`,
  }

describe('the swap ceiling a memory ceiling carries, on this runner', () => {
  it(`user scope on ${process.platform}: control=${control.acceptance} MemorySwapMax=${swap.acceptance}/${swap.enforcement}/${swap.inScope ? 'in-scope' : 'not-in-scope'}`, () => {
    console.log(`[scope-limits-probe] ${swap.property}: path=${swap.path || '(none)'} inScope=${String(swap.inScope)} value=${swap.value || '(unread)'} controllers=${swap.controllers || '(unread)'}`)
    if (swap.diagnostic !== '') console.log(`[scope-limits-probe] ${swap.property}: ${swap.diagnostic}`)
    expect(['accepted', 'rejected', 'not-applicable']).toContain(swap.acceptance)
    if (swap.acceptance !== 'accepted') expect(swap.enforcement).not.toBe('enforced')
    if (!swap.inScope) expect(swap.enforcement).not.toBe('enforced')
  })
})
