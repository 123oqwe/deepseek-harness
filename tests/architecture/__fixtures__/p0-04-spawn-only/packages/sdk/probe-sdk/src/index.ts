export function spawnIt(): string {
  return import.meta.resolve('@deepseek-ai/dsh-probe-bundle-root/package.json')
}
