/**
 * notes-plugin's Loader row. At start it opens its own data unit through the
 * storage hub, as a plugin that keeps data does before it serves anything.
 *
 * When `P1_10_HARNESS_REPORT` names a file, the row writes there what it saw —
 * its own package version, the unit's stamp, and whether its descriptor opened
 * the unit and which `notes` records it read — and stops the process with
 * SIGTERM once the tree has settled. The P1-10 crash campaign sets the
 * variable; nothing else does.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { descriptor } from './descriptor.js'

export const name = 'notes-plugin'
export const inject = ['storage']

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * Open the unit with this version's descriptor and read its `notes` table.
 * @param backend - the storage hub's `json` backend.
 * @returns whether the unit opened, with its records or the refusal.
 */
async function openOwnUnit(backend) {
  let unit
  try {
    unit = await backend.kv.open(descriptor)
  } catch (error) {
    // A refused open is what this row reports: this code cannot open this data.
    return { opened: false, error: error instanceof Error ? error.message : String(error) }
  }
  try {
    return { opened: true, rows: (await unit.loadAll()).tables.notes }
  } finally {
    await unit.close()
  }
}

export function apply(ctx) {
  const report = process.env.P1_10_HARNESS_REPORT
  const observing = ctx.inject(['storage.backend.json'], async (inner) => {
    const backend = inner.storage.backend.get('json')
    const stamp = await backend.migration.stampedVersion(descriptor)
    const observed = await openOwnUnit(backend)
    if (report !== undefined) writeFileSync(report, `${JSON.stringify({ code: version, stamp, ...observed })}\n`)
  })
  return Promise.resolve(observing).then(() => {
    if (report !== undefined) void ctx.loader.await().then(() => { process.kill(process.pid, 'SIGTERM') })
  })
}
