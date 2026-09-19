// @vitest-environment jsdom
/**
 * P2-12 acceptance[3]'s Web half: the indicator, and the two states in which it
 * must say nothing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostControlState } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { HostStopIndicator, type HostStopIndicatorProps } from '../src/client/HostStopIndicator.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const SESSION = 'session' as SessionId
/**
 * The dictionary arrives as a PROP here, from `makeTranslate` over this
 * package's own `zh` keys — no locale service is mounted and none is needed.
 * In production the slot supplies `t` because the entry registers with
 * `locale: NS`, and that registration is asserted separately in
 * `apply.client.spec.ts`. These cases are about what the component renders,
 * given copy.
 */
const t: HostStopIndicatorProps['t'] = makeTranslate(zh)

const STOPPED: HostControlState = {
  stopped: true,
  record: {
    requestedBy: 'operator-1',
    reason: 'human-requested',
    requestedAtMs: 1_700_000_000_000,
    release: 'explicit-resume',
  },
}

function props(hostControl: HostControlState | undefined): HostStopIndicatorProps {
  const state = {
    ids: [SESSION],
    byId: {},
    current: SESSION,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    ...(hostControl === undefined ? {} : { hostControl }),
  } satisfies SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  return { useSessions, t } as unknown as HostStopIndicatorProps
}

describe('HostStopIndicator', () => {
  it('shows the stop with its reason, requester and time', () => {
    render(<HostStopIndicator {...props(STOPPED)} />)
    const card = screen.getByRole('status', { name: zh['stopped.aria'] })
    expect(card.textContent).toContain(zh['stopped.title'])
    expect(card.textContent).toContain('human-requested')
    expect(card.textContent).toContain('operator-1')
    // The YEAR, not the formatted string: `toLocaleString()` renders in the
    // runtime's locale and timezone, and pinning its exact output would assert
    // the environment rather than the component. The year is stable across
    // both, and it is enough to catch the failure that matters here -- a field
    // other than `requestedAtMs` reaching this line.
    expect(card.textContent).toContain('2023')
  })

  it('says NOTHING when the state is unknown, rather than implying the host is running', () => {
    // The absent key is the reachable case: no control plane is mounted, or no
    // baseline has arrived yet. Rendering "not stopped" here would be an
    // assertion the client cannot make.
    const { container } = render(<HostStopIndicator {...props(undefined)} />)
    expect(container.innerHTML).toBe('')
  })

  it('says nothing when the host is known to be running', () => {
    const { container } = render(<HostStopIndicator {...props({ stopped: false })} />)
    expect(container.innerHTML).toBe('')
  })

  it('does NOT cover the frame, so the application stays clickable while it shows', () => {
    // The trap this case exists for: `.overlayLayer` is `pointer-events: none`
    // but gives every DIRECT child `pointer-events: auto`
    // (`../src/client/AppFrame.module.css:90-99`). An entry whose root
    // is a full-bleed wrapper would therefore swallow every click in the
    // application for as long as a stop is displayed -- and a stop is a state
    // nobody exercises, so nothing else would catch it.
    //
    // jsdom computes no layout, so geometry is not observable here. What IS
    // observable is the property that decides it: the frame-spanning element
    // must opt OUT of pointer events, leaving only the card opted in.
    const { container } = render(<HostStopIndicator {...props(STOPPED)} />)
    const positioner = container.firstElementChild
    expect(positioner).not.toBeNull()
    const card = screen.getByRole('status', { name: zh['stopped.aria'] })
    expect(positioner?.contains(card)).toBe(true)
    // The class carrying `pointer-events: none` is on the spanning element and
    // the one carrying `auto` is on the card; CSS modules hash the names, so
    // the two are asserted to DIFFER rather than by literal name.
    expect(positioner?.className).not.toBe(card.className)
    expect(positioner?.className).toBeTruthy()
  })
})
