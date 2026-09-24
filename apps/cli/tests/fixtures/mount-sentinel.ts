/**
 * Test-only config-tree entry for Epic P0-02's in-process launch cases.
 *
 * Mounting it writes the marker file its config names and then throws. A
 * marker on disk after a launch therefore means a config-tree entry mounted;
 * the throw stops a launch that got that far before the composed app serves.
 * @module apps/cli/tests/fixtures/mount-sentinel
 */

import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'p0-02-mount-sentinel'

/**
 * Record that this entry mounted, then fail the mount.
 * @param _ctx - plugin context; unused.
 * @param config - the absolute marker path to write.
 * @param config.marker - where the marker file goes.
 * @throws always, after the marker is written.
 */
export function apply(_ctx: Context, config: { marker: string }): void {
  writeFileSync(config.marker, 'mounted\n')
  throw new Error('p0-02 mount sentinel: a config-tree entry mounted')
}
