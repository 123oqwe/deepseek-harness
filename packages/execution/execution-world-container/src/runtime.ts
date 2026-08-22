import type { ContainerSpec, ContainerHandle, ContainerAttestation } from './types.ts'
import { verifyImageDigest } from './images.ts'

export class ContainerRuntime {
  private containers = new Map<string, ContainerHandle>()

  create(spec: ContainerSpec): { handle?: ContainerHandle; error?: string } {
    const digestCheck = verifyImageDigest(spec.image)
    if (!digestCheck.valid) {
      return { error: digestCheck.reason }
    }

    if (spec.mountDockerSocket) {
      return { error: 'Docker socket mount is forbidden' }
    }

    if (spec.mountHostHome) {
      return { error: 'Host home mount is forbidden' }
    }

    const id = `container-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const handle: ContainerHandle = {
      id,
      spec,
      createdAt: Date.now(),
      status: 'running',
    }
    this.containers.set(id, handle)
    return { handle }
  }

  terminate(id: string): { terminated: boolean; reason: string } {
    const handle = this.containers.get(id)
    if (!handle) return { terminated: false, reason: 'not found' }
    this.containers.delete(id)
    return { terminated: true, reason: 'terminated' }
  }

  attest(id: string): ContainerAttestation | undefined {
    const handle = this.containers.get(id)
    if (!handle) return undefined
    return {
      imageDigest: handle.spec.image.digest,
      rootless: handle.spec.image.rootless,
      readOnlyRootfs: handle.spec.image.readOnlyRootfs,
      noDockerSocket: !handle.spec.mountDockerSocket,
      noHostHome: !handle.spec.mountHostHome,
      egressProxyEnabled: handle.spec.egressProxy,
    }
  }

  cleanup(): { removed: number } {
    const count = this.containers.size
    this.containers.clear()
    return { removed: count }
  }

  getContainer(id: string): ContainerHandle | undefined {
    return this.containers.get(id)
  }
}
