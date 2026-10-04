/**
 * P3-12 must[0] red first: 「所有路径操作使用 openat/handle 风格或执行前重新验证 inode，禁止 symlink escape。」
 *
 * Each case plants one directory below a store root as a symlink to a
 * directory outside that root, then drives one write path of the shipped local
 * attachment provider (`LocalAttachmentStore`) through its service methods:
 * a normalized image object (`objects`), the staging file every object passes
 * through (`tmp`), a file's named alias (`files`), and a cached model-request
 * image (`request-images` under the cache root). Each asserts that nothing is
 * ever created outside the root: the write is refused, or it lands under the
 * root's real path. The staging file is unlinked once published, so that case
 * looks outside while the provider is still reading the stream it writes.
 *
 * A control case plants nothing and requires every write path to succeed
 * under the roots' real paths. Symlinks need a privilege on Windows, so the
 * cases run on POSIX hosts only.
 *
 * Red first for lane A's fix (§17); written on 66ed34afdb, before lane A's
 * must[0] patch was read (§21.4).
 * @module tests/first100/fixtures/P3-12.must0-ancestor-symlink.provider
 */

import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { afterEach, describe, expect, it } from 'vitest'

/** A 32×32 opaque PNG: larger than the request policy below, so the request image is re-encoded and cached. */
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAO0lEQVRIiWPgUbKgKWIYtUBpNIgsRlMRz2hGsxgtKnhGS1Ol0QqHZ7TKVBptVViMNryURpuOFoO6dQ0AbQeYEIeTlWUAAAAASUVORK5CYII=',
  'base64',
))

/** A request policy that a 32×32 image exceeds. */
const REQUEST_POLICY = { maxPixels: 16 * 16, maxBytes: 4_096 }

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * A fresh directory this file removes after each case.
 * @param prefix - the temporary directory prefix.
 * @returns the directory.
 */
async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

/**
 * A provider over a fresh `DSH_HOME`, with the directory at `planted` (relative to
 * `DSH_HOME`) replaced by a symlink to a fresh directory outside it.
 * @param planted - the path segments below `DSH_HOME` to plant, or none for the control.
 * @returns the provider, its home, and the outside directory.
 */
async function plantedStore(planted: readonly string[]): Promise<{ store: LocalAttachmentStore; dshHome: string; outside: string }> {
  const dshHome = await freshDir('p3-12-must0-home-')
  const outside = await freshDir('p3-12-must0-outside-')
  if (planted.length > 0) {
    const link = join(dshHome, ...planted)
    await mkdir(join(link, '..'), { recursive: true })
    await symlink(outside, link, 'dir')
  }
  return { store: new LocalAttachmentStore(new Context(), { dshHome }), dshHome, outside }
}

/**
 * Every entry under `dir`, recursively.
 * @param dir - the directory to list.
 * @returns the relative entry paths.
 */
async function entries(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).map(String).sort()
}

/**
 * Whether `path` resolves to a location strictly under `root`'s real path.
 * @param root - the store root.
 * @param path - the stored object's host path.
 * @returns the verdict.
 */
async function landsUnder(root: string, path: string): Promise<boolean> {
  return (await realpath(path)).startsWith(`${await realpath(root)}${sep}`)
}

/**
 * Settle a write, keeping its outcome: the value, or the rejection.
 * @param write - the write.
 * @returns the outcome.
 */
async function settle<T>(write: Promise<T>): Promise<{ readonly value: T } | { readonly error: unknown }> {
  try {
    return { value: await write }
  } catch (error) {
    return { error }
  }
}

describe('P3-12 must[0]: a symlinked directory below a store root never carries a write outside it', () => {
  it.skipIf(process.platform === 'win32')('an image object: `objects` symlinked outside the root', async () => {
    const { store, outside } = await plantedStore(['attachments', 'v1', 'objects'])
    const saved = await settle(store.saveImage({ data: PNG, mediaType: 'image/png' }))

    expect(await entries(outside), 'the image object was written outside the store root').toEqual([])
    if ('value' in saved) expect(await landsUnder(store.root, store.imageHostPath(saved.value))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('a staging file: `tmp` symlinked outside the root', async () => {
    const { store, outside } = await plantedStore(['attachments', 'v1', 'tmp'])
    let whileStaging: string[] = []
    // The provider pulls the second chunk only after it opened the staging
    // file and wrote the first, so this looks outside while that file exists.
    async function* source(): AsyncGenerator<Uint8Array> {
      yield Uint8Array.of(1, 2, 3)
      whileStaging = await entries(outside)
      yield Uint8Array.of(4, 5, 6)
    }
    const saved = await settle(store.saveFileStream({ data: source(), name: 'staged.bin' }))

    expect(whileStaging, 'the staging file was opened outside the store root').toEqual([])
    expect(await entries(outside)).toEqual([])
    if ('value' in saved) expect(await landsUnder(store.root, store.fileHostPath(saved.value))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('a file alias: `files` symlinked outside the root', async () => {
    const { store, outside } = await plantedStore(['attachments', 'v1', 'files'])
    const saved = await settle(store.saveFile({ data: Uint8Array.of(7, 8, 9), name: 'notes.txt' }))

    expect(await entries(outside), 'the file alias was written outside the store root').toEqual([])
    if ('value' in saved) expect(await landsUnder(store.root, store.fileHostPath(saved.value))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('a cached request image: `request-images` symlinked outside the cache root', async () => {
    const { store, dshHome, outside } = await plantedStore(['cache', 'attachments', 'request-images'])
    const image = await store.saveImage({ data: PNG, mediaType: 'image/png' })
    await settle(store.readImageRequest(image, REQUEST_POLICY))

    expect(await entries(outside), 'the request image was cached outside the cache root').toEqual([])
    expect(await entries(join(dshHome, 'attachments', 'v1', 'objects'))).not.toEqual([])
  })

  it.skipIf(process.platform === 'win32')('control: with nothing planted, every write path succeeds under the roots\' real paths', async () => {
    const { store, dshHome } = await plantedStore([])
    const image = await store.saveImage({ data: PNG, mediaType: 'image/png' })
    async function* source(): AsyncGenerator<Uint8Array> {
      yield Uint8Array.of(1, 2, 3)
      yield Uint8Array.of(4, 5, 6)
    }
    const streamed = await store.saveFileStream({ data: source(), name: 'staged.bin' })
    const file = await store.saveFile({ data: Uint8Array.of(7, 8, 9), name: 'notes.txt' })
    await store.readImageRequest(image, REQUEST_POLICY)

    expect(await landsUnder(store.root, store.imageHostPath(image))).toBe(true)
    expect(await landsUnder(store.root, store.fileHostPath(streamed))).toBe(true)
    expect(await landsUnder(store.root, store.fileHostPath(file))).toBe(true)
    expect(await entries(join(dshHome, 'cache', 'attachments', 'request-images'))).not.toEqual([])
  })
})
