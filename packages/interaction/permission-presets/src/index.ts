/**
 * User-facing permission presets over the independent sandbox-mode and
 * approval-policy knobs. A switch records the selected preset, then writes
 * changed knobs through their canonical setters. Execution, prompt narration,
 * and replay keep reading their knob folds. The preset event preserves user
 * intent when two presets share a bundle. The read side ships as the
 * `permissions` session projection; the write side ships as the
 * `/permission` command.
 *
 * @module dsh-permission-presets
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { SANDBOX_MODES, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
// Side-effect type import: declaration-merges `ctx.shell` (the capability fact
// `sandboxMode` this service reads), without a value dependency on the seam.
import type {} from '@deepseek-ai/dsh-shell'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { APPROVAL_POLICIES, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { classify, riskRank, RISK_CLASSES_BY_ASCENDING_RISK } from '@deepseek-ai/dsh-risk-taxonomy'
import type { ActionRiskSubject, RiskClass, RiskClassification, RiskPolicy, RiskPolicyRule } from '@deepseek-ai/dsh-risk-taxonomy'
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: resolves the optional projection and command children.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-commands'
import type { PermissionSelect, PresetOption } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    permissionPresets: PermissionPresetService
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest logged permission overrides and constructor-seed provenance. */
    permissions: PermissionProjectionState
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records the selected preset as durable, log-only user intent. The knob
     * events follow in the same turn and control execution; this event stays
     * out of the model transcript and lets the permission projection unit
     * preserve a selection when bundles match.
     */
    'permission/preset': { preset: string }
  }
}

/** One preset's sandbox/approval bundle and optional client presentation. */
export interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
  /**
   * The risk class at or above which an action needs approval under this
   * preset (P2-04 must[1], §12.48-B).
   *
   * It rides the PRESET rather than the surface or the service, because which
   * band is worth interrupting for is the same question `approval` already
   * answers for this bundle: a preset whose point is not to ask should not
   * acquire a threshold that asks. A per-surface value would let one client
   * ask about an action another performs silently, which is exactly the
   * inconsistency P2-04's acceptance[0] rules out.
   */
  approvalThreshold?: RiskClass
}

/**
 * Returned when effective knob values match no table entry. Clients may show
 * it as the current value, but it is never a switch target or event payload.
 */
export const CUSTOM_PRESET = 'custom'

/** Settings namespace carrying the default for future sessions. */
export const PERMISSION_SETTINGS_NAMESPACE = 'permission'

/**
 * The projection unit's knob state: the last seen value of each knob event,
 * null before an override (composition defaults apply at view time).
 */
export interface KnobState {
  /** Last `permission/preset` payload, or null. */
  preset: string | null
  /** Last `sandbox/mode` payload, or null. */
  sandbox: SandboxMode | null
  /** Last `approval/policy` payload, or null. */
  approval: ApprovalPolicy | null
}

/** Projection state for permission overrides and constructor-seed provenance. */
interface PermissionProjectionState extends KnobState {
  /** Whether the log contains a constructor-seed boundary. */
  seeded: boolean
}

const permissionStateSchema: zod.ZodType<PermissionProjectionState> = zod.object({
  preset: zod.string().nullable(),
  sandbox: zod.union([
    zod.literal('read-only'),
    zod.literal('workspace-write'),
    zod.literal('danger-full-access'),
  ]).nullable(),
  approval: zod.union([zod.literal('ask'), zod.literal('never')]).nullable(),
  seeded: zod.boolean(),
}).strict()

/** State for the empty log: every knob at its composition default. */
const EMPTY_KNOBS: KnobState = { preset: null, sandbox: null, approval: null }

/**
 * One-event permission-state transition (the projection unit's `apply`). Unrelated
 * events return the same reference — the registry's change gate.
 * @param state - the folded knob state before `event`.
 * @param event - one committed session event.
 * @returns the next state; the same reference when the event is unrelated.
 */
function applyPermissionEvent(
  state: PermissionProjectionState,
  event: SessionEvent,
): PermissionProjectionState {
  switch (event.type) {
    case 'permission/preset':
      return { ...state, preset: event.data.preset }
    case 'sandbox/mode':
      return { ...state, sandbox: event.data.mode }
    case 'approval/policy':
      return { ...state, approval: event.data.policy }
    case 'session/end-seed':
      return { ...state, seeded: true }
    default:
      return state
  }
}

/** User setting resolved when a new session receives its initial permission. */
export interface PermissionSettings {
  /** Preset pinned into a newly created session. */
  defaultPreset: string
}

/** The {@link PermissionPresetService} config: preset table and composition default. */
export interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
  /**
   * The organisation's risk-classification rules (P2-04 must[1]).
   *
   * A plugin declares domain TAGS; which risk class a tag lands in is the
   * organisation's decision, so the mapping is deployment configuration and
   * lives here rather than with any plugin that would be deciding its own
   * risk band. An empty table is a real choice, not a missing one: every
   * action then classifies by the unknown default.
   */
  riskRules?: RiskPolicyRule[]
  /**
   * Risk classes this deployment refuses outright, on top of the kernel's
   * (P2-04 acceptance[2]).
   *
   * Additions only. An organisation may raise its own bar; the kernel's band
   * is a floor, and a policy naming one of its classes for removal is
   * refused at classification time rather than silently re-added.
   */
  addedHardDenyClasses?: RiskClass[]
  /**
   * Risk classes this deployment states it does NOT refuse (P2-04 acceptance[2]).
   *
   * The field exists so a deployment can SAY it, and be refused where it says
   * it. Naming a class the kernel pins is rejected at mount with the class in
   * the message; naming any other class removes nothing, because the kernel
   * list is the only floor. Silently ignoring the setting instead would let a
   * deployment believe it had switched off a hard deny and discover otherwise
   * at enforcement time.
   */
  removedHardDenyClasses?: RiskClass[]
}

/**
 * Owns the deployment's permission presets and their write path. Requires a
 * confining `ctx.shell` executor and `ctx.approval`; unmatched knob values are
 * reported as {@link CUSTOM_PRESET}, not an error.
 */
export class PermissionPresetService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    presets: z.dict(z.object({
      sandbox: z.union(SANDBOX_MODES as SandboxMode[]).required(),
      approval: z.union(APPROVAL_POLICIES as ApprovalPolicy[]).required(),
      name: z.string(),
      description: z.string(),
      approvalThreshold: z.union(RISK_CLASSES_BY_ASCENDING_RISK as RiskClass[]).default('destructive'),
    })).default({
      'workspace-write': {
        sandbox: 'workspace-write', approval: 'ask', approvalThreshold: 'destructive',
        name: 'workspace-write', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.',
      },
      'danger-full-access': {
        sandbox: 'danger-full-access', approval: 'never', approvalThreshold: 'safety-critical',
        name: 'danger-full-access', description: 'Full file access without approval prompts.',
      },
    }),
    defaultPreset: z.string(),
    riskRules: z.array(z.object({
      domainTag: z.string().required(),
      riskClass: z.union(RISK_CLASSES_BY_ASCENDING_RISK as RiskClass[]).required(),
    })).default([]),
    addedHardDenyClasses: z.array(z.union(RISK_CLASSES_BY_ASCENDING_RISK as RiskClass[])).default([]),
    removedHardDenyClasses: z.array(z.union(RISK_CLASSES_BY_ASCENDING_RISK as RiskClass[])).default([]),
  })

  static inject = ['shell', 'approval', 'sessions', 'sessionProjections']

  private readonly presets: Record<string, PresetSpec>
  private defaultSettings: () => PermissionSettings
  /** The organisation policy this deployment classifies actions under (P2-04 must[1]). */
  private readonly risk: RiskPolicy

  constructor(ctx: Context, config: Config) {
    super(ctx, 'permissionPresets')
    // The schema defaulted the table — the cast records that runtime fact.
    this.presets = config.presets as Record<string, PresetSpec>
    this.risk = {
      rules: config.riskRules as RiskPolicyRule[],
      addedHardDenyClasses: config.addedHardDenyClasses as RiskClass[],
      removedHardDenyClasses: config.removedHardDenyClasses as RiskClass[],
    }
    // Validate the policy at MOUNT, not at the first classification: a
    // deployment that believes it switched off a kernel hard-deny must fail
    // where it said so, and `classify` refuses such a policy every time it is
    // called, which would otherwise surface as a runtime error per action.
    this.classifyAction({ actionId: 'permission-presets:policy-check', domainTags: [] })
    if (CUSTOM_PRESET in this.presets) {
      throw new Error(`permission: "${CUSTOM_PRESET}" is reserved for the derived not-a-preset state and cannot name a table entry`)
    }
    if (ctx.shell.sandboxMode === undefined) {
      throw new Error('permission: the mounted bash executor does not confine (no sandboxMode) — presets bundle a sandbox mode, so composing this plugin over an unconfined executor is a misconfiguration')
    }
    const inferredDefault = this.derive(EMPTY_KNOBS)
    const defaultPreset = config.defaultPreset ?? inferredDefault
    if (defaultPreset === CUSTOM_PRESET) {
      throw new Error('permission: composed sandbox and approval defaults match no preset; configure defaultPreset explicitly')
    }
    this.resolve(defaultPreset)
    const baseSettings: PermissionSettings = { defaultPreset }
    this.defaultSettings = () => baseSettings
    const presetChoices = this.names.map((name) => {
      const choice = z.const(name)
      const label = this.presets[name]?.name
      return label === undefined ? choice : choice.description(label)
    })
    const settingsSchema: z<PermissionSettings> = z.object({
      defaultPreset: z.union(presetChoices).required(),
    })
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, PERMISSION_SETTINGS_NAMESPACE, settingsSchema, baseSettings, {
        setSource: (current) => {
          this.defaultSettings = current
        },
        // The source thunk reads the latest scope snapshot at session creation;
        // no process-level registration needs replacement on change.
        onChange: () => {},
      })
    })

    // zod `.optional()` types the key `string | undefined` while the domain
    // says `description?: string`; on the JSON wire the two serialize
    // identically (absent), so the cast records exactly that
    // exactOptionalPropertyTypes widening (the Wire<T> precedent).
    const selectSchema = zod.object({
      options: zod.array(zod.object({
        value: zod.string().min(1),
        name: zod.string().min(1),
        description: zod.string().optional(),
      })),
      currentValue: zod.string().min(1),
    }) as unknown as zod.ZodType<PermissionSelect>
    ctx.sessionProjections.register({
      key: 'permissions',
      stateVersion: 2,
      stateSchema: permissionStateSchema,
      init: () => ({ ...EMPTY_KNOBS, seeded: false }),
      apply: applyPermissionEvent,
      wire: { viewSchema: selectSchema, view: state => this.selectFor(state) },
    })
    ctx.on('session/created', (session) => {
      this.pinInitialPermission(session)
    })
    for (const session of ctx.sessions.list()) {
      this.pinInitialPermission(session)
    }

    // The /permission command: the one write path a web client uses (the
    // popup contribution submits the picked preset as this line). The child
    // activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'permission',
        description: 'Switch the permission preset (sandbox mode + approval policy)',
        input: { hint: '<preset>' },
        // No settlement text labels its value with this command's own name: a
        // surface that renders `name · text` (the web command row) would
        // otherwise read `permission · Permission preset: workspace-write.`
        handler: ({ agent, rawInput }) => {
          const name = rawInput.trim()
          if (name === '') {
            return { kind: 'success', text: `current preset ${this.current(agent.session)} (available: ${this.names.join(', ')})` }
          }
          if (!this.names.includes(name)) {
            return { kind: 'error', text: `unknown preset "${name}" (available: ${this.names.join(', ')})` }
          }
          this.apply(agent.session, name, (policy) =>{  this.ctx.approval.setPolicy(agent, policy) })
          return { kind: 'success', text: `preset ${name}` }
        },
      })
    })
  }

  /**
   * The advertised preset names, in the preset table's declaration order.
   * @returns every switchable preset name.
   */
  get names(): readonly string[] {
    return Object.keys(this.presets)
  }

  /**
   * The preset currently selected as the default for future sessions.
   * @returns the resolved settings value, or the composition default without
   * a mounted settings provider.
   */
  get defaultPreset(): string {
    return this.defaultSettings().defaultPreset
  }

  private permissionState(session: Session): PermissionProjectionState {
    const state = this.ctx.sessionProjections.stateOf(session, 'permissions')
    if (state === undefined) throw new Error('permission: permissions session projection is not registered')
    return state
  }

  /**
   * Resolve the preset matching the effective knob values. A still-matching
   * last selection wins shared-bundle ties; otherwise the first table match
   * wins, or {@link CUSTOM_PRESET} when no entry matches.
   * @param session - the session whose knob state is read.
   * @returns the effective preset name, or `custom` when nothing matches.
   */
  current(session: Session): string {
    return this.derive(this.permissionState(session))
  }

  /** Resolve the preset for one folded knob state (the shared mathematics of `current` and the projection unit). */
  /**
   * Classify one action under this deployment's organisation policy
   * (P2-04 must[1], must[2], must[3]).
   *
   * The policy is held here rather than passed by each caller so that two
   * surfaces cannot classify the same action differently: the classifier is
   * pure and takes the policy as a parameter, and this is the one place that
   * parameter is bound.
   * @param subject - the action and the domain tags it declares.
   * @returns the class, how it was reached, and whether it is refused outright.
   */
  classifyAction(subject: ActionRiskSubject): RiskClassification {
    return classify(subject, this.risk)
  }

  /**
   * Whether a classified action needs approval before it may execute, under
   * one preset (P2-04 must[1], P2-03 acceptance[2], §12.48-B).
   *
   * The threshold comes from the NAMED preset, because it is part of that
   * permission bundle: a session running `danger-full-access` and one running
   * `read-only` are answering different questions about the same action, and
   * a service-level threshold would give them one answer.
   *
   * A preset the table does not carry — including the derived `custom` state,
   * which is by definition no bundle — resolves to the STRICTEST threshold the
   * table configures. That is fail-closed and invents no tunable: the strictest
   * value is one the deployment already chose.
   *
   * A hard-denied action is NOT reported as needing approval: approval is a
   * question, and the kernel band is one no deployment asks. A caller
   * distinguishes the two by reading `hardDenied` itself.
   * @param classification - the classifier's verdict for the action.
   * @param preset - the preset in force for the session performing it.
   * @returns whether the action's class reaches that preset's threshold.
   */
  requiresApproval(classification: RiskClassification, preset: string): boolean {
    return riskRank(classification.riskClass) >= riskRank(this.thresholdOf(preset))
  }

  /**
   * The approval threshold in force under one preset name.
   * @param preset - a table key, or any value the table does not carry.
   * @returns the preset's threshold, or the strictest the table configures.
   */
  private thresholdOf(preset: string): RiskClass {
    const configured = this.presets[preset]?.approvalThreshold
    if (configured !== undefined) return configured
    const thresholds = Object.values(this.presets)
      .map(spec => spec.approvalThreshold)
      .filter((value): value is RiskClass => value !== undefined)
    return thresholds.reduce(
      (strictest, value) => (riskRank(value) < riskRank(strictest) ? value : strictest),
      thresholds[0] ?? 'destructive',
    )
  }

  private derive(state: KnobState): string {
    const sandbox = state.sandbox ?? this.ctx.shell.sandboxMode
    const approval = state.approval ?? this.ctx.approval.config.policy ?? 'ask'
    const matches = (spec: PresetSpec): boolean => spec.sandbox === sandbox && spec.approval === approval
    if (state.preset !== null) {
      const spec = this.presets[state.preset]
      if (spec !== undefined && matches(spec)) return state.preset
    }
    for (const [name, spec] of Object.entries(this.presets)) {
      if (matches(spec)) return name
    }
    return CUSTOM_PRESET
  }

  /**
   * Build the whole select value for one folded knob state: every table
   * option in declaration order, `custom` appended exactly while derived.
   * @param state - the folded knob overrides.
   * @returns the `permissions` projection payload.
   */
  selectFor(state: KnobState): PermissionSelect {
    const currentValue = this.derive(state)
    return {
      options: [
        ...this.names.map(name => this.optionOf(name)),
        ...currentValue === CUSTOM_PRESET ? [this.optionOf(CUSTOM_PRESET)] : [],
      ],
      currentValue,
    }
  }

  /**
   * Resolve a preset's knob bundle.
   * @param name - the preset name to resolve.
   * @returns the configured bundle.
   * @throws when `name` is not in the table.
   */
  resolve(name: string): PresetSpec {
    const spec = this.presets[name]
    if (spec === undefined) {
      throw new Error(`permission: unknown preset "${name}" (known: ${Object.keys(this.presets).join(', ')})`)
    }
    return spec
  }

  /**
   * Build the client option for a table entry or {@link CUSTOM_PRESET}. A
   * missing label falls back to the table key.
   * @param name - a table key, or `custom`.
   * @returns the option a client renders.
   * @throws when `name` is neither a table key nor `custom`.
   */
  optionOf(name: string): PresetOption {
    if (name === CUSTOM_PRESET) {
      return { value: CUSTOM_PRESET, name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' }
    }
    const spec = this.resolve(name)
    return { value: name, name: spec.name ?? name, ...spec.description !== undefined ? { description: spec.description } : {} }
  }

  /**
   * Record a changed preset, then update each changed knob through its own
   * setter. Selecting the effective preset again appends nothing.
   * @param session - the session the switch belongs to.
   * @param name - the preset to switch to; unknown names throw.
   */
  set(session: Session, name: string): void {
    this.apply(session, name, (policy) =>{  setApprovalPolicy(session, policy) })
  }

  /** Apply one preset with the caller-selected live or initialization policy writer. */
  private apply(session: Session, name: string, setApproval: (policy: ApprovalPolicy) => void): void {
    const spec = this.resolve(name)
    if (this.current(session) !== name) {
      session.append('permission/preset', { preset: name })
    }
    const knobs = this.permissionState(session)
    if (spec.sandbox !== (knobs.sandbox ?? this.ctx.shell.sandboxMode)) {
      setSandboxMode(session, spec.sandbox)
    }
    if (spec.approval !== (knobs.approval ?? this.ctx.approval.config.policy ?? 'ask')) {
      setApproval(spec.approval)
    }
  }

  /**
   * Fill every missing permission fact before a session is published. A
   * genuinely fresh session uses the current user default; seeded or partially
   * initialized sessions preserve their effective knob values and only gain
   * the missing durable facts.
   */
  private pinInitialPermission(session: Session): void {
    const state = this.permissionState(session)
    const selected = state.preset
    const sandbox = state.sandbox
    const approval = state.approval
    const seeded = state.seeded
    if (selected === null && sandbox === null && approval === null && !seeded) {
      const name = this.defaultPreset
      const spec = this.resolve(name)
      session.append('permission/preset', { preset: name })
      setSandboxMode(session, spec.sandbox)
      setApprovalPolicy(session, spec.approval)
      return
    }

    const effective = this.derive(state)
    if (selected === null && effective !== CUSTOM_PRESET) {
      session.append('permission/preset', { preset: effective })
    }
    if (sandbox === null) {
      setSandboxMode(session, this.ctx.shell.sandboxMode as SandboxMode)
    }
    if (approval === null) {
      setApprovalPolicy(session, this.ctx.approval.config.policy ?? 'ask')
    }
  }
}

export default PermissionPresetService
