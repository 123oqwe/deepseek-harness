/**
 * The ExecutionWorld capability seam (Epic P3-01): the vocabulary a world is
 * described in, and the lifecycle and selection decisions over it.
 *
 * Contract only at this stage — no provider, no service mount. The local
 * provider adapting `dsh-sandbox` is P3-01's P stage (must[2]), and the
 * handle reaching a real agent request is its U stage.
 * @module @deepseek-ai/dsh-execution-world
 */

export * from './types.ts'
export * from './lifecycle.ts'
