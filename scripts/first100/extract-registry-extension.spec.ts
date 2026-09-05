import { describe, expect, it } from 'vitest'
import { triageLineFor } from './extract-registry-extension.mjs'

const TRIAGE = [
  '## 二、9 个 P9 扩展项',
  '- **P9-02（激活 pi-ai 多协议路由）≈ 冗余 → 大幅缩**: 已 ship。',
  '- **P9-01（conformance kit）= 部分**: 缩成抽可复用 kit。',
  '- **P9-04/05/06/07/08/09 = 全缺，照做**：编辑容错回退 / 真 tokenizer。',
  'not a bullet: P9-99 mentioned in prose',
].join('\n')

describe('triageLineFor (P9 Stage-0, 2026-09-06)', () => {
  it('finds an item named directly on its own line', () => {
    expect(triageLineFor('P9-01', TRIAGE)).toContain('conformance kit')
  })

  it('finds an item named only inside a grouped line', () => {
    expect(triageLineFor('P9-06', TRIAGE)).toContain('全缺')
  })

  it('finds the first and last members of a grouped line, not just the leading id', () => {
    expect(triageLineFor('P9-04', TRIAGE)).toContain('全缺')
    expect(triageLineFor('P9-09', TRIAGE)).toContain('全缺')
  })

  it('returns null for an item the document never mentions, so the caller can fail closed', () => {
    expect(triageLineFor('P9-03', TRIAGE)).toBeNull()
  })

  it('ignores a mention outside a bullet, which is prose rather than a verdict', () => {
    expect(triageLineFor('P9-99', TRIAGE)).toBeNull()
  })
})
