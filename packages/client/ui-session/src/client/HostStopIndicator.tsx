import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './HostStopIndicator.module.css'

/** Full props for the frame-wide host-stop indicator. */
export type HostStopIndicatorProps =
  PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS>

/**
 * Show that the host is under an emergency stop, for as long as it is
 * (P2-12 acceptance[3]).
 *
 * **Three states, two of which render nothing.** An absent `hostControl` means
 * UNKNOWN -- no control plane, or no baseline yet -- and `{ stopped: false }`
 * means known-running. Both render null, and that is not a shortcut: a surface
 * has nothing to say in either case, and the one thing it must never do is turn
 * "I do not know" into a reassurance. Only a known stop is shown.
 *
 * **It is not a toast.** A stop is a standing condition, so a notification that
 * fades would leave a stopped host looking normal to anyone who blinked --
 * which is the disagreement between surfaces the clause forbids. It disappears
 * on its own when the stop is released, because the client forgets the state
 * with the baseline that no longer carries it.
 *
 * `role="status"` rather than `alert`, including on first appearance: `alert`
 * interrupts whatever the screen reader is currently speaking, and what it
 * would interrupt for is a condition that will still be true at the next pause.
 * The user cannot act on it faster than they can hear it, and the indicator
 * persists, so unlike a toast it cannot be missed by waiting.
 * @param props.useSessions - the sessions list selector, carrying the host control state.
 * @param props.t - localized copy for this namespace.
 * @returns the indicator, or null when there is no known stop.
 */
export function HostStopIndicator({ useSessions, t }: HostStopIndicatorProps) {
  const control = useSessions(state => state.hostControl)
  if (control === undefined || !control.stopped) return null
  const { reason, requestedBy, requestedAtMs } = control.record
  return (
    <div className={css.positioner}>
      <div className={css.card} role="status" aria-label={t('stopped.aria')}>
        <span className={css.title}>{t('stopped.title')}</span>
        <span className={css.detail}>{t('stopped.reason', { reason })}</span>
        <span className={css.detail}>{t('stopped.requestedBy', { requestedBy })}</span>
        <span className={css.detail}>
          {t('stopped.requestedAt', { at: new Date(requestedAtMs).toLocaleString() })}
        </span>
      </div>
    </div>
  )
}
