import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { callTool } from './mcp.ts'
import type { McpAuth } from './mcp.ts'
import { ApiError } from './http.ts'

const ORG_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const COLUMN_ID = '22222222-3333-4444-8555-666666666666'
const CARD_ID = '33333333-4444-4555-8666-777777777777'
const USER_ID = '44444444-5555-4666-8777-888888888888'

type Row = Record<string, unknown>

function projectRow(): Row {
  return {
    id: PROJECT_ID,
    org_id: ORG_ID,
    client_id: null,
    name: 'Stub Project',
    description: null,
    status: 'active',
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
  }
}

function cardRow(overrides: Row = {}): Row {
  return {
    id: CARD_ID,
    org_id: ORG_ID,
    project_id: PROJECT_ID,
    column_id: COLUMN_ID,
    title: 'Stub Card',
    description: null,
    assignee_membership_id: null,
    due_at: null,
    position: 0,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

/** Minimal fluent stub covering the query shapes projects.ts/clients.ts build. */
class StubQuery {
  constructor(
    private resolve: (table: string) => { data: unknown; error: unknown },
    private table: string,
  ) {}
  select(_cols?: string) {
    return this
  }
  insert(_values?: Row) {
    return this
  }
  update(_values?: Row) {
    return this
  }
  eq(_col: string, _val: unknown) {
    return this
  }
  is(_col: string, _val: unknown) {
    return this
  }
  order(_col: string, _opts?: unknown) {
    return this
  }
  in(_col: string, _vals: unknown[]) {
    return this
  }
  contains(_col: string, _vals: unknown) {
    return this
  }
  limit(_n: number) {
    return this
  }
  range(_from: number, _to: number) {
    return this
  }
  single() {
    return Promise.resolve(this.resolve(this.table))
  }
  maybeSingle() {
    return Promise.resolve(this.resolve(this.table))
  }
  then<T>(
    onFulfilled: (value: { data: unknown; error: unknown }) => T,
  ): Promise<T> {
    return Promise.resolve(onFulfilled(this.resolve(this.table)))
  }
}

export function makeDb(
  tables: Record<string, () => { data: unknown; error: unknown }>,
): {
  from(table: string): StubQuery
  rpc(name: string, _args?: Row): Promise<{ data: unknown; error: unknown }>
} {
  return {
    from(table: string) {
      const resolver = tables[table] ??
        (() => ({ data: null, error: null }))
      return new StubQuery(resolver, table)
    },
    rpc(name: string) {
      if (name === 'soft_delete_project_card') {
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  }
}

function makeAuth(
  role: 'owner' | 'admin' | 'member' | 'readonly' | 'billing',
  db: unknown,
): McpAuth {
  return {
    db: db as McpAuth['db'],
    userId: USER_ID,
    membership: { id: 'membership-1', role },
    orgId: ORG_ID,
    actorType: 'api_key',
    apiKeyId: 'key-1',
  }
}

Deno.test('MCP guards block billing and readonly across resources', async () => {
  for (const role of ['billing', 'readonly'] as const) {
    const auth = makeAuth(role, makeDb({}))
    await assertRejects(
      () =>
        callTool(
          auth,
          'create_card',
          { project_id: PROJECT_ID, column_id: COLUMN_ID, title: 'T' },
          `req-guard-${role}`,
        ),
      ApiError,
      undefined,
      `${role} should be blocked from card mutation`,
    )
  }
})

Deno.test('MCP billing members can read clients but not modify them', async () => {
  const clientRow = {
    id: CARD_ID,
    org_id: ORG_ID,
    name: 'Stub Client',
    status: 'active',
    lifecycle_status: 'active',
    owner_membership_id: null,
    primary_email: 'stub@example.test',
    primary_phone: null,
    website_url: null,
    address_line1: null,
    city: null,
    country_code: null,
    notes: null,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    created_by: null,
    updated_by: null,
  }
  const db = makeDb({
    clients: () => ({ data: [clientRow], error: null }),
  })
  const readAuth = makeAuth('billing', db)
  const result = await callTool(readAuth, 'list_clients', {}, 'req-clients')
  assertEquals(result.isError, false)

  const writeAuth = makeAuth('billing', makeDb({}))
  await assertRejects(
    () => callTool(writeAuth, 'create_client', { name: 'X' }, 'req-client-write'),
    ApiError,
  )
})

Deno.test('MCP create_card requires user-backed actor and valid uuid args', async () => {
  const db = makeDb({ projects: () => ({ data: projectRow(), error: null }) })
  const anonAuth: McpAuth = {
    ...makeAuth('member', db),
    userId: null,
  }
  await assertRejects(
    () =>
      callTool(
        anonAuth,
        'create_card',
        {
          project_id: PROJECT_ID,
          column_id: COLUMN_ID,
          title: 'T',
        },
        'req-anon-card',
      ),
    ApiError,
  )

  const badArgsAuth = makeAuth('member', db)
  await assertRejects(
    () =>
      callTool(
        badArgsAuth,
        'create_card',
        { project_id: 'not-a-uuid', column_id: COLUMN_ID, title: 'T' },
        'req-bad-card',
      ),
    ApiError,
  )
})

Deno.test('MCP create_card creates through the HTTP pipeline', async () => {
  const db = makeDb({
    projects: () => ({ data: projectRow(), error: null }),
    project_cards: () => ({
      data: cardRow(),
      error: null,
    }),
  })
  const auth = makeAuth('member', db)
  const result = await callTool(
    auth,
    'create_card',
    {
      project_id: PROJECT_ID,
      column_id: COLUMN_ID,
      title: 'New card',
    },
    'req-create-card',
  )
  assertEquals(result.isError, false)
  assert(result.structuredContent)
})

Deno.test('MCP update_card sends If-Match version', async () => {
  const db = makeDb({
    project_cards: () => ({
      data: cardRow({ version: 2 }),
      error: null,
    }),
    projects: () => ({ data: projectRow(), error: null }),
  })
  const auth = makeAuth('admin', db)
  const result = await callTool(
    auth,
    'update_card',
    {
      project_id: PROJECT_ID,
      id: CARD_ID,
      version: 2,
      title: 'Renamed',
    },
    'req-update-card',
  )
  assertEquals(result.isError, false)
})

Deno.test('MCP update_card rejects stale versions with 412', async () => {
  const db = makeDb({
    projects: () => ({ data: projectRow(), error: null }),
    project_cards: () => ({ data: null, error: null }),
  })
  const auth = makeAuth('admin', db)
  await assertRejects(
    () =>
      callTool(
        auth,
        'update_card',
        {
          project_id: PROJECT_ID,
          id: CARD_ID,
          version: 9,
          title: 'Renamed',
        },
        'req-stale-card',
      ),
    ApiError,
    undefined,
    undefined,
  )
})

Deno.test('MCP delete_card soft-deletes via RPC with version guard', async () => {
  const rpcCalls: Array<{ name: string; args: Row }> = []
  const base = makeDb({
    projects: () => ({ data: projectRow(), error: null }),
    project_cards: () => ({ data: cardRow(), error: null }),
  })
  const db = {
    ...base,
    rpc(name: string, args?: Row) {
      rpcCalls.push({ name, args: args ?? {} })
      return Promise.resolve({ data: null, error: null })
    },
  }
  const auth = makeAuth('owner', db)
  const result = await callTool(
    auth,
    'delete_card',
    {
      project_id: PROJECT_ID,
      id: CARD_ID,
      version: 1,
    },
    'req-delete-card',
  )
  assertEquals(result.isError, false)
  assertEquals(
    rpcCalls.some((call) =>
      call.name === 'soft_delete_project_card' &&
      call.args.p_expected_version === 1
    ),
    true,
  )
})
