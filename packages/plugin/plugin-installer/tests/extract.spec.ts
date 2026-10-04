/**
 * The P1-04 security core refuses (does not strip) each unsafe tarball entry —
 * path traversal, absolute path, symlink, hardlink, and an over-limit
 * decompression — and extracts a benign package into a quarantine without
 * touching anything else.
 * @module @deepseek-ai/dsh-plugin-installer/tests/extract
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { extractQuarantined, inspectTarball } from '../src/index.ts'
import type { UnpackPolicy } from '../src/index.ts'

const POLICY: UnpackPolicy = { maxTotalBytes: 1024 * 1024, maxEntries: 100 }

interface TarEntry {
  readonly name: string
  /** ustar typeflag: '0' file, '1' hardlink, '2' symlink, '5' directory. */
  readonly type: '0' | '1' | '2' | '5'
  readonly data?: Uint8Array
  readonly linkname?: string
}

function writeStr(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) buf[offset + i] = text.charCodeAt(i)
}

/** An octal field: `len - 1` zero-padded octal digits then a NUL. */
function writeOctal(buf: Uint8Array, offset: number, value: number, len: number): void {
  writeStr(buf, offset, value.toString(8).padStart(len - 1, '0'))
}

function header(entry: TarEntry): Uint8Array {
  const h = new Uint8Array(512)
  writeStr(h, 0, entry.name)
  writeOctal(h, 100, 0o644, 8)
  writeOctal(h, 108, 0, 8)
  writeOctal(h, 116, 0, 8)
  writeOctal(h, 124, entry.data?.length ?? 0, 12)
  writeOctal(h, 136, 0, 12)
  writeStr(h, 156, entry.type)
  if (entry.linkname !== undefined) writeStr(h, 157, entry.linkname)
  writeStr(h, 257, 'ustar\0')
  writeStr(h, 263, '00')
  // Checksum: the field is spaces while summing, then 6 octal digits + NUL + space.
  for (let i = 148; i < 156; i += 1) h[i] = 0x20
  let sum = 0
  for (const byte of h) sum += byte
  writeStr(h, 148, sum.toString(8).padStart(6, '0'))
  h[154] = 0
  h[155] = 0x20
  return h
}

/** Build a gzipped tar (`.tgz`) from the given entries, with the two zero end-blocks. */
function makeTgz(entries: readonly TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = []
  for (const entry of entries) {
    blocks.push(header(entry))
    const data = entry.data ?? new Uint8Array(0)
    if (data.length > 0) {
      const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
      padded.set(data)
      blocks.push(padded)
    }
  }
  blocks.push(new Uint8Array(1024))
  const total = blocks.reduce((n, b) => n + b.length, 0)
  const tar = new Uint8Array(total)
  let at = 0
  for (const b of blocks) { tar.set(b, at); at += b.length }
  return gzipSync(tar)
}

const dirs: string[] = []
async function tgzFile(entries: readonly TarEntry[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-test-'))
  dirs.push(dir)
  const path = join(dir, 'package.tgz')
  await writeFile(path, makeTgz(entries))
  return path
}

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true })
})

describe('P1-04 security core: an unsafe tarball entry is refused, not stripped', () => {
  it('refuses a path-traversal entry', async () => {
    const path = await tgzFile([{ name: 'package/../../evil', type: '0' }])
    await expect(inspectTarball(path, POLICY)).rejects.toMatchObject({ code: 'MALICIOUS_PACKAGE', threat: 'path-traversal' })
  })

  it('refuses an absolute-path entry', async () => {
    const path = await tgzFile([{ name: '/etc/evil', type: '0' }])
    await expect(inspectTarball(path, POLICY)).rejects.toMatchObject({ code: 'MALICIOUS_PACKAGE', threat: 'absolute-path' })
  })

  it('refuses a symlink entry', async () => {
    const path = await tgzFile([{ name: 'package/link', type: '2', linkname: '/etc/passwd' }])
    await expect(inspectTarball(path, POLICY)).rejects.toMatchObject({ code: 'MALICIOUS_PACKAGE', threat: 'symlink' })
  })

  it('refuses a hardlink entry', async () => {
    const path = await tgzFile([{ name: 'package/hl', type: '1', linkname: 'package/other' }])
    await expect(inspectTarball(path, POLICY)).rejects.toMatchObject({ code: 'MALICIOUS_PACKAGE', threat: 'hardlink' })
  })

  it('refuses an archive whose declared size exceeds the bomb limit', async () => {
    const path = await tgzFile([{ name: 'package/big', type: '0', data: new Uint8Array(2 * 1024 * 1024) }])
    await expect(inspectTarball(path, POLICY)).rejects.toMatchObject({ code: 'MALICIOUS_PACKAGE', threat: 'decompression-ratio' })
  })

  it('extracts a benign package into a quarantine', async () => {
    const manifest = new TextEncoder().encode('{"name":"ok","version":"1.0.0"}')
    const path = await tgzFile([{ name: 'package/package.json', type: '0', data: manifest }])
    const dir = await extractQuarantined(path, POLICY)
    dirs.push(dir)
    expect(JSON.parse(await readFile(join(dir, 'package/package.json'), 'utf8'))).toMatchObject({ name: 'ok' })
  })
})
