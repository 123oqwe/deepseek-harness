// @vitest-environment jsdom
/**
 * P2-12 acceptance[3], end to end on the browser side: a control frame enters
 * the real Session Controller client, and a rendered component shows it.
 *
 * **Each half of this path has now shipped without the other twice.** The host
 * emitted to a client that dropped the frame (`3975e4f3e7`), and the manager
 * recorded a state no store carried (`1b61575d8d`). Both halves had passing
 * cases of their own; neither suite could see the seam. This case is the seam:
 * a real `ClientSessions`, its real `projectList`, its real list store, a
 * `useSessions` bound over that store the way the slot runtime binds one, and
 * the shipped component.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
// `ClientSessions` is not on the package's `/client` face (its `client/index.ts`
// imports it to build the service and re-exports only the interface), so the
// class comes through the `./src/*` export the package declares. The real
// class is the point: a stand-in would not carry `projectList`, which is
// where the state was being lost.
import { ClientSessions } from '@deepseek-ai/dsh-api-session-controller/src/client/sessions/service.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { HostStopIndicator, type HostStopIndicatorProps } from '../src/client/HostStopIndicator.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t: HostStopIndicatorProps['t'] = makeTranslate(zh)

const STOPPED = {
  stopped: true as const,
  record: { requestedBy: 'operator-1', reason: 'human-requested', requestedAtMs: 1_700_000_000_000, release: 'explicit-resume' },
}

/**
 * A remote that is never called.
 *
 * `ClientSessions` hands it straight to `SessionManager`
 * (`client/sessions/service.ts:242-246`), whose constructor only stores it
 * (`client/sessions/manager.ts:163-171`); nothing on the control-frame path
 * reaches it. That is read from those two constructors rather than assumed —
 * a stub that turned out to be called would fail as a confusing undefined
 * rather than as a missing fixture.
 */
const UNUSED_REMOTE = {} as never

/** A selector hook over a live store, the way the slot runtime binds one. */
function hookOf<T>(store: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(select: (snapshot: T) => S): S {
    return select(useSyncExternalStore(store.subscribe, store.getSnapshot))
  }
}

/**
 * The two props this component reads, widened to the full standard kit.
 *
 * `GlobalStandardProps` is the seat every assembled Client merges into -- panel
 * info, workspaces, resources, pending interactions -- and the slot runtime
 * fills all of it. Building those here would fixture four subsystems this case
 * says nothing about, so it casts, the way
 * `ui-agent-preset/tests/components.client.spec.tsx:59` does.
 * @param useSessions - the live selector hook under test.
 * @returns props the component can be rendered with.
 */
function props(useSessions: (select: (snapshot: SessionListState) => unknown) => unknown): HostStopIndicatorProps {
  return { useSessions, t } as unknown as HostStopIndicatorProps
}

describe('host stop, control frame to rendered component', () => {
  it('appears when the frame arrives and disappears when the stop is released', async () => {
    const service = new ClientSessions(new Context(), UNUSED_REMOTE)
    const useSessions = hookOf<SessionListState>(service.list)

    render(<HostStopIndicator {...props(useSessions)} />)
    // Nothing yet: no control plane has spoken, which is UNKNOWN and not a
    // claim that the host is running.
    expect(screen.queryByRole('status')).toBeNull()

    await act(async () => {
      service.handleControlFrame({ type: 'control', state: STOPPED })
      await Promise.resolve() // the manager notifier batches on a microtask
    })
    const card = screen.getByRole('status', { name: zh['stopped.aria'] })
    expect(card.textContent).toContain('human-requested')
    expect(card.textContent).toContain('operator-1')

    // Released: the host says it is no longer stopped, and the indicator goes
    // away on its own. A surface left showing a lifted stop is worse than one
    // that never learned of it.
    await act(async () => {
      service.handleControlFrame({ type: 'control', state: { stopped: false } })
      await Promise.resolve()
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('forgets the stop when a later baseline carries none, rather than showing a halt nothing enforces', async () => {
    const service = new ClientSessions(new Context(), UNUSED_REMOTE)
    const useSessions = hookOf<SessionListState>(service.list)
    render(<HostStopIndicator {...props(useSessions)} />)

    await act(async () => {
      service.handleControlFrame({ type: 'control', state: STOPPED })
      await Promise.resolve()
    })
    expect(screen.queryByRole('status')).not.toBeNull()

    // A reconnect can land on a host with no control plane at all.
    await act(async () => {
      service.handleControlFrame({ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } })
      await Promise.resolve()
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
