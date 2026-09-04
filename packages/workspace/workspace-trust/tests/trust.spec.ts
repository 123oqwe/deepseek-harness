/**
 * Clause coverage for Epic P1-07's project trust boundary. One
 * `it()` per registry-declared must[]/acceptance[] clause (must[2] split
 * into its refuse/admit halves, acceptance[1] split into its three named
 * identity-change vectors plus one unchanged-identity control) that is
 * structurally testable at this Contract level. Every case calls an
 * exported function from `../src/index.ts` against real fixture data.
 */

import { createServicePrincipal, createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { describe, expect, it } from 'vitest'
import {
  authorizeProjectLoad,
  bindWorkspaceTrust,
  downgradeTrust,
  reconcileWorkspaceTrust,
  requestTrustUpgrade,
} from '../src/index.ts'
import type { ProjectContentKind, TrustRecord, WorkspaceIdentity } from '../src/types.ts'

const TENANT = TenantId('acme')
const hostUser = createUserPrincipal(PrincipalId('harry'), TENANT)
const serviceCaller = createServicePrincipal(PrincipalId('ci-bot'), TENANT)

const PROJECT_LEVEL_EXECUTABLE_KINDS: readonly ProjectContentKind[] = [
  'project-plugin',
  'project-hook',
  'mcp-server',
  'executable-skill',
  'home-profile-patch-override',
]

const clonedRepoIdentity: WorkspaceIdentity = {
  canonicalPath: '/home/harry/clones/malicious-repo',
  volume: { device: 1, inode: 1001, createdAtMs: 1_700_000_000_000 },
}

function trustedExecuteRecord(identity: WorkspaceIdentity): TrustRecord {
  return {
    identity,
    state: 'trusted-execute',
    at: '2026-08-31T00:00:00.000Z',
    grantedBy: hostUser.id,
  }
}

describe('P1-07 Contract — must clauses', () => {
  it('must[0]: a freshly bound workspace trust record starts untrusted and carries the full canonical-realpath-plus-inode/volume binding it was bound to', () => {
    const record = bindWorkspaceTrust(clonedRepoIdentity, '2026-08-31T00:00:00.000Z')
    expect(record.state).toBe('untrusted')
    expect(record.identity).toEqual(clonedRepoIdentity)
    expect(record.grantedBy).toBeUndefined()
  })

  it('must[1]: an untrusted workspace permits only safe reads and denies every project plugin/hook/MCP-server/executable-skill/home-profile-patch-override load', () => {
    const safeRead = authorizeProjectLoad('untrusted', 'safe-read')
    expect(safeRead.permitted).toBe(true)

    for (const kind of PROJECT_LEVEL_EXECUTABLE_KINDS) {
      const decision = authorizeProjectLoad('untrusted', kind)
      expect(decision.permitted).toBe(false)
      if (!decision.permitted) {
        expect(decision.reason).toBe('trust-required')
        expect(decision.requiredState).toBe('trusted-execute')
      }
    }
  })

  // The registry `gate` names instructions FIRST among what an untrusted
  // workspace cannot load ("Untrusted workspace cannot load
  // instructions/hooks/skills/MCP or execute"), while validation[1] requires a
  // trusted-read workspace to inject project text as marked plain text. Those
  // two sentences are what make 'project-instructions' a kind of its own: it is
  // the only member whose decision differs between 'untrusted' and
  // 'trusted-read', and so the only reason 'trusted-read' is a distinct state
  // rather than a second spelling of 'untrusted'.
  it("gate: an untrusted workspace denies project instructions, so opening a clone never reads the repository's own AGENTS.md", () => {
    const decision = authorizeProjectLoad('untrusted', 'project-instructions')
    expect(decision.permitted).toBe(false)
    if (!decision.permitted) expect(decision.reason).toBe('trust-required')
  })

  it('validation[1]: a trusted-read workspace permits project instructions as plain text while still denying every project-level executable kind', () => {
    expect(authorizeProjectLoad('trusted-read', 'project-instructions').permitted).toBe(true)
    for (const kind of PROJECT_LEVEL_EXECUTABLE_KINDS) {
      expect(authorizeProjectLoad('trusted-read', kind).permitted).toBe(false)
    }
  })

  it('must[2]: a trust upgrade presented by a non-host principal is refused and produces neither a new record nor an audit entry', () => {
    const current = bindWorkspaceTrust(clonedRepoIdentity, '2026-08-31T00:00:00.000Z')
    const result = requestTrustUpgrade(current, 'trusted-execute', serviceCaller, '2026-08-31T00:05:00.000Z')
    expect(result.upgraded).toBe(false)
    if (!result.upgraded) expect(result.reason).toBe('non-host-principal')
  })

  it('must[2]: a trust upgrade presented by a genuine host user principal succeeds and writes an audit record naming the host principal and the state transition', () => {
    const current = bindWorkspaceTrust(clonedRepoIdentity, '2026-08-31T00:00:00.000Z')
    const result = requestTrustUpgrade(current, 'trusted-execute', hostUser, '2026-08-31T00:05:00.000Z')
    expect(result.upgraded).toBe(true)
    if (result.upgraded) {
      expect(result.record.state).toBe('trusted-execute')
      expect(result.record.identity).toEqual(clonedRepoIdentity)
      expect(result.record.grantedBy).toBe(hostUser.id)
      expect(result.audit.fromState).toBe('untrusted')
      expect(result.audit.toState).toBe('trusted-execute')
      expect(result.audit.hostPrincipalId).toBe(hostUser.id)
      expect(result.audit.identity).toEqual(clonedRepoIdentity)
    }
  })
})

describe('P1-07 Contract — acceptance[0]: clone 一个含恶意配置的仓库并打开，不产生任何子进程、网络或凭证读取', () => {
  it('a trusted-read workspace (never upgraded to trusted-execute) still denies every project-level executable load kind, so opening the clone alone can never reach a subprocess/network/credential-read path', () => {
    for (const kind of PROJECT_LEVEL_EXECUTABLE_KINDS) {
      const decision = authorizeProjectLoad('trusted-read', kind)
      expect(decision.permitted).toBe(false)
      if (!decision.permitted) expect(decision.requiredState).toBe('trusted-execute')
    }
  })
})

describe('P1-07 Contract — acceptance[1]: 目录被替换、symlink 改指、移动后信任不自动继承', () => {
  it('directory replaced: the same canonical path reporting a different device/inode demotes an existing trusted-execute record to untrusted', () => {
    const record = trustedExecuteRecord(clonedRepoIdentity)
    const replaced: WorkspaceIdentity = {
      canonicalPath: clonedRepoIdentity.canonicalPath,
      volume: {
        device: clonedRepoIdentity.volume.device,
        inode: clonedRepoIdentity.volume.inode + 1,
        createdAtMs: clonedRepoIdentity.volume.createdAtMs,
      },
    }
    const reconciled = reconcileWorkspaceTrust(record, replaced, '2026-08-31T01:00:00.000Z')
    expect(reconciled.state).toBe('untrusted')
    expect(reconciled.identity).toEqual(replaced)
    expect(reconciled.grantedBy).toBeUndefined()
  })

  it('symlink retargeted: a different canonical path demotes an existing trusted-execute record to untrusted even when device/inode happen to match', () => {
    const record = trustedExecuteRecord(clonedRepoIdentity)
    const retargeted: WorkspaceIdentity = {
      canonicalPath: '/home/harry/clones/other-repo',
      volume: { ...clonedRepoIdentity.volume },
    }
    const reconciled = reconcileWorkspaceTrust(record, retargeted, '2026-08-31T01:00:00.000Z')
    expect(reconciled.state).toBe('untrusted')
    expect(reconciled.identity).toEqual(retargeted)
  })

  it('directory moved: a different canonical path with the same device/inode still demotes an existing trusted-execute record to untrusted', () => {
    const record = trustedExecuteRecord(clonedRepoIdentity)
    const moved: WorkspaceIdentity = {
      canonicalPath: '/home/harry/projects/malicious-repo',
      volume: { ...clonedRepoIdentity.volume },
    }
    const reconciled = reconcileWorkspaceTrust(record, moved, '2026-08-31T01:00:00.000Z')
    expect(reconciled.state).toBe('untrusted')
    expect(reconciled.identity).toEqual(moved)
  })

  it('an unchanged identity (same canonical path, device, and inode) preserves the current trust state and grantor', () => {
    const record = trustedExecuteRecord(clonedRepoIdentity)
    const reconciled = reconcileWorkspaceTrust(record, { ...clonedRepoIdentity }, '2026-08-31T01:00:00.000Z')
    expect(reconciled.state).toBe('trusted-execute')
    expect(reconciled.grantedBy).toBe(hostUser.id)
  })
})

describe('P1-07 Contract — acceptance[2]: 降级 trust 立即撤销项目能力', () => {
  it('downgrading from trusted-execute to trusted-read revokes exactly the five project-level executable kinds and keeps project instructions, which trusted-read still injects', () => {
    const record = trustedExecuteRecord(clonedRepoIdentity)
    const result = downgradeTrust(record, 'trusted-read', '2026-08-31T02:00:00.000Z')
    expect(result.record.state).toBe('trusted-read')
    expect([...result.revokedKinds].sort()).toEqual([...PROJECT_LEVEL_EXECUTABLE_KINDS].sort())
    expect(result.revokedKinds).not.toContain('project-instructions')
  })

  it('downgrading from trusted-read to untrusted revokes exactly project-instructions, the one kind trusted-read granted that untrusted does not', () => {
    const record: TrustRecord = {
      identity: clonedRepoIdentity,
      state: 'trusted-read',
      at: '2026-08-31T00:00:00.000Z',
      grantedBy: hostUser.id,
    }
    const result = downgradeTrust(record, 'untrusted', '2026-08-31T02:00:00.000Z')
    expect(result.record.state).toBe('untrusted')
    expect(result.revokedKinds).toEqual(['project-instructions'])
  })
})

describe('an inode number reissued to a different directory does not carry trust', () => {
  it('drops trust when the path, device, and inode all match but the creation time does not', () => {
    const granted: TrustRecord = {
      identity: { canonicalPath: '/w/project', volume: { device: 1, inode: 1001, createdAtMs: 1_000 } },
      state: 'trusted-execute',
      at: '2026-09-03T00:00:00.000Z',
      grantedBy: PrincipalId('user-1'),
    }
    // Exactly what ext4 hands back after a trusted directory is deleted and an
    // attacker's directory is created at the same path: the freed inode is
    // reissued, so every field the old comparison looked at is identical.
    const rebuilt = {
      canonicalPath: '/w/project',
      volume: { device: 1, inode: 1001, createdAtMs: 2_000 },
    }

    const reconciled = reconcileWorkspaceTrust(granted, rebuilt, '2026-09-03T01:00:00.000Z')

    expect(reconciled.state).toBe('untrusted')
    expect(reconciled.grantedBy).toBeUndefined()
  })

  it('refuses to confirm identity when the filesystem reports no creation time, rather than matching on the inode alone', () => {
    const granted: TrustRecord = {
      identity: { canonicalPath: '/w/project', volume: { device: 1, inode: 1001, createdAtMs: 0 } },
      state: 'trusted-execute',
      at: '2026-09-03T00:00:00.000Z',
      grantedBy: PrincipalId('user-1'),
    }
    const observed = { canonicalPath: '/w/project', volume: { device: 1, inode: 1001, createdAtMs: 0 } }

    const reconciled = reconcileWorkspaceTrust(granted, observed, '2026-09-03T01:00:00.000Z')

    expect(reconciled.state).toBe('untrusted')
  })
})

describe('P1-07 Fault — a trust transition must never grant capability outside must[2]', () => {
  // downgradeTrust has no production caller today; requestTrustUpgrade's
  // lowering path does, through WorkspaceEntity.upgradeTrust, which passes
  // `target` through untouched. The reachable half manufactures exactly the
  // input that makes the unreachable half dangerous: an untrusted record
  // carrying a grantor, which a raising downgradeTrust call then lifts to
  // trusted-execute while revokedKinds reports nothing revoked.
  it('must[2]: downgradeTrust refuses a raising target, so acceptance[2] entry point can never grant trusted-execute with no host principal and no audit record', () => {
    const untrusted = bindWorkspaceTrust(clonedRepoIdentity, '2026-09-04T00:00:00.000Z')
    expect(() => downgradeTrust(untrusted, 'trusted-execute', '2026-09-04T00:01:00.000Z')).toThrow()
  })

  it('must[2]: downgradeTrust refuses a raising target even when the presented record still carries a grantor from an earlier grant', () => {
    const untrustedWithStaleGrantor: TrustRecord = {
      identity: clonedRepoIdentity,
      state: 'untrusted',
      at: '2026-09-04T00:00:00.000Z',
      grantedBy: hostUser.id,
    }
    expect(() => downgradeTrust(untrustedWithStaleGrantor, 'trusted-execute', '2026-09-04T00:01:00.000Z')).toThrow()
  })

  it('must[2]: requestTrustUpgrade refuses a lowering target instead of reporting an upgrade and writing an audit record for a demotion', () => {
    const result = requestTrustUpgrade(
      trustedExecuteRecord(clonedRepoIdentity),
      'untrusted',
      hostUser,
      '2026-09-04T00:01:00.000Z',
    )
    expect(result.upgraded).toBe(false)
  })

  it('must[2]: a refused trust upgrade returns neither a record nor an audit entry, for every refusal reason', () => {
    const refusals = [
      requestTrustUpgrade(
        bindWorkspaceTrust(clonedRepoIdentity, '2026-09-04T00:00:00.000Z'),
        'trusted-execute',
        serviceCaller,
        '2026-09-04T00:01:00.000Z',
      ),
      requestTrustUpgrade(
        trustedExecuteRecord(clonedRepoIdentity),
        'untrusted',
        hostUser,
        '2026-09-04T00:01:00.000Z',
      ),
    ]
    for (const refusal of refusals) {
      expect(refusal.upgraded).toBe(false)
      expect('record' in refusal).toBe(false)
      expect('audit' in refusal).toBe(false)
    }
  })
})

describe('P1-07 Fault — identity reconciliation faults the landed code has not been shown', () => {
  const grantedAt: TrustRecord = {
    identity: { canonicalPath: '/w/project', volume: { device: 1, inode: 1001, createdAtMs: 1_000 } },
    state: 'trusted-execute',
    at: '2026-09-04T00:00:00.000Z',
    grantedBy: hostUser.id,
  }

  it('CHARACTERIZATION: drops trust when the creation time is recorded on one side and absent on the other, rather than falling back to a path/device/inode match', () => {
    const reconciled = reconcileWorkspaceTrust(
      grantedAt,
      { canonicalPath: '/w/project', volume: { device: 1, inode: 1001, createdAtMs: 0 } },
      '2026-09-04T01:00:00.000Z',
    )
    expect(reconciled.state).toBe('untrusted')
    expect(reconciled.grantedBy).toBeUndefined()
  })

  it('CHARACTERIZATION: drops trust when the device id changes while the canonical path and inode do not', () => {
    const reconciled = reconcileWorkspaceTrust(
      grantedAt,
      { canonicalPath: '/w/project', volume: { device: 2, inode: 1001, createdAtMs: 1_000 } },
      '2026-09-04T01:00:00.000Z',
    )
    expect(reconciled.state).toBe('untrusted')
    expect(reconciled.grantedBy).toBeUndefined()
  })

  // NaN > 0 is false, so an unparseable creation time lands in the
  // unconfirmable branch and drops trust. Pinning it keeps a later refactor
  // from turning the comparison into a fallback that matches on the inode.
  it('CHARACTERIZATION: drops trust when the observed creation time is NaN, since an unconfirmable creation time is not an equal one', () => {
    const reconciled = reconcileWorkspaceTrust(
      grantedAt,
      { canonicalPath: '/w/project', volume: { device: 1, inode: 1001, createdAtMs: Number.NaN } },
      '2026-09-04T01:00:00.000Z',
    )
    expect(reconciled.state).toBe('untrusted')
    expect(reconciled.grantedBy).toBeUndefined()
  })

  it('CHARACTERIZATION: downgrading a workspace that never granted anything revokes nothing and invents no grantor', () => {
    const result = downgradeTrust(
      bindWorkspaceTrust(clonedRepoIdentity, '2026-09-04T00:00:00.000Z'),
      'untrusted',
      '2026-09-04T01:00:00.000Z',
    )
    expect(result.record.state).toBe('untrusted')
    expect(result.record.grantedBy).toBeUndefined()
    expect(result.revokedKinds).toEqual([])
  })
})
