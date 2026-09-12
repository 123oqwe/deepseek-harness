/**
 * Epic P2-10's policy vocabulary: the Cedar schema dsh's own requests are
 * shaped by, and the conventions that go with it.
 *
 * The schema is the whole of must[0]'s "finite declarative language" under the
 * delegate's ruling (b) of 2026-09-12: dsh does not define a second syntax
 * compiling to Cedar, because a second language would be a second trust root
 * and would re-verify the authorization semantics P2-05 already froze. What is
 * finite is the vocabulary a policy may name, and this package declares it.
 * @module @deepseek-ai/dsh-policy-language
 */

export * from './schema.ts'
