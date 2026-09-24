/**
 * Names the P3-01 world-swap driver and its scripted model share.
 * @module tests/first100/fixtures/loader/p3-01-world-swap/shared
 */

/** The route the overlay's `main` agent names. */
export const PROVIDER = 'p3-01-world-swap-mock'

/** The file the driver writes into the working directory and the model reads. */
export const READ_FILE = 'p3-01-world-swap.txt'

/** The one line that file holds. */
export const READ_LINE = 'P3-01 acceptance[0]: one read through either world provider'

/** The tool call id the model issues, so both processes manifest the same action id. */
export const CALL_ID = 'p3-01-read'
