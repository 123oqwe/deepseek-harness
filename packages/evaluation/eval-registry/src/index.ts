import type { EvalResult } from '@deepseek-ai/dsh-eval'
import { createHash } from 'node:crypto'

export class EvalRegistry {
  // eslint-disable-next-line no-redundant-type-constituents
  private results = new Map<string, EvalResult & { codeVersion: string; configHash: string }>()

  register(result: EvalResult, codeVersion: string, configHash: string): void {
    // eslint-disable-next-line no-unsafe-assignment
    const hash = createHash('sha256').update(JSON.stringify({ result, codeVersion, configHash })).digest('hex')
    this.results.set(hash, { ...result, codeVersion, configHash })
  }

  // eslint-disable-next-line no-redundant-type-constituents
  // eslint-disable-next-line no-redundant-type-constituents
  get(evalId: string): (EvalResult & { codeVersion: string; configHash: string }) | undefined {
    // eslint-disable-next-line no-unsafe-member-access
    return Array.from(this.results.values()).find(r => r.evalId === evalId)
  }

  // eslint-disable-next-line no-redundant-type-constituents
  listAll(): readonly (EvalResult & { codeVersion: string; configHash: string })[] {
    // eslint-disable-next-line no-unsafe-return
    return Array.from(this.results.values())
  }

  clear(): void {
    this.results.clear()
  }
}
