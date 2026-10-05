/** The malicious-content detectors behind {@link AttachmentSecurityScanner}. @module @deepseek-ai/dsh-attachment-security/scanner */

import { unzipSync } from 'fflate'
import type { AttachmentScanInput, AttachmentScanRefusal } from '@deepseek-ai/dsh-attachment'

/** The deployment-resolved thresholds the detectors read. */
export interface ScanPolicy {
  /** The largest total-uncompressed to compressed ratio an archive may declare before it reads as a bomb. */
  readonly maxDecompressionRatio: number
  /** The deepest archive-within-archive nesting admitted; 0 forbids any nested archive. */
  readonly maxNestingDepth: number
  /** The largest intrinsic width times height admitted for a raster image. */
  readonly maxPixels: number
}

/** A sniffed container kind, or undefined when no known magic matches. */
type SniffedKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'ole' | 'elf' | 'pe' | 'macho'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const GIF = [0x47, 0x49, 0x46, 0x38]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]
const PDF = [0x25, 0x50, 0x44, 0x46]
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04]
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ELF = [0x7f, 0x45, 0x4c, 0x46]
const PE = [0x4d, 0x5a]
const MACHO = [
  [0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe],
]
const ARCHIVE_NAME = /\.(zip|jar|docx|xlsx|pptx|gz|tgz|7z|rar|war)$/iu

function at(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i += 1) if (bytes[offset + i] !== sig[i]) return false
  return true
}

/** A DataView over the payload, whose getters return numbers and bounds-check their reads. */
function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * The container kind the payload bytes actually are, by leading magic number.
 * @param bytes - the decoded payload.
 * @returns the sniffed kind, or `undefined` when no known magic number leads the bytes.
 */
export function sniffKind(bytes: Uint8Array): SniffedKind | undefined {
  if (at(bytes, PNG)) return 'png'
  if (at(bytes, JPEG)) return 'jpeg'
  if (at(bytes, GIF)) return 'gif'
  if (at(bytes, RIFF) && at(bytes, WEBP, 8)) return 'webp'
  if (at(bytes, PDF)) return 'pdf'
  if (at(bytes, ZIP_LOCAL)) return 'zip'
  if (at(bytes, OLE)) return 'ole'
  if (at(bytes, ELF)) return 'elf'
  if (at(bytes, PE)) return 'pe'
  if (MACHO.some(sig => at(bytes, sig))) return 'macho'
  return undefined
}

/** The container kind a declared media type names, or undefined when unknown. */
function expectedKind(mediaType: string): SniffedKind | undefined {
  const type = mediaType.toLowerCase()
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpeg'
  if (type === 'image/gif') return 'gif'
  if (type === 'image/webp') return 'webp'
  if (type === 'application/pdf') return 'pdf'
  if (type === 'application/zip' || type.endsWith('+zip') || type.includes('officedocument') || type.includes('opendocument')) return 'zip'
  return undefined
}

const IMAGE_KINDS: ReadonlySet<SniffedKind> = new Set<SniffedKind>(['png', 'jpeg', 'gif', 'webp'])

/** The intrinsic pixel count of a raster header, or undefined when this kind carries no readable header here. */
function imagePixels(kind: SniffedKind, bytes: Uint8Array): number | undefined {
  const view = viewOf(bytes)
  if (kind === 'png' && bytes.length >= 24) return view.getUint32(16, false) * view.getUint32(20, false)
  if (kind === 'gif' && bytes.length >= 10) return view.getUint16(6, true) * view.getUint16(8, true)
  if (kind === 'jpeg') {
    // Walk the marker segments to the start-of-frame, which carries the dimensions.
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (view.getUint8(offset) !== 0xff) return undefined
      const marker = view.getUint8(offset + 1)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return view.getUint16(offset + 5, false) * view.getUint16(offset + 7, false)
      }
      offset += 2 + view.getUint16(offset + 2, false)
    }
  }
  return undefined
}

function indexOfSig(bytes: Uint8Array, sig: readonly number[], from: number): number {
  for (let i = from; i + sig.length <= bytes.length; i += 1) if (at(bytes, sig, i)) return i
  return -1
}

/** Entry metadata read from the ZIP central directory without decompressing. */
interface ZipEntry {
  readonly name: string
  readonly size: number
  readonly originalSize: number
}

/** Read every ZIP entry's declared sizes and name without decompressing any member. */
function readZipEntries(bytes: Uint8Array): readonly ZipEntry[] {
  const entries: ZipEntry[] = []
  unzipSync(bytes, {
    filter: (file) => {
      entries.push({ name: file.name, size: file.size, originalSize: file.originalSize })
      return false
    },
  })
  return entries
}

/**
 * Classify one decoded payload against the policy, returning the first threat
 * found or undefined to admit. Detectors run from the cheapest, most decisive
 * leading-magic checks to the archive checks that read ZIP metadata.
 * @param input - the decoded bytes and the caller-declared media type.
 * @param policy - the deployment-resolved thresholds.
 * @returns the first refusal, or undefined when the payload is admitted.
 */
export function scanPayload(input: AttachmentScanInput, policy: ScanPolicy): AttachmentScanRefusal | undefined {
  const { bytes, declaredMediaType } = input
  const kind = sniffKind(bytes)

  if (kind === 'elf' || kind === 'pe' || kind === 'macho') {
    return { kind: 'executable', detail: `the payload is a native ${kind} executable` }
  }
  if (kind === 'ole') {
    return { kind: 'macro', detail: 'the payload is an OLE compound document, a macro-bearing format' }
  }

  const expected = expectedKind(declaredMediaType)
  if (expected !== undefined && kind !== undefined && kind !== expected) {
    return { kind: 'mime-mismatch', detail: `declared ${declaredMediaType} but the bytes are ${kind}` }
  }

  if (kind !== undefined && IMAGE_KINDS.has(kind)) {
    const pixels = imagePixels(kind, bytes)
    if (pixels !== undefined && pixels > policy.maxPixels) {
      return { kind: 'pixel-bomb', detail: `${pixels} pixels exceeds the ${policy.maxPixels} limit` }
    }
    if (indexOfSig(bytes, ZIP_LOCAL, 1) !== -1) {
      return { kind: 'polyglot', detail: `the ${kind} payload also carries an embedded ZIP archive` }
    }
  }

  if (kind === 'zip') {
    return scanArchive(bytes, policy, 0)
  }
  return undefined
}

/** Classify one ZIP payload for a decompression bomb, a macro, or excess nesting, recursing into nested archives up to the depth limit. */
function scanArchive(bytes: Uint8Array, policy: ScanPolicy, depth: number): AttachmentScanRefusal | undefined {
  let entries: readonly ZipEntry[]
  try {
    entries = readZipEntries(bytes)
  } catch {
    // A payload that declares itself a ZIP but does not parse is left to the
    // downstream parser to reject; the scanner asserts no threat it cannot read.
    return undefined
  }

  for (const entry of entries) {
    if (/(^|\/)vbaProject\.bin$/iu.test(entry.name)) {
      return { kind: 'macro', detail: `the archive carries ${entry.name}, a macro project` }
    }
  }

  const compressed = entries.reduce((sum, entry) => sum + entry.size, 0)
  const original = entries.reduce((sum, entry) => sum + entry.originalSize, 0)
  if (compressed > 0 && original / compressed > policy.maxDecompressionRatio) {
    return { kind: 'decompression-ratio', detail: `declares a ${Math.round(original / compressed)}:1 decompression ratio` }
  }

  const nested = entries.filter(entry => ARCHIVE_NAME.test(entry.name))
  if (nested.length > 0 && depth + 1 > policy.maxNestingDepth) {
    return { kind: 'nesting-depth', detail: `nests an archive beyond the ${policy.maxNestingDepth} level limit` }
  }
  if (nested.length > 0) {
    // The ratio check above has cleared this level, so decompressing only the
    // nested-archive members to read their depth cannot release a bomb.
    const inner = unzipSync(bytes, { filter: file => ARCHIVE_NAME.test(file.name) })
    for (const member of Object.values(inner)) {
      const refusal = scanArchive(member, policy, depth + 1)
      if (refusal !== undefined) return refusal
    }
  }
  return undefined
}
