#!/usr/bin/env node
/**
 * Test driver: boot the P2-10 Provider-stage Loader composition against a real
 * settings document, then make the document go bad while the harness is
 * running, and record what the namespace holds at each step to
 * `./policy-loader-report.json` for the package spec's inspect step.
 *
 * The point of doing this through a real boot rather than a hand-built context
 * is that the behaviour under test is not this package's: it is what
 * `@deepseek-ai/dsh-settings` does to a registration whose `validate` says no.
 * A hand-mounted registry would let this fixture supply its own answer.
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { POLICY_SET_NAMESPACE, type PolicySetValue } from '@deepseek-ai/dsh-policy-language'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('policy-language driver requires a config path')

/** The document path the fixture composition configures, relative to the run cwd. */
const documentPath = join(process.cwd(), 'settings.yaml')

/**
 * Replace the settings document ATOMICALLY.
 *
 * A plain `writeFile` truncates before it writes, and the provider's watcher can
 * read that truncated moment. With a composition baseline underneath, an empty
 * document is not an error — it resolves to the baseline alone, which is a
 * VALID set, so it commits and the previous value is gone. The last-good
 * mechanism does not save it, because nothing failed. Writing to a sibling and
 * renaming makes the document go from one complete state to another.
 * @param body - the document's complete next text.
 */
async function replaceDocument(body: string): Promise<void> {
  const staging = `${documentPath}.next`
  await writeFile(staging, body, 'utf8')
  await rename(staging, documentPath)
}

/** Wait until `read` reports a change, or give up and let the caller record what it saw. */
async function settle<T>(read: () => T, changed: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000
  let value = read()
  while (Date.now() < deadline && !changed(value)) {
    await new Promise(resolve => setTimeout(resolve, 20))
    value = read()
  }
  return value
}

const ctx = await boot('p2-10-policy-loader', resolveConfigPath(configPath, undefined))
try {
  const registered = ctx.settings.describe().map(descriptor => descriptor.ns)
  const atBoot = ctx.settings.get(POLICY_SET_NAMESPACE) as PolicySetValue

  // An EXTERNAL edit, the way an operator editing the document by hand makes
  // one: written straight to the file, not through `settings.update`, so what
  // reacts is the provider's watcher and not a write this process validated.
  await replaceDocument([
    `${POLICY_SET_NAMESPACE}:`,
    '  policies:',
    '    typo: \'permit(principal, action, resource) when { context.tyop == 1 };\'',
    '',
  ].join('\n'))

  // The value must NOT change. Settle on the opposite condition so the wait
  // ends early if it wrongly does, and otherwise costs the full window once.
  const afterBadEdit = await settle(
    () => ctx.settings.get(POLICY_SET_NAMESPACE) as PolicySetValue,
    value => !Object.hasOwn(value.policies, 'baseline-permit'),
  )

  // A good edit afterwards must still land: keeping the last good value is not
  // the same as latching, and a namespace that never recovered would be worse
  // than one that took the bad set.
  await replaceDocument([
    `${POLICY_SET_NAMESPACE}:`,
    '  policies:',
    '    recovered: \'permit(principal, action, resource) when { context.riskClass == "low" };\'',
    '',
  ].join('\n'))
  const afterGoodEdit = await settle(
    () => ctx.settings.get(POLICY_SET_NAMESPACE) as PolicySetValue,
    value => Object.hasOwn(value.policies, 'recovered'),
  )

  // Override the BASELINE id from the user layer: the composition supplies
  // `shipped-forbid`, and a deployment naming the same id must replace that one
  // policy without disturbing the rest of the baseline.
  await replaceDocument([
    `${POLICY_SET_NAMESPACE}:`,
    '  policies:',
    '    shipped-forbid: \'forbid(principal, action, resource) when { context.world == "absent" };\'',
    '',
  ].join('\n'))
  const afterOverride = await settle(
    () => ctx.settings.get(POLICY_SET_NAMESPACE) as PolicySetValue,
    value => (value.policies['shipped-forbid'] ?? '').includes('world'),
  )

  // A write THROUGH the service, which is the only path that persists: the
  // provider writes back what it resolved, so this is where a derived `pin`
  // would leak into the deployment's own document if the schema transformed the
  // stored value as well as the resolved one.
  await ctx.settings.update(POLICY_SET_NAMESPACE, {
    policies: { written: 'permit(principal, action, resource) when { context.world == "bound" };' },
  })
  const afterWrite = ctx.settings.get(POLICY_SET_NAMESPACE) as PolicySetValue

  await writeFile(join(process.cwd(), 'policy-loader-report.json'), JSON.stringify({
    registered,
    atBootIds: Object.keys(atBoot.policies).sort(),
    afterBadEditIds: Object.keys(afterBadEdit.policies).sort(),
    afterGoodEditIds: Object.keys(afterGoodEdit.policies).sort(),
    // The pins as READ FROM THE NAMESPACE at each step, which is what makes a
    // reload's effect observable: the bad edit must leave the pin untouched
    // along with the set, and the good one must move it.
    atBootPin: atBoot.pin,
    afterBadEditPin: afterBadEdit.pin,
    afterGoodEditPin: afterGoodEdit.pin,
    // The document itself must not have grown a `pin` key: it is derived, and
    // writing it back would put a value nobody authored into a deployment's own
    // configuration file.
    afterOverrideSource: afterOverride.policies['shipped-forbid'],
    afterWritePin: afterWrite.pin,
    documentText: await readFile(documentPath, 'utf8'),
  }), 'utf8')
} finally {
  await ctx.fiber.dispose()
}
