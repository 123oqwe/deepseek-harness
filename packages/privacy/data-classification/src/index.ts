import type { PrivacyLevel, ClassificationRule } from './types.ts'

export type { PrivacyLevel, ClassificationRule } from './types.ts'

const RULES: ClassificationRule[] = [
  { id: 'r1', pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', level: 'pii', description: 'SSN' },
  { id: 'r2', pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z]{2,}\\b', level: 'pii', description: 'Email' },
  { id: 'r3', pattern: '(password|passwd|secret|token|api.key)', level: 'secret', description: 'Secret keyword' },
  { id: 'r4', pattern: '\\b\\d{16}\\b', level: 'restricted', description: 'Credit card' },
]

const LEVEL_ORDER: Record<PrivacyLevel, number> = {
  public: 0, internal: 1, confidential: 2, restricted: 3, pii: 4, secret: 5,
}

export function classify(text: string): { level: PrivacyLevel; matches: { rule: string; level: PrivacyLevel }[] } {
  const matches: { rule: string; level: PrivacyLevel }[] = []
  for (const rule of RULES) {
    const regex = new RegExp(rule.pattern, 'i')
    if (regex.test(text)) {
      matches.push({ rule: rule.id, level: rule.level })
    }
  }
  let highest: PrivacyLevel = 'public'
  for (const m of matches) {
    if (LEVEL_ORDER[m.level] > LEVEL_ORDER[highest]) {
      highest = m.level
    }
  }
  return { level: highest, matches }
}

export function shouldRedact(level: PrivacyLevel, threshold: PrivacyLevel = 'confidential'): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[threshold]
}
