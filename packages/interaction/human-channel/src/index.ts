/**
 * The human-interaction channel (Epic P2-12): the five control verbs, the
 * durable stop, and the question/approval separation.
 *
 * Contract only at this stage — vocabulary, no service mount and no answerer.
 * The channel implementation behind the Service Definition is P2-12's P stage,
 * and wiring the answerers that already exist (the Web question answerer, the
 * ACP and Web approval answerers) is its U stage. Per the delegate's ruling on
 * this epic's second open question, no NEW answerer is written here: a surface
 * with none stays fail closed, which is what both existing services already do.
 * @module @deepseek-ai/dsh-human-channel
 */

export * from './types.ts'
