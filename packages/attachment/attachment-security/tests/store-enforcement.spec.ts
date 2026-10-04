/**
 * P3-12 slice-2: the scan is enforced in `AttachmentStore`'s save path, not in a
 * bypassable admission entry. A malicious payload put through `store.saveFile`
 * is refused before the commit when the scanner is mounted; a benign one reaches
 * the commit; and a store with no scanner mounted admits (capability absence).
 * @module @deepseek-ai/dsh-attachment-security/tests/store-enforcement
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef, ImageAttachmentRef, SaveFileAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import AttachmentSecurityScanner from '../src/index.ts'

const LIMITS = {
  maxImageBytes: 1_000_000,
  maxImagesPerMessage: 10,
  maxMessageImageBytes: 1_000_000,
  maxImagePixels: 1_000_000,
  maxImageDimension: 100_000,
  mediaTypes: ['image/png'] as const,
}

/** A store whose only job is to count the file commits the save path lets through. */
class CountingStore extends AttachmentStore {
  readonly imageLimits = LIMITS
  committedFiles = 0

  validateImage(): Promise<void> {
    return Promise.resolve()
  }

  saveImage(): Promise<ImageAttachmentRef> {
    throw new Error('not used')
  }

  readImage(): Promise<StoredImageAttachment> {
    throw new Error('not used')
  }

  protected override commitFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    this.committedFiles += 1
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'00'.repeat(32)}`),
      name: input.name ?? 'f',
      bytes: input.data.byteLength,
    })
  }
}

const ELF = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0])

describe('P3-12 slice-2: the store save path enforces the scan', () => {
  it('refuses a malicious payload through store.saveFile before the commit, with a mounted scanner', async () => {
    const ctx = new Context()
    await ctx.plugin(AttachmentSecurityScanner, {})
    const store = new CountingStore(ctx)
    await expect(store.saveFile({ data: ELF })).rejects.toMatchObject({ code: 'MALICIOUS_ATTACHMENT' })
    expect(store.committedFiles).toBe(0)
  })

  it('admits a benign payload, reaching the commit', async () => {
    const ctx = new Context()
    await ctx.plugin(AttachmentSecurityScanner, {})
    const store = new CountingStore(ctx)
    await store.saveFile({ data: Uint8Array.from([1, 2, 3]) })
    expect(store.committedFiles).toBe(1)
  })

  it('admits every payload when no scanner is mounted (capability absence is not a silent pass)', async () => {
    const store = new CountingStore(new Context())
    await store.saveFile({ data: ELF })
    expect(store.committedFiles).toBe(1)
  })
})
