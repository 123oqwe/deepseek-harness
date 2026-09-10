# Agent Note: Every mutation green and the probe silent means the tests are not measuring your source

Status: implemented

English | [中文](2026-09-10-mutations-all-green-means-the-tests-are-not-measuring-source.zh.md)

## Problem

Three mutations were run against a new package's transaction tests — migrating production in place instead of into quarantine, overwriting the live directory instead of renaming it aside, and reporting a health-check failure without rolling back. All three passed. The mutated text was confirmed present in the file each time.

A probe at the top of the mutated function printed nothing at all. The tests imported `@deepseek-ai/dsh-plugin-migrations/transaction`; that subpath had no `tsconfig.base.json` alias, so the source plane could not resolve it, and vitest ran the `lib/` output an earlier `tsc -b` had produced. The suite was measuring a build artifact while the source was being edited.

This is the repo's "source plane vs artifact plane, never mixed" rule failing in the direction that leaves no error: a missing alias does not fail, it resolves elsewhere.

## Decision

**A mutation that fails to redden has three possible causes, and they are distinguishable in a fixed order.** Recorded because two of the three were already known and the third was not:

1. **The suite is weak** — the assertion does not observe what the mutation changes. Two cases in the same batch were this: a parent/child budget case whose two readings both produced 3 requests, and a timeout row whose adapter defaulted `status` to 503 so it tested a 503 twice.
2. **The mutant is equivalent** — the change cannot alter behaviour. Recorded once already for a nested-run admission mutation that rebuilt an object equal to the one it replaced.
3. **The tests are not running the code being mutated.** New. It looks exactly like (2) from the outside, and only a probe distinguishes them.

**The diagnosis is a probe, and it is cheap.** Put an `appendFileSync` at the top of the mutated function and run one case. Silence means the test never reached that file. Do this BEFORE theorising about the assertion, because (3) invalidates every conclusion drawn about (1).

**Do not use `console` for the probe** in this repo: vitest does not forward console output for passing tests, so silence there proves nothing.

**Fix the class, not the instance.** The missing alias was the fifth of its kind; the generator now derives an alias for every subpath a package's `exports` publishes, and refuses when one is unmapped.

## Alternatives considered

**Treat the surviving mutations as evidence the code was already correct.** Rejected on its face once the probe fired, but worth naming: this is the reading that makes a vacuous suite look like a strong one, and it is available every time.

**Add the one missing alias by hand.** That is what the previous four occurrences did. Each was correct locally and left the sixth to happen.

**Require every test to import through relative paths.** Rejected: package-name imports are the repo's convention and they exercise the same resolution consumers use. The defect was the alias, not the import style.

## Consequences

Bought: a published subpath with no alias is now a generator failure rather than a silent redirection to `lib/`, and the diagnosis for a green mutation has a written order.

Cost: `PackageAlias` gained a `subpaths` field, and the generator's own spec pins the derivation. A package that publishes a subpath backed by built output rather than a source module is excluded by the `src/<name>.ts` check — deliberately, since aliasing it would point at a file that is not there, but it means such a subpath keeps whatever resolution it had.
