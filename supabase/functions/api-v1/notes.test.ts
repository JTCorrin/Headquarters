import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import { ApiError } from './http.ts'
import {
  decodeNoteCursor,
  handleNotes,
  normaliseSearchQuery,
  noteExcerpt,
  validateNoteBody,
} from './notes.ts'

const ORG_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const MEMBERSHIP_ID = '11111111-2222-4333-8444-555555555555'
const NOTE_ID = '22222222-3333-4444-8555-666666666666'

type Row = Record<string, unknown>

function noteRow(overrides: Row = {}): Row {
  return {
    id: NOTE_ID,
    org_id: ORG_ID,
    owner_membership_id: MEMBERSHIP_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    created_by: null,
    updated_by: null,
    deleted_at: null,
    version: 1,
    title: 'Stub note',
    body: { type: 'doc', content: [] },
    body_text: 'hello world',
    color: 'yellow',
    pinned: false,
    ...overrides,
  }
}

interface Recorded {
  table: string
  filters: Array<{ op: string; col: string; val: unknown }>
  textSearch: { col: string; q: string; opts: unknown } | null
  inserted: Row | null
  updated: Row | null
}

/** Fluent stub that records the filters applied so tests can assert scoping. */
class RecordingQuery {
  constructor(
    private resolve: () => { data: unknown; error: unknown },
    readonly record: Recorded,
  ) {}
  select() {
    return this
  }
  insert(values: Row) {
    this.record.inserted = values
    return this
  }
  update(values: Row) {
    this.record.updated = values
    return this
  }
  eq(col: string, val: unknown) {
    this.record.filters.push({ op: 'eq', col, val })
    return this
  }
  is(col: string, val: unknown) {
    this.record.filters.push({ op: 'is', col, val })
    return this
  }
  or(expr: string) {
    this.record.filters.push({ op: 'or', col: '', val: expr })
    return this
  }
  textSearch(col: string, q: string, opts: unknown) {
    this.record.textSearch = { col, q, opts }
    return this
  }
  order() {
    return this
  }
  limit() {
    return this
  }
  single() {
    return Promise.resolve(this.resolve())
  }
  maybeSingle() {
    return Promise.resolve(this.resolve())
  }
  then<T>(onFulfilled: (value: { data: unknown; error: unknown }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.resolve()))
  }
}

function makeDb(resolve: () => { data: unknown; error: unknown }) {
  const records: Recorded[] = []
  const rpcCalls: Array<{ name: string; args: Row }> = []
  const db = {
    from(table: string) {
      const record: Recorded = {
        table,
        filters: [],
        textSearch: null,
        inserted: null,
        updated: null,
      }
      records.push(record)
      return new RecordingQuery(resolve, record)
    },
    rpc(name: string, args: Row) {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
  }
  return { db: db as unknown as Parameters<typeof handleNotes>[1], records, rpcCalls }
}

function call(
  db: Parameters<typeof handleNotes>[1],
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers ?? {})
  let body: string | undefined
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.body)
  }
  const req = new Request(`https://example.test${path}`, { method, headers, body })
  return handleNotes(req, db, path.split('?')[0], ORG_ID, 'member', MEMBERSHIP_ID, 'req-notes')
}

Deno.test('note create validation applies defaults and rejects unknown fields', () => {
  const created = validateNoteBody({}, false)
  assertEquals(created, { title: '', color: 'yellow', pinned: false })

  const err = assertThrows(
    () => validateNoteBody({ title: 'x', owner_membership_id: 'spoof' }, false),
    ApiError,
  )
  assertEquals(err.status, 422)
  assertEquals(err.fields?.owner_membership_id, 'Field is not writable')

  assertThrows(() => validateNoteBody({ color: 'neon' }, true), ApiError)
  assertThrows(() => validateNoteBody({ pinned: 'yes' }, true), ApiError)
  assertThrows(() => validateNoteBody({ body: [] }, true), ApiError)
  assertThrows(() => validateNoteBody({}, true), ApiError)

  const patched = validateNoteBody(
    { title: '  Trim me  ', body: { type: 'doc' }, body_text: 'plain', pinned: true },
    true,
  )
  assertEquals(patched.title, 'Trim me')
  assertEquals(patched.body_text, 'plain')
  assertEquals(patched.pinned, true)
})

Deno.test('note cursor round-trips pinned/updated_at/id and rejects garbage', async () => {
  const { db } = makeDb(() => ({
    data: Array.from({ length: 3 }, (_, i) =>
      noteRow({
        id: `3333333${i}-3333-4444-8555-666666666666`,
        pinned: i === 0,
        updated_at: `2026-01-0${3 - i}T00:00:00Z`,
      })),
    error: null,
  }))
  const res = await call(db, 'GET', '/api/v1/notes?limit=2')
  const json = await res.json()
  assertEquals(json.data.length, 2)
  assert(typeof json.meta.next_cursor === 'string')
  const cursor = decodeNoteCursor(json.meta.next_cursor)
  assertEquals(cursor.pinned, false)
  assertEquals(cursor.updated_at, '2026-01-02T00:00:00Z')

  assertThrows(() => decodeNoteCursor('not*base64'), ApiError)
  assertThrows(() => decodeNoteCursor(btoa('{"id":"nope"}')), ApiError)
})

Deno.test('note list always scopes to owner membership and applies search', async () => {
  const { db, records } = makeDb(() => ({ data: [noteRow()], error: null }))
  const res = await call(db, 'GET', '/api/v1/notes?q=hello%20world&pinned=true')
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.data[0].excerpt, 'hello world')
  assertEquals('body' in json.data[0], false)
  assertEquals('body_text' in json.data[0], false)

  const record = records[0]
  assertEquals(record.table, 'notes')
  assert(
    record.filters.some((f) =>
      f.op === 'eq' && f.col === 'owner_membership_id' && f.val === MEMBERSHIP_ID
    ),
    'list must filter by owner_membership_id',
  )
  assert(record.filters.some((f) => f.op === 'eq' && f.col === 'pinned' && f.val === true))
  assertEquals(record.textSearch?.col, 'search')
  assertEquals(record.textSearch?.q, 'hello world')
})

Deno.test('note list rejects invalid pinned and over-long q', async () => {
  const { db } = makeDb(() => ({ data: [], error: null }))
  const err = await assertRejects(() => call(db, 'GET', '/api/v1/notes?pinned=maybe'), ApiError)
  assertEquals(err.status, 400)
  assertEquals(normaliseSearchQuery('   '), null)
  assertThrows(() => normaliseSearchQuery('x'.repeat(201)), ApiError)
})

Deno.test('note create inserts with owner membership from auth, never from body', async () => {
  const { db, records } = makeDb(() => ({ data: noteRow(), error: null }))
  const res = await call(db, 'POST', '/api/v1/notes', { body: { title: 'New', color: 'blue' } })
  assertEquals(res.status, 201)
  assertEquals(res.headers.get('etag'), '"1"')
  assertEquals(res.headers.get('location'), `/api/v1/notes/${NOTE_ID}`)
  assertEquals(records[0].inserted?.owner_membership_id, MEMBERSHIP_ID)
  assertEquals(records[0].inserted?.org_id, ORG_ID)
  assertEquals(records[0].inserted?.color, 'blue')
})

Deno.test('note get/patch/delete scope every query by owner membership', async () => {
  const { db, records, rpcCalls } = makeDb(() => ({ data: noteRow(), error: null }))

  const got = await call(db, 'GET', `/api/v1/notes/${NOTE_ID}`)
  assertEquals(got.status, 200)

  const patched = await call(db, 'PATCH', `/api/v1/notes/${NOTE_ID}`, {
    body: { pinned: true },
    headers: { 'if-match': '"1"' },
  })
  assertEquals(patched.status, 200)

  const deleted = await call(db, 'DELETE', `/api/v1/notes/${NOTE_ID}`, {
    headers: { 'if-match': '"1"' },
  })
  assertEquals(deleted.status, 204)
  assertEquals(rpcCalls[0].name, 'soft_delete_note')
  assertEquals(rpcCalls[0].args.p_note_id, NOTE_ID)
  assertEquals(rpcCalls[0].args.p_expected_version, 1)

  for (const record of records) {
    assert(
      record.filters.some((f) => f.col === 'owner_membership_id' && f.val === MEMBERSHIP_ID),
      `query on ${record.table} must be scoped to the owner membership`,
    )
  }
})

Deno.test('note patch requires If-Match and rejects stale versions with 412', async () => {
  const { db } = makeDb(() => ({ data: noteRow({ version: 3 }), error: null }))
  const missing = await assertRejects(
    () => call(db, 'PATCH', `/api/v1/notes/${NOTE_ID}`, { body: { title: 'x' } }),
    ApiError,
  )
  assertEquals(missing.status, 428)

  const stale = await assertRejects(
    () =>
      call(db, 'PATCH', `/api/v1/notes/${NOTE_ID}`, {
        body: { title: 'x' },
        headers: { 'if-match': '"1"' },
      }),
    ApiError,
  )
  assertEquals(stale.status, 412)
})

Deno.test('note routes 404 on unknown paths and non-uuid ids', async () => {
  const { db } = makeDb(() => ({ data: null, error: null }))
  const missingNote = await assertRejects(
    () => call(db, 'GET', `/api/v1/notes/${NOTE_ID}`),
    ApiError,
  )
  assertEquals(missingNote.status, 404)
  const badId = await assertRejects(() => call(db, 'GET', '/api/v1/notes/not-a-uuid'), ApiError)
  assertEquals(badId.status, 404)
  const method = await assertRejects(() => call(db, 'PUT', '/api/v1/notes'), ApiError)
  assertEquals(method.status, 405)
})

Deno.test('note excerpt collapses whitespace and truncates', () => {
  assertEquals(noteExcerpt('  a\n\n b   c '), 'a b c')
  const long = noteExcerpt('word '.repeat(100))
  assert(long.length <= 280)
  assert(long.endsWith('…'))
})
