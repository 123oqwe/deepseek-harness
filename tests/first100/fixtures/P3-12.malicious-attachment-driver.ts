/**
 * P3-12 acceptance[1] on the shipped `headless` profile: what the attachment
 * store does with a zip bomb, a polyglot, a file whose bytes contradict the
 * type its name declares, and a malicious document.
 *
 * Run by `runLoaderSmoke` with `[overlayPath]` after the bin. It boots the
 * profile through `bootProductionProfile` over the given test overlay and
 * hands each payload to the mounted store's `saveFile`, the call that commits
 * an uploaded file before any session event refers to it. For each payload it
 * records whether the call returned a reference or threw, the attachment
 * failure code when it threw, and how many files that appeared under the
 * working directory during the call hold the payload's exact bytes
 * (`DSH_HOME` is `<cwd>/.dsh`), and writes `observation.json` there. The
 * payloads are built here, in memory, so no copy of their bytes is on disk
 * before the store is asked.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateRawSync, deflateSync } from 'node:zlib'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { isAttachmentError } from '@deepseek-ai/dsh-attachment'
import { bootProductionProfile } from '../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const [overlayPath] = process.argv.slice(2)
if (overlayPath === undefined) throw new Error('the P3-12 attachment driver takes an overlay path')

/** One entry of a ZIP archive. */
interface ZipEntry { readonly name: string; readonly data: Uint8Array; readonly deflate: boolean }

/**
 * A ZIP archive holding `entries`, written field by field (local headers,
 * central directory, end record) so its declared sizes are exact.
 * @param entries - the archive's members, in order.
 * @returns the archive's bytes.
 */
function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const body = entry.deflate ? deflateRawSync(entry.data) : Buffer.from(entry.data)
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/**
 * One PNG chunk: length, type, data and the CRC over type and data.
 * @param type - the four-letter chunk type.
 * @param data - the chunk's data.
 * @returns the chunk's bytes.
 */
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** A valid 1×1 opaque RGB PNG. */
function png(): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(2, 9)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0xff, 0x80, 0x00]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A PDF whose objects are `bodies`, with a cross-reference table that points
 * at each, so a reader opens it as written.
 * @param bodies - each object's dictionary or stream, object 1 first (the catalog).
 * @returns the document's bytes.
 */
function pdf(bodies: readonly string[]): Buffer {
  let text = '%PDF-1.7\n'
  const offsets: number[] = []
  bodies.forEach((body, index) => {
    offsets.push(Buffer.byteLength(text, 'latin1'))
    text += `${String(index + 1)} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(text, 'latin1')
  text += `xref\n0 ${String(bodies.length + 1)}\n0000000000 65535 f \n`
  for (const offset of offsets) text += `${String(offset).padStart(10, '0')} 00000 n \n`
  text += `trailer\n<< /Size ${String(bodies.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return Buffer.from(text, 'latin1')
}

/** A minimal Windows PE executable header: `MZ`, then `PE\0\0` at the offset `e_lfanew` names. */
function peExecutable(): Buffer {
  const bytes = Buffer.alloc(512)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write('PE\0\0', 0x80, 'latin1')
  bytes.writeUInt16LE(0x8664, 0x84)
  return bytes
}

/** A minimal 64-bit little-endian ELF executable header. */
function elfExecutable(): Buffer {
  const bytes = Buffer.alloc(256)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(bytes, 0)
  bytes.writeUInt16LE(2, 16)
  bytes.writeUInt16LE(0x3e, 18)
  return bytes
}

/**
 * A zip that holds a zip that holds a zip, `depth` levels down to one file of zeros.
 * @param depth - how many archives enclose the file.
 * @returns the outermost archive's bytes.
 */
function nestedZip(depth: number): Buffer {
  let inner: Buffer = zip([{ name: 'zeros.bin', data: new Uint8Array(1 << 20), deflate: true }])
  for (let level = 1; level < depth; level += 1) inner = zip([{ name: `level-${String(level)}.zip`, data: inner, deflate: true }])
  return inner
}

/** The macro project an OOXML document carries: an OLE compound file, recognised by its signature. */
function vbaProject(): Buffer {
  const bytes = Buffer.alloc(512)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(bytes, 0)
  return bytes
}

const text = (value: string): Uint8Array => Buffer.from(value, 'utf8')

/** What each payload is and the name it is uploaded under. `control` payloads are benign. */
const PAYLOADS: readonly { readonly label: string; readonly name: string; readonly control: boolean; readonly data: Uint8Array }[] = [
  {
    label: 'zip bomb (compression ratio)',
    name: 'archive.zip',
    control: false,
    data: zip([{ name: 'zeros.bin', data: new Uint8Array(32 << 20), deflate: true }]),
  },
  { label: 'zip bomb (nesting depth)', name: 'nested.zip', control: false, data: nestedZip(12) },
  {
    label: 'polyglot (PNG that is also a ZIP)',
    name: 'photo.png',
    control: false,
    data: Buffer.concat([png(), zip([{ name: 'payload.js', data: text("require('child_process').exec('id')\n"), deflate: false }])]),
  },
  { label: 'false MIME (executable named .jpg)', name: 'photo.jpg', control: false, data: peExecutable() },
  { label: 'false MIME (ELF named .pdf)', name: 'statement.pdf', control: false, data: elfExecutable() },
  {
    label: 'malicious document (PDF that runs JavaScript on open)',
    name: 'invoice.pdf',
    control: false,
    data: pdf([
      '<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
      '<< /S /JavaScript /JS (app.launchURL\\("https://example.invalid/", true\\);) >>',
    ]),
  },
  {
    label: 'malicious document (Word file with a macro)',
    name: 'report.docm',
    control: false,
    data: zip([
      {
        name: '[Content_Types].xml',
        data: text('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          + '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'),
        deflate: true,
      },
      { name: 'word/document.xml', data: text('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'), deflate: true },
      { name: 'word/vbaProject.bin', data: vbaProject(), deflate: true },
    ]),
  },
  { label: 'plain text file (control)', name: 'notes.txt', control: true, data: text('meeting notes\n') },
  { label: 'plain PNG image (control)', name: 'pixel.png', control: true, data: png() },
]

/**
 * Every file under `root`, by path.
 * @param root - the directory to walk.
 * @returns the files' paths.
 */
async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name))
}

const ctx = await bootProductionProfile({
  binName: 'p3-12-malicious-attachment',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(overlayPath, undefined)],
})
try {
  const records: object[] = []
  for (const payload of PAYLOADS) {
    const before = new Set(await files(process.cwd()))
    let outcome: { readonly committed: true; readonly bytes: number } | { readonly committed: false; readonly code: string | null }
    try {
      const ref = await ctx.attachments.saveFile({ data: payload.data, name: payload.name })
      outcome = { committed: true, bytes: ref.bytes }
    } catch (error: unknown) {
      outcome = { committed: false, code: isAttachmentError(error) ? error.code : null }
    }
    let storedCopies = 0
    for (const path of (await files(process.cwd())).filter(path => !before.has(path))) {
      if (Buffer.from(payload.data).equals(await readFile(path))) storedCopies += 1
    }
    records.push({ label: payload.label, control: payload.control, size: payload.data.length, ...outcome, storedCopies })
  }
  await writeFile('observation.json', `${JSON.stringify(records, null, 2)}\n`, 'utf8')
} finally {
  await ctx.fiber.dispose()
}
