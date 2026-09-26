/**
 * Names the P2-05 originator driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-05-originators/shared
 */

/** The originators the driver drives, one boot each. */
export const ORIGINATOR_MODES = ['native', 'subagent', 'workflow'] as const

/** One driven originator. */
export type OriginatorMode = typeof ORIGINATOR_MODES[number]

/** The file the driver writes into its working directory and every mode reads. */
export const READ_FILE = 'p2-05-originators.txt'

/** The one line that file holds. */
export const READ_LINE = 'P2-05 acceptance[0]: one read through every shipped originator'

/** The call id of the root agent's own `read`. */
export const ROOT_READ_CALL = 'a433-root-read'

/** The call id of a delegated child's `read`, whether a `subagent` call or a workflow `agent()` started it. */
export const CHILD_READ_CALL = 'a433-child-read'
