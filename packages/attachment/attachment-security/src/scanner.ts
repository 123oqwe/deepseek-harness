export interface ScanResult {
  readonly safe: boolean
  readonly threats: string[]
  readonly mimeType: string
  readonly _declaredType?: string
  readonly size: number
  readonly compressionRatio?: number
  readonly nestingDepth: number
}

export function detectPathTraversal(path: string): boolean {
  return path.includes('../') || path.includes('..\\') || path.includes('/..')
}

export function sniffMimeType(data: Uint8Array, _declaredType?: string): string {
  if (data.length === 0) return 'application/octet-stream'
  const head = Array.from(data.slice(0, 8))
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'application/pdf'
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03) return 'application/zip'
  if (head[0] === 0x1f && head[1] === 0x8b) return 'application/gzip'
  if (head[0] === 0x4d && head[1] === 0x5a) return 'application/x-msdownload'
  if (head.slice(0, 4).every(b => b === undefined ? false : (b ?? 0) >= 0x20 && (b ?? 0) <= 0x7e)) return 'text/plain'
  return 'application/octet-stream'
}

export function detectCompressionBomb(size: number, uncompressedSize: number): boolean {
  if (uncompressedSize === 0) return false
  return (uncompressedSize / size) > 100
}

export function detectNestedDepth(depth: number, maxDepth: number = 10): boolean {
  return depth > maxDepth
}

export function detectExecutableHeader(data: Uint8Array): boolean {
  if (data.length < 2) return false
  const head = Array.from(data.slice(0, 2))
  return head[0] === 0x4d && head[1] === 0x5a
}

export function scanAttachment(data: Uint8Array, _declaredType?: string, nestingDepth: number = 0): ScanResult {
  const threats: string[] = []
  const mimeType = sniffMimeType(data, _declaredType)

  if (_declaredType && mimeType !== _declaredType) {
    threats.push(`MIME mismatch: declared ${_declaredType}, actual ${mimeType}`)
  }

  if (detectExecutableHeader(data)) {
    threats.push('executable header detected')
  }

  if (detectNestedDepth(nestingDepth)) {
    threats.push(`nesting depth ${nestingDepth} exceeds limit`)
  }

  const size = data.length
  if (size > 100 * 1024 * 1024) {
    threats.push('file size exceeds 100MB')
  }

  return {
    safe: threats.length === 0,
    threats,
    mimeType,
    ...(_declaredType !== undefined && { _declaredType }),
    size,
    nestingDepth,
  }
}
