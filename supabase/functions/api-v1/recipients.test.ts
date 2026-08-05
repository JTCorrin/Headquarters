import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { ApiError } from './http.ts'
import { validateRecipientsField } from './recipients.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

Deno.test('validateRecipientsField accepts empty array and billing pair', () => {
  const fields: Record<string, string> = {}
  assertEquals(validateRecipientsField([], fields), [])
  assertEquals(fields, {})

  const ok = validateRecipientsField(
    [
      { contact_id: A, is_billing: true },
      { contact_id: B, is_billing: false },
    ],
    fields,
  )
  assertEquals(ok, [
    { contact_id: A, is_billing: true },
    { contact_id: B, is_billing: false },
  ])
  assertEquals(fields, {})
})

Deno.test('validateRecipientsField rejects duplicates and dual billing', () => {
  const fields: Record<string, string> = {}
  validateRecipientsField(
    [
      { contact_id: A, is_billing: true },
      { contact_id: A, is_billing: false },
    ],
    fields,
  )
  assertEquals(fields['recipients.1.contact_id'], 'Duplicate contact_id')

  const dual: Record<string, string> = {}
  validateRecipientsField(
    [
      { contact_id: A, is_billing: true },
      { contact_id: B, is_billing: true },
    ],
    dual,
  )
  assertEquals(dual.recipients, 'Exactly one recipient may have is_billing=true')
})

Deno.test('validateRecipientsField rejects non-array and oversized lists', () => {
  const fields: Record<string, string> = {}
  validateRecipientsField('nope', fields)
  assertEquals(fields.recipients, 'Must be an array')

  const big: Record<string, string> = {}
  validateRecipientsField(
    Array.from({ length: 26 }, (_, i) => ({
      contact_id: `${i.toString().padStart(8, '0')}-1111-4111-8111-111111111111`,
    })),
    big,
  )
  assertEquals(big.recipients, 'Must not exceed 25 recipients')
})

Deno.test('validateQuoteBody wires recipients through create payload', async () => {
  const { validateQuoteBody } = await import('./quotes.ts')
  const clientId = '33333333-3333-4333-8333-333333333333'
  const result = validateQuoteBody(
    {
      title: 'Recipients quote',
      client_id: clientId,
      recipients: [{ contact_id: A, is_billing: true }, { contact_id: B }],
      lines: [],
    },
    false,
  )
  assertEquals(result.recipients, [
    { contact_id: A, is_billing: true },
    { contact_id: B },
  ])
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: 'Bad',
          client_id: clientId,
          recipients: 'x',
          lines: [],
        },
        false,
      ),
    ApiError,
  )
})
