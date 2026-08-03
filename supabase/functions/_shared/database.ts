// Bootstrap subset matching the committed migrations. Replace this with CLI-generated database
// types after a Docker/hosted reset, then keep generation in CI to prevent schema drift.
export type Json =
  | boolean
  | number
  | string
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type ProfileRow = {
  id: string
  display_name: string
  avatar_path: string | null
  locale: string
  timezone: string
  theme_preference: 'system' | 'light' | 'dark' | null
  created_at: string
  updated_at: string
}

export type OrganisationRow = {
  id: string
  name: string
  legal_name: string | null
  slug: string
  logo_path: string | null
  billing_email: string | null
  phone: string | null
  website_url: string | null
  tax_identifier: string | null
  registration_number: string | null
  default_currency: string
  timezone: string
  locale: string
  country_code: string
  theme_default: 'system' | 'light' | 'dark'
  settings: Json
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type TaxRateRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  name: string
  rate_percent: number
  is_default: boolean
  active: boolean
}

export type EmailTemplateRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  name: string
  subject: string
  body_text: string | null
  body_html: string | null
  category: 'transactional' | 'campaign' | 'chase' | 'onboarding' | 'other'
  status: 'draft' | 'active' | 'archived'
  merge_schema: Json
}

export type EmailTemplateInsert = {
  org_id: string
  name: string
  subject: string
  body_text?: string | null
  body_html?: string | null
  category: EmailTemplateRow['category']
  status?: EmailTemplateRow['status']
  merge_schema?: Json
  deleted_at?: string | null
}

export type MembershipRow = {
  id: string
  org_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member' | 'billing' | 'readonly'
  status: 'active' | 'suspended'
  job_title: string | null
  joined_at: string
  suspended_at: string | null
  created_at: string
  updated_at: string
}

/** Minimal Wave B email message row for Draft response reads (RLS owner/share). */
export type EmailMessageRow = {
  id: string
  org_id: string
  subject: string | null
  from_address: string | null
  body_text: string | null
  preview_text: string | null
  deleted_at: string | null
}

export type ContactRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  first_name: string | null
  last_name: string | null
  display_name: string
  primary_email: string | null
  primary_phone: string | null
  job_title: string | null
  company_name: string | null
  owner_membership_id: string | null
  lifecycle_status: 'active' | 'inactive' | 'archived'
  source: string | null
  notes: string | null
  last_contacted_at: string | null
  metadata: Json
}

export type LeadRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  name: string
  company_name: string | null
  contact_id: string | null
  client_id: string | null
  stage: 'new' | 'qualified' | 'proposal' | 'won' | 'lost'
  value_cents: number | null
  currency: string
  probability_percent: number | null
  source: string | null
  owner_membership_id: string | null
  expected_close_on: string | null
  lost_reason: string | null
  won_at: string | null
  lost_at: string | null
  converted_at: string | null
  position: number
  notes: string | null
  metadata: Json
}

export type ClientRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  name: string
  status: 'prospect' | 'active' | 'on_hold' | 'inactive' | 'archived'
  website_url: string | null
  industry: string | null
  primary_email: string | null
  phone: string | null
  tax_identifier: string | null
  registration_number: string | null
  default_currency: string | null
  payment_terms_days: number | null
  owner_membership_id: string | null
  converted_from_lead_id: string | null
  renewal_on: string | null
  notes: string | null
  metadata: Json
}

export type ClientContactRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  client_id: string
  contact_id: string
  role: 'primary' | 'billing' | 'decision_maker' | 'other'
  is_primary: boolean
}

export type TimelineEventRow = {
  id: string
  org_id: string
  entity_type: 'contact' | 'lead' | 'client' | 'quote' | 'invoice' | 'bill'
  entity_id: string
  kind:
    | 'note'
    | 'email'
    | 'call'
    | 'payment'
    | 'document'
    | 'status'
    | 'meeting'
    | 'task'
    | 'conversion'
  title: string
  body: string | null
  actor_type: 'user' | 'agent' | 'system' | 'integration'
  actor_id: string | null
  source_type: string | null
  source_id: string | null
  payload: Json
  occurred_at: string
  created_at: string
}

export type AuditEventRow = {
  id: string
  org_id: string | null
  actor_type: 'user' | 'agent' | 'api_key' | 'system'
  actor_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  request_id: string | null
  ip_address: string | null
  user_agent: string | null
  before_data: Json | null
  after_data: Json | null
  metadata: Json
  created_at: string
}

export type ProductCategoryRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  name: string
  description: string | null
  position: number
}

export type ProductRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  sku: string
  name: string
  description: string | null
  category_id: string | null
  product_type: 'product' | 'service'
  unit_name: string | null
  unit_price_cents: number
  cost_price_cents: number | null
  currency: string
  tax_rate_id: string | null
  track_stock: boolean
  stock_qty: number | null
  low_stock_at: number | null
  status: 'active' | 'archived'
  metadata: Json
}

export type InventoryMovementRow = {
  id: string
  org_id: string
  created_at: string
  created_by: string | null
  product_id: string
  quantity_delta: number
  reason: 'opening' | 'adjustment' | 'invoice' | 'return' | 'void'
  reference_type: string | null
  reference_id: string | null
  occurred_at: string
  note: string | null
}

export type ApiIdempotencyKeyRow = {
  id: string
  org_id: string
  actor_type: 'user' | 'agent' | 'api_key'
  actor_id: string
  idempotency_key_hash: string
  route: string
  request_hash: string
  response_status: number | null
  response_body: Json | null
  resource_type: string | null
  resource_id: string | null
  created_at: string
  expires_at: string
}

export type QuoteRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  number: string
  title: string
  client_id: string | null
  lead_id: string | null
  contact_id: string | null
  owner_membership_id: string | null
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'void'
  currency: string
  issue_on: string
  valid_until: string | null
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  party_snapshot: Json
  terms: string | null
  notes: string | null
  internal_notes: string | null
  sent_at: string | null
  viewed_at: string | null
  accepted_at: string | null
  rejected_at: string | null
  converted_invoice_id: string | null
}

export type InvoiceRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  number: string
  client_id: string
  contact_id: string | null
  quote_id: string | null
  owner_membership_id: string | null
  source: 'manual' | 'quote' | 'recurring'
  recurring_run_id: string | null
  billing_period_start: string | null
  billing_period_end: string | null
  status: 'draft' | 'sent' | 'partial' | 'paid' | 'void'
  currency: string
  issue_on: string
  due_on: string
  purchase_order_number: string | null
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  paid_cents: number
  balance_due_cents: number
  party_snapshot: Json
  payment_terms: string | null
  notes: string | null
  internal_notes: string | null
  sent_at: string | null
  viewed_at: string | null
  paid_at: string | null
  voided_at: string | null
  void_reason: string | null
}

export type RecurringInvoiceScheduleRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  name: string
  client_id: string
  contact_id: string | null
  owner_membership_id: string | null
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled'
  currency: string
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval_count: number
  anchor_on: string
  rule_version: number
  weekdays: number[] | null
  day_of_month: number | null
  month_of_year: number | null
  month_end_policy: 'clamp' | 'last_day' | 'skip'
  timezone: string
  local_run_time: string
  start_on: string
  end_on: string | null
  max_occurrences: number | null
  scheduled_occurrence_count: number
  next_run_at: string | null
  last_run_at: string | null
  due_days: number
  delivery_mode: 'draft' | 'auto_send'
  pricing_mode: 'fixed' | 'catalog_at_generation'
  catch_up_policy: 'skip' | 'latest' | 'all'
  max_catch_up_runs: number
  purchase_order_number: string | null
  payment_terms: string | null
  notes: string | null
  internal_notes: string | null
  activated_at: string | null
  paused_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancelled_by: string | null
}

export type RecurringInvoiceLineRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  schedule_id: string
  product_id: string | null
  sku_snapshot: string | null
  description_template: string
  quantity: number
  unit_price_cents: number
  discount_percent: number
  tax_rate_percent: number
  position: number
  active: boolean
}

export type RecurringInvoiceRunRow = {
  id: string
  org_id: string
  schedule_id: string
  occurrence_sequence: number | null
  occurrence_key: string
  scheduled_for: string
  occurrence_local_date: string
  occurrence_timezone: string
  schedule_version: number
  configuration_snapshot: Json
  period_start: string
  period_end: string
  trigger: 'scheduled' | 'manual' | 'catch_up'
  status:
    | 'pending'
    | 'processing'
    | 'generated'
    | 'delivery_pending'
    | 'sent'
    | 'skipped'
    | 'generation_failed'
    | 'delivery_failed'
    | 'delivery_unknown'
  attempt_count: number
  available_at: string
  claimed_at: string | null
  claimed_by: string | null
  lease_expires_at: string | null
  generated_at: string | null
  sent_at: string | null
  error_code: string | null
  error_message: string | null
  request_id: string | null
  created_at: string
  updated_at: string
}

export type RecurringInvoiceScheduleInsert = Partial<RecurringInvoiceScheduleRow> & {
  org_id: string
  name: string
  client_id: string
  currency: string
  frequency: RecurringInvoiceScheduleRow['frequency']
  anchor_on: string
  start_on: string
}

export type RecurringInvoiceLineInsert = Partial<RecurringInvoiceLineRow> & {
  org_id: string
  schedule_id: string
  description_template: string
  quantity: number
  unit_price_cents: number
  position: number
}

export type VendorRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  name: string
  status: 'active' | 'inactive' | 'archived'
  primary_email: string | null
  phone: string | null
  website_url: string | null
  tax_identifier: string | null
  default_currency: string | null
  payment_terms_days: number | null
  notes: string | null
  metadata: Json
}

export type BillRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  vendor_id: string
  number: string
  internal_reference: string | null
  status: 'draft' | 'received' | 'scheduled' | 'partial' | 'paid' | 'void'
  currency: string
  issue_on: string | null
  received_on: string | null
  due_on: string
  scheduled_payment_on: string | null
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  paid_cents: number
  balance_due_cents: number
  party_snapshot: Json
  notes: string | null
  attachment_document_id: string | null
  paid_at: string | null
  voided_at: string | null
  void_reason: string | null
}

export type BillLineRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  version: number
  bill_id: string
  product_id: string | null
  sku_snapshot: string | null
  description: string
  quantity: number
  unit_price_cents: number
  discount_percent: number
  tax_rate_percent: number
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  position: number
}

export type PaymentRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  version: number
  direction: 'inbound' | 'outbound'
  client_id: string | null
  vendor_id: string | null
  amount_cents: number
  currency: string
  method: 'bank' | 'card' | 'cash' | 'stripe' | 'other'
  status:
    | 'pending'
    | 'completed'
    | 'unallocated'
    | 'part_allocated'
    | 'allocated'
    | 'refunded'
    | 'reversed'
    | 'failed'
  occurred_on: string
  reference: string | null
  provider: string
  provider_payment_id: string | null
  notes: string | null
  reverses_payment_id: string | null
  completed_at: string | null
  metadata: Json
}

export type PaymentInsert = {
  org_id: string
  direction: PaymentRow['direction']
  client_id?: string | null
  vendor_id?: string | null
  amount_cents: number
  currency: string
  method: PaymentRow['method']
  status?: PaymentRow['status']
  occurred_on?: string
  reference?: string | null
  provider?: string
  provider_payment_id?: string | null
  notes?: string | null
  reverses_payment_id?: string | null
  completed_at?: string | null
  metadata?: Json
}

export type PaymentAllocationRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  version: number
  payment_id: string
  invoice_id: string | null
  bill_id: string | null
  amount_cents: number
  allocated_at: string
  reversed_at: string | null
  reversal_reason: string | null
}

export type PaymentAllocationInsert = {
  org_id: string
  payment_id: string
  invoice_id?: string | null
  bill_id?: string | null
  amount_cents: number
  allocated_at?: string
  reversed_at?: string | null
  reversal_reason?: string | null
}

export type TaskRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  title: string
  description: string | null
  priority: 'p1' | 'p2' | 'p3' | 'p4'
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
  assignee_membership_id: string | null
  assignee_agent_id: string | null
  due_at: string | null
  started_at: string | null
  completed_at: string | null
  blocked_reason: string | null
  source: 'manual' | 'meeting' | 'email' | 'workflow' | 'agent'
  entity_type: 'contact' | 'lead' | 'client' | null
  entity_id: string | null
  meeting_id: string | null
  project_card_id: string | null
  position: number
  metadata: Json
}

export type MeetingRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  title: string
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  starts_at: string
  ends_at: string
  timezone: string
  location: string | null
  meeting_url: string | null
  organiser_membership_id: string | null
  related_entity_type: 'client' | 'contact' | 'lead' | 'project' | null
  related_entity_id: string | null
  calendar_provider: string | null
  external_event_id: string | null
  transcript_status: 'none' | 'uploaded' | 'processing' | 'ready' | 'failed'
  summary_status: 'none' | 'generating' | 'ready' | 'failed'
  summary: string | null
  metadata: Json
}

export type MeetingAttendeeRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  meeting_id: string
  contact_id: string | null
  membership_id: string | null
  name: string | null
  email: string
  response_status: 'needs_action' | 'accepted' | 'declined' | 'tentative' | null
  attended: boolean | null
  organiser: boolean
}

export type MeetingTranscriptRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  meeting_id: string
  document_id: string | null
  provider: string | null
  language_code: string | null
  status: 'uploaded' | 'processing' | 'ready' | 'failed'
  plain_text: string | null
  segments: Json | null
  processed_at: string | null
  error_code: string | null
}

export type MeetingTaskProposalRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  meeting_id: string
  title: string
  description: string | null
  suggested_assignee_membership_id: string | null
  suggested_due_at: string | null
  confidence: number | null
  status: 'proposed' | 'accepted' | 'dismissed'
  accepted_task_id: string | null
  decided_by: string | null
  decided_at: string | null
}

export type ProjectRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  client_id: string
  name: string
  description: string | null
  status: 'planning' | 'active' | 'blocked' | 'done' | 'archived'
  owner_membership_id: string | null
  starts_on: string | null
  due_on: string | null
  completed_at: string | null
  position: number
}

export type ProjectColumnRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  project_id: string
  name: string
  key: string
  position: number
  wip_limit: number | null
}

export type ProjectCardRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  project_id: string
  column_id: string
  title: string
  description: string | null
  assignee_membership_id: string | null
  task_id: string | null
  due_at: string | null
  position: number
  completed_at: string | null
}

export type InvoiceLineRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  version: number
  invoice_id: string
  product_id: string | null
  sku_snapshot: string | null
  description: string
  quantity: number
  unit_price_cents: number
  discount_percent: number
  tax_rate_percent: number
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  position: number
}

export type DocumentRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  name: string
  category: string
  notes: string | null
  bucket: string
  storage_path: string
  storage_version: string | null
  mime_type: string
  size_bytes: number
  sha256: string
  uploaded_by: string | null
  uploaded_at: string | null
  scan_status: 'pending' | 'clean' | 'infected' | 'failed'
  metadata: Json
  status: 'pending_upload' | 'ready' | 'orphan' | 'failed'
  upload_expires_at: string | null
}

export type DocumentFolderRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  entity_type: string
  entity_id: string
  parent_id: string | null
  name: string
}

export type MailboxAccountRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  membership_id: string
  email_address: string
  from_name: string | null
  imap_host: string
  imap_port: number
  imap_security: 'tls' | 'starttls' | 'none'
  smtp_host: string
  smtp_port: number
  smtp_security: 'tls' | 'starttls' | 'none'
  username: string
  status: 'pending' | 'active' | 'error' | 'disabled'
  last_checked_at: string | null
  last_error_code: string | null
  credentials_updated_at: string | null
  sync_lookback_days: number
  sync_max_messages: number
  sync_max_body_bytes: number
  sync_attachments_metadata_only: boolean
  sync_lease_until: string | null
  sync_lease_holder: string | null
  consecutive_auth_failures: number
}

export type IntegrationRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  type: 'ai_openai' | 'ai_anthropic' | 'ai_google' | 'ai_openrouter'
  name: string
  status: 'pending' | 'active' | 'error' | 'disabled'
  config: Json
  external_account_id: string | null
  connected_by: string | null
  last_sync_at: string | null
  last_error_code: string | null
  credentials_updated_at: string | null
}

export type DocumentLinkRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  deleted_at: string | null
  version: number
  document_id: string
  entity_type: string
  entity_id: string
  folder_id: string | null
}

export type QuoteLineRow = {
  id: string
  org_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  version: number
  quote_id: string
  product_id: string | null
  sku_snapshot: string | null
  description: string
  quantity: number
  unit_price_cents: number
  discount_percent: number
  tax_rate_percent: number
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  position: number
}

type ProfileInsert = Pick<ProfileRow, 'display_name' | 'id'> & Partial<Omit<ProfileRow, 'id'>>
type TaxRateInsert =
  & Pick<TaxRateRow, 'name' | 'org_id' | 'rate_percent'>
  & Partial<Omit<TaxRateRow, 'id' | 'name' | 'org_id' | 'rate_percent'>>
type OrganisationInsert =
  & Pick<OrganisationRow, 'country_code' | 'name' | 'slug'>
  & Partial<Omit<OrganisationRow, 'country_code' | 'id' | 'name' | 'slug'>>
type MembershipInsert =
  & Pick<MembershipRow, 'org_id' | 'role' | 'user_id'>
  & Partial<Omit<MembershipRow, 'id' | 'org_id' | 'role' | 'user_id'>>
type ContactInsert =
  & Pick<ContactRow, 'display_name' | 'org_id'>
  & Partial<Omit<ContactRow, 'display_name' | 'id' | 'org_id'>>
type LeadInsert =
  & Pick<LeadRow, 'name' | 'org_id'>
  & Partial<Omit<LeadRow, 'id' | 'name' | 'org_id'>>
type ClientInsert =
  & Pick<ClientRow, 'name' | 'org_id'>
  & Partial<Omit<ClientRow, 'id' | 'name' | 'org_id'>>
type ClientContactInsert =
  & Pick<ClientContactRow, 'client_id' | 'contact_id' | 'org_id'>
  & Partial<Omit<ClientContactRow, 'client_id' | 'contact_id' | 'id' | 'org_id'>>
type TimelineEventInsert =
  & Pick<TimelineEventRow, 'actor_type' | 'entity_id' | 'entity_type' | 'kind' | 'org_id' | 'title'>
  & Partial<
    Omit<
      TimelineEventRow,
      'actor_type' | 'entity_id' | 'entity_type' | 'id' | 'kind' | 'org_id' | 'title'
    >
  >
type ProductCategoryInsert =
  & Pick<ProductCategoryRow, 'name' | 'org_id'>
  & Partial<Omit<ProductCategoryRow, 'id' | 'name' | 'org_id'>>
type ProductInsert =
  & Pick<ProductRow, 'name' | 'org_id' | 'sku' | 'unit_price_cents'>
  & Partial<Omit<ProductRow, 'id' | 'name' | 'org_id' | 'sku' | 'unit_price_cents'>>
type InventoryMovementInsert =
  & Pick<InventoryMovementRow, 'org_id' | 'product_id' | 'quantity_delta' | 'reason'>
  & Partial<
    Omit<InventoryMovementRow, 'id' | 'org_id' | 'product_id' | 'quantity_delta' | 'reason'>
  >
type ApiIdempotencyKeyInsert =
  & Pick<
    ApiIdempotencyKeyRow,
    | 'actor_id'
    | 'actor_type'
    | 'expires_at'
    | 'idempotency_key_hash'
    | 'org_id'
    | 'request_hash'
    | 'route'
  >
  & Partial<
    Omit<
      ApiIdempotencyKeyRow,
      | 'actor_id'
      | 'actor_type'
      | 'expires_at'
      | 'id'
      | 'idempotency_key_hash'
      | 'org_id'
      | 'request_hash'
      | 'route'
    >
  >
type QuoteInsert =
  & Pick<QuoteRow, 'number' | 'org_id' | 'title' | 'currency'>
  & Partial<Omit<QuoteRow, 'id' | 'number' | 'org_id' | 'title' | 'currency'>>
type InvoiceInsert =
  & Pick<InvoiceRow, 'client_id' | 'currency' | 'due_on' | 'number' | 'org_id'>
  & Partial<Omit<InvoiceRow, 'client_id' | 'currency' | 'due_on' | 'id' | 'number' | 'org_id'>>
type InvoiceLineInsert =
  & Pick<
    InvoiceLineRow,
    | 'description'
    | 'invoice_id'
    | 'org_id'
    | 'position'
    | 'quantity'
    | 'subtotal_cents'
    | 'tax_cents'
    | 'total_cents'
    | 'unit_price_cents'
  >
  & Partial<
    Omit<
      InvoiceLineRow,
      | 'description'
      | 'id'
      | 'invoice_id'
      | 'org_id'
      | 'position'
      | 'quantity'
      | 'subtotal_cents'
      | 'tax_cents'
      | 'total_cents'
      | 'unit_price_cents'
    >
  >
type QuoteLineInsert =
  & Pick<
    QuoteLineRow,
    | 'description'
    | 'org_id'
    | 'position'
    | 'quantity'
    | 'quote_id'
    | 'subtotal_cents'
    | 'tax_cents'
    | 'total_cents'
    | 'unit_price_cents'
  >
  & Partial<
    Omit<
      QuoteLineRow,
      | 'description'
      | 'id'
      | 'org_id'
      | 'position'
      | 'quantity'
      | 'quote_id'
      | 'subtotal_cents'
      | 'tax_cents'
      | 'total_cents'
      | 'unit_price_cents'
    >
  >

type VendorInsert =
  & Pick<VendorRow, 'name' | 'org_id'>
  & Partial<Omit<VendorRow, 'id' | 'name' | 'org_id'>>
type BillInsert =
  & Pick<BillRow, 'currency' | 'due_on' | 'number' | 'org_id' | 'vendor_id'>
  & Partial<Omit<BillRow, 'currency' | 'due_on' | 'id' | 'number' | 'org_id' | 'vendor_id'>>
type BillLineInsert =
  & Pick<
    BillLineRow,
    | 'bill_id'
    | 'description'
    | 'org_id'
    | 'position'
    | 'quantity'
    | 'subtotal_cents'
    | 'tax_cents'
    | 'total_cents'
    | 'unit_price_cents'
  >
  & Partial<
    Omit<
      BillLineRow,
      | 'bill_id'
      | 'description'
      | 'id'
      | 'org_id'
      | 'position'
      | 'quantity'
      | 'subtotal_cents'
      | 'tax_cents'
      | 'total_cents'
      | 'unit_price_cents'
    >
  >
type TaskInsert =
  & Pick<TaskRow, 'org_id' | 'title'>
  & Partial<Omit<TaskRow, 'id' | 'org_id' | 'title'>>
type MeetingInsert =
  & Pick<MeetingRow, 'org_id' | 'title' | 'starts_at' | 'ends_at' | 'timezone'>
  & Partial<Omit<MeetingRow, 'id' | 'org_id' | 'title' | 'starts_at' | 'ends_at' | 'timezone'>>
type MeetingAttendeeInsert =
  & Pick<MeetingAttendeeRow, 'org_id' | 'meeting_id' | 'email'>
  & Partial<Omit<MeetingAttendeeRow, 'id' | 'org_id' | 'meeting_id' | 'email'>>
type MeetingTranscriptInsert =
  & Pick<MeetingTranscriptRow, 'org_id' | 'meeting_id' | 'status'>
  & Partial<Omit<MeetingTranscriptRow, 'id' | 'org_id' | 'meeting_id' | 'status'>>
type MeetingTaskProposalInsert =
  & Pick<MeetingTaskProposalRow, 'org_id' | 'meeting_id' | 'title'>
  & Partial<Omit<MeetingTaskProposalRow, 'id' | 'org_id' | 'meeting_id' | 'title'>>

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: ProfileInsert
        Update: Partial<ProfileInsert>
        Relationships: []
      }
      organisations: {
        Row: OrganisationRow
        Insert: OrganisationInsert
        Update: Partial<OrganisationInsert>
        Relationships: []
      }
      tax_rates: {
        Row: TaxRateRow
        Insert: TaxRateInsert
        Update: Partial<TaxRateInsert>
        Relationships: []
      }
      email_templates: {
        Row: EmailTemplateRow
        Insert: EmailTemplateInsert
        Update: Partial<EmailTemplateInsert>
        Relationships: []
      }
      memberships: {
        Row: MembershipRow
        Insert: MembershipInsert
        Update: Partial<MembershipInsert>
        Relationships: []
      }
      contacts: {
        Row: ContactRow
        Insert: ContactInsert
        Update: Partial<ContactInsert>
        Relationships: []
      }
      leads: {
        Row: LeadRow
        Insert: LeadInsert
        Update: Partial<LeadInsert>
        Relationships: []
      }
      clients: {
        Row: ClientRow
        Insert: ClientInsert
        Update: Partial<ClientInsert>
        Relationships: []
      }
      client_contacts: {
        Row: ClientContactRow
        Insert: ClientContactInsert
        Update: Partial<ClientContactInsert>
        Relationships: []
      }
      timeline_events: {
        Row: TimelineEventRow
        Insert: TimelineEventInsert
        Update: Partial<TimelineEventInsert>
        Relationships: []
      }
      audit_events: {
        Row: AuditEventRow
        Insert:
          & Partial<AuditEventRow>
          & Pick<AuditEventRow, 'actor_type' | 'action' | 'resource_type'>
        Update: Partial<AuditEventRow>
        Relationships: []
      }
      email_messages: {
        Row: EmailMessageRow
        Insert: Partial<EmailMessageRow> & Pick<EmailMessageRow, 'id' | 'org_id'>
        Update: Partial<EmailMessageRow>
        Relationships: []
      }
      product_categories: {
        Row: ProductCategoryRow
        Insert: ProductCategoryInsert
        Update: Partial<ProductCategoryInsert>
        Relationships: []
      }
      products: {
        Row: ProductRow
        Insert: ProductInsert
        Update: Partial<ProductInsert>
        Relationships: []
      }
      inventory_movements: {
        Row: InventoryMovementRow
        Insert: InventoryMovementInsert
        Update: Partial<InventoryMovementInsert>
        Relationships: []
      }
      api_idempotency_keys: {
        Row: ApiIdempotencyKeyRow
        Insert: ApiIdempotencyKeyInsert
        Update: Partial<ApiIdempotencyKeyInsert>
        Relationships: []
      }
      quotes: {
        Row: QuoteRow
        Insert: QuoteInsert
        Update: Partial<QuoteInsert>
        Relationships: []
      }
      quote_lines: {
        Row: QuoteLineRow
        Insert: QuoteLineInsert
        Update: Partial<QuoteLineInsert>
        Relationships: []
      }
      invoices: {
        Row: InvoiceRow
        Insert: InvoiceInsert
        Update: Partial<InvoiceInsert>
        Relationships: []
      }
      invoice_lines: {
        Row: InvoiceLineRow
        Insert: InvoiceLineInsert
        Update: Partial<InvoiceLineInsert>
        Relationships: []
      }

      vendors: {
        Row: VendorRow
        Insert: VendorInsert
        Update: Partial<VendorInsert>
        Relationships: []
      }
      bills: {
        Row: BillRow
        Insert: BillInsert
        Update: Partial<BillInsert>
        Relationships: []
      }
      bill_lines: {
        Row: BillLineRow
        Insert: BillLineInsert
        Update: Partial<BillLineInsert>
        Relationships: []
      }
      recurring_invoice_schedules: {
        Row: RecurringInvoiceScheduleRow
        Insert: RecurringInvoiceScheduleInsert
        Update: Partial<RecurringInvoiceScheduleInsert>
        Relationships: []
      }
      recurring_invoice_lines: {
        Row: RecurringInvoiceLineRow
        Insert: RecurringInvoiceLineInsert
        Update: Partial<RecurringInvoiceLineInsert>
        Relationships: []
      }
      recurring_invoice_runs: {
        Row: RecurringInvoiceRunRow
        Insert: Partial<RecurringInvoiceRunRow>
        Update: Partial<RecurringInvoiceRunRow>
        Relationships: []
      }
      payments: {
        Row: PaymentRow
        Insert: PaymentInsert
        Update: Partial<PaymentInsert>
        Relationships: []
      }
      payment_allocations: {
        Row: PaymentAllocationRow
        Insert: PaymentAllocationInsert
        Update: Partial<PaymentAllocationInsert>
        Relationships: []
      }
      tasks: {
        Row: TaskRow
        Insert: TaskInsert
        Update: Partial<TaskInsert>
        Relationships: []
      }
      meetings: {
        Row: MeetingRow
        Insert: MeetingInsert
        Update: Partial<MeetingInsert>
        Relationships: []
      }
      meeting_attendees: {
        Row: MeetingAttendeeRow
        Insert: MeetingAttendeeInsert
        Update: Partial<MeetingAttendeeInsert>
        Relationships: []
      }
      meeting_transcripts: {
        Row: MeetingTranscriptRow
        Insert: MeetingTranscriptInsert
        Update: Partial<MeetingTranscriptInsert>
        Relationships: []
      }
      meeting_task_proposals: {
        Row: MeetingTaskProposalRow
        Insert: MeetingTaskProposalInsert
        Update: Partial<MeetingTaskProposalInsert>
        Relationships: []
      }
      projects: {
        Row: ProjectRow
        Insert: Partial<ProjectRow> & Pick<ProjectRow, 'org_id' | 'client_id' | 'name'>
        Update: Partial<ProjectRow>
        Relationships: []
      }
      project_columns: {
        Row: ProjectColumnRow
        Insert:
          & Partial<ProjectColumnRow>
          & Pick<
            ProjectColumnRow,
            'org_id' | 'project_id' | 'name' | 'key'
          >
        Update: Partial<ProjectColumnRow>
        Relationships: []
      }
      project_cards: {
        Row: ProjectCardRow
        Insert:
          & Partial<ProjectCardRow>
          & Pick<
            ProjectCardRow,
            'org_id' | 'project_id' | 'column_id' | 'title'
          >
        Update: Partial<ProjectCardRow>
        Relationships: []
      }
      documents: {
        Row: DocumentRow
        Insert: Partial<DocumentRow>
        Update: Partial<DocumentRow>
        Relationships: []
      }
      document_folders: {
        Row: DocumentFolderRow
        Insert: Partial<DocumentFolderRow>
        Update: Partial<DocumentFolderRow>
        Relationships: []
      }
      document_links: {
        Row: DocumentLinkRow
        Insert: Partial<DocumentLinkRow>
        Update: Partial<DocumentLinkRow>
        Relationships: []
      }
      mailbox_accounts: {
        Row: MailboxAccountRow
        Insert: Partial<MailboxAccountRow>
        Update: Partial<MailboxAccountRow>
        Relationships: []
      }
      integrations: {
        Row: IntegrationRow
        Insert: Partial<IntegrationRow>
        Update: Partial<IntegrationRow>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      create_organisation: {
        Args: {
          p_country_code: string
          p_default_currency?: string
          p_locale?: string
          p_name: string
          p_slug: string
          p_timezone?: string
        }
        Returns: OrganisationRow
      }
      convert_lead: {
        Args: {
          p_client_name?: string
          p_client_status?: string
          p_lead_id: string
        }
        Returns: Json
      }
      create_timeline_event: {
        Args: {
          p_body?: string | null
          p_entity_id: string
          p_entity_type: string
          p_kind: string
          p_org_id: string
          p_payload?: Json
          p_title: string
        }
        Returns: TimelineEventRow
      }
      adjust_product_stock: {
        Args: {
          p_note?: string
          p_occurred_at?: string
          p_product_id: string
          p_quantity_delta: number
          p_reason?: string
        }
        Returns: Json
      }
      adjust_product_stock_idempotent: {
        Args: {
          p_idempotency_key_hash: string
          p_note?: string
          p_occurred_at?: string
          p_org_id: string
          p_product_id: string
          p_quantity_delta: number
          p_reason?: string
          p_request_hash: string
          p_route: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      create_quote_draft: {
        Args: {
          p_lines?: Json
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      save_quote_draft: {
        Args: {
          p_expected_version: number
          p_lines?: Json | null
          p_org_id: string
          p_payload: Json
          p_quote_id: string
        }
        Returns: Json
      }
      get_quote_document: {
        Args: {
          p_org_id: string
          p_quote_id: string
        }
        Returns: Json
      }
      soft_delete_quote_draft: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_quote_id: string
        }
        Returns: Json
      }
      accept_quote: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_quote_id: string
        }
        Returns: Json
      }
      create_invoice_draft: {
        Args: {
          p_lines?: Json
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      save_invoice_draft: {
        Args: {
          p_expected_version: number
          p_invoice_id: string
          p_lines?: Json | null
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      get_invoice_document: {
        Args: {
          p_invoice_id: string
          p_org_id: string
        }
        Returns: Json
      }
      soft_delete_invoice_draft: {
        Args: {
          p_expected_version: number
          p_invoice_id: string
          p_org_id: string
        }
        Returns: Json
      }
      send_invoice: {
        Args: {
          p_expected_version: number
          p_invoice_id: string
          p_org_id: string
        }
        Returns: Json
      }
      void_invoice: {
        Args: {
          p_expected_version: number
          p_invoice_id: string
          p_org_id: string
          p_void_reason: string
        }
        Returns: Json
      }

      create_bill_draft: {
        Args: {
          p_lines?: Json
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      save_bill_draft: {
        Args: {
          p_bill_id: string
          p_expected_version: number
          p_lines?: Json | null
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      get_bill_document: {
        Args: {
          p_bill_id: string
          p_org_id: string
        }
        Returns: Json
      }
      soft_delete_bill_draft: {
        Args: {
          p_bill_id: string
          p_expected_version: number
          p_org_id: string
        }
        Returns: Json
      }
      receive_bill: {
        Args: {
          p_bill_id: string
          p_expected_version: number
          p_org_id: string
        }
        Returns: Json
      }
      void_bill: {
        Args: {
          p_bill_id: string
          p_expected_version: number
          p_org_id: string
          p_void_reason: string
        }
        Returns: Json
      }
      soft_delete_vendor: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_vendor_id: string
        }
        Returns: undefined
      }
      create_recurring_schedule_draft: {
        Args: {
          p_lines?: Json
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      get_recurring_schedule_document: {
        Args: {
          p_org_id: string
          p_schedule_id: string
        }
        Returns: Json
      }
      save_recurring_schedule_draft: {
        Args: {
          p_expected_version: number
          p_lines?: Json | null
          p_org_id: string
          p_payload: Json
          p_schedule_id: string
        }
        Returns: Json
      }
      soft_delete_recurring_schedule_draft: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_schedule_id: string
        }
        Returns: undefined
      }
      activate_recurring_schedule: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_schedule_id: string
        }
        Returns: Json
      }
      pause_recurring_schedule: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_schedule_id: string
        }
        Returns: Json
      }
      resume_recurring_schedule: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_schedule_id: string
        }
        Returns: Json
      }
      cancel_recurring_schedule: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_schedule_id: string
        }
        Returns: Json
      }
      preview_recurring_schedule: {
        Args: {
          p_lines?: Json
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      run_now_recurring_schedule: {
        Args: {
          p_expected_version: number
          p_idempotency_key_hash: string
          p_org_id: string
          p_request_hash: string
          p_route: string
          p_schedule_id: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      get_payment: {
        Args: {
          p_org_id: string
          p_payment_id: string
        }
        Returns: Json
      }
      create_payment: {
        Args: {
          p_allocations?: Json
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      create_payment_idempotent: {
        Args: {
          p_allocations?: Json
          p_idempotency_key_hash: string
          p_org_id: string
          p_payload: Json
          p_request_hash: string
          p_route: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      allocate_payment: {
        Args: {
          p_allocations: Json
          p_expected_version: number
          p_org_id: string
          p_payment_id: string
        }
        Returns: Json
      }
      allocate_payment_idempotent: {
        Args: {
          p_allocations: Json
          p_expected_version: number
          p_idempotency_key_hash: string
          p_org_id: string
          p_payment_id: string
          p_request_hash: string
          p_route: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      reverse_payment: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_payment_id: string
          p_reason: string
        }
        Returns: Json
      }
      reverse_payment_idempotent: {
        Args: {
          p_expected_version: number
          p_idempotency_key_hash: string
          p_org_id: string
          p_payment_id: string
          p_reason: string
          p_request_hash: string
          p_route: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      soft_delete_task: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_task_id: string
        }
        Returns: undefined
      }
      soft_delete_meeting: {
        Args: {
          p_expected_version: number
          p_meeting_id: string
          p_org_id: string
        }
        Returns: undefined
      }
      replace_meeting_attendees: {
        Args: {
          p_attendees: Json
          p_meeting_id: string
          p_org_id: string
        }
        Returns: Json
      }
      create_project_with_defaults: {
        Args: {
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      soft_delete_project: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_project_id: string
        }
        Returns: undefined
      }
      soft_delete_project_card: {
        Args: {
          p_card_id: string
          p_expected_version: number
          p_org_id: string
        }
        Returns: undefined
      }
      soft_delete_project_column: {
        Args: {
          p_column_id: string
          p_expected_version: number
          p_org_id: string
        }
        Returns: undefined
      }
      create_invoice_from_quote: {
        Args: {
          p_org_id: string
          p_quote_id: string
        }
        Returns: Json
      }
      soft_delete_contact: {
        Args: {
          p_contact_id: string
          p_expected_version: number
          p_org_id: string
        }
        Returns: undefined
      }
      create_contact_with_primary_client: {
        Args: {
          p_client_id?: string | null
          p_org_id: string
          p_payload: Json
          p_set_client_id?: boolean
        }
        Returns: Json
      }
      update_contact_with_primary_client: {
        Args: {
          p_client_id?: string | null
          p_contact_id: string
          p_expected_version: number
          p_org_id: string
          p_payload?: Json
          p_set_client_id?: boolean
        }
        Returns: Json
      }
      soft_delete_lead: {
        Args: {
          p_expected_version: number
          p_lead_id: string
          p_org_id: string
        }
        Returns: undefined
      }
      soft_delete_client: {
        Args: {
          p_client_id: string
          p_expected_version: number
          p_org_id: string
        }
        Returns: undefined
      }
      soft_delete_product: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_product_id: string
        }
        Returns: undefined
      }
      soft_delete_email_template: {
        Args: {
          p_expected_version: number
          p_org_id: string
          p_template_id: string
        }
        Returns: undefined
      }
      browse_entity_documents: {
        Args: {
          p_org_id: string
          p_entity_type: string
          p_entity_id: string
          p_folder_id?: string | null
        }
        Returns: Json
      }
      create_document_folder: {
        Args: {
          p_org_id: string
          p_entity_type: string
          p_entity_id: string
          p_name: string
          p_parent_id?: string | null
        }
        Returns: Json
      }
      rename_document_folder: {
        Args: {
          p_org_id: string
          p_folder_id: string
          p_expected_version: number
          p_name: string
        }
        Returns: Json
      }
      move_document_folder: {
        Args: {
          p_org_id: string
          p_folder_id: string
          p_expected_version: number
          p_parent_id?: string | null
        }
        Returns: Json
      }
      soft_delete_document_folder: {
        Args: {
          p_org_id: string
          p_folder_id: string
          p_expected_version: number
        }
        Returns: Json
      }
      restore_document_folder: {
        Args: {
          p_org_id: string
          p_folder_id: string
          p_expected_version: number
        }
        Returns: Json
      }
      create_document_upload_intent: {
        Args: {
          p_org_id: string
          p_entity_type: string
          p_entity_id: string
          p_folder_id?: string | null
          p_name: string
          p_category: string
          p_mime_type: string
          p_size_bytes: number
          p_sha256: string
        }
        Returns: Json
      }
      finalize_document_upload: {
        Args: {
          p_org_id: string
          p_document_id: string
          p_expected_size_bytes?: number | null
          p_expected_sha256?: string | null
        }
        Returns: Json
      }
      soft_delete_document: {
        Args: {
          p_org_id: string
          p_document_id: string
          p_expected_version: number
        }
        Returns: Json
      }
      restore_document: {
        Args: {
          p_org_id: string
          p_document_id: string
          p_expected_version: number
        }
        Returns: Json
      }
      rename_document: {
        Args: {
          p_org_id: string
          p_document_id: string
          p_expected_version: number
          p_name: string
        }
        Returns: Json
      }
      move_document_link: {
        Args: {
          p_org_id: string
          p_document_id: string
          p_entity_type: string
          p_entity_id: string
          p_expected_version: number
          p_folder_id?: string | null
        }
        Returns: Json
      }
      reap_expired_document_uploads: {
        Args: Record<string, never>
        Returns: Json
      }
      get_mailbox_account: {
        Args: { p_org_id: string }
        Returns: Json
      }
      upsert_mailbox_account: {
        Args: {
          p_org_id: string
          p_email_address: string
          p_from_name: string | null
          p_imap_host: string
          p_imap_port: number
          p_imap_security: string
          p_smtp_host: string
          p_smtp_port: number
          p_smtp_security: string
          p_username: string
          p_password?: string | null
        }
        Returns: Json
      }
      disconnect_mailbox_account: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      mailbox_credentials_present: {
        Args: { p_org_id: string; p_password?: string | null }
        Returns: boolean
      }
      list_ai_integrations: {
        Args: { p_org_id: string }
        Returns: Json
      }
      upsert_ai_integration: {
        Args: { p_org_id: string; p_provider: string; p_api_key: string }
        Returns: Json
      }
      disconnect_ai_integration: {
        Args: { p_org_id: string; p_provider: string }
        Returns: undefined
      }
      claim_mailbox_sync_lease: {
        Args: { p_mailbox_id: string; p_holder: string; p_lease_seconds?: number }
        Returns: Json
      }
      read_mailbox_sync_credentials: {
        Args: { p_mailbox_id: string }
        Returns: Json
      }
      release_mailbox_sync_lease: {
        Args: {
          p_mailbox_id: string
          p_holder: string
          p_ok: boolean
          p_error_code?: string | null
          p_auth_failed?: boolean
        }
        Returns: undefined
      }
      list_mailboxes_due_for_sync: {
        Args: { p_limit?: number }
        Returns: Json
      }
      upsert_inbound_email_message: {
        Args: {
          p_org_id: string
          p_mailbox_id: string
          p_provider_message_id: string
          p_provider_thread_id: string
          p_from_address: string
          p_from_name: string
          p_to_addresses: Json
          p_subject: string
          p_body_text: string
          p_preview_text: string
          p_received_at: string
          p_body_truncated?: boolean
        }
        Returns: Json
      }
      share_email_message_to_timeline: {
        Args: {
          p_org_id: string
          p_message_id: string
          p_entity_type: string
          p_entity_id: string
        }
        Returns: Json
      }
      create_email_reply_suggestion: {
        Args: {
          p_org_id: string
          p_message_id: string
          p_output_text: string
          p_model_provider: string
          p_model_name: string
          p_variant?: string
        }
        Returns: Json
      }
      decide_ai_suggestion: {
        Args: {
          p_org_id: string
          p_suggestion_id: string
          p_decision: string
          p_accepted_text?: string | null
        }
        Returns: Json
      }
      list_entity_email_messages: {
        Args: {
          p_org_id: string
          p_entity_type: string
          p_entity_id: string
          p_limit?: number
        }
        Returns: Json
      }
      list_my_email_messages: {
        Args: {
          p_org_id: string
          p_limit?: number
          p_cursor_received_at?: string | null
          p_cursor_id?: string | null
        }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
