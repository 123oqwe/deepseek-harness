import { createHash } from 'node:crypto'
import type { OutcomePackage } from './types.ts'

export type { OutcomePackage } from './types.ts'

export function buildOutcomePackage(
  runId: string,
  opts: Omit<OutcomePackage, 'runId' | 'contentDigest' | 'signature'>,
): OutcomePackage {
  const contentDigest = createHash('sha256').update(JSON.stringify({
    runId, finalAnswer: opts.finalAnswer, artifacts: opts.artifacts,
    stateDiffs: opts.stateDiffs, actionTrace: opts.actionTrace,
    verificationReport: opts.verificationReport, costs: opts.costs,
  })).digest('hex')
  const signature = createHash('sha256').update(`${contentDigest}:${runId}`).digest('hex')
  return { ...opts, runId, contentDigest, signature }
}

export function verifyOutcomePackage(pkg: OutcomePackage): boolean {
  const expectedDigest = createHash('sha256').update(JSON.stringify({
    runId: pkg.runId, finalAnswer: pkg.finalAnswer, artifacts: pkg.artifacts,
    stateDiffs: pkg.stateDiffs, actionTrace: pkg.actionTrace,
    verificationReport: pkg.verificationReport, costs: pkg.costs,
  })).digest('hex')
  return expectedDigest === pkg.contentDigest
}
