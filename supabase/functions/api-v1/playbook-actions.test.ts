import { assertEquals } from 'jsr:@std/assert@1'
import { emailDedupeKey, uuidFromKey } from '../_shared/playbook-actions.ts'

Deno.test('emailDedupeKey is stable and case-insensitive on recipient', () => {
  const a = emailDedupeKey({
    runId: 'run-1',
    nodeId: 'n1',
    to: 'A@Example.COM',
    templateId: 'tmpl',
    playbookVersion: 2,
  })
  const b = emailDedupeKey({
    runId: 'run-1',
    nodeId: 'n1',
    to: 'a@example.com',
    templateId: 'tmpl',
    playbookVersion: 2,
  })
  assertEquals(a, b)
  assertEquals(a.startsWith('email:'), true)
})

Deno.test('uuidFromKey is deterministic UUID-shaped', async () => {
  const a = await uuidFromKey('run:node:member')
  const b = await uuidFromKey('run:node:member')
  const c = await uuidFromKey('run:node:other')
  assertEquals(a, b)
  assertEquals(a === c, false)
  assertEquals(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a),
    true,
  )
})
