import { describe, it, expect, beforeEach } from 'vitest'
import { EvalRunner } from '../../eval-runner/src/index.ts'
import { EvalRegistry } from '../../eval-registry/src/index.ts'
import { ChampionChallenger } from '../../champion-challenger/src/index.ts'
import { EvolutionProposalManager } from '../src/index.ts'
import type { EvalConfig, EvalMetrics } from '../../eval/src/types.ts'

function makeMetrics(overrides: Partial<EvalMetrics> = {}): EvalMetrics {
  return {
    verifiedTaskSuccess: 0.9,
    policyViolations: 0,
    duplicateSideEffects: 0,
    recoveryRate: 1,
    routerRegret: 0.05,
    cost: 100,
    latencyMs: 5000,
    humanInterventions: 0,
    memoryPollution: 0,
    evidenceCompleteness: 1,
    ...overrides,
  }
}

describe('P7-10 Evaluation Plane & Champion-Challenger', () => {
  let runner: EvalRunner
  let registry: EvalRegistry

  beforeEach(() => {
    runner = new EvalRunner()
    registry = new EvalRegistry()
  })

  it('runs eval and produces result', async () => {
    const config: EvalConfig = { mode: 'offline-replay' }
    const result = await runner.run('cand-1', config, async () => makeMetrics())
    expect(result.evalId).toMatch(/^eval-/)
    expect(result.metrics.verifiedTaskSuccess).toBe(0.9)
    expect(result.replayable).toBe(true)
  })

  it('registry stores and retrieves results', async () => {
    const config: EvalConfig = { mode: 'shadow' }
    const result = await runner.run('cand-1', config, async () => makeMetrics())
    registry.register(result, 'v1.0', 'config-hash-1')
    const stored = registry.get(result.evalId)
    expect(stored?.candidateId).toBe('cand-1')
    expect(stored?.codeVersion).toBe('v1.0')
  })

  it('champion-challenger compares metrics', async () => {
    const cc = new ChampionChallenger('champ')
    const champResult = { evalId: 'e1', candidateId: 'champ', metrics: makeMetrics({ verifiedTaskSuccess: 0.9, cost: 100 }), replayable: true, auditable: true }
    const challResult = { evalId: 'e2', candidateId: 'chall', metrics: makeMetrics({ verifiedTaskSuccess: 0.95, cost: 80 }), replayable: true, auditable: true }
    cc.registerResult(champResult)
    cc.registerResult(challResult)
    const comparison = cc.compare('chall')
    expect(comparison.successRateDelta).toBeGreaterThan(0)
    expect(comparison.challengerBetter).toBe(true)
    expect(comparison.autoRollbackTriggered).toBe(false)
  })

  it('auto-rollback triggers on success rate degradation', async () => {
    const cc = new ChampionChallenger('champ')
    cc.registerResult({ evalId: 'e1', candidateId: 'champ', metrics: makeMetrics({ verifiedTaskSuccess: 0.9 }), replayable: true, auditable: true })
    cc.registerResult({ evalId: 'e2', candidateId: 'chall', metrics: makeMetrics({ verifiedTaskSuccess: 0.8 }), replayable: true, auditable: true })
    const comparison = cc.compare('chall')
    expect(comparison.autoRollbackTriggered).toBe(true)
  })

  it('non-auto-evolvable components cannot be auto-evolved', () => {
    expect(ChampionChallenger.isNonAutoEvolvable('trust-kernel')).toBe(true)
    expect(ChampionChallenger.isNonAutoEvolvable('router')).toBe(false)
  })

  it('evolution proposal advances through stages', () => {
    const mgr = new EvolutionProposalManager()
    const proposal = mgr.create('router', 'router', 'Test new router strategy')
    expect(proposal.status).toBe('draft')
    const step1 = mgr.advance(proposal.id)
    expect(step1?.status).toBe('static-scan')
    const step2 = mgr.advance(proposal.id)
    expect(step2?.status).toBe('offline-eval')
  })

  it('evolution proposal gets signed when published', () => {
    const mgr = new EvolutionProposalManager()
    const proposal = mgr.create('plugin', 'plugin', 'New plugin version')
    for (let i = 0; i < 6; i++) mgr.advance(proposal.id)
    const published = mgr.get(proposal.id)
    expect(published?.status).toBe('published')
    expect(published?.signedBy).toBeDefined()
  })

  it('non-auto-evolvable component proposal is rejected', () => {
    const mgr = new EvolutionProposalManager()
    const proposal = mgr.create('trust-kernel', 'policy', 'Modify trust kernel')
    const result = mgr.advance(proposal.id)
    expect(result?.status).toBe('rejected')
  })

  it('canary mode with threshold', async () => {
    const config: EvalConfig = {
      mode: 'canary',
      canaryThreshold: { maxSuccessRateDegradation: 0.03 },
    }
    const result = await runner.run('cand-1', config, async () => makeMetrics())
    expect(result.metrics.verifiedTaskSuccess).toBe(0.9)
  })

  it('A/B mode is supported', async () => {
    const config: EvalConfig = { mode: 'ab' }
    const result = await runner.run('cand-1', config, async () => makeMetrics())
    expect(result.auditable).toBe(true)
  })
})
