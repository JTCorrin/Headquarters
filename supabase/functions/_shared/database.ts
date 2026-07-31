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
  settings: Json
  created_at: string
  updated_at: string
  deleted_at: string | null
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
  entity_type: 'contact' | 'lead' | 'client'
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

type ProfileInsert = Pick<ProfileRow, 'display_name' | 'id'> & Partial<Omit<ProfileRow, 'id'>>
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
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
