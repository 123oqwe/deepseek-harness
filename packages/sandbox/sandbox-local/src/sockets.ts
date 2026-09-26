/**
 * The host daemon and agent sockets a backend that cannot refuse Unix-domain
 * sockets reports as reachable (first100 registry P3-05 must[1]; BLOCKED-346).
 *
 * The provider looks for sockets through which a command could act with rights
 * the sandbox withholds: container and virtual-machine daemons that start
 * workloads with host mounts, and SSH agents that sign with the user's keys.
 * The package README lists each location with the reason it is included, and
 * the locations deliberately left out. A list is never complete, which is why
 * the bwrap and Seatbelt backends refuse every Unix-domain socket instead of
 * consulting it.
 *
 * @module @deepseek-ai/dsh-sandbox-local/sockets
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Where the search reads its variables and the home directory it expands. */
export interface SocketSearch {
  /** The provider process's environment. */
  readonly env: NodeJS.ProcessEnv
  /** The provider process's home directory. */
  readonly home: string
}

/** Fixed locations under the home directory, relative to it. */
const HOME_SOCKETS = [
  '.docker/run/docker.sock',
  '.docker/desktop/docker.sock',
  '.colima/default/docker.sock',
  '.orbstack/run/docker.sock',
  '.rd/docker.sock',
  '.gnupg/S.gpg-agent.ssh',
  '.1password/agent.sock',
  'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock',
  'Library/Containers/com.maxgoedjen.Secretive.SecretAgent/Data/socket.ssh',
] as const

/** Fixed locations under `$XDG_RUNTIME_DIR`, relative to it. */
const RUNTIME_SOCKETS = [
  'docker.sock',
  'podman/podman.sock',
  'libvirt/libvirt-sock',
  'libvirt/virtqemud-sock',
  'ssh-agent.socket',
  'gnupg/S.gpg-agent.ssh',
  'keyring/ssh',
] as const

/** Fixed absolute locations. */
const SYSTEM_SOCKETS = [
  '/var/run/docker.sock',
  '/run/docker.sock',
  '/run/podman/podman.sock',
  '/var/snap/lxd/common/lxd/unix.socket',
  '/var/lib/lxd/unix.socket',
  '/var/lib/incus/unix.socket',
  '/var/run/libvirt/libvirt-sock',
  '/run/libvirt/libvirt-sock',
  '/run/libvirt/virtqemud-sock',
] as const

/**
 * The entries of one directory, or none when it cannot be read.
 * @param dir - the directory.
 * @returns its entry names.
 */
function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    // Absent or unreadable (another user's agent directory): nothing in it can be named from here.
    return []
  }
}

/**
 * OpenSSH's default agent sockets (the `agent.*` files in `ssh-*` directories
 * under the temp roots) and the macOS launchd agent listener, including agents
 * of other login sessions of the same user.
 * @param env - the environment naming `$TMPDIR`.
 * @returns the sockets' candidate paths.
 */
function tempAgentSockets(env: NodeJS.ProcessEnv): string[] {
  const roots = [...new Set(['/tmp', '/private/tmp', env.TMPDIR].filter((dir): dir is string => dir !== undefined && dir !== ''))]
  return roots.flatMap(root => entriesOf(root).flatMap((name) => {
    if (name.startsWith('com.apple.launchd.')) return [join(root, name, 'Listeners')]
    if (!name.startsWith('ssh-')) return []
    return entriesOf(join(root, name)).filter(entry => entry.startsWith('agent.')).map(entry => join(root, name, entry))
  }))
}

/**
 * The socket path a `unix://` endpoint names.
 * @param endpoint - an endpoint such as `$DOCKER_HOST`.
 * @returns the path, or `undefined` for any other scheme.
 */
function unixPath(endpoint: string | undefined): string | undefined {
  return endpoint?.startsWith('unix://') === true ? endpoint.slice('unix://'.length) : undefined
}

/**
 * Read and parse one JSON file.
 * @param path - the file.
 * @returns the parsed value, or `undefined` when the file is absent or not JSON.
 */
function readJson(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // Absent or unreadable: the Docker CLI has no configuration here either.
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Not JSON: the Docker CLI could not use it either.
    return undefined
  }
}

/**
 * The daemon socket the Docker CLI's current context names: `$DOCKER_CONTEXT`,
 * else `currentContext` in `$DOCKER_CONFIG/config.json` (default
 * `~/.docker`), whose endpoint is stored under
 * `contexts/meta/<sha256 of the name>/meta.json`.
 * @param search - the environment and home directory.
 * @returns the socket path, or `undefined` when the context names none.
 */
function dockerContextSocket({ env, home }: SocketSearch): string | undefined {
  const configDir = env.DOCKER_CONFIG !== undefined && env.DOCKER_CONFIG !== '' ? env.DOCKER_CONFIG : join(home, '.docker')
  const config = readJson(join(configDir, 'config.json'))
  const named = env.DOCKER_CONTEXT !== undefined && env.DOCKER_CONTEXT !== ''
    ? env.DOCKER_CONTEXT
    : typeof config === 'object' && config !== null && typeof (config as { currentContext?: unknown }).currentContext === 'string'
      ? (config as { currentContext: string }).currentContext
      : undefined
  if (named === undefined || named === 'default') return undefined
  const meta = readJson(join(configDir, 'contexts', 'meta', createHash('sha256').update(named).digest('hex'), 'meta.json'))
  const host = (meta as { Endpoints?: { docker?: { Host?: unknown } } } | undefined)?.Endpoints?.docker?.Host
  return typeof host === 'string' ? unixPath(host) : undefined
}

/**
 * Whether a candidate names an existing socket once links are resolved.
 * @param path - one candidate.
 * @returns `true` when it does.
 */
function isSocket(path: string): boolean {
  let resolved: string
  try {
    resolved = realpathSync(path)
  } catch {
    // Absent, a dangling link, or unreadable: nothing a client could reach by this name.
    return false
  }
  return statSync(resolved, { throwIfNoEntry: false })?.isSocket() === true
}

/**
 * The known daemon and agent sockets present on this host, named as a client
 * names them: `$SSH_AUTH_SOCK`, `$DOCKER_HOST`, the Docker CLI's current
 * context, the fixed locations, and OpenSSH's default agent directories.
 * @param search - the environment and home directory to read.
 * @returns the existing sockets' paths, without duplicates, in that order.
 */
export function knownHostSockets(search: SocketSearch): string[] {
  const { env, home } = search
  const runtime = env.XDG_RUNTIME_DIR !== undefined && env.XDG_RUNTIME_DIR !== '' ? env.XDG_RUNTIME_DIR : undefined
  const candidates = [
    env.SSH_AUTH_SOCK,
    unixPath(env.DOCKER_HOST),
    dockerContextSocket(search),
    ...SYSTEM_SOCKETS,
    ...runtime === undefined ? [] : RUNTIME_SOCKETS.map(rel => join(runtime, rel)),
    ...HOME_SOCKETS.map(rel => join(home, rel)),
    ...tempAgentSockets(env),
  ]
  return [...new Set(candidates.filter((path): path is string => path !== undefined && path !== '' && isSocket(path)))]
}
