/** `host-control` namespace dictionaries. */

/** Dictionary namespace owned by the host-stop indicator. */
export const NS = 'host-control'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'stopped.title': '主机已停机',
  'stopped.reason': '原因:{reason}',
  'stopped.requestedBy': '请求者:{requestedBy}',
  'stopped.requestedAt': '时间:{at}',
  'stopped.aria': '主机已停机',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<HostControlKey, string> = {
  'stopped.title': 'Host stopped',
  'stopped.reason': 'Reason: {reason}',
  'stopped.requestedBy': 'Requested by: {requestedBy}',
  'stopped.requestedAt': 'At: {at}',
  'stopped.aria': 'Host stopped',
}

/** Key domain of the `host-control` namespace (zh is the source of truth). */
export type HostControlKey = keyof typeof zh
