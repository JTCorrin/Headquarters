import { parseUuid } from './http.ts'

export type RecipientInput = {
  contact_id: string
  is_billing?: boolean
}

export type RecipientRow = {
  id: string
  org_id: string
  contact_id: string
  position: number
  is_billing: boolean
  created_at?: string
  updated_at?: string
  created_by?: string | null
  updated_by?: string | null
  quote_id?: string
  invoice_id?: string
  schedule_id?: string
}

/** Validate `recipients` array for quote/invoice/recurring draft payloads. */
export function validateRecipientsField(
  value: unknown,
  fields: Record<string, string>,
): RecipientInput[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    fields.recipients = 'Must be an array'
    return undefined
  }
  if (value.length > 25) {
    fields.recipients = 'Must not exceed 25 recipients'
    return undefined
  }

  const seen = new Set<string>()
  let billingCount = 0
  const output: RecipientInput[] = []

  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fields[`recipients.${i}`] = 'Must be an object'
      continue
    }
    const row = item as Record<string, unknown>
    for (const key of Object.keys(row)) {
      if (key !== 'contact_id' && key !== 'is_billing') {
        fields[`recipients.${i}.${key}`] = 'Field is not writable'
      }
    }
    let contactId: string | undefined
    try {
      if (typeof row.contact_id !== 'string') {
        throw new Error('not a string')
      }
      contactId = parseUuid(row.contact_id, `recipients.${i}.contact_id`)
    } catch {
      fields[`recipients.${i}.contact_id`] = 'Must be a UUID'
      continue
    }
    if (seen.has(contactId)) {
      fields[`recipients.${i}.contact_id`] = 'Duplicate contact_id'
      continue
    }
    seen.add(contactId)

    let isBilling: boolean | undefined
    if ('is_billing' in row) {
      if (typeof row.is_billing !== 'boolean') {
        fields[`recipients.${i}.is_billing`] = 'Must be a boolean'
        continue
      }
      isBilling = row.is_billing
      if (isBilling) billingCount += 1
    }

    output.push(
      isBilling === undefined
        ? { contact_id: contactId }
        : { contact_id: contactId, is_billing: isBilling },
    )
  }

  if (output.length > 0 && billingCount > 1) {
    fields.recipients = 'Exactly one recipient may have is_billing=true'
  }

  return output
}
