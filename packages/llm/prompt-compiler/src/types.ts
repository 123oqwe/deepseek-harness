export type ProviderType = 'openai' | 'anthropic' | 'deepseek' | 'local'

export interface ProviderCapability {
  readonly provider: ProviderType
  readonly supportsSystemPrompt: boolean
  readonly supportsToolCalls: boolean
  readonly supportsJsonMode: boolean
  readonly supportsVision: boolean
  readonly maxContextTokens: number
  readonly stopSequenceLimit: number
}

export interface CompiledPrompt {
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly toolDefinitions: readonly string[]
  readonly stopSequences: readonly string[]
  readonly jsonMode: boolean
  readonly provider: ProviderType
  readonly warnings: readonly string[]
}
