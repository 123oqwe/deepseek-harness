import type { EvalResult } from './types.ts'
import { createHash } from 'node:crypto'

export class EvalRegistry {
  private results = new Map<string, EvalResult & { codeVersion: string; configHash: string }>()

  register(result: EvalResult, codeVersion: string, configHash: string): void {
    const hash = createHash('sha256').update(JSON.stringify({ result, codeVersion, configHash })).digest('hex')
    this.results.set(hash, { ...result, codeVersion, configHash })
  }

  get(evalId: string): (EvalResult & { codeVersion: string; configHash: string }) | undefined {
    return Array.from(this.results.values()).find(r => r.evalId === evalId)
  }

  listAll(): readonly (EvalResult & { codeVersion: string; configHash: string })[] {
    return Array.from(this.results.values())
  }

  clear(): void {
    this.results.clear()
  }
}
