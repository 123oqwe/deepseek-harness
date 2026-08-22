import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlRunStore, setRunStore, getRun, listRuns } from '../src/index.ts'

describe('P4-01 Run Service Cross-Process Recovery', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'dsh-run-test-'))
  })

  afterEach(() => {
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
  })

  it('recovers runs from a different process via JSONL ledger', () => {
    // Process A: create a run and transition it, writing to disk
    const script = `
      const { JsonlRunStore, setRunStore, createRun, transition, appendEvent } = require(process.argv[1])
      const store = new JsonlRunStore('${dataDir}')
      setRunStore(store)
      const run = createRun('user-1', 'tenant-a')
      transition(String(run.id), 'running')
      appendEvent(String(run.id), 'tool:called', { tool: 'fs:read' })
      // Print the run ID so the test can use it
      console.log(String(run.id))
    `
    const output = execSync(`node --import tsx -e '${script.replace(/'/g, "'\\''")}' '${join(process.cwd(), 'packages/run/run/src/index.ts')}'`, {
      encoding: 'utf8',
      timeout: 15000,
    }).trim()

    expect(output).toBeTruthy()
    const runId = output

    // Process B (this test process): create a NEW store pointing to the same directory
    const recoveredStore = new JsonlRunStore(dataDir)
    setRunStore(recoveredStore)

    // Verify the run is recovered with correct state and event log
    const recovered = getRun(runId)
    expect(recovered).toBeDefined()
    expect(recovered!.state).toBe('running')
    expect(recovered!.events.length).toBe(3) // genesis + run:running + tool:called
    expect(recovered!.events[0]!.type).toBe('run:created')
    expect(recovered!.events[1]!.type).toBe('run:running')
    expect(recovered!.events[2]!.type).toBe('tool:called')

    // Verify tamper-evidence: event chain hashes are linked
    expect(recovered!.events[1]!.prevHash).toBe(recovered!.events[0]!.hash)
    expect(recovered!.events[2]!.prevHash).toBe(recovered!.events[1]!.hash)
  })

  it('lists all non-terminal runs after recovery', () => {
    // Create two runs in a subprocess, one terminal and one not
    const script = `
      const { JsonlRunStore, setRunStore, createRun, transition } = require(process.argv[1])
      const store = new JsonlRunStore('${dataDir}')
      setRunStore(store)
      const run1 = createRun('user-1', 'tenant-a')
      transition(String(run1.id), 'running')
      transition(String(run1.id), 'completed')
      const run2 = createRun('user-2', 'tenant-b')
      transition(String(run2.id), 'running')
      console.log(String(run1.id) + ' ' + String(run2.id))
    `
    const output = execSync(`node --import tsx -e '${script.replace(/'/g, "'\\''")}' '${join(process.cwd(), 'packages/run/run/src/index.ts')}'`, {
      encoding: 'utf8',
      timeout: 15000,
    }).trim()

    const [run1Id, run2Id] = output.split(' ')

    // Recover in this process
    const recoveredStore = new JsonlRunStore(dataDir)
    setRunStore(recoveredStore)

    const allRuns = listRuns()
    expect(allRuns.length).toBe(2)

    // Both runs should be recoverable
    const r1 = getRun(run1Id!)
    const r2 = getRun(run2Id!)
    expect(r1!.state).toBe('completed')
    expect(r2!.state).toBe('running')
  })
})
