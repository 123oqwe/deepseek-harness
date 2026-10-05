import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CordisCatalogProjector,
  projectCordisCatalog,
  renderInheritedPage,
  renderPageRegion,
  type CordisCatalogPolicy,
} from '../src/cordis-catalog.ts'
import type { SourceDeclarationModel } from '../src/model.ts'
import {
  CORDIS_CATALOG_POLICY,
  EVENT_SCOPE_PAGE,
  localizePageRegion,
  REGION_BEGIN,
  REGION_END,
  SERVICE_PAGE,
} from '../../../../scripts/gen-cordis-catalog.ts'

const workspaceRoot = resolve(import.meta.dirname, '../../../..')

/** One workspace projection shared by both cases: analyzing it twice doubles a multi-minute run. */
let cached: ReturnType<typeof projectCordisCatalog> | undefined
const projection = (): ReturnType<typeof projectCordisCatalog> =>
  (cached ??= projectCordisCatalog(workspaceRoot, CORDIS_CATALOG_POLICY))

const SOURCE_LINK_POLICY: CordisCatalogPolicy = {
  linkedTypePages: {},
  foundationTypeNames: new Set(),
  typeLinkExemptions: {},
  inheritedEvents: [{ name: 'ready', summary: 'Ready.', source: 'vendor/cordis/src/events.ts:9' }],
  inheritedServices: [{ name: 'ctx.root', summary: 'Root.', source: 'vendor/cordis/src/context.ts:12' }],
}

describe('Typert-backed Cordis catalog', () => {
  it('omits subsystem source lines while preserving inherited Cordis source lines', () => {
    const page = renderPageRegion('fixture.md', [{
      key: 'fixture',
      type: 'Fixture',
      abstract: false,
      doc: 'Fixture.',
      methods: [],
      source: 'packages/fixture/service.ts:24',
    }], [{
      name: 'fixture/ready',
      scope: 'fixture',
      signature: "'fixture/ready'(): void",
      jsDoc: '/** Ready. */',
      mode: 'emit',
      doc: 'Ready.',
      source: 'packages/fixture/events.ts:42',
    }], SOURCE_LINK_POLICY)
    const inherited = renderInheritedPage(SOURCE_LINK_POLICY)

    expect(page).toContain('Source: [`packages/fixture/events.ts`](../../packages/fixture/events.ts)')
    expect(page).toContain('Source: [`packages/fixture/service.ts`](../../packages/fixture/service.ts)')
    expect(inherited).toContain('([`vendor/cordis/src/events.ts:9`](../../vendor/cordis/src/events.ts))')
    expect(inherited).toContain('([`vendor/cordis/src/context.ts:12`](../../vendor/cordis/src/context.ts))')
  })

  it('keeps a type two packages declare with the same text and drops one they declare differently', () => {
    const declared = (file: string, name: string, text: string): SourceDeclarationModel => ({
      face: 'host', package: file, name, kind: 'alias', location: { file, line: 1, column: 1 }, text,
    })
    const projector = new CordisCatalogProjector(
      { face: 'host', packages: [], graph: { declarations: [], nodes: [] } },
      [
        declared('packages/fixture/owner/src/types.ts', 'SessionId', "export type SessionId = Branded<'SessionId'>;"),
        declared('packages/fixture/copy/src/types.ts', 'SessionId', "export type SessionId = Branded<'SessionId'>;"),
        declared('packages/fixture/owner/src/types.ts', 'Widget', 'export type Widget = string;'),
        declared('packages/fixture/copy/src/types.ts', 'Widget', 'export type Widget = number;'),
      ],
      {
        ...SOURCE_LINK_POLICY,
        runtimeServices: [{
          key: 'fixture',
          type: 'Fixture',
          abstract: false,
          doc: 'Fixture.',
          methods: [{ signature: 'read(id: SessionId): Widget', jsDoc: '' }],
          source: 'packages/fixture/owner/src/index.ts:1',
        }],
      },
    )
    const source = projector.renderRuntimeApi({ events: [], services: [] })

    expect(source).toContain("    name: 'SessionId',")
    expect(source).not.toContain("    name: 'Widget',")
  })

  it('reproduces every committed catalog artifact byte for byte', { timeout: 480_000 }, () => {
    const { projector, model } = projection()
    const expected = (path: string): string => readFileSync(join(workspaceRoot, path), 'utf8')

    expect(renderInheritedPage(CORDIS_CATALOG_POLICY)).toBe(expected('docs/cordis-api/inherited.md'))
    for (const page of [...new Set([...Object.values(SERVICE_PAGE), ...Object.values(EVENT_SCOPE_PAGE)])].sort()) {
      const region = renderPageRegion(
        page,
        [...model.services].filter(s => SERVICE_PAGE[s.key] === page),
        [...model.events].filter(e => EVENT_SCOPE_PAGE[e.scope] === page),
        CORDIS_CATALOG_POLICY,
      )
      for (const side of [page, page.replace(/\.md$/, '.zh.md')]) {
        const rel = `docs/subsystems/${side}`
        const committed = expected(rel)
        const begin = committed.indexOf(REGION_BEGIN)
        const end = committed.indexOf(REGION_END)
        expect(begin, `${rel} carries the region`).toBeGreaterThanOrEqual(0)
        expect(committed.slice(begin, end + REGION_END.length)).toBe(
          localizePageRegion(region, rel, workspaceRoot),
        )
      }
    }
    expect(projector.renderRuntimeApi(model)).toBe(
      expected('packages/extensions/tool-cordis/src/api-catalog.ts'),
    )
  })

  it('resolves each key to the declaration a caller meets, and drops keys no plugin provides', { timeout: 480_000 }, () => {
    const byKey = new Map(projection().model.services.map(service => [service.key, service]))
    // An interface-typed key is described by its Service Definition: that is where
    // the contract and, by repository convention, the member JSDoc live.
    expect(byKey.get('lsp')?.type).toBe('LspService')
    // Two packages describe `ctx.typert` — a merge-extensible interface in
    // type-meta and the implementing class in registry. The class wins: it is the
    // object a caller meets and it carries the documentation.
    expect(byKey.get('typert')?.type).toBe('TypertRegistry')
    // Optional keys are values a launcher installs before the tree mounts. No
    // plugin provides them, so describing one as a service would answer "add the
    // plugin that provides it" for a key where no such plugin exists.
    expect(byKey.has('headlessIo')).toBe(false)
    expect(byKey.has('dshHomePath')).toBe(false)
    expect(byKey.has('launcherEnvironment')).toBe(false)
  })
})
