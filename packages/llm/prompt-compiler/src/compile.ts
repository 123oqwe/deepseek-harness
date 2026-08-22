import type { ProviderCapability, CompiledPrompt, ProviderType } from './types.ts'

const CAPABILITIES: Record<ProviderType, ProviderCapability> = {
  openai: {
    provider: 'openai',
    supportsSystemPrompt: true, supportsToolCalls: true,
    supportsJsonMode: true, supportsVision: true,
    maxContextTokens: 128000, stopSequenceLimit: 4,
  },
  anthropic: {
    provider: 'anthropic',
    supportsSystemPrompt: true, supportsToolCalls: true,
    supportsJsonMode: false, supportsVision: true,
    maxContextTokens: 200000, stopSequenceLimit: 4,
  },
  deepseek: {
    provider: 'deepseek',
    supportsSystemPrompt: true, supportsToolCalls: true,
    supportsJsonMode: true, supportsVision: false,
    maxContextTokens: 64000, stopSequenceLimit: 4,
  },
  local: {
    provider: 'local',
    supportsSystemPrompt: false, supportsToolCalls: false,
    supportsJsonMode: false, supportsVision: false,
    maxContextTokens: 8000, stopSequenceLimit: 2,
  },
}

export interface CompileInput {
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly toolDefinitions: readonly string[]
  readonly stopSequences: readonly string[]
  readonly jsonMode: boolean
}

export function getCapability(provider: ProviderType): ProviderCapability {
  return CAPABILITIES[provider]
}

export function compilePrompt(input: CompileInput, provider: ProviderType): CompiledPrompt {
  const caps = getCapability(provider)
  const warnings: string[] = []

  const systemPrompt = caps.supportsSystemPrompt ? input.systemPrompt : ''
  if (!caps.supportsSystemPrompt && input.systemPrompt) {
    warnings.push('System prompt not supported, prepended to user prompt')
  }

  const toolDefinitions = caps.supportsToolCalls ? input.toolDefinitions : []
  if (!caps.supportsToolCalls && input.toolDefinitions.length > 0) {
    warnings.push('Tool calls not supported, tool definitions omitted')
  }

  const stopSequences = input.stopSequences.slice(0, caps.stopSequenceLimit)
  if (input.stopSequences.length > caps.stopSequenceLimit) {
    warnings.push(`Stop sequences truncated to ${caps.stopSequenceLimit}`)
  }

  const jsonMode = caps.supportsJsonMode && input.jsonMode
  if (input.jsonMode && !caps.supportsJsonMode) {
    warnings.push('JSON mode not supported')
  }

  const userPrompt = !caps.supportsSystemPrompt && input.systemPrompt
    ? `${input.systemPrompt}\n\n${input.userPrompt}`
    : input.userPrompt

  return { systemPrompt, userPrompt, toolDefinitions, stopSequences, jsonMode, provider, warnings }
}
