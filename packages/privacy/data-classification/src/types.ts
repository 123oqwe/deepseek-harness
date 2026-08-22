export type PrivacyLevel = 'public' | 'internal' | 'confidential' | 'restricted' | 'pii' | 'secret'

export interface ClassificationRule {
  readonly id: string
  readonly pattern: string
  readonly level: PrivacyLevel
  readonly description: string
}
