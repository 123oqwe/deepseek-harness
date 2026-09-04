/**
 * Provider-stage durable Capability Token registry for Epic P2-02: the
 * store, nonce ledger, and revocation state that turn `./attenuate.ts`'s
 * pure Contract-stage decisions into a service whose tokens, spent nonces,
 * and revocations outlive the process that issued them.
 *
 * Contract stage landed the decisions themselves — which attenuations are
 * legal (`attenuateToken`), whether a lineage is revoked (`isTokenRevoked`),
 * whether a candidate verifies (`verifyToken`), what is log-safe
 * (`redactTokenForLog`) — as pure functions over values a caller already
 * held. Two of this epic's clauses are unreachable from that surface no
 * matter how correct it is:
 *
 * - **acceptance[1]** ("撤销父 token 立即使所有 descendants 失效"). `isTokenRevoked`
 *   takes a {@link TokenLineage} the caller already assembled. Nothing at
 *   Contract stage produces one: assembling a real lineage means walking
 *   successive `parentDigest` hops back through tokens that were actually
 *   issued, which is a lookup over recorded state, not a computation over
 *   one token value. `tests/token.spec.ts` accordingly passes three literal
 *   strings (`'digest-root'`, `'digest-child'`, `'digest-grandchild'`) that
 *   no token ever produced — a correct test of the membership check, but not
 *   of cascading revocation. This module supplies the missing half:
 *   {@link CapabilityTokenService.lineageOf} reconstructs a lineage from
 *   tokens this service really minted, so revoking an ancestor's digest
 *   invalidates descendants that never named that digest themselves.
 * - **The replay check's durability.** `verifyToken` takes `seenNonces` as
 *   caller-supplied pure data; `./types.ts` names "a later Provider-stage
 *   nonce ledger" as what must actually have recorded them. A nonce ledger
 *   that dies with the process defeats its own purpose — a restart is
 *   exactly when a replayed token would be presented again. This module
 *   records every spent nonce durably.
 *
 * **must[1] ("TrustKernel 签发/验证") is BLOCKED, not satisfied here, and this
 * module makes no claim to satisfy it.** Two independent, unmet
 * prerequisites, both outside this epic's Provider-stage file scope:
 *
 * 1. `@deepseek-ai/dsh-trust-kernel`'s `createTrustKernel()` mints
 *    `signatureRoots` as `Object.freeze({})` — a frozen empty object holding
 *    no key material. There is nothing to sign or verify *with*.
 *    `./attenuate.ts`'s "signature" is the fixed byte sequence
 *    `[0x01, 0x02, 0x03, 0x04]`, which any code can construct without the
 *    kernel's involvement — `tests/token.spec.ts`'s own `fixtureSigned`
 *    helper does exactly that, and `verifyToken` accepts the result. A
 *    token's signature therefore proves nothing about its origin today.
 *    Making it real means adding key material to
 *    `packages/kernel/trust-kernel/`.
 * 2. Making the kernel the *authority* rather than a handle a caller passes
 *    in means an enforcement point that reads the kernel from a Cordis
 *    `Context`. `docs/architecture/trust-kernel-boundary.md` gates exactly
 *    that behind the vendored Cordis `Fiber` structural fix (Option A),
 *    which has not landed: `vendor/cordis/src/fiber.ts`'s `store` is still a
 *    plain public writable field, and `vendor/README.md`'s local-modification
 *    log records no such change.
 *
 * This module therefore takes `TrustKernelSignatureRoots` as an explicit
 * parameter and passes it through to `./attenuate.ts` unchanged, exactly as
 * the Contract stage does — it never reads the kernel from a `Context`, so
 * it adds no new exposure to that residual. **P2-02 cannot be ACCEPTED while
 * must[1] is open, however many stage cells are green.**
 *
 * Every attenuation, verification, and redaction decision is delegated to
 * `./attenuate.ts`. This module holds no second rule table: it decides only
 * what is recorded and what is read back.
 *
 * @module @deepseek-ai/dsh-capability-token
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { attenuateToken, digestToken, isTokenRevoked, issueToken, redactTokenForLog, verifyToken, } from "./attenuate.js";
export * from "./types.js";
export * from "./attenuate.js";
/**
 * A real file-backed {@link CapabilityTokenStore}: one JSON document at
 * `path` holding the whole state, rewritten in full on each
 * {@link CapabilityTokenStore.save}. Durable across a process restart — a
 * second store over the same `path` reads back exactly what the first wrote,
 * including each token's brands and each `signature`'s bytes.
 * @param path - filesystem path of the store's document; a path that does not
 * exist yet is a first boot, not an error, and is created on the first save.
 * @returns a store over `path`.
 */
export function createFileCapabilityTokenStore(path) {
    /**
     * Every read and write of `path` is chained onto this promise, so a `save`
     * never interleaves with another one and loses a revocation or a nonce.
     */
    let queue = Promise.resolve();
    const enqueue = (operation) => {
        const next = queue.then(operation, operation);
        queue = next.then(() => undefined, () => undefined);
        return next;
    };
    return {
        async load() {
            return enqueue(async () => {
                let raw;
                try {
                    raw = await readFile(path, 'utf8');
                }
                catch (error) {
                    // A store whose document does not exist yet is a first boot, not a
                    // failure; every other read error (permissions, an unreadable
                    // medium) still propagates.
                    if (error.code === 'ENOENT')
                        return EMPTY_STORE_STATE;
                    throw error;
                }
                return reviveState(JSON.parse(raw));
            });
        },
        async save(state) {
            await enqueue(async () => {
                const temporary = `${path}.tmp`;
                await writeFile(temporary, `${JSON.stringify(serializeState(state), null, 2)}\n`, 'utf8');
                await rename(temporary, path);
            });
        },
    };
}
/** The state a store reports for a medium that has never been written to. */
const EMPTY_STORE_STATE = {
    tokens: [],
    revokedDigests: [],
    spentNonces: [],
    auditRecords: [],
};
/**
 * Project `state` down to the JSON-representable form a store writes.
 * @param state - the state to serialize.
 * @returns the same state with each `signature` as a plain byte array.
 */
function serializeState(state) {
    return {
        tokens: state.tokens.map(signed => ({ token: signed.token, signature: [...signed.signature] })),
        revokedDigests: [...state.revokedDigests],
        spentNonces: [...state.spentNonces],
        auditRecords: [...state.auditRecords],
    };
}
/**
 * Rebuild the in-memory state from what a store read back, restoring each
 * `signature` to a real `Uint8Array`.
 * @param state - the parsed JSON document.
 * @returns the state with each `signature` back as a `Uint8Array`.
 */
function reviveState(state) {
    return {
        tokens: state.tokens.map(signed => ({ token: signed.token, signature: new Uint8Array(signed.signature) })),
        revokedDigests: [...state.revokedDigests],
        spentNonces: [...state.spentNonces],
        auditRecords: [...state.auditRecords],
    };
}
/**
 * The durable Capability Token registry: issues and attenuates tokens
 * through `./attenuate.ts`, records each one, reconstructs a real
 * {@link TokenLineage} by walking recorded `parentDigest` hops
 * (acceptance[1]), spends nonces durably, and keeps an audit trail carrying
 * only {@link CapabilityTokenLogRecord}s (acceptance[2]).
 *
 * must[1] is BLOCKED — see this module's top-of-file note. The
 * `TrustKernelSignatureRoots` handle this service holds is passed through to
 * `./attenuate.ts` unchanged and is not, today, evidence of a token's origin.
 */
export class CapabilityTokenService {
    #store;
    #trustRoot;
    #tokens;
    #revokedDigests;
    #spentNonces;
    #auditRecords;
    constructor(store, trustRoot, state) {
        this.#store = store;
        this.#trustRoot = trustRoot;
        this.#tokens = [...state.tokens];
        this.#revokedDigests = new Set(state.revokedDigests);
        this.#spentNonces = new Set(state.spentNonces);
        this.#auditRecords = [...state.auditRecords];
    }
    /**
     * Reconstruct a service from everything `store` durably holds. The only
     * way to obtain a service — there is no constructor starting from an
     * in-memory value, so a restored service's contents always came from the
     * store's bytes.
     * @param store - the durability seam to restore from and write through.
     * @param trustRoot - the `TrustKernelSignatureRoots` handle passed through to `./attenuate.ts`.
     * @returns a service over `store`'s recorded state.
     */
    static async restore(store, trustRoot) {
        return new CapabilityTokenService(store, trustRoot, await store.load());
    }
    /**
     * Write this service's complete current state through to its store.
     * @returns once the write is durable.
     */
    async #persist() {
        await this.#store.save({
            tokens: [...this.#tokens],
            revokedDigests: [...this.#revokedDigests],
            spentNonces: [...this.#spentNonces],
            auditRecords: [...this.#auditRecords],
        });
    }
    /**
     * Record `signed` in the token registry and append its redacted audit
     * record, then persist both — the one path by which a token becomes
     * durable, so no caller can add a token without its audit record.
     * @param signed - the freshly issued or attenuated token to record.
     */
    async #record(signed) {
        this.#tokens.push(signed);
        this.#auditRecords.push(redactTokenForLog(signed));
        await this.#persist();
    }
    /**
     * Mint a root token through `./attenuate.ts`'s `issueToken`, record it,
     * and append its redacted audit record.
     * @param request - the root grant's scope.
     * @param nonce - a fresh, caller-generated nonce.
     * @returns the newly issued, durably recorded token.
     */
    async issue(request, nonce) {
        const signed = issueToken(this.#trustRoot, request, nonce);
        await this.#record(signed);
        return signed;
    }
    /**
     * Delegate the narrowing decision to `./attenuate.ts`'s `attenuateToken`,
     * recording the child and appending its redacted audit record only when
     * that decision accepts. A refusal writes nothing at all.
     * @param parent - the recorded parent token being attenuated.
     * @param request - the requested child scope.
     * @returns `attenuateToken`'s own decision, unchanged.
     */
    async attenuate(parent, request) {
        const decision = attenuateToken(this.#trustRoot, parent, request);
        if (decision.accepted)
            await this.#record(decision.child);
        return decision;
    }
    /**
     * Reconstruct the complete root-first digest chain of the recorded token
     * whose own digest is `digest`, by walking successive recorded
     * `parentDigest` hops — acceptance[1]'s missing half, and this package's
     * only real producer of a {@link TokenLineage}.
     * @param digest - the digest of the token whose lineage to reconstruct.
     * @returns the lineage, root-first and ending with `digest`, or `undefined` when no recorded token has that digest.
     */
    lineageOf(digest) {
        const byDigest = new Map(this.#tokens.map(signed => [digestToken(signed.token), signed.token]));
        let current = byDigest.get(digest);
        if (current === undefined)
            return undefined;
        // Walked leaf-first, then reversed, so the returned chain is root-first.
        const chain = [digest];
        while (current.parentDigest !== null) {
            chain.push(current.parentDigest);
            const parent = byDigest.get(current.parentDigest);
            // An ancestor absent from the registry still contributes its digest —
            // dropping it would silently hide an ancestor's revocation.
            if (parent === undefined)
                break;
            current = parent;
        }
        return chain.reverse();
    }
    /**
     * Durably record `digest` as revoked. Revoking an ancestor's digest is
     * what invalidates every descendant (acceptance[1]) — no per-descendant
     * record is written, and none is needed.
     * @param digest - the digest to revoke.
     */
    async revoke(digest) {
        this.#revokedDigests.add(digest);
        await this.#persist();
    }
    /**
     * Whether the recorded token with `digest` is revoked, by checking
     * `./attenuate.ts`'s `isTokenRevoked` against this service's reconstructed
     * lineage for it — so an ancestor's revocation counts, however many
     * attenuation hops away.
     * @param digest - the digest of the token to check.
     * @returns `true` when the token's lineage contains a revoked digest; `false` when it does not, and for a digest no recorded token has.
     */
    isRevoked(digest) {
        const lineage = this.lineageOf(digest);
        if (lineage === undefined)
            return false;
        return isTokenRevoked(lineage, this.#revokedDigests);
    }
    /**
     * Verify `signed` through `./attenuate.ts`'s `verifyToken` against this
     * service's durable nonce ledger, spending the nonce when verification
     * succeeds so a second presentation of the same token is refused as
     * `'replayed'` — including after a process restart.
     *
     * Revocation is deliberately not folded in: `TokenVerificationDenialReason`
     * is a closed three-reason union this Provider stage may not widen
     * (`./types.ts` belongs to the Contract stage), so a caller composes this
     * with {@link isRevoked} rather than receiving a fourth reason here.
     * @param signed - the candidate token being presented.
     * @param now - Unix epoch milliseconds to check expiry against.
     * @returns `verifyToken`'s own result, against the durable nonce ledger.
     */
    async verify(signed, now) {
        const result = verifyToken(this.#trustRoot, signed, { now, seenNonces: this.#spentNonces });
        if (!result.verified)
            return result;
        this.#spentNonces.add(signed.token.nonce);
        await this.#persist();
        return result;
    }
    /**
     * acceptance[2]'s log surface: every audit record this service has
     * recorded, oldest first. Each is `redactTokenForLog`'s six-field output —
     * a digest plus already-log-safe metadata. No raw token, `nonce`, or
     * `signature` ever reaches this surface.
     * @returns the recorded audit records, oldest first.
     */
    auditRecords() {
        return [...this.#auditRecords];
    }
}
//# sourceMappingURL=index.js.map