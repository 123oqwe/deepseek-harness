 import { describe, it, expect, beforeEach, afterEach } from 'vitest'
 import { resolve } from 'node:path'
 import { getOrCreateWorkspace, setTrustState, getTrustPolicy, assertAllowed, isAllowed, clearTrust, WorkspaceTrustError } from '../src/index.ts'

 describe('P1-07 Workspace Trust Boundary', () => {
   beforeEach(() => clearTrust())
   afterEach(() => clearTrust())

   it('defaults to untrusted', () => {
     const ws = getOrCreateWorkspace('/tmp')
     expect(ws.trustState).toBe('untrusted')
     const policy = getTrustPolicy('/tmp')
     expect(policy.allowProjectPlugins).toBe(false)
     expect(policy.allowHooks).toBe(false)
     expect(policy.allowSafeRead).toBe(true)
   })

   it('trusted-execute allows all actions', () => {
     setTrustState('/tmp', 'trusted-execute')
     const policy = getTrustPolicy('/tmp')
     expect(policy.allowProjectPlugins).toBe(true)
     expect(policy.allowHooks).toBe(true)
     expect(policy.allowMCPServers).toBe(true)
     expect(policy.allowExecutableSkills).toBe(true)
     expect(policy.allowProfilePatchOverrides).toBe(true)
   })

   it('untrusted rejects project plugins', () => {
     expect(() => assertAllowed('/tmp', 'allowProjectPlugins')).toThrow(WorkspaceTrustError)
   })

   it('trusted-execute allows project plugins', () => {
     setTrustState('/tmp', 'trusted-execute')
     expect(() => assertAllowed('/tmp', 'allowProjectPlugins')).not.toThrow()
   })

   it('isAllowed returns boolean without throwing', () => {
     expect(isAllowed('/tmp', 'allowHooks')).toBe(false)
     setTrustState('/tmp', 'trusted-execute')
     expect(isAllowed('/tmp', 'allowHooks')).toBe(true)
   })

   it('workspace identity is canonical', () => {
     const ws1 = getOrCreateWorkspace('/tmp')
     const ws2 = getOrCreateWorkspace('/tmp/../tmp')
     expect(ws1.canonicalPath).toBe(ws2.canonicalPath)
   })

   it('trusted-read allows safe read but not execution', () => {
     setTrustState('/tmp', 'trusted-read')
     expect(isAllowed('/tmp', 'allowSafeRead')).toBe(true)
     expect(isAllowed('/tmp', 'allowProjectPlugins')).toBe(false)
   })
 })
