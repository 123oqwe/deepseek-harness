export type { PluginHostConfig, HostRequest, HostResponse, HostCrash } from '@deepseek-ai/dsh-plugin-host-protocol'
export { spawnPlugin, crashPlugin, terminatePlugin, getPlugin, isIsolated, clearPlugins } from './supervisor.ts'
export { sendRequest, handleResponse, getPendingCount, clearPending } from './rpc.ts'
