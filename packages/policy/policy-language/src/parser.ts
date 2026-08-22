export type PolicyExpr =
  | { type: 'deny'; capability: string; reason: string }
  | { type: 'allow'; capability: string; condition?: string }
  | { type: 'require-approval'; capability: string; approver: string }
  | { type: 'limit'; capability: string; maxActions: number; window: number }

export function parseRule(line: string): PolicyExpr | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const denyMatch = trimmed.match(/^deny\s+(.+)\s+because\s+"(.*)"$/)
  if (denyMatch) return { type: 'deny', capability: denyMatch[1] ?? '', reason: denyMatch[2] ?? '' }
  const allowMatch = trimmed.match(/^allow\s+(.+?)(?:\s+when\s+(.+))?$/)
  if (allowMatch) return { type: 'allow', capability: allowMatch[1] ?? '', ...(allowMatch[2] !== undefined && { condition: allowMatch[2] }) }
  const approvalMatch = trimmed.match(/^require-approval\s+(.+)\s+from\s+(.+)$/)
  if (approvalMatch) return { type: 'require-approval', capability: approvalMatch[1] ?? '', approver: approvalMatch[2] ?? '' }
  const limitMatch = trimmed.match(/^limit\s+(.+)\s+to\s+(\d+)\s+actions\s+per\s+(\d+)\s+seconds$/)
  if (limitMatch) return { type: 'limit', capability: limitMatch[1] ?? '', maxActions: parseInt(limitMatch[2] ?? '0'), window: parseInt(limitMatch[3] ?? '0') }
  return null
}

export function parsePolicy(text: string): PolicyExpr[] {
  return text.split('\n').map(parseRule).filter((r): r is PolicyExpr => r !== null)
}
