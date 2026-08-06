import { ApiError } from './http.ts'

export const AI_PROMPT_KEYS = [
  'email_reply',
  'meeting_summary',
  'meeting_task_proposals',
  'invoice_chase',
] as const

export type AiPromptKey = (typeof AI_PROMPT_KEYS)[number]

export const DEFAULT_AI_PROMPTS: Record<AiPromptKey, string> = {
  email_reply:
    'Draft a concise email reply based on the source message. Stay professional and actionable. Do not invent facts that are not in the thread.',
  meeting_summary:
    'Summarise this meeting transcript into clear prose: decisions, open questions, and next steps. Keep it skimmable.',
  meeting_task_proposals:
    'Extract 1–3 concrete follow-up tasks from the transcript. Reply with ONLY a JSON array of objects shaped like [{"title":"...","description":"...","confidence":0.8}]. No markdown fences or prose outside the JSON.',
  invoice_chase:
    'Draft a short payment-reminder email for this invoice. Be clear about the amount/due date when provided. Do not threaten legal action.',
}

const MAX_PROMPT_CHARS = 16384

export function isAiPromptKey(value: string): value is AiPromptKey {
  return (AI_PROMPT_KEYS as readonly string[]).includes(value)
}

export function mergeEffectivePrompts(
  overrides: Record<string, unknown> | null | undefined,
): Record<AiPromptKey, string> {
  const effective = { ...DEFAULT_AI_PROMPTS }
  if (!overrides || typeof overrides !== 'object') return effective
  for (const key of AI_PROMPT_KEYS) {
    const raw = overrides[key]
    if (typeof raw === 'string' && raw.trim() !== '') {
      effective[key] = raw
    }
  }
  return effective
}

export async function promptVersionFor(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `ai-prompts-v1:${hex.slice(0, 12)}`
}

export function validateAiPromptsPutBody(
  body: Record<string, unknown>,
): Partial<Record<AiPromptKey, string | null>> {
  const fields: Record<string, string> = {}
  const out: Partial<Record<AiPromptKey, string | null>> = {}

  for (const key of Object.keys(body)) {
    if (!isAiPromptKey(key)) {
      fields[key] = 'Field is not writable'
      continue
    }
    const value = body[key]
    if (value === null) {
      out[key] = null
      continue
    }
    if (typeof value !== 'string') {
      fields[key] = 'Must be a string or null'
      continue
    }
    if (value.length > MAX_PROMPT_CHARS) {
      fields[key] = `Must be at most ${MAX_PROMPT_CHARS} characters`
      continue
    }
    // Empty string clears the override (revert to default).
    out[key] = value.trim() === '' ? null : value
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'AI prompts validation failed', fields)
  }
  if (Object.keys(out).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'AI prompts validation failed', {
      prompts: 'Provide at least one prompt key to update',
    })
  }
  return out
}

/** Deterministic stub draft until provider HTTP lands — tone is injected, not hardcoded per variant. */
export function buildEmailReplyStubDraft(input: {
  subject: string | null
  tone: string
}): string {
  const subject = input.subject?.trim() || ''
  const about = subject ? ` about "${subject}"` : ''
  return `Thanks for your email${about}.\n\nI will follow up shortly.\n\nTONE: ${input.tone}\n`
}

export function buildInvoiceChaseStubDraft(input: {
  clientName: string
  invoiceNumber: string
  dueOn: string | null
  tone: string
}): string {
  const due = input.dueOn?.trim() || 'the due date'
  return (
    `Hi ${input.clientName || 'there'},\n\n` +
    `Friendly reminder that invoice ${input.invoiceNumber} was due on ${due}. ` +
    `Happy to resend the PDF or set up a payment link if useful.\n\n` +
    `Thanks\n\n` +
    `TONE: ${input.tone}\n`
  )
}

export function buildMeetingSummaryStub(plainText: string, prompt: string): string {
  const trimmed = plainText.trim().replace(/\s+/g, ' ')
  const excerpt = trimmed.slice(0, 280)
  const promptHint = prompt.trim().split(/\n/)[0]?.slice(0, 100) ?? 'Summarise the meeting'
  return (
    `Meeting summary:\n${excerpt}${trimmed.length > 280 ? '…' : ''}\n\n` +
    `(Prompt: ${promptHint}${prompt.trim().length > 100 ? '…' : ''})`
  )
}

export function buildMeetingProposalStubs(
  plainText: string,
  prompt: string,
): Array<{ title: string; description: string; confidence: number }> {
  const lines = plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const seeds = lines.length > 0
    ? lines.slice(0, 3)
    : [plainText.trim().slice(0, 80) || 'Follow up from meeting']
  const promptHint = prompt.trim().split(/\n/)[0]?.slice(0, 80) || 'Follow-up task'
  return seeds.map((seed, index) => {
    const title = seed.length > 120 ? `${seed.slice(0, 117)}…` : seed
    return {
      title: title || `Follow-up ${index + 1}`,
      description: `${promptHint} — proposed from transcript line ${index + 1}.`,
      confidence: Number((0.9 - index * 0.1).toFixed(4)),
    }
  })
}

/** Parse model JSON task proposals; fall back to line stubs when unparseable. */
export function parseMeetingProposalOutput(
  text: string,
  plainText: string,
  prompt: string,
): Array<{ title: string; description: string; confidence: number }> {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    const parsed = JSON.parse(cleaned) as unknown
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)
      ? (parsed as { tasks: unknown[] }).tasks
      : null
    if (!rows) return buildMeetingProposalStubs(plainText, prompt)
    const out: Array<{ title: string; description: string; confidence: number }> = []
    for (const [index, row] of rows.slice(0, 3).entries()) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const title = typeof r.title === 'string' ? r.title.trim() : ''
      const description = typeof r.description === 'string' ? r.description.trim() : ''
      if (!title) continue
      let confidence = 0.8 - index * 0.1
      if (typeof r.confidence === 'number' && Number.isFinite(r.confidence)) {
        confidence = Math.min(1, Math.max(0, r.confidence))
      }
      out.push({
        title: title.slice(0, 200),
        description: (description || title).slice(0, 2000),
        confidence: Number(confidence.toFixed(4)),
      })
    }
    return out.length > 0 ? out : buildMeetingProposalStubs(plainText, prompt)
  } catch {
    return buildMeetingProposalStubs(plainText, prompt)
  }
}
