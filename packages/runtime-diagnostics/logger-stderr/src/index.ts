/**
 * Plugin warnings and errors on stderr (BLOCKED-336).
 *
 * Without an exporter, every `ctx.logger.warn` and `ctx.logger.error` a plugin
 * writes lands only in Cordis's in-memory buffer, which no operator reads. This
 * plugin renders the chosen message types with the vendored console exporter
 * and writes each line to the process's stderr, prefixed `dsh: ` like the
 * launcher's own diagnostics. It never writes stdout: on the headless, ACP and
 * SDK hosts stdout carries results or protocol frames.
 *
 * Messages logged before it mounts are written when it mounts, from Cordis's
 * in-memory buffer; `@deepseek-ai/dsh-app-boot` raises the root logger's
 * default level so that buffer keeps warnings as well as errors.
 *
 * A host that owns stderr's layout takes the lines over with
 * {@link LoggerStderr.routeThrough}; the headless runner does, so a line never
 * lands inside an open reasoning section. A route that throws loses nothing:
 * the line is written to stderr directly.
 * @module @deepseek-ai/dsh-logger-stderr
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context, LoggerType, Message } from '@deepseek-ai/cordis'
import { ConsoleExporter } from '@deepseek-ai/cordis-plugin-logger-console'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    loggerStderr: LoggerStderr
  }
}

/** The prefix every line carries, as the launcher's own stderr diagnostics do. */
export const LINE_PREFIX = 'dsh: '

/** The level the vendored logger assigns each message type. */
const LEVEL_OF: Readonly<Record<LoggerType, number>> = { error: 0, info: 1, warn: 2, debug: 3 }

/** Which message types reach stderr. */
export interface Config {
  /** Message types written to stderr, `error` and `warn` when omitted; the others stay in the in-memory buffer only. */
  types?: LoggerType[]
}

/** {@link Config} after {@link LoggerStderr.Config} has applied its default. */
interface ResolvedConfig extends Config {
  types: LoggerType[]
}

/** Renders messages in the console exporter's layout and hands each line on. */
class StderrExporter extends ConsoleExporter {
  /**
   * @param ctx - the plugin context the exporter registers under.
   * @param types - the message types to write.
   * @param emit - writes one complete line.
   */
  constructor(ctx: Context, private readonly types: ReadonlySet<LoggerType>, private readonly emit: (line: string) => void) {
    // The logger filters by level before exporting, and warn sits above info,
    // so the threshold admits every chosen type and export() drops the rest.
    super(ctx, { colors: false, levels: { default: Math.max(...[...types].map(type => LEVEL_OF[type])) } })
  }

  override export(message: Message): void {
    if (!this.types.has(message.type)) return
    for (const line of this.render(message).split('\n')) this.emit(`${LINE_PREFIX}${line}\n`)
  }
}

/** Writes plugin warnings and errors to stderr; published as `ctx.loggerStderr`. */
export default class LoggerStderr extends Service {
  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config: z<Config> = z.object({
    types: z.array(z.union(['error', 'warn', 'info', 'debug'] as const)).default(['error', 'warn'])
      .description('Message types written to stderr.'),
  })

  // Held in an object: `ctx.loggerStderr` is a Cordis proxy that wraps every
  // function read through it, so a disposer comparing the function it stored
  // would never find it again and could not clear its route.
  private route: { readonly write: (line: string) => void } | undefined

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.loggerStderr`.
   * @param config - the validated configuration.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'loggerStderr')
    // Cordis passes the configuration through `LoggerStderr.Config`, whose default fills `types`.
    const { types } = config as ResolvedConfig
    // The exporter registers itself under ctx, so the plugin's unload removes it.
    const exporter = new StderrExporter(ctx, new Set(types), (line) => { this.write(line) })
    // Row order carries no load order, so other plugins may have logged first.
    for (const message of ctx.logger.buffer) exporter.export(message)
  }

  /**
   * Send every line through `write` instead of straight to stderr, until the
   * returned disposer runs. One route at a time: a later route replaces an
   * earlier one, and a disposer clears only the route it installed.
   * @param write - writes one complete line, newline included.
   * @returns the disposer that restores direct writes.
   */
  routeThrough(write: (line: string) => void): () => void {
    const route = { write }
    this.route = route
    return () => {
      if (this.route === route) this.route = undefined
    }
  }

  /**
   * Write one line through the route, or to stderr when there is none or it throws.
   * @param line - one complete line, newline included.
   */
  private write(line: string): void {
    const route = this.route
    if (route !== undefined && routed(route.write, line)) return
    process.stderr.write(line)
  }
}

/**
 * Hand one line to a route.
 * @param route - the host's writer.
 * @param line - one complete line.
 * @returns whether the route took it without throwing.
 */
function routed(route: (line: string) => void, line: string): boolean {
  try {
    route(line)
  } catch {
    // The caller writes the line to stderr instead, so a failing route loses nothing.
    return false
  }
  return true
}
