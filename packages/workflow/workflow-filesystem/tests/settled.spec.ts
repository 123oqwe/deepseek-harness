/**
 * B-729: the loader says when its load has finished, so a step that lists the
 * saved workflows can wait for it.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SavedWorkflowLoader from '../src/index.ts'

const previousHome = process.env.DSH_HOME
const roots: string[] = []
afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('B-729: the saved-workflow loader settles', () => {
  it('settles with no failure once its load over an empty home has finished', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-saved-workflows-settled-'))
    roots.push(root)
    process.env.DSH_HOME = root
    const ctx = new Context()
    ctx.provide('workflowEngine', { registerDefinition() { /* an empty home registers nothing */ } })
    await ctx.plugin(SavedWorkflowLoader)

    await expect(ctx.savedWorkflows.settled).resolves.toEqual({})
  })
})
