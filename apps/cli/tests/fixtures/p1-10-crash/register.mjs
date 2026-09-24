/**
 * Module hooks for the P1-10 crash campaign's instrumented `dsh plugin` child:
 * `node --import tsx/esm --import <this file> apps/cli/src/bin.ts plugin ...`.
 *
 * Imported after tsx, so this resolve hook runs before tsx's and asks it
 * first: the swap below is decided on the URL tsx resolved, which holds
 * whether tsx registered through `module.registerHooks` or `module.register`.
 * - `@deepseek-ai/dsh-plugin-migrations/transaction`, once resolved to its
 *   source, becomes `./transaction.shim.mjs` for every importer but the shim.
 * - `node:fs/promises` imported by storage-json's source becomes
 *   `./fs-promises.shim.mjs`.
 * Both shims pass everything through unless a `P1_10_*` variable says
 * otherwise.
 */
import { registerHooks } from 'node:module'

const TRANSACTION_SOURCE = '/packages/plugin/plugin-migrations/src/transaction.ts'
const STORAGE_JSON_SOURCE = '/packages/storage/storage-json/src/index.ts'
const transactionShim = new URL('./transaction.shim.mjs', import.meta.url).href
const fsPromisesShim = new URL('./fs-promises.shim.mjs', import.meta.url).href

/**
 * A module URL without its query or fragment.
 * @param url - the module URL.
 * @returns the part that names the file.
 */
function pathOf(url) {
  return url.split(/[?#]/u, 1)[0]
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:fs/promises' && pathOf(context.parentURL ?? '').endsWith(STORAGE_JSON_SOURCE)) {
      return { url: fsPromisesShim, format: 'module', shortCircuit: true }
    }
    const resolved = nextResolve(specifier, context)
    if (context.parentURL !== transactionShim && pathOf(resolved.url).endsWith(TRANSACTION_SOURCE)) {
      return { url: transactionShim, format: 'module', shortCircuit: true }
    }
    return resolved
  },
})
