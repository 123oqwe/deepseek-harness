export function redact(text: string, replacements: Record<string, string> = {}): string {
  let result = text
  result = result.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED-SSN]')
  result = result.replace(/[\w.%+-]+@[\w.-]+\w{2,}/gi, '[REDACTED-EMAIL]')
  result = result.replace(/\b\d{16}\b/g, '[REDACTED-CC]')
  result = result.replace(/(password|passwd|secret|token|api[._-]?key)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
  for (const [find, replace] of Object.entries(replacements)) {
    result = result.replace(new RegExp(find, 'gi'), replace)
  }
  return result
}
