/**
 * notes-plugin's 1 -> 2 migration module, declared in its package.json
 * `dsh.migrations`.
 *
 * `descriptor` is the unit version 2 opens, and the one the product migrates
 * and health-checks (`resolvePluginUpgrade` in apps/cli/src/plugin-migration.ts
 * takes the last step's `descriptor`). It is written here, not imported, so a
 * reader that loads this module gets this file's value and nothing cached from
 * another file at the same path.
 *
 * `migrate` adds one record, so a store at version 2 differs from one at
 * version 1 in content as well as in stamp. `P1_10_PLUGIN_KILL` (`migrate` or
 * `validate`) SIGKILLs the process inside that step, and
 * `P1_10_PLUGIN_REFUSE=1` makes `validate` refuse; the P1-10 crash campaign
 * sets them and nothing else does.
 */
export const descriptor = { name: 'notes', version: 2, tables: ['notes'], hasGlobal: false }

export function migrate(content) {
  if (process.env.P1_10_PLUGIN_KILL === 'migrate') process.kill(process.pid, 'SIGKILL')
  const notes = content.tables.notes ?? {}
  return Promise.resolve({
    global: content.global,
    tables: { ...content.tables, notes: { ...notes, n2: { body: 'migrated' } } },
  })
}

export function validate(content) {
  if (process.env.P1_10_PLUGIN_KILL === 'validate') process.kill(process.pid, 'SIGKILL')
  return Promise.resolve(process.env.P1_10_PLUGIN_REFUSE !== '1' && content.tables.notes?.n2 !== undefined)
}
