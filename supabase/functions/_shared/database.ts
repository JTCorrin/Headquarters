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
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
