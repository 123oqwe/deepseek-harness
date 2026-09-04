import type { Anything } from '@deepseek-ai/dsh-probe-bundle-root'
export function spawnIt(): string {
  return import.meta.resolve('@deepseek-ai/dsh-probe-bundle-root/package.json')
}
export type Re = Anything
