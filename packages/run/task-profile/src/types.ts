export type TaskKind = 'code' | 'research' | 'external-write' | 'approval' | 'long-run' | 'multi-agent'
export type ExecutionStrategy = 'direct' | 'react' | 'plan' | 'workflow' | 'multi-agent'

export interface TaskProfile {
  readonly id: string
  readonly kind: TaskKind
  readonly strategy: ExecutionStrategy
  readonly description: string
  readonly model: string
  readonly provider: string
  readonly tools: string[]
  readonly world: 'local' | 'container' | 'remote' | 'browser'
  readonly budget: { readonly tokens: number; readonly cost: number; readonly time: number }
  readonly verification: { readonly method: string; readonly criteria: string[] }
  readonly constraints: string[]
}
