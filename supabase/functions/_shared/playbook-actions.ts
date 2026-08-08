/**
 * Playbook Phase D side effects: email.send / task.create / timeline.note / notification.create.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './database.ts'
import { generateOutboundMessageId, sendSmtpMail, type SmtpSecurity } from './smtp-outbound.ts'
import type { GraphNode } from './playbook-runtime.ts'

type Db = SupabaseClient<Database>

export type PlaybookActionContext = {
  db: Db
  orgId: string
  runId: string
  playbookVersion: number
  rootEntityType: string | null
  rootEntityId: string | null
  context: Record<string, unknown>
  triggerPayload: Record<string, unknown>
}

export type ActionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string }

const TASK_ENTITY_TYPES = new Set(['contact', 'lead', 'client', 'project'])
const TIMELINE_ENTITY_TYPES = new Set([
  'contact',
  'lead',
  'client',
  'quote',
  'invoice',
  'bill',
])
const PRIORITIES = new Set(['p1', 'p2', 'p3', 'p4'])

/** Deterministic UUID v4-shaped id from a string key (SHA-256). */
export async function uuidFromKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${
    hex.slice(20)
  }`
}

export function emailDedupeKey(input: {
  runId: string
  nodeId: string
  to: string
  templateId: string
  playbookVersion: number
}): string {
  return [
    'email',
    input.runId,
    input.nodeId,
    input.to.toLowerCase(),
    input.templateId,
    String(input.playbookVersion),
  ].join(':')
}

async function claimSendLedger(
  db: Db,
  orgId: string,
  runId: string,
  nodeId: string,
  dedupeKey: string,
): Promise<'claimed' | 'duplicate' | 'error'> {
  const { error } = await db.from('playbook_send_ledger').insert({
    org_id: orgId,
    run_id: runId,
    node_id: nodeId,
    dedupe_key: dedupeKey,
  })
  if (!error) return 'claimed'
  if (error.code === '23505') return 'duplicate'
  console.error('playbook_send_ledger insert failed', error)
  return 'error'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function resolveMailboxId(
  db: Db,
  orgId: string,
  configured: string,
): Promise<string | null> {
  if (configured) {
    const { data } = await db
      .from('mailbox_accounts')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', configured)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.id ?? null
  }
  const { data } = await db
    .from('mailbox_accounts')
    .select('id')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function resolveOwnerMembershipId(
  db: Db,
  orgId: string,
  entityType: string | null,
  entityId: string | null,
): Promise<string | null> {
  if (!entityType || !entityId) return null
  if (entityType === 'contact') {
    const { data } = await db
      .from('contacts')
      .select('owner_membership_id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.owner_membership_id ?? null
  }
  if (entityType === 'lead') {
    const { data } = await db
      .from('leads')
      .select('owner_membership_id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.owner_membership_id ?? null
  }
  if (entityType === 'client') {
    const { data } = await db
      .from('clients')
      .select('owner_membership_id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.owner_membership_id ?? null
  }
  if (entityType === 'invoice' || entityType === 'quote') {
    const { data: doc } = entityType === 'invoice'
      ? await db
        .from('invoices')
        .select('client_id,owner_membership_id')
        .eq('org_id', orgId)
        .eq('id', entityId)
        .is('deleted_at', null)
        .maybeSingle()
      : await db
        .from('quotes')
        .select('client_id,owner_membership_id')
        .eq('org_id', orgId)
        .eq('id', entityId)
        .is('deleted_at', null)
        .maybeSingle()
    if (doc?.owner_membership_id) return doc.owner_membership_id
    if (doc?.client_id) {
      const { data: client } = await db
        .from('clients')
        .select('owner_membership_id')
        .eq('org_id', orgId)
        .eq('id', doc.client_id)
        .is('deleted_at', null)
        .maybeSingle()
      return client?.owner_membership_id ?? null
    }
  }
  return null
}

async function executeEmailSend(
  node: GraphNode,
  ctx: PlaybookActionContext,
): Promise<ActionResult> {
  const data = asRecord(node.data)
  const templateId = String(data.templateId ?? '').trim()
  if (!templateId) return { ok: false, error: 'emailSend requires templateId' }

  const mailboxId = await resolveMailboxId(ctx.db, ctx.orgId, String(data.mailboxId ?? '').trim())
  if (!mailboxId) return { ok: false, error: 'No mailbox configured for emailSend' }

  const toMode = String(data.to ?? 'entity_primary')
  if (toMode !== 'entity_primary' && toMode !== 'related_contact') {
    return { ok: false, error: `Unsupported emailSend.to: ${toMode}` }
  }
  if (!ctx.rootEntityType || !ctx.rootEntityId) {
    return { ok: false, error: 'emailSend requires a root entity' }
  }

  const { data: toEmail, error: resolveError } = await ctx.db.rpc('resolve_playbook_entity_email', {
    p_org_id: ctx.orgId,
    p_entity_type: ctx.rootEntityType,
    p_entity_id: ctx.rootEntityId,
  })
  if (resolveError) return { ok: false, error: resolveError.message }
  if (!toEmail || typeof toEmail !== 'string') {
    return { ok: false, error: 'Could not resolve recipient email for root entity' }
  }

  const { data: template, error: templateError } = await ctx.db
    .from('email_templates')
    .select('id,subject,body_text,body_html,status,version')
    .eq('org_id', ctx.orgId)
    .eq('id', templateId)
    .is('deleted_at', null)
    .maybeSingle()
  if (templateError) return { ok: false, error: templateError.message }
  if (!template) return { ok: false, error: 'Email template not found' }
  if (template.status !== 'active') {
    return { ok: false, error: `Email template is ${template.status}, expected active` }
  }

  const dedupeKey = emailDedupeKey({
    runId: ctx.runId,
    nodeId: node.id,
    to: toEmail,
    templateId,
    playbookVersion: ctx.playbookVersion,
  })
  const claim = await claimSendLedger(ctx.db, ctx.orgId, ctx.runId, node.id, dedupeKey)
  if (claim === 'error') return { ok: false, error: 'Failed to claim send ledger' }
  if (claim === 'duplicate') {
    return { ok: true, result: { skipped: true, reason: 'duplicate_send', dedupe_key: dedupeKey } }
  }

  const { data: creds, error: credError } = await ctx.db.rpc('read_mailbox_sync_credentials', {
    p_mailbox_id: mailboxId,
  })
  if (credError) return { ok: false, error: credError.message }
  const c = asRecord(creds)
  const host = String(c.smtp_host ?? '')
  const port = Number(c.smtp_port)
  const security = String(c.smtp_security ?? 'tls') as SmtpSecurity
  const username = String(c.username ?? '')
  const password = typeof c.password === 'string' ? c.password : ''
  const from = String(c.email_address ?? '')
  if (!host || !Number.isFinite(port) || !from) {
    return { ok: false, error: 'Mailbox SMTP configuration incomplete' }
  }

  const messageId = generateOutboundMessageId(from)
  try {
    const sent = await sendSmtpMail({
      host,
      port,
      security,
      username,
      password,
      from,
      to: toEmail,
      subject: template.subject,
      bodyText: template.body_text ?? '',
      bodyHtml: template.body_html,
      messageId,
    })
    return {
      ok: true,
      result: {
        to: toEmail,
        template_id: templateId,
        mailbox_id: mailboxId,
        message_id: sent.message_id,
        synthetic: sent.synthetic,
        dedupe_key: dedupeKey,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'SMTP send failed',
    }
  }
}

async function executeTaskCreate(
  node: GraphNode,
  ctx: PlaybookActionContext,
): Promise<ActionResult> {
  const data = asRecord(node.data)
  const title = String(data.title ?? '').trim() || 'Playbook task'
  const description = String(data.description ?? '').trim() || null
  const priorityRaw = String(data.priority ?? 'p3')
  const priority = (PRIORITIES.has(priorityRaw) ? priorityRaw : 'p3') as 'p1' | 'p2' | 'p3' | 'p4'
  const assignee = String(data.assigneeMembershipId ?? '').trim() || null
  const dueOffsetDays = Number(data.dueOffsetDays ?? 0)
  const dueAt = Number.isFinite(dueOffsetDays) && dueOffsetDays > 0
    ? new Date(Date.now() + dueOffsetDays * 86_400_000).toISOString()
    : null

  let entityType: string | null = null
  let entityId: string | null = null
  if (
    ctx.rootEntityType &&
    ctx.rootEntityId &&
    TASK_ENTITY_TYPES.has(ctx.rootEntityType)
  ) {
    entityType = ctx.rootEntityType
    entityId = ctx.rootEntityId
  }

  const { data: task, error } = await ctx.db
    .from('tasks')
    .insert({
      org_id: ctx.orgId,
      title: title.slice(0, 200),
      description,
      priority,
      status: 'open',
      source: 'workflow',
      assignee_membership_id: assignee,
      assignee_agent_id: null,
      due_at: dueAt,
      entity_type: entityType as 'contact' | 'lead' | 'client' | 'project' | null,
      entity_id: entityId,
      position: 0,
      metadata: {
        playbook_run_id: ctx.runId,
        playbook_node_id: node.id,
      } as Json,
    })
    .select('id,title,priority,assignee_membership_id,due_at,entity_type,entity_id')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, result: { task } }
}

async function executeTimelineNote(
  node: GraphNode,
  ctx: PlaybookActionContext,
): Promise<ActionResult> {
  const data = asRecord(node.data)
  const body = String(data.body ?? '').trim()
  if (!body) return { ok: false, error: 'timelineNote requires body' }
  if (!ctx.rootEntityType || !ctx.rootEntityId) {
    return { ok: false, error: 'timelineNote requires a root entity' }
  }
  if (!TIMELINE_ENTITY_TYPES.has(ctx.rootEntityType)) {
    return { ok: false, error: `timelineNote unsupported entity type: ${ctx.rootEntityType}` }
  }

  const title = body.length > 80 ? `${body.slice(0, 77)}...` : body
  const { data: event, error } = await ctx.db.rpc('create_playbook_timeline_note', {
    p_org_id: ctx.orgId,
    p_entity_type: ctx.rootEntityType,
    p_entity_id: ctx.rootEntityId,
    p_title: title,
    p_body: body,
    p_payload: {
      playbook_run_id: ctx.runId,
      playbook_node_id: node.id,
      note_kind: String(data.kind ?? 'note'),
    } as Json,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, result: { timeline_event: event } }
}

async function executeNotificationCreate(
  node: GraphNode,
  ctx: PlaybookActionContext,
): Promise<ActionResult> {
  const data = asRecord(node.data)
  const title = String(data.title ?? '').trim() || 'Playbook alert'
  const body = String(data.body ?? '').trim() || null
  const configured = Array.isArray(data.recipientMembershipIds)
    ? data.recipientMembershipIds.filter((id): id is string =>
      typeof id === 'string' && id.length > 0
    )
    : []

  let recipients = configured
  if (recipients.length === 0) {
    const owner = await resolveOwnerMembershipId(
      ctx.db,
      ctx.orgId,
      ctx.rootEntityType,
      ctx.rootEntityId,
    )
    if (owner) recipients = [owner]
  }
  if (recipients.length === 0) {
    return { ok: false, error: 'notificationCreate has no recipients' }
  }

  const created: string[] = []
  for (const membershipId of recipients) {
    const sourceId = await uuidFromKey(`${ctx.runId}:${node.id}:${membershipId}`)
    const { data: notifId, error } = await ctx.db.rpc('create_playbook_notification', {
      p_org_id: ctx.orgId,
      p_recipient_membership_id: membershipId,
      p_run_id: ctx.runId,
      p_title: title,
      p_body: body,
      p_payload: { playbook_node_id: node.id } as Json,
      p_source_id: sourceId,
    })
    if (error) return { ok: false, error: error.message }
    if (typeof notifId === 'string') created.push(notifId)
  }
  return { ok: true, result: { notification_ids: created, recipients } }
}

export function executeSideEffect(
  node: GraphNode,
  ctx: PlaybookActionContext,
): Promise<ActionResult> {
  switch (node.type) {
    case 'emailSend':
      return executeEmailSend(node, ctx)
    case 'taskCreate':
      return executeTaskCreate(node, ctx)
    case 'timelineNote':
      return executeTimelineNote(node, ctx)
    case 'notificationCreate':
      return executeNotificationCreate(node, ctx)
    default:
      return Promise.resolve({ ok: true, result: { stub: true, node_type: node.type } })
  }
}

export function isSideEffectNodeType(type: string): boolean {
  return (
    type === 'emailSend' ||
    type === 'taskCreate' ||
    type === 'timelineNote' ||
    type === 'notificationCreate'
  )
}
