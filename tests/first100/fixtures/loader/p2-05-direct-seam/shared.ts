/**
 * Names the P2-05 direct-seam driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-05-direct-seam/shared
 */

/** The file the driver writes into its working directory and every call reads. */
export const READ_FILE = 'p2-05-direct-seam.txt'

/** The one line that file holds. */
export const READ_LINE = 'P2-05 BLOCKED-294: one read through the model and two through the direct seam'

/** The call id of the model's own `read`, the control. */
export const NATIVE_CALL = 'a434-native-read'

/** The call id of a plugin's direct `read` on behalf of the root agent. */
export const DIRECT_AGENT_CALL = 'a434-direct-agent'

/** The call id of a plugin's direct `read` with no agent, as the tutorial teaches it. */
export const DIRECT_PLAIN_CALL = 'a434-direct-plain'
