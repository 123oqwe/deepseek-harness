export interface PreconditionResult {
  readonly satisfied: boolean
  readonly failedChecks: string[]
}

export function checkPreconditions(
  actionDigest: string,
  capabilityTokenValid: boolean,
  policyVersion: string,
  expectedPolicyVersion: string,
  resourcesExist: boolean,
): PreconditionResult {
  const failed: string[] = []
  if (!actionDigest) failed.push('action manifest digest missing')
  if (!capabilityTokenValid) failed.push('capability token is not valid or expired')
  if (policyVersion !== expectedPolicyVersion) failed.push(`policy version mismatch: expected ${expectedPolicyVersion}, got ${policyVersion}`)
  if (!resourcesExist) failed.push('required resources not available')
  return { satisfied: failed.length === 0, failedChecks: failed }
}
