import type { TaskProfile } from './types.ts'

export function validateProfile(profile: Partial<TaskProfile>): string[] {
  const errors: string[] = []
  if (!profile.id) errors.push('id is required')
  if (!profile.kind) errors.push('kind is required')
  if (!profile.strategy) errors.push('strategy is required')
  if (!profile.description) errors.push('description is required')
  if (!profile.model) errors.push('model is required')
  if (!profile.provider) errors.push('provider is required')
  if (!profile.tools || !Array.isArray(profile.tools)) errors.push('tools must be an array')
  if (!profile.world) errors.push('world is required')
  if (!profile.budget) errors.push('budget is required')
  if (profile.budget && profile.budget.tokens <= 0) errors.push('budget.tokens must be positive')
  if (!profile.verification) errors.push('verification is required')
  if (!profile.constraints) errors.push('constraints is required')
  return errors
}

export function isValidProfile(profile: Partial<TaskProfile>): boolean {
  return validateProfile(profile).length === 0
}
