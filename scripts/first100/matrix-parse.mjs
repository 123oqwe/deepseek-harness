/**
 * Parsing for the First-100 requirements-matrix document format.
 *
 * Extracted from `./extract-registry.mjs` so the Phase-9 extension generator
 * parses its matrix with the SAME function rather than a copy. A second parser
 * would drift from this one silently, and the two documents it reads are in
 * one format on purpose.
 *
 * This module is pure and side-effect free. `extract-registry.mjs` performs its
 * whole extraction at import time, so importing it to borrow a helper would run
 * a registry regeneration as a side effect -- which is why the helper lives
 * here instead.
 *
 * @module scripts/first100/matrix-parse
 */

/** Matches a `- **Label：**value` field line. */
const FIELD_RX = /^- \*\*(.+?)：\*\*(.*)$/

/**
 * The header pattern accepts `P0`..`P9`. The canonical document contains only
 * `P0`..`P8` sections, so widening it changes nothing there; `P9` is the Phase-9
 * extension (items 101-109) that maintainer decision C3 authorized, and the
 * narrower pattern was the one thing actually preventing it from being read.
 *
 * Parse a matrix-format doc (`### P#-## — Title` headers, then
 * `- **Label：**value` fields) into `id -> {title, line, fields}`. Shared
 * by the canonical `first100-requirements-matrix.md` and any BLOCKED-037
 * new-gap matrix doc -- identical parsing, identical trust level; the only
 * difference is which SHA-pinned file is handed in.
 */
export function parseMatrixText(text) {
  const matrix = new Map()
  let currentId = null
  let currentTitle = null
  let currentLine = 0
  let currentFields = null
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const head = line.match(/^###\s+(P[0-9]-\d{2})\s+[—-]\s*(.+)$/)
    if (head) {
      if (currentId) matrix.set(currentId, { title: currentTitle, line: currentLine, fields: currentFields })
      currentId = head[1]
      currentTitle = head[2].trim()
      currentLine = i + 1
      currentFields = {}
      continue
    }
    if (!currentId) continue
    const m = line.match(FIELD_RX)
    if (m) {
      const label = m[1].trim()
      const value = m[2].trim()
      // group field labels into canonical keys
      let key = null
      if (label.startsWith('Priority / Wave')) key = 'priorityWave'
      else if (label.startsWith('Files')) key = 'files'
      else if (label.startsWith('MUST')) key = 'must'
      else if (label.startsWith('明确 non-goal')) key = 'nonGoal'
      else if (label.startsWith('Acceptance')) key = 'acceptance'
      else if (label.startsWith('Validation')) key = 'validation'
      else if (label.startsWith('验证命令')) key = 'verifyCommand'
      else if (label.startsWith('真实任务证据')) key = 'realTask'
      else if (label.startsWith('规格缺口')) key = 'specGap'
      else if (label.startsWith('PrimaryLayer')) key = 'primaryLayer' // new-gap docs only; canonical epics get primaryLayer from r0-decision-package.md
      if (key) currentFields[key] = value
    }
  }
  if (currentId) matrix.set(currentId, { title: currentTitle, line: currentLine, fields: currentFields })
  return matrix
}
