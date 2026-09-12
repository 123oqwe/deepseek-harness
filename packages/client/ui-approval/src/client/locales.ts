/** `approval` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  'detail.aria': '审批详情',
  escalation: '工具 {toolName} 请求越权执行',
  reject: '拒绝',
  allowOnce: '允许一次',
  'detail.resource': '对象',
  'detail.expected': '预期变更',
  'detail.arguments': '参数(已脱敏)',
  'detail.risk': '风险等级',
  'detail.digest': 'Manifest 摘要',
  'detail.expires': '批准有效至',
} satisfies Record<string, string>

/** Approval dictionary key union. */
export type ApprovalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  waiting: 'Waiting for approval',
  'detail.aria': 'Approval details',
  escalation: 'Tool {toolName} requests privileged execution',
  reject: 'Reject',
  allowOnce: 'Allow once',
  'detail.resource': 'Resource',
  'detail.expected': 'Expected change',
  'detail.arguments': 'Arguments (redacted)',
  'detail.risk': 'Risk class',
  'detail.digest': 'Manifest digest',
  'detail.expires': 'Approval valid until',
} satisfies Record<ApprovalKey, string>
