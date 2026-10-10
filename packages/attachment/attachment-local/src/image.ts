/** Raster inspection: full decode at admission, header-only probe on verified reads. */

import sharp, { type Sharp } from 'sharp'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/** Decoded metadata from a supported image. */
export interface DetectedImage {
  mediaType: ImageMediaType
  /** Intrinsic width with EXIF orientation applied — the width a viewer perceives. */
  width: number
  /** Intrinsic height with EXIF orientation applied — the height a viewer perceives. */
  height: number
  /** Whether the container carries more than one frame. */
  animated: boolean
  /** Whether the bytes carry descriptive metadata, a color profile, or orientation. */
  carriesMetadata: boolean
  /** Sharp sample depth reported for the decoded channels. */
  depth: string
  /** Sharp colour space reported for the decoded pixels. */
  space: string
  /** Whether decoded pixels carry an alpha channel. */
  hasAlpha: boolean
}

/**
 * Check alpha metadata for bytes produced by this package's encoders.
 * Sharp/libvips may omit an all-opaque alpha plane from WebP output; every
 * other addition or removal indicates that the encoded result is incompatible
 * with its source facts.
 * @param sourceHasAlpha - whether the source bytes declare an alpha plane, or undefined when the source frame is unspecified.
 * @param output - decoded media type and alpha metadata from the encoded result.
 * @returns whether the output alpha metadata is compatible with the source.
 */
export function encodedAlphaIsCompatible(
  sourceHasAlpha: boolean | undefined,
  output: Pick<DetectedImage, 'mediaType' | 'hasAlpha'>,
): boolean {
  return sourceHasAlpha === undefined
    || output.hasAlpha === sourceHasAlpha
    || (sourceHasAlpha && !output.hasAlpha && output.mediaType === 'image/webp')
}

const MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * The scalar facts the mapping reads, with metadata presence reduced to
 * booleans. Both the in-process {@link imageMetadata} and the isolated
 * {@link detectImageViaSubprocess} produce this, so they map identically.
 */
interface RawImageMetadata {
  format?: string
  width: number
  height: number
  orientation?: number | undefined
  pages?: number | undefined
  depth: string
  space: string
  hasAlpha: boolean
  exif: boolean
  xmp: boolean
  iptc: boolean
  icc: boolean
  hasProfile: boolean
  tifftagPhotoshop: boolean
  comments: boolean
}

/** Reduce one Sharp metadata object to the scalar facts {@link mapMetadata} reads. */
function rawFromSharp(metadata: Awaited<ReturnType<Sharp['metadata']>>): RawImageMetadata {
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    orientation: metadata.orientation,
    pages: metadata.pages,
    depth: metadata.depth,
    space: metadata.space,
    hasAlpha: metadata.hasAlpha,
    exif: metadata.exif !== undefined,
    xmp: metadata.xmp !== undefined,
    iptc: metadata.iptc !== undefined,
    icc: metadata.icc !== undefined,
    hasProfile: metadata.hasProfile,
    tifftagPhotoshop: metadata.tifftagPhotoshop !== undefined,
    comments: metadata.comments !== undefined,
  }
}

/** Map decoded scalar facts to a {@link DetectedImage}, refusing an unsupported format. */
function mapMetadata(raw: RawImageMetadata): DetectedImage {
  const mediaType = MEDIA_TYPES[raw.format as string]
  if (mediaType === undefined) {
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE')
  }
  // EXIF orientations 5-8 transpose the stored raster; report the perceived
  // axes so limits, source facts, and coordinate advice all share them.
  const transposed = raw.orientation !== undefined && raw.orientation >= 5
  return {
    mediaType,
    width: transposed ? raw.height : raw.width,
    height: transposed ? raw.width : raw.height,
    animated: (raw.pages ?? 1) > 1,
    carriesMetadata: raw.exif || raw.xmp || raw.iptc || raw.icc || raw.hasProfile
      || raw.tifftagPhotoshop || raw.comments || raw.orientation !== undefined,
    depth: raw.depth,
    space: raw.space,
    hasAlpha: raw.hasAlpha,
  }
}

async function imageMetadata(image: Sharp): Promise<DetectedImage> {
  return mapMetadata(rawFromSharp(await image.metadata()))
}

/**
 * Parse a supported raster's header and return its intrinsic metadata without
 * decoding pixels. Digest-verified reads use this: admission already proved
 * that these exact bytes decode completely, so the read path only re-derives
 * the reference fields instead of paying the full-raster decode again.
 * @param data - complete encoded image bytes.
 * @returns verified format and dimensions.
 */
export async function probeImage(data: Uint8Array): Promise<DetectedImage> {
  try {
    return await imageMetadata(sharp(data, { failOn: 'error', limitInputPixels: false }))
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  }
}

/** Admission limits applied to a decoded raster's intrinsic dimensions. */
export interface DecodedImageLimits {
  /** Decoded-pixel (width times height) admission limit. */
  maxPixels?: number
  /** Per-side admission limit applied to width and height independently. */
  maxDimension?: number
}

/**
 * Fully decode a supported raster and return its intrinsic metadata.
 * @param data - complete encoded image bytes.
 * @param limits - intrinsic-dimension admission limits.
 * @returns verified format and dimensions.
 */
export async function detectImage(data: Uint8Array, limits?: DecodedImageLimits): Promise<DetectedImage> {
  try {
    const image = sharp(data, { failOn: 'error', limitInputPixels: false })
    const detected = await imageMetadata(image)
    if (limits?.maxPixels !== undefined && detected.width * detected.height > limits.maxPixels) {
      throw new AttachmentError('Image exceeds the configured decoded-pixel limit.', 'IMAGE_TOO_MANY_PIXELS')
    }
    if (limits?.maxDimension !== undefined && Math.max(detected.width, detected.height) > limits.maxDimension) {
      throw new AttachmentError('Image exceeds the configured per-side pixel limit.', 'IMAGE_DIMENSION_TOO_LARGE')
    }
    await image.raw().toBuffer()
    return detected
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  }
}

/** What the isolated decoder emits: the decoded facts, or a refusal code it decided. */
type DecodeProgramResult =
  | ({ ok: true } & RawImageMetadata)
  | { ok: false; code: 'INVALID_IMAGE' | 'IMAGE_TOO_MANY_PIXELS' | 'IMAGE_DIMENSION_TOO_LARGE' }

/** The operator-facing message for each refusal the isolated decoder reports. */
const DECODE_REFUSAL_MESSAGES: Record<Exclude<DecodeProgramResult, { ok: true }>['code'], string> = {
  INVALID_IMAGE: 'Unsupported or malformed image data.',
  IMAGE_TOO_MANY_PIXELS: 'Image exceeds the configured decoded-pixel limit.',
  IMAGE_DIMENSION_TOO_LARGE: 'Image exceeds the configured per-side pixel limit.',
}

/**
 * The ESM program the isolated decoder runs (P3-12 must[2]): it fully decodes
 * the untrusted bytes with Sharp in a SEPARATE process, so a libvips decode
 * exploit is contained there and never reaches the host. It reads the encoded
 * bytes from stdin and the pixel/dimension limits from argv (`argv[1]`,
 * `argv[2]`, after node consumes `--eval` and the `--` separator), checks the
 * limits BEFORE the full raster decode (so a pixel bomb is refused without
 * decoding it), and writes one {@link DecodeProgramResult} JSON value to stdout.
 * Sharp is resolved by the host and injected as an absolute URL, so the child
 * does not depend on its own working directory to find it.
 * @param sharpUrl - the host-resolved absolute module URL for `sharp`.
 * @returns the program source.
 */
function decodeProgram(sharpUrl: string): string {
  return `
import sharp from ${JSON.stringify(sharpUrl)}
const maxPixels = process.argv[1] === '' ? undefined : Number(process.argv[1])
const maxDimension = process.argv[2] === '' ? undefined : Number(process.argv[2])
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const data = Buffer.concat(chunks)
const emit = (value) => { process.stdout.write(JSON.stringify(value)) }
try {
  const image = sharp(data, { failOn: 'error', limitInputPixels: false })
  const m = await image.metadata()
  const transposed = m.orientation !== undefined && m.orientation >= 5
  const width = transposed ? m.height : m.width
  const height = transposed ? m.width : m.height
  if (maxPixels !== undefined && width * height > maxPixels) emit({ ok: false, code: 'IMAGE_TOO_MANY_PIXELS' })
  else if (maxDimension !== undefined && Math.max(width, height) > maxDimension) emit({ ok: false, code: 'IMAGE_DIMENSION_TOO_LARGE' })
  else {
    await image.raw().toBuffer()
    emit({ ok: true, format: m.format, width: m.width, height: m.height, orientation: m.orientation, pages: m.pages, depth: m.depth, space: m.space, hasAlpha: m.hasAlpha, exif: m.exif !== undefined, xmp: m.xmp !== undefined, iptc: m.iptc !== undefined, icc: m.icc !== undefined, hasProfile: m.hasProfile === true, tifftagPhotoshop: m.tifftagPhotoshop !== undefined, comments: m.comments !== undefined })
  }
} catch { emit({ ok: false, code: 'INVALID_IMAGE' }) }
`
}

/** A decoder the admission path calls; the store binds it to the isolated subprocess. */
export type ImageDecoder = (data: Uint8Array, limits?: DecodedImageLimits) => Promise<DetectedImage>

/**
 * Fully decode an untrusted raster in a SEPARATE process (P3-12 must[2]), so a
 * decoder exploit is contained by the process boundary rather than running in
 * the host. The in-process {@link detectImage} stays for verified-read probes;
 * admission uses this. A contained decode can still reach the network or
 * filesystem — OS-level confinement is P3-09.
 * @param subprocess - the isolated-world subprocess runtime (`ctx.subprocess`).
 * @param data - the untrusted encoded image bytes.
 * @param limits - intrinsic-dimension admission limits, checked in the child before the full decode.
 * @returns the decoded metadata.
 * @throws AttachmentError on a refusal, a decode failure, or a child that could not report an outcome.
 */
export async function detectImageViaSubprocess(
  subprocess: SubprocessRuntime,
  data: Uint8Array,
  limits?: DecodedImageLimits,
): Promise<DetectedImage> {
  const handle = subprocess.spawn({
    argv: [
      process.execPath, '--input-type=module', '--eval', decodeProgram(import.meta.resolve('sharp')),
      '--', String(limits?.maxPixels ?? ''), String(limits?.maxDimension ?? ''),
    ],
    cwd: process.cwd(),
    stdio: { stdin: 'pipe', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 8192 } },
    graceMs: 5000,
  })
  handle.stdin?.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  const outcome = await handle.done.catch((error: unknown) => {
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  })
  const stdout = handle.collected.stdout?.readFrom(0)
  if (outcome.exitCode !== 0 || stdout === undefined) {
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE')
  }
  let parsed: DecodeProgramResult
  try {
    parsed = JSON.parse(stdout.text) as DecodeProgramResult
  } catch (error: unknown) {
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  }
  if (!parsed.ok) throw new AttachmentError(DECODE_REFUSAL_MESSAGES[parsed.code], parsed.code)
  return mapMetadata(parsed)
}
