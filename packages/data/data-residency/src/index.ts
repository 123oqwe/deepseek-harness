export type DataRegion = 'us' | 'eu' | 'asia' | 'global'

export interface ResidencyPolicy {
  readonly allowedRegions: readonly DataRegion[]
  readonly blockedRegions: readonly DataRegion[]
  readonly replicationAllowed: boolean
  readonly crossBorderTransferApproval: boolean
}

export function checkResidency(
  dataRegion: DataRegion,
  policy: ResidencyPolicy,
): { compliant: boolean; reason: string } {
  if (policy.blockedRegions.includes(dataRegion)) {
    return { compliant: false, reason: `Data region ${dataRegion} is blocked` }
  }
  if (policy.allowedRegions.length > 0 && !policy.allowedRegions.includes(dataRegion) && !policy.allowedRegions.includes('global')) {
    return { compliant: false, reason: `Data region ${dataRegion} not in allowed regions` }
  }
  return { compliant: true, reason: 'compliant' }
}

export function checkCrossBorderTransfer(
  sourceRegion: DataRegion,
  destRegion: DataRegion,
  policy: ResidencyPolicy,
): { allowed: boolean; reason: string } {
  if (sourceRegion === destRegion) {
    return { allowed: true, reason: 'same region' }
  }
  if (!policy.replicationAllowed) {
    return { allowed: false, reason: 'Cross-border replication not allowed' }
  }
  if (policy.crossBorderTransferApproval) {
    return { allowed: false, reason: 'Cross-border transfer requires approval' }
  }
  const sourceCheck = checkResidency(sourceRegion, policy)
  if (!sourceCheck.compliant) return { allowed: false, reason: sourceCheck.reason }
  const destCheck = checkResidency(destRegion, policy)
  if (!destCheck.compliant) return { allowed: false, reason: destCheck.reason }
  return { allowed: true, reason: 'transfer allowed' }
}
