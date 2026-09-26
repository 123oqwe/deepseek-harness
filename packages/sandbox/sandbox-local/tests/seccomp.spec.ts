/**
 * The Unix-socket seccomp filter, evaluated instruction by instruction on the
 * input the kernel hands a filter, and the shell trampoline that hands the
 * filter to bwrap on file descriptor 3. The kernel's own verdict is observed by
 * the bwrap end-to-end suites.
 */

import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { seccompTrampoline, unixSocketFilter } from '../src/seccomp.ts'

const ALLOW = 0x7fff0000
const ERRNO_EPERM = 0x00050001
const KILL_PROCESS = 0x80000000
const AF_UNIX = 1n
const AF_INET = 2n
const AF_INET6 = 10n

/** One call as the kernel describes it to a filter: its number, its ABI, and its first argument. */
interface Call {
  readonly nr: number
  readonly arch: number
  readonly arg0?: bigint
}

/**
 * Run a classic-BPF seccomp program the way the kernel does, for the four
 * opcodes the filter uses.
 * @param program - the filter bytes.
 * @param call - the call to judge.
 * @returns the action the program returns.
 */
function evaluate(program: Buffer, call: Call): number {
  const data = Buffer.alloc(64)
  data.writeInt32LE(call.nr, 0)
  data.writeUInt32LE(call.arch, 4)
  data.writeBigUInt64LE(call.arg0 ?? 0n, 16)
  let accumulator = 0
  let pc = 0
  while (pc < program.length / 8) {
    const code = program.readUInt16LE(pc * 8)
    const jt = program.readUInt8(pc * 8 + 2)
    const jf = program.readUInt8(pc * 8 + 3)
    const k = program.readUInt32LE(pc * 8 + 4)
    if (code === 0x20) {
      accumulator = data.readUInt32LE(k)
      pc += 1
    } else if (code === 0x15) {
      pc += 1 + (accumulator === k ? jt : jf)
    } else if (code === 0x35) {
      pc += 1 + (accumulator >= k ? jt : jf)
    } else if (code === 0x06) {
      return k
    } else {
      throw new Error(`unexpected opcode ${String(code)}`)
    }
  }
  throw new Error('the program ran off its end')
}

const ARCHES = [
  { nodeArch: 'x64', audit: 0xc000003e, socket: 41, socketpair: 53, read: 0, foreign: 0x40000003 },
  { nodeArch: 'arm64', audit: 0xc00000b7, socket: 198, socketpair: 199, read: 63, foreign: 0x40000028 },
] as const

describe.each(ARCHES)('the $nodeArch filter', ({ nodeArch, audit, socket, socketpair, read, foreign }) => {
  const program = unixSocketFilter(nodeArch) as Buffer

  it('is a program the kernel accepts: whole instructions, every jump forward and in range, ending in a return', () => {
    expect(program.length % 8).toBe(0)
    const count = program.length / 8
    for (let pc = 0; pc < count; pc += 1) {
      const code = program.readUInt16LE(pc * 8)
      if (code === 0x15 || code === 0x35) {
        expect(pc + 1 + program.readUInt8(pc * 8 + 2)).toBeLessThan(count)
        expect(pc + 1 + program.readUInt8(pc * 8 + 3)).toBeLessThan(count)
      }
    }
    expect(program.readUInt16LE((count - 1) * 8)).toBe(0x06)
  })

  it('refuses socket(AF_UNIX) with EPERM, reading only the int argument\'s low half', () => {
    expect(evaluate(program, { nr: socket, arch: audit, arg0: AF_UNIX })).toBe(ERRNO_EPERM)
    expect(evaluate(program, { nr: socket, arch: audit, arg0: (1n << 32n) | AF_UNIX })).toBe(ERRNO_EPERM)
  })

  it('allows sockets of every other family', () => {
    expect(evaluate(program, { nr: socket, arch: audit, arg0: AF_INET })).toBe(ALLOW)
    expect(evaluate(program, { nr: socket, arch: audit, arg0: AF_INET6 })).toBe(ALLOW)
  })

  it('allows socketpair and ordinary calls, so a command\'s own processes still talk', () => {
    expect(evaluate(program, { nr: socketpair, arch: audit, arg0: AF_UNIX })).toBe(ALLOW)
    expect(evaluate(program, { nr: read, arch: audit })).toBe(ALLOW)
  })

  it.each([425, 426, 427])('refuses io_uring call %i, whose socket operation would bypass the socket rule', (nr) => {
    expect(evaluate(program, { nr, arch: audit })).toBe(ERRNO_EPERM)
  })

  it('kills a call made through the other ABI, which reaches sockets through socketcall', () => {
    expect(evaluate(program, { nr: 102, arch: foreign })).toBe(KILL_PROCESS)
  })
})

describe('the x32 ABI and the architectures without a filter', () => {
  it('kills an x32 call on x86_64, which reports the native audit value', () => {
    const program = unixSocketFilter('x64') as Buffer
    expect(evaluate(program, { nr: 41 | 0x40000000, arch: 0xc000003e, arg0: AF_UNIX })).toBe(KILL_PROCESS)
  })

  it.each(['ia32', 'arm', 'ppc64', 'riscv64', 's390x', 'loong64'])('builds none for %s', (arch) => {
    expect(unixSocketFilter(arch)).toBeUndefined()
  })
})

describe('the trampoline', () => {
  it('passes the filter as one octal-escaped printf format, then the runner argv', () => {
    const argv = seccompTrampoline(Buffer.from([0, 7, 8, 255]), ['bwrap', '--seccomp', '3'])
    expect(argv.slice(0, 4)).toEqual(['/bin/sh', '-c', expect.stringContaining('printf "$1"'), 'dsh-sandbox-seccomp'])
    expect(argv.slice(4)).toEqual(['\\000\\007\\010\\377', 'bwrap', '--seccomp', '3'])
  })

  it('gives the runner the filter bytes on file descriptor 3 and the caller\'s own standard input', () => {
    const filter = unixSocketFilter('x64') as Buffer
    const reader = 'const fs=require("node:fs");process.stdout.write(fs.readFileSync(3).toString("hex")+"|"+fs.readFileSync(0,"utf8"))'
    const argv = seccompTrampoline(filter, [process.execPath, '-e', reader])
    const run = spawnSync(argv[0] as string, argv.slice(1), { input: 'caller stdin', encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(`${filter.toString('hex')}|caller stdin`)
  })
})
