/**
 * Package entry point. Re-exports the public surface of Epic P4-01's
 * first-class Run Service and Run event log: the Run/RunEvent types and
 * branded identifiers ({@link ./types}), the append-only event log
 * operations ({@link ./events}), and the Run state machine
 * ({@link ./state-machine}).
 *
 * @module @deepseek-ai/dsh-run
 */
export * from './types.ts'
export * from './events.ts'
export * from './state-machine.ts'
