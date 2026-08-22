import type { ReplayBundle } from './types.ts'

export class RecordedWorld {
  private observations: Map<string, unknown>
  private networkCallCount = 0
  private writeCallCount = 0

  constructor(bundle: ReplayBundle) {
    this.observations = new Map(bundle.externalObservations)
  }

  observe(key: string): unknown {
    return this.observations.get(key)
  }

  has(key: string): boolean {
    return this.observations.has(key)
  }

  recordNetworkCall(): void {
    this.networkCallCount++
  }

  recordWriteCall(): void {
    this.writeCallCount++
  }

  getNetworkCallCount(): number {
    return this.networkCallCount
  }

  getWriteCallCount(): number {
    return this.writeCallCount
  }
}
