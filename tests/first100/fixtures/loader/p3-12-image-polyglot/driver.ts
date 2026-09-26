/**
 * Driver for A-474's P3-12 case under acceptance[1]: on the SHIPPED headless
 * profile, the shipped attachment store admits three images and the driver
 * reads back what it stored and what it would send a model.
 *
 * It boots headless through `bootProductionProfile` with the originator cases'
 * overlay and calls `ctx.attachments` directly, the store the Web and SDK
 * upload endpoints reach through `admitEncodedImages`. The inputs are a 1×1
 * PNG, the same PNG declared `image/jpeg`, and the same PNG followed by an
 * empty ZIP's end-of-central-directory record, declared `image/png` — bytes
 * that are both a PNG and a ZIP. For each admitted image it reads the stored
 * bytes and the request bytes under a permissive request policy. It prints one
 * `P3-12-POLYGLOT <json>` line.
 * @module tests/first100/fixtures/loader/p3-12-image-polyglot/driver
 */

import { Buffer } from 'node:buffer'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** A 1×1 RGBA PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

/** The signature of a ZIP end-of-central-directory record. */
const ZIP_RECORD = Buffer.from([0x50, 0x4b, 0x05, 0x06])

/** The PNG followed by an empty ZIP: a PNG reader and a ZIP reader both accept it. */
const POLYGLOT = Buffer.concat([PNG, ZIP_RECORD, Buffer.alloc(18)])

/** What the store did with one image. */
interface Outcome {
  readonly admitted: boolean
  readonly code: string | null
  readonly storedSameAsInput: boolean | null
  readonly storedCarriesZip: boolean | null
  readonly requestSameAsInput: boolean | null
  readonly requestCarriesZip: boolean | null
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p3-12 image-polyglot driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p3-12-image-polyglot',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})

/**
 * Admit one image and read back what the store kept and would send.
 * @param data - the image bytes.
 * @param mediaType - the declared media type.
 * @returns what happened to it.
 */
async function admit(data: Buffer, mediaType: ImageMediaType): Promise<Outcome> {
  try {
    const [ref] = await ctx.attachments.saveImages([{ data: new Uint8Array(data), mediaType }])
    if (ref === undefined) throw new Error('the store returned no reference')
    const stored = Buffer.from((await ctx.attachments.readImage(ref)).data)
    const request = Buffer.from((await ctx.attachments.readImageRequest(ref, { maxPixels: 1_000_000, maxBytes: 1_000_000 })).data)
    return {
      admitted: true,
      code: null,
      storedSameAsInput: stored.equals(data),
      storedCarriesZip: stored.includes(ZIP_RECORD),
      requestSameAsInput: request.equals(data),
      requestCarriesZip: request.includes(ZIP_RECORD),
    }
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : String(error)
    return { admitted: false, code, storedSameAsInput: null, storedCarriesZip: null, requestSameAsInput: null, requestCarriesZip: null }
  }
}

try {
  const report = {
    plain: await admit(PNG, 'image/png'),
    mislabelled: await admit(PNG, 'image/jpeg'),
    polyglot: await admit(POLYGLOT, 'image/png'),
  }
  process.stdout.write(`P3-12-POLYGLOT ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
