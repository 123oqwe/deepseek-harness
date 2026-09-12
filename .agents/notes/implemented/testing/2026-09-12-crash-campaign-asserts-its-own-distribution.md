# Agent Note: A randomised campaign asserts the distribution it depends on

Status: implemented

English | [中文](2026-09-12-crash-campaign-asserts-its-own-distribution.zh.md)

## Problem

P4-12's crash campaign (`packages/action/action-ledger/tests/fault-matrix.spec.ts`) is the direct evidence for one acceptance clause: zero duplicate external effects across 10,000 random crashes, counted at a fake external service. It drove the crash point with `random = (random * 1_103_515_245 + 12_345) % 2_147_483_648`.

JavaScript evaluates that multiply as a double. From the second iteration the product passes 2^53, the low bits are lost, and the modulus returns multiples of large powers of two — so the drawn crash point was `none` in 9956 of 10,000 iterations, `after-reserve` in 43, `after-send` in 1, and `after-receipt` never. Almost every key also reached `confirmed` inside the first 250 attempts, so the few real crash draws hit settled entries, got `duplicate`, and returned before their `throw`. The campaign asserted zero duplicates and 250 commits, and both hold for 10,000 clean attempts.

Nothing in the suite could have caught it. Every assertion was about the OUTCOME — no duplicates, 250 effects — and an outcome assertion is satisfied by an experiment that was never run.

## Decision

The draw uses `Math.imul`, which keeps the multiply in 32 bits, and takes the result's **high** bits.

The high bits are the half a reader would skip, and the measurement is why they are not optional. With `Math.imul` and the low bits the generator draws `23012301…` — an LCG's low bits have tiny periods — and against 250 keys visited round-robin that leaves every key permanently blind to two of the four crash points, while the aggregate histogram comes out at a perfect 2500 per point.

So the case asserts two things about its own generator: a lower bound per crash point, and that every key saw every crash point. Lower bounds rather than an exact histogram, because the assertion is about a generator that reaches every point often, and an exact count is precisely what a four-cycle delivers.

Each attempt on a key presents the next generation, because a restart takes a new lease epoch; repeating one generation makes every retry its own peer and the campaign would measure a ledger that refuses rather than one that recovers.

A second campaign runs the same 10,000 attempts fully unfenced. It commits each effect exactly once, and that is the point: crash-retry dedup comes from the `sent` state a restart reads off the disk, not from fencing. What unfenced gives up is concurrent exclusivity, which a sequential campaign cannot measure — there is never a live peer to confuse with a restart — and which the two-process case in `store.spec.ts` measures instead.

## Alternatives considered

**Asserting an exact histogram.** Rejected because it is the assertion a broken generator passes: the low-bit variant produces exactly 2500 per point. A lower bound says what the campaign needs — that every crash point is reached often — without pinning an arbitrary count that any reseeding would have to chase.

**Asserting the aggregate distribution only.** This was the first version and it is satisfied by the four-cycle. Per-key coverage is what separates a uniform generator from a short one, because the defect a cycle produces is not a skewed total but a blind spot in each key's own history.

**Replacing the LCG with a library PRNG.** Rejected as a dependency for four values per draw, and it would not have addressed either defect: a correct generator used through its low bits cycles the same way. The repair a reader must understand is the arithmetic and the bit selection, which are both visible in four lines here.

**Seeding from the clock so every run explores a new path.** Rejected, as it was when the campaign was written: a campaign that cannot be re-run identically turns a failure into a story about which run it was.

**Leaving the campaign's outcome assertions alone and adding a separate generator test.** Rejected. A generator test passes while the campaign keeps using a different draw; the assertion belongs in the case whose evidence depends on it, where it is re-measured every time the case runs.

## Consequences

The file now runs two 10,000-attempt campaigns and took 37.8 s wall on a host at load average ~36, against the case's 120 s timeout. The timeout was deliberately not raised: the same campaign took 9 s on a quiet host, and a loaded developer machine is an environment reading rather than a property of the suite.

A future edit that breaks the draw fails on the distribution rather than silently producing a campaign that does not crash. That is the general form worth keeping: when a test's evidence depends on a random experiment actually covering its space, the coverage is an assertion, not an assumption.

The campaign exercises all four crash points for every key for the first time, so it is now evidence for the clause it always claimed. No defect surfaced when it started really crashing — zero duplicates and 250 commits still hold — which is the outcome the epic asserted and had not yet earned.
