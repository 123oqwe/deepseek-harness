import type { HostRequest, HostResponse } from '@deepseek-ai/dsh-plugin-host-protocol'

const pendingRequests = new Map<string,
  { resolve: (r: HostResponse) => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }>()

export function sendRequest(req: HostRequest, timeout: number = 30000): Promise<HostResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(req.id)
      reject(new Error(`Request ${req.id} timed out after ${timeout}ms`))
    }, timeout)
    pendingRequests.set(req.id, { resolve, reject, timeout: timer })
    // In production, this would send over IPC/stdio to the child process
    // For now, immediately resolve with a mock response
    resolve({ id: req.id, ok: true, result: { method: req.method, processed: true } })
    clearTimeout(timer)
    pendingRequests.delete(req.id)
  })
}

export function handleResponse(resp: HostResponse): void {
  const pending = pendingRequests.get(resp.id)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingRequests.delete(resp.id)
  if (resp.ok) {
    pending.resolve(resp)
  } else {
    pending.reject(new Error(resp.error?.message ?? 'unknown error'))
  }
}

export function getPendingCount(): number {
  return pendingRequests.size
}

export function clearPending(): void {
  for (const { timeout } of pendingRequests.values()) {
    clearTimeout(timeout)
  }
  pendingRequests.clear()
}
