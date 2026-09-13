/**
 * Resource budgets (Epic P3-10): the vocabulary a budget is stated in, and the
 * reservation and hierarchical accounting over it.
 *
 * Contract only at this stage: no provider samples usage and nothing enforces a
 * limit on a running process. Enforcement is the Provider stage's, and wall
 * clock, tool call and agent limits reach a real run at the Usage stage.
 * @module @deepseek-ai/dsh-resource-budget
 */

export * from './types.ts'
export * from './accounting.ts'
