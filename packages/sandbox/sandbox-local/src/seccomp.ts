/**
 * The seccomp filter the bwrap backend installs so a confined command cannot
 * open a Unix-domain socket (first100 registry P3-05 must[1] and
 * acceptance[0]; BLOCKED-346).
 *
 * The filter refuses `socket(AF_UNIX, …)` and the three io_uring calls with
 * `EPERM` and allows every other call. `socketpair` is a separate call and
 * pipes are not sockets, so a command's own processes still talk to each other.
 * io_uring is refused because its `IORING_OP_SOCKET` operation (Linux 5.19)
 * creates a socket without the `socket` call. A call made through an ABI other
 * than the host's native one (the 32-bit `int 0x80` and x32 ABIs on x86_64,
 * AArch32 on AArch64) kills the process: those ABIs reach sockets through
 * `socketcall`, whose arguments a filter cannot read.
 *
 * The rule set is the one Anthropic's sandbox-runtime exports with libseccomp;
 * this module assembles the same program itself, as the Agent Note
 * `.agents/notes/implemented/bug-fix/2026-09-26-sandboxed-commands-cannot-open-unix-sockets.md`
 * records.
 *
 * @module @deepseek-ai/dsh-sandbox-local/seccomp
 */

// Instruction encodings from <linux/filter.h> and actions from <linux/seccomp.h>.
const BPF_LD_W_ABS = 0x20
const BPF_JEQ_K = 0x15
const BPF_JGE_K = 0x35
const BPF_RET_K = 0x06
const SECCOMP_RET_KILL_PROCESS = 0x80000000
const SECCOMP_RET_ERRNO = 0x00050000
const SECCOMP_RET_ALLOW = 0x7fff0000
const EPERM = 1
const AF_UNIX = 1

// Offsets into `struct seccomp_data`: the call number, the audit architecture,
// and the low half of the first argument on a little-endian host.
const DATA_NR = 0
const DATA_ARCH = 4
const DATA_ARG0_LOW = 16

/** `io_uring_setup`, `io_uring_enter` and `io_uring_register`, numbered alike on every architecture. */
const IO_URING_CALLS = [425, 426, 427] as const

/** One host architecture the filter is built for. */
interface FilterArch {
  /** The `AUDIT_ARCH_*` value the kernel reports for the native ABI. */
  readonly audit: number
  /** The native `socket` call number. */
  readonly socket: number
  /** Call numbers at or above this belong to another ABI that reports the same audit value (x32 on x86_64). */
  readonly foreignFrom?: number
}

/** The filter's architectures, keyed by Node's `process.arch`; both are little-endian. */
const ARCHES: Readonly<Record<string, FilterArch>> = {
  x64: { audit: 0xc000003e, socket: 41, foreignFrom: 0x40000000 },
  arm64: { audit: 0xc00000b7, socket: 198 },
}

/** Where a conditional jump goes: the next instruction, or one of the program's three closing returns. */
type Target = 'next' | 'allow' | 'deny' | 'kill'

/** One instruction before its jump targets become offsets. */
interface Step {
  readonly code: number
  readonly k: number
  readonly jt?: Target
  readonly jf?: Target
}

/**
 * Encode the steps, then the three returns every jump lands on (allow, deny
 * with `EPERM`, kill the process), as the kernel's `struct sock_filter` array.
 * @param steps - the instructions before the returns, in order.
 * @returns the program bytes.
 */
function assemble(steps: readonly Step[]): Buffer {
  const count = steps.length + 3
  const at = { allow: count - 3, deny: count - 2, kill: count - 1 }
  const program = Buffer.alloc(count * 8)
  const write = (index: number, code: number, jt: number, jf: number, k: number): void => {
    program.writeUInt16LE(code, index * 8)
    program.writeUInt8(jt, index * 8 + 2)
    program.writeUInt8(jf, index * 8 + 3)
    program.writeUInt32LE(k >>> 0, index * 8 + 4)
  }
  steps.forEach((step, index) => {
    const offset = (target: Target | undefined): number => target === undefined || target === 'next' ? 0 : at[target] - index - 1
    write(index, step.code, offset(step.jt), offset(step.jf), step.k)
  })
  write(at.allow, BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW)
  write(at.deny, BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO | EPERM)
  write(at.kill, BPF_RET_K, 0, 0, SECCOMP_RET_KILL_PROCESS)
  return program
}

/**
 * The filter program for one host architecture, in the form bwrap's
 * `--seccomp` option reads.
 * @param nodeArch - the host's `process.arch`.
 * @returns the program, or `undefined` for an architecture it is not built for.
 */
export function unixSocketFilter(nodeArch: string): Buffer | undefined {
  const arch = ARCHES[nodeArch]
  if (arch === undefined) return undefined
  const foreignAbi: Step[] = arch.foreignFrom === undefined ? [] : [{ code: BPF_JGE_K, k: arch.foreignFrom, jt: 'kill', jf: 'next' }]
  const ioUring = IO_URING_CALLS.map((nr): Step => ({ code: BPF_JEQ_K, k: nr, jt: 'deny', jf: 'next' }))
  return assemble([
    { code: BPF_LD_W_ABS, k: DATA_ARCH },
    { code: BPF_JEQ_K, k: arch.audit, jt: 'next', jf: 'kill' },
    { code: BPF_LD_W_ABS, k: DATA_NR },
    ...foreignAbi,
    ...ioUring,
    { code: BPF_JEQ_K, k: arch.socket, jt: 'next', jf: 'allow' },
    { code: BPF_LD_W_ABS, k: DATA_ARG0_LOW },
    { code: BPF_JEQ_K, k: AF_UNIX, jt: 'deny', jf: 'allow' },
  ])
}

/**
 * The POSIX shell script that pipes the filter into the runner on file
 * descriptor 3 and gives the runner the caller's standard input back. The
 * filter never touches the disk, so no later command can replace it.
 */
const TRAMPOLINE = 'exec 4<&0; printf "$1" | { shift; exec "$@" 3<&0 0<&4 4<&-; }'

/**
 * Wrap a bwrap-compatible runner invocation so the runner reads `filter` from
 * file descriptor 3. `runnerArgv` must carry `--seccomp 3` among the runner's
 * options.
 * @param filter - the program from {@link unixSocketFilter}.
 * @param runnerArgv - the runner program, its options and the confined argv.
 * @returns the argv to spawn.
 */
export function seccompTrampoline(filter: Buffer, runnerArgv: readonly string[]): string[] {
  const escaped = [...filter].map(byte => `\\${byte.toString(8).padStart(3, '0')}`).join('')
  return ['/bin/sh', '-c', TRAMPOLINE, 'dsh-sandbox-seccomp', escaped, ...runnerArgv]
}
