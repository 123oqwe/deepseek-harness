/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */

import { Context, Service } from '@deepseek-ai/cordis'
import { admitEncodedFile as admitFileInput, admitEncodedImages } from './admission.ts'
import { AttachmentError, isAttachmentError as matchesAttachmentError } from './error.ts'
import type { AttachmentScanInput, AttachmentScanner } from './scan.ts'
import type {
  AdmittedPromptContentPart,
  AttachmentAdmissionPart,
  EncodedFileAttachment,
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveFileStreamAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from './types.ts'

export { AttachmentId, ImageVariantId } from './brand.ts'
export { AttachmentError, isAttachmentError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, ImageAdmissionErrorCode } from './error.ts'
export { admitEncodedFile, admitEncodedImages } from './admission.ts'
export { AttachmentScanner } from './scan.ts'
export type { AttachmentScanInput, AttachmentScanRefusal, AttachmentScanVerdict, AttachmentThreatKind } from './scan.ts'
export { requestImageDimensions } from './request-projection.ts'
export type {
  AttachmentId as AttachmentIdType,
  AdmittedPromptContentPart,
  AttachmentAdmissionPart,
  EncodedFileAttachment,
  EncodedImageAttachment,
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  ImageMediaType,
  PromptContentPart,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveFileStreamAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  protected validateImageBatch(inputs: readonly SaveImageAttachment[]): void {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
  }

  /**
   * Scan one decoded payload through the mounted {@link AttachmentScanner}
   * before it is committed (Epic P3-12 must[1]). The scan lives in this save
   * path, not in an admission entry a direct `saveImages`/`saveFile` caller
   * bypasses, so no provider reaches a commit with an unscanned payload. An
   * absent scanner admits every payload, which is capability absence, not a
   * silent pass.
   * @param input - the decoded bytes and the declared media type.
   * @throws AttachmentError with code `MALICIOUS_ATTACHMENT` when the scanner refuses.
   */
  protected async scanInput(input: AttachmentScanInput): Promise<void> {
    const scanner: AttachmentScanner | undefined = this.ctx.get('attachmentScanner')
    if (scanner === undefined) return
    const verdict = await scanner.scan(input)
    if (!verdict.admit) {
      throw new AttachmentError(`Attachment refused: ${verdict.refusal.kind} — ${verdict.refusal.detail}`, 'MALICIOUS_ATTACHMENT')
    }
  }

  /**
   * Validate, scan, and durably commit one ordered image batch. This template
   * is the enforcement point: it validates, scans every member, then delegates
   * the commit to {@link AttachmentStore.commitImages}, so a provider that
   * overrides the commit cannot skip the scan.
   * @param inputs - encoded images in owning-message order.
   * @returns durable normalized attachment references in the same order after every member succeeds.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    for (const input of inputs) {
      await this.scanInput({
        bytes: input.data,
        declaredMediaType: input.mediaType,
        ...input.name === undefined ? {} : { name: input.name },
      })
    }
    return this.commitImages(inputs)
  }

  /**
   * Validate and durably commit one already-batch-checked, already-scanned image
   * batch. The default validates and commits each member through
   * {@link AttachmentStore.validateImage} and {@link AttachmentStore.saveImage};
   * a provider overrides this to prepare and commit the batch its own way, never
   * {@link AttachmentStore.saveImages}, whose scan it must not skip.
   * @param inputs - batch-checked and scanned images in owning-message order.
   * @returns durable references in the same order.
   */
  protected async commitImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    for (const input of inputs) await this.validateImage(input)
    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

  /**
   * Admit one Host prompt and replace each uploaded image with its durable reference.
   * Text and durable file references pass through unchanged. A prompt without image parts performs no storage operation.
   * @param content - prompt parts in message order after file receipt resolution.
   * @returns admitted prompt parts in the same order as `content`.
   * @throws AttachmentError when the image batch is refused.
   */
  async admitPromptContent(
    content: readonly AttachmentAdmissionPart[],
  ): Promise<AdmittedPromptContentPart[]> {
    if (content.every(part => part.type !== 'image')) {
      return content.map(part => part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'file', attachment: part.attachment })
    }
    const refs = await admitEncodedImages(this, content.filter(part => part.type === 'image'))
    let next = 0
    return content.map((part) => {
      if (part.type === 'text') return { type: 'text', text: part.text }
      if (part.type === 'file') return { type: 'file', attachment: part.attachment }
      return { type: 'image', attachment: refs[next++] as ImageAttachmentRef }
    })
  }

  /**
   * Decode and durably commit one canonical base64 file upload.
   * @param input - canonical base64 bytes and optional display name.
   * @returns the durable content-addressed file reference.
   * @throws AttachmentError when the encoding or storage operation is refused.
   */
  admitEncodedFile(input: EncodedFileAttachment): Promise<FileAttachmentRef> {
    return admitFileInput(this, input)
  }

  /**
   * Identify a failure emitted by this attachment capability by its stable code.
   * @param error - value caught from an attachment operation.
   * @returns whether the value is an attachment failure.
   */
  isAttachmentError(error: unknown): error is AttachmentError {
    return matchesAttachmentError(error)
  }

  /**
   * Validate and durably commit one image before its owning session event is appended.
   * The returned reference describes the persisted normalized image. When
   * normalization reduces the raster, its `originalDimensions` records the
   * orientation-applied input dimensions.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns the durable content-addressed normalized image reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and normalized attachment reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

  /**
   * Locate the provider-owned normalized object in the harness host filesystem.
   * @param ref - durable normalized attachment reference.
   * @returns an absolute host path, or undefined when this backend is not host-file-backed.
   * @throws an AttachmentError when the durable reference is invalid.
   */
  imageHostPath(ref: ImageAttachmentRef): string | undefined {
    void ref
    return undefined
  }

  /**
   * Durably commit one file byte-for-byte before its owning session event is
   * appended. Files carry no admission limits: any byte content and length is
   * accepted, and the stored object is the exact submitted bytes. Backends
   * without verbatim file storage keep this default rejection.
   * @param input - exact bytes and optional display name.
   * @returns the durable content-addressed file reference.
   */
  async saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    // A file carries no declared media type; the scanner sniffs the bytes, so
    // the executable, decompression-ratio, polyglot and macro detectors still
    // apply, and only the declared-vs-sniffed check has nothing to compare.
    await this.scanInput({ bytes: input.data, declaredMediaType: '', ...input.name === undefined ? {} : { name: input.name } })
    return this.commitFile(input)
  }

  /**
   * Durably commit one already-scanned verbatim file. Backends without verbatim
   * file storage keep this default rejection; a provider overrides this, never
   * {@link AttachmentStore.saveFile}, whose scan it must not skip.
   * @param input - exact bytes and optional display name.
   * @returns the durable content-addressed file reference.
   */
  protected commitFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    void input
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot store verbatim files.',
      'ATTACHMENT_FILES_UNSUPPORTED',
    ))
  }

  /**
   * Durably commit one file byte-for-byte from bounded chunks. Providers must
   * apply backpressure and must not collect the complete file in memory.
   * Backends without streamed verbatim storage keep this default rejection.
   * @param input - ordered exact bytes, optional cancellation, and display name.
   * @returns the durable content-addressed file reference.
   */
  saveFileStream(input: SaveFileStreamAttachment): Promise<FileAttachmentRef> {
    void input
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot stream verbatim files.',
      'ATTACHMENT_FILES_UNSUPPORTED',
    ))
  }

  /**
   * Read and verify one verbatim stored file as bounded chunks. Providers must
   * not collect the complete file in memory. Backends without verbatim file
   * reads keep this default rejection.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend reads and verification work.
   * @returns exact file bytes in order; integrity failures reject the iteration.
   */
  async *readFileStream(
    ref: FileAttachmentRef,
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    signal?.throwIfAborted()
    void ref
    await Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot read verbatim files.',
      'ATTACHMENT_FILES_UNSUPPORTED',
    ))
  }

  /**
   * Locate the verbatim stored file object in the harness host filesystem.
   * @param ref - durable file reference.
   * @returns an absolute host path, or undefined when this backend is not host-file-backed.
   * @throws an AttachmentError when the durable reference is invalid.
   */
  fileHostPath(ref: FileAttachmentRef): string | undefined {
    void ref
    return undefined
  }

  /**
   * Generate or read one deterministic model-request version from the stored normalized image.
   * @param ref - durable provider-independent normalized attachment reference.
   * @param policy - exact route pixel budget and encoded-byte target; a target no ladder quality meets yields the smallest ladder output.
   * @param signal - optional cancellation.
   * @returns request bytes and the cache/upload identity covering every transform input.
   */
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    void ref
    void policy
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot derive model-request images.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

}

export default AttachmentStore
