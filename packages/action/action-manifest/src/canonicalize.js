import { createHash } from 'node:crypto';
import { brandString } from '@deepseek-ai/dsh-brand';
/**
 * Canonicalize an arguments value into a stable, deterministic string form:
 * object keys sorted, strings Unicode-normalized, numbers rendered in one
 * canonical representation — so two semantically identical `args` values
 * always canonicalize identically regardless of source key order, Unicode
 * form, or number literal spelling (acceptance[1], validation[2]).
 * `computeArgumentsHash` is expected to call this before hashing.
 * @param args - the action's raw arguments value.
 * @returns the canonical string form of `args`.
 */
export function canonicalizeArguments(args) {
    if (args === null)
        return 'null';
    if (typeof args === 'boolean')
        return args ? 'true' : 'false';
    if (typeof args === 'number')
        return JSON.stringify(args);
    if (typeof args === 'string')
        return JSON.stringify(args.normalize('NFC'));
    if (Array.isArray(args))
        return `[${args.map(canonicalizeArguments).join(',')}]`;
    const entries = Object.entries(args)
        .map(([key, value]) => [key.normalize('NFC'), value])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${canonicalizeArguments(value)}`).join(',')}}`;
}
/**
 * Hash `args` into the {@link ArgumentsHash} an {@link ActionManifest}
 * carries (must[0], acceptance[1]). Two `args` values that
 * {@link canonicalizeArguments} maps to the same canonical string MUST hash
 * to the same {@link ArgumentsHash} — key order, Unicode normalization form,
 * and number literal spelling never affect the result (validation[2]'s
 * fuzz requirement).
 * @param args - the action's raw arguments value.
 * @returns a stable {@link ArgumentsHash} for `args`.
 */
export function computeArgumentsHash(args) {
    const digest = createHash('sha256').update(canonicalizeArguments(args), 'utf8').digest('hex');
    return brandString(digest);
}
/**
 * Classify an action's side effect from the underlying capability's own
 * declared class, when one is available (acceptance[2]). When `declared` is
 * `undefined` — the capability declares no {@link ActionSideEffectClass}, or
 * the caller could not resolve one — this function MUST return
 * `{ sideEffectClass: 'destructive', classified: false, requiresApproval: true }`:
 * the highest-risk class, marked unclassified, requiring approval. When
 * `declared` is present, it is trusted directly:
 * `{ sideEffectClass: declared, classified: true, requiresApproval }`, with
 * `requiresApproval` decided by `declared` itself (a later fix-round's
 * policy, not fixed by this Contract stage beyond the unclassifiable
 * default).
 * @param declared - the capability's own declared side-effect class, or `undefined` when none is available.
 * @returns the resulting {@link SideEffectClassification}.
 */
export function classifySideEffect(declared) {
    if (declared === undefined)
        return { sideEffectClass: 'destructive', classified: false, requiresApproval: true };
    return { sideEffectClass: declared, classified: true, requiresApproval: declared === 'destructive' };
}
/**
 * must[0]/must[1]'s manifest-construction entry point: build a complete
 * {@link ActionManifest} from `request`, deriving
 * {@link ActionManifest.argumentsHash} via `computeArgumentsHash(request.args)`
 * and {@link ActionManifest.sideEffectClass}/{@link ActionManifest.requiresApproval}
 * via `classifySideEffect(request.declaredSideEffectClass)`. Construction
 * alone never durably appends anything or makes a policy/approval decision
 * — must[1] requires generation to happen first, but generation and
 * durable append are two distinct steps; a later Usage-stage Consumer owns
 * the actual append.
 * @param request - the {@link CreateActionManifestRequest} to build a manifest from.
 * @returns a complete {@link ActionManifest}.
 */
export function createActionManifest(request) {
    const classification = classifySideEffect(request.declaredSideEffectClass);
    return {
        actionId: request.actionId,
        runId: request.runId,
        actor: request.actor,
        capability: request.capability,
        origin: request.origin,
        target: request.target,
        argumentsHash: computeArgumentsHash(request.args),
        sideEffectClass: classification.sideEffectClass,
        requiresApproval: classification.requiresApproval,
        idempotencyKey: request.idempotencyKey,
        preconditions: request.preconditions,
        expectedDiff: request.expectedDiff,
        compensation: request.compensation,
        evidenceRequirements: request.evidenceRequirements,
    };
}
/**
 * must[1]/acceptance[0]'s ordering gate: an execution attempt for
 * `actionId`/`argumentsHash` may proceed only when `appended` already
 * contains an {@link AppendedManifest} whose `manifest.actionId` equals
 * `actionId` AND whose `manifest.argumentsHash` equals `argumentsHash`.
 * Refuses with `'no-manifest-appended'` when no appended manifest names
 * `actionId` at all — the execution path attempted to run before
 * generating and durably appending a manifest, or skipped manifest
 * generation entirely (must[2]: this refusal applies identically
 * regardless of the manifest's {@link ActionOrigin} — a code-mode embedded
 * sub-dispatch or a plugin RPC call gets no exemption). Refuses with
 * `'manifest-argument-mismatch'` when a manifest for `actionId` exists but
 * its `argumentsHash` differs from `argumentsHash` — the appended manifest
 * does not describe this execution attempt.
 * @param actionId - the {@link ActionId} of the execution attempt to gate.
 * @param argumentsHash - the {@link ArgumentsHash} the execution attempt is about to run with.
 * @param appended - every {@link AppendedManifest} durably appended so far, in append order.
 * @returns `{ admitted: true, manifest }` naming the matching manifest, or `{ admitted: false, reason }`.
 */
export function assertManifestPrecedesExecution(actionId, argumentsHash, appended) {
    const forActionId = appended.filter(entry => entry.manifest.actionId === actionId);
    if (forActionId.length === 0)
        return { admitted: false, reason: 'no-manifest-appended' };
    const matching = forActionId.find(entry => entry.manifest.argumentsHash === argumentsHash);
    if (matching === undefined)
        return { admitted: false, reason: 'manifest-argument-mismatch' };
    return { admitted: true, manifest: matching.manifest };
}
//# sourceMappingURL=canonicalize.js.map