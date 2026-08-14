import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { handleClients } from './clients.ts'
import { handleContacts } from './contacts.ts'
import { ApiError, errorResponse, jsonResponse, parseUuid } from './http.ts'
import { handleInvoices } from './invoices.ts'
import { handleLeads } from './leads.ts'
import { handleMeetings } from './meetings.ts'
import { handlePayments } from './payments.ts'
import { handleProductCategories } from './product-categories.ts'
import { handleProducts } from './products.ts'
import { handleProjects } from './projects.ts'
import { handleQuotes } from './quotes.ts'
import { handleTasks } from './tasks.ts'
import { handleTimelineEvents } from './timeline-events.ts'

type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

export type McpAuth = {
  db: SupabaseClient<Database>
  userId: string | null
  membership: { id: string; role: MembershipRole }
  orgId: string
  actorType: 'api_key'
  apiKeyId: string
}

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
}

type ToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const SERVER_INFO = {
  name: 'headquarters-crm',
  version: '1.0.0',
}

const PROTOCOL_VERSION = '2025-03-26'

const TOOLS: ToolDef[] = [
  {
    name: 'list_contacts',
    description: 'List contacts in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        lifecycle_status: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_contact',
    description: 'Get a contact by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_contact',
    description: 'Create a contact (same validation as POST /api/v1/contacts).',
    inputSchema: {
      type: 'object',
      properties: {
        display_name: { type: 'string' },
        first_name: { type: ['string', 'null'] },
        last_name: { type: ['string', 'null'] },
        primary_email: { type: ['string', 'null'] },
        primary_phone: { type: ['string', 'null'] },
        job_title: { type: ['string', 'null'] },
        company_name: { type: ['string', 'null'] },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        lifecycle_status: {
          type: 'string',
          enum: ['active', 'inactive', 'archived'],
        },
        source: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        metadata: { type: 'object' },
        client_id: { type: ['string', 'null'], format: 'uuid' },
      },
      required: ['display_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_contact',
    description:
      'Update a contact (same validation as PATCH /api/v1/contacts/{id}). Requires version for If-Match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        display_name: { type: 'string' },
        first_name: { type: ['string', 'null'] },
        last_name: { type: ['string', 'null'] },
        primary_email: { type: ['string', 'null'] },
        primary_phone: { type: ['string', 'null'] },
        job_title: { type: ['string', 'null'] },
        company_name: { type: ['string', 'null'] },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        lifecycle_status: {
          type: 'string',
          enum: ['active', 'inactive', 'archived'],
        },
        source: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        metadata: { type: 'object' },
        client_id: { type: ['string', 'null'], format: 'uuid' },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_clients',
    description: 'List clients in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        status: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_client',
    description: 'Get a client by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_client',
    description: 'Create a client (same validation as POST /api/v1/clients).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        status: {
          type: 'string',
          enum: ['prospect', 'active', 'on_hold', 'inactive', 'archived'],
        },
        website_url: { type: ['string', 'null'] },
        industry: { type: ['string', 'null'] },
        primary_email: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        tax_identifier: { type: ['string', 'null'] },
        registration_number: { type: ['string', 'null'] },
        default_currency: { type: ['string', 'null'] },
        payment_terms_days: { type: ['integer', 'null'], minimum: 0 },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        renewal_on: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        metadata: { type: 'object' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_client',
    description:
      'Update a client (same validation as PATCH /api/v1/clients/{id}). Requires version for If-Match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        name: { type: 'string' },
        status: {
          type: 'string',
          enum: ['prospect', 'active', 'on_hold', 'inactive', 'archived'],
        },
        website_url: { type: ['string', 'null'] },
        industry: { type: ['string', 'null'] },
        primary_email: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        tax_identifier: { type: ['string', 'null'] },
        registration_number: { type: ['string', 'null'] },
        default_currency: { type: ['string', 'null'] },
        payment_terms_days: { type: ['integer', 'null'], minimum: 0 },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        renewal_on: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        metadata: { type: 'object' },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_leads',
    description: 'List leads in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        stage: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_lead',
    description: 'Get a lead by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_lead',
    description: 'Create a lead (same validation as POST /api/v1/leads). Not for convert/won.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        company_name: { type: ['string', 'null'] },
        primary_email: { type: ['string', 'null'] },
        contact_id: { type: ['string', 'null'], format: 'uuid' },
        client_id: { type: ['string', 'null'], format: 'uuid' },
        stage: {
          type: 'string',
          enum: ['new', 'qualified', 'proposal', 'lost'],
        },
        value_cents: { type: ['integer', 'null'], minimum: 0 },
        currency: { type: 'string' },
        probability_percent: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        source: { type: ['string', 'null'] },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        expected_close_on: { type: ['string', 'null'] },
        lost_reason: { type: ['string', 'null'] },
        position: { type: 'number' },
        notes: { type: ['string', 'null'] },
        metadata: { type: 'object' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_lead',
    description:
      'Update a lead (same validation as PATCH /api/v1/leads/{id}). Requires version for If-Match. Use HTTP convert to mark won.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        name: { type: 'string' },
        company_name: { type: ['string', 'null'] },
        primary_email: { type: ['string', 'null'] },
        contact_id: { type: ['string', 'null'], format: 'uuid' },
        client_id: { type: ['string', 'null'], format: 'uuid' },
        stage: {
          type: 'string',
          enum: ['new', 'qualified', 'proposal', 'lost'],
        },
        value_cents: { type: ['integer', 'null'], minimum: 0 },
        currency: { type: 'string' },
        probability_percent: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        source: { type: ['string', 'null'] },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        expected_close_on: { type: ['string', 'null'] },
        lost_reason: { type: ['string', 'null'] },
        position: { type: 'number' },
        notes: { type: ['string', 'null'] },
        metadata: { type: 'object' },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        status: { type: 'string' },
        assignee: { type: 'string', enum: ['me'] },
        entity_type: { type: 'string' },
        entity_id: { type: 'string', format: 'uuid' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    description: 'Get a task by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description:
      'Create a task assigned to an org membership (same validation as POST /api/v1/tasks). assignee_membership_id is required — MCP tasks cannot be unassigned.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['p1', 'p2', 'p3', 'p4'] },
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'blocked', 'done', 'cancelled'],
        },
        assignee_membership_id: { type: 'string', format: 'uuid' },
        due_at: { type: ['string', 'null'] },
        entity_type: {
          type: ['string', 'null'],
          enum: ['contact', 'lead', 'client', 'project', null],
        },
        entity_id: { type: ['string', 'null'], format: 'uuid' },
        source: {
          type: 'string',
          enum: ['manual', 'meeting', 'email', 'workflow', 'agent'],
        },
      },
      required: ['title', 'assignee_membership_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description:
      'Update a task (same validation as PATCH /api/v1/tasks/{id}). Requires version for If-Match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['p1', 'p2', 'p3', 'p4'] },
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'blocked', 'done', 'cancelled'],
        },
        assignee_membership_id: { type: ['string', 'null'], format: 'uuid' },
        due_at: { type: ['string', 'null'] },
        entity_type: {
          type: ['string', 'null'],
          enum: ['contact', 'lead', 'client', 'project', null],
        },
        entity_id: { type: ['string', 'null'], format: 'uuid' },
        blocked_reason: { type: ['string', 'null'] },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_timeline_note',
    description: 'Add a timeline note on a contact, lead, client, quote, invoice, or bill.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'lead', 'client', 'quote', 'invoice', 'bill'],
        },
        entity_id: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        body: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['note', 'email', 'call', 'payment', 'document', 'status', 'meeting', 'task'],
        },
        payload: { type: 'object' },
      },
      required: ['entity_type', 'entity_id', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_projects',
    description: 'List projects in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        status: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_project',
    description: 'Get a project by id (includes columns/cards).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_project',
    description:
      'Create a project with default board columns (same validation as POST /api/v1/projects). Omit client_id or pass null for an internal project.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: ['string', 'null'], format: 'uuid' },
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        status: {
          type: 'string',
          enum: ['planning', 'active', 'blocked', 'done', 'archived'],
        },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        starts_on: { type: ['string', 'null'] },
        due_on: { type: ['string', 'null'] },
        completed_at: { type: ['string', 'null'] },
        position: { type: 'number' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_project',
    description:
      'Update a project (same validation as PATCH /api/v1/projects/{id}). Requires version for If-Match. Pass client_id null to mark the project internal.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        client_id: { type: ['string', 'null'], format: 'uuid' },
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        status: {
          type: 'string',
          enum: ['planning', 'active', 'blocked', 'done', 'archived'],
        },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        starts_on: { type: ['string', 'null'] },
        due_on: { type: ['string', 'null'] },
        completed_at: { type: ['string', 'null'] },
        position: { type: 'number' },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_meetings',
    description: 'List meetings in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        status: { type: 'string' },
        upcoming: { type: 'boolean' },
        starts_after: { type: 'string' },
        starts_before: { type: 'string' },
        entity_type: {
          type: 'string',
          enum: ['client', 'contact', 'lead', 'project'],
        },
        entity_id: { type: 'string', format: 'uuid' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_meeting',
    description: 'Get a meeting by id (includes attendees/transcript/proposals).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_meeting',
    description: 'Create a meeting (same validation as POST /api/v1/meetings).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        status: {
          type: 'string',
          enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
        },
        starts_at: { type: 'string' },
        ends_at: { type: 'string' },
        timezone: { type: 'string' },
        location: { type: ['string', 'null'] },
        meeting_url: { type: ['string', 'null'] },
        organiser_membership_id: { type: ['string', 'null'], format: 'uuid' },
        related_entity_type: {
          type: ['string', 'null'],
          enum: ['client', 'contact', 'lead', 'project', null],
        },
        related_entity_id: { type: ['string', 'null'], format: 'uuid' },
        metadata: { type: 'object' },
        attendees: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              name: { type: ['string', 'null'] },
              contact_id: { type: ['string', 'null'], format: 'uuid' },
              membership_id: { type: ['string', 'null'], format: 'uuid' },
              organiser: { type: 'boolean' },
              response_status: {
                type: ['string', 'null'],
                enum: ['needs_action', 'accepted', 'declined', 'tentative', null],
              },
              attended: { type: ['boolean', 'null'] },
            },
            required: ['email'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'starts_at', 'ends_at'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_meeting',
    description:
      'Update a meeting (same validation as PATCH /api/v1/meetings/{id}). Requires version for If-Match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        title: { type: 'string' },
        status: {
          type: 'string',
          enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
        },
        starts_at: { type: 'string' },
        ends_at: { type: 'string' },
        timezone: { type: 'string' },
        location: { type: ['string', 'null'] },
        meeting_url: { type: ['string', 'null'] },
        organiser_membership_id: { type: ['string', 'null'], format: 'uuid' },
        related_entity_type: {
          type: ['string', 'null'],
          enum: ['client', 'contact', 'lead', 'project', null],
        },
        related_entity_id: { type: ['string', 'null'], format: 'uuid' },
        metadata: { type: 'object' },
        attendees: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              name: { type: ['string', 'null'] },
              contact_id: { type: ['string', 'null'], format: 'uuid' },
              membership_id: { type: ['string', 'null'], format: 'uuid' },
              organiser: { type: 'boolean' },
              response_status: {
                type: ['string', 'null'],
                enum: ['needs_action', 'accepted', 'declined', 'tentative', null],
              },
              attended: { type: ['boolean', 'null'] },
            },
            required: ['email'],
            additionalProperties: false,
          },
        },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_quotes',
    description: 'List quotes in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        status: {
          type: 'string',
          enum: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'void'],
        },
        client_id: { type: 'string', format: 'uuid' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_quote',
    description: 'Get a quote document by id (header + lines).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_quote',
    description:
      'Create a draft quote (same validation as POST /api/v1/quotes). Line tax: omit tax_rate_percent to inherit product tax then org default; send 0 for zero-rated. Use send_quote / accept_quote / reject_quote for lifecycle transitions.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        client_id: { type: ['string', 'null'], format: 'uuid' },
        lead_id: { type: ['string', 'null'], format: 'uuid' },
        contact_id: { type: ['string', 'null'], format: 'uuid' },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        currency: { type: 'string' },
        issue_on: { type: 'string' },
        valid_until: { type: ['string', 'null'] },
        discount_cents: { type: 'integer', minimum: 0 },
        terms: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        internal_notes: { type: ['string', 'null'] },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: ['string', 'null'], format: 'uuid' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit_price_cents: { type: 'integer' },
              discount_percent: { type: 'number' },
              tax_rate_percent: {
                type: 'number',
                description:
                  'Omit to inherit product tax rate, else org default. Send 0 for zero-rated.',
              },
              position: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_quote',
    description:
      'Update a draft quote (same validation as PATCH /api/v1/quotes/{id}). Requires version for If-Match. Drafts only. Line tax: omit tax_rate_percent to inherit product tax then org default; send 0 for zero-rated.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        title: { type: 'string' },
        client_id: { type: ['string', 'null'], format: 'uuid' },
        lead_id: { type: ['string', 'null'], format: 'uuid' },
        contact_id: { type: ['string', 'null'], format: 'uuid' },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        currency: { type: 'string' },
        issue_on: { type: 'string' },
        valid_until: { type: ['string', 'null'] },
        discount_cents: { type: 'integer', minimum: 0 },
        terms: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        internal_notes: { type: ['string', 'null'] },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: ['string', 'null'], format: 'uuid' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit_price_cents: { type: 'integer' },
              discount_percent: { type: 'number' },
              tax_rate_percent: {
                type: 'number',
                description:
                  'Omit to inherit product tax rate, else org default. Send 0 for zero-rated.',
              },
              position: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_quote',
    description:
      'Mark a draft quote as sent (POST /api/v1/quotes/{id}/send). Requires version for If-Match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'accept_quote',
    description:
      'Accept a sent quote (POST /api/v1/quotes/{id}/accept). Requires version for If-Match. Optional idempotency_key for safe retries.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'reject_quote',
    description:
      'Reject a sent quote (POST /api/v1/quotes/{id}/reject). Requires version for If-Match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_invoices',
    description: 'List invoices in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        status: {
          type: 'string',
          enum: ['draft', 'sent', 'partial', 'paid', 'void'],
        },
        client_id: { type: 'string', format: 'uuid' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_invoice',
    description: 'Get an invoice document by id (header + lines).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_invoice',
    description:
      'Create a draft invoice (same validation as POST /api/v1/invoices). Optional number for migration; otherwise auto-allocated. Line tax: omit tax_rate_percent to inherit product tax then org default; send 0 for zero-rated. Use send_invoice / void_invoice / create_invoice_from_quote for lifecycle transitions.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', format: 'uuid' },
        number: { type: 'string', minLength: 1, maxLength: 64 },
        contact_id: { type: ['string', 'null'], format: 'uuid' },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        currency: { type: 'string' },
        issue_on: { type: 'string' },
        due_on: { type: ['string', 'null'] },
        purchase_order_number: { type: ['string', 'null'] },
        discount_cents: { type: 'integer', minimum: 0 },
        payment_terms: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        internal_notes: { type: ['string', 'null'] },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: ['string', 'null'], format: 'uuid' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit_price_cents: { type: 'integer' },
              discount_percent: { type: 'number' },
              tax_rate_percent: {
                type: 'number',
                description:
                  'Omit to inherit product tax rate, else org default. Send 0 for zero-rated.',
              },
              position: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['client_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_invoice',
    description:
      'Update a draft invoice (same validation as PATCH /api/v1/invoices/{id}). Requires version for If-Match. Drafts only. Line tax: omit tax_rate_percent to inherit product tax then org default; send 0 for zero-rated.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        client_id: { type: 'string', format: 'uuid' },
        contact_id: { type: ['string', 'null'], format: 'uuid' },
        owner_membership_id: { type: ['string', 'null'], format: 'uuid' },
        currency: { type: 'string' },
        issue_on: { type: 'string' },
        due_on: { type: ['string', 'null'] },
        purchase_order_number: { type: ['string', 'null'] },
        discount_cents: { type: 'integer', minimum: 0 },
        payment_terms: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        internal_notes: { type: ['string', 'null'] },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: ['string', 'null'], format: 'uuid' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit_price_cents: { type: 'integer' },
              discount_percent: { type: 'number' },
              tax_rate_percent: {
                type: 'number',
                description:
                  'Omit to inherit product tax rate, else org default. Send 0 for zero-rated.',
              },
              position: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_invoice',
    description:
      'Mark a draft invoice as sent (POST /api/v1/invoices/{id}/send). Requires version for If-Match. Optional sent_at (ISO timestamptz) for migration; optional idempotency_key for safe retries.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        sent_at: { type: 'string' },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'void_invoice',
    description:
      'Void an invoice (POST /api/v1/invoices/{id}/void). Requires version for If-Match and void_reason. Optional idempotency_key for safe retries.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        void_reason: { type: 'string', minLength: 1, maxLength: 2000 },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['id', 'version', 'void_reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_invoice_from_quote',
    description:
      'Create an invoice from an accepted quote (POST /api/v1/invoices/from-quote).',
    inputSchema: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', format: 'uuid' },
      },
      required: ['quote_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_payments',
    description: 'List payments in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        direction: { type: 'string', enum: ['inbound', 'outbound'] },
        status: {
          type: 'string',
          enum: [
            'pending',
            'completed',
            'unallocated',
            'part_allocated',
            'allocated',
            'refunded',
            'reversed',
            'failed',
          ],
        },
        client_id: { type: 'string', format: 'uuid' },
        vendor_id: { type: 'string', format: 'uuid' },
        invoice_id: { type: 'string', format: 'uuid' },
        bill_id: { type: 'string', format: 'uuid' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_payment',
    description: 'Get a payment document by id (header + allocations).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_payment',
    description:
      'Create a payment (POST /api/v1/payments). Optional allocations at create. Optional idempotency_key for safe retries.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['inbound', 'outbound'] },
        client_id: { type: ['string', 'null'], format: 'uuid' },
        vendor_id: { type: ['string', 'null'], format: 'uuid' },
        amount_cents: { type: 'integer', minimum: 1 },
        currency: { type: 'string' },
        method: {
          type: 'string',
          enum: ['bank', 'card', 'cash', 'stripe', 'other'],
        },
        occurred_on: { type: 'string' },
        reference: { type: ['string', 'null'] },
        provider: { type: 'string' },
        provider_payment_id: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        metadata: { type: 'object' },
        allocations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              invoice_id: { type: 'string', format: 'uuid' },
              bill_id: { type: 'string', format: 'uuid' },
              amount_cents: { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
          },
        },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['direction', 'amount_cents', 'currency', 'method'],
      additionalProperties: false,
    },
  },
  {
    name: 'allocate_payment',
    description:
      'Allocate a payment to invoices/bills (POST /api/v1/payments/{id}/allocate). Requires version for If-Match. Optional idempotency_key.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        allocations: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              invoice_id: { type: 'string', format: 'uuid' },
              bill_id: { type: 'string', format: 'uuid' },
              amount_cents: { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
          },
        },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['id', 'version', 'allocations'],
      additionalProperties: false,
    },
  },
  {
    name: 'reverse_payment',
    description:
      'Reverse a payment (POST /api/v1/payments/{id}/reverse). Requires version for If-Match and reason. Optional idempotency_key.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        reason: { type: 'string', minLength: 1, maxLength: 2000 },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['id', 'version', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_products',
    description: 'List products in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        status: { type: 'string', enum: ['active', 'archived'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_product',
    description: 'Get a product by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_product',
    description: 'Create a product (same validation as POST /api/v1/products).',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', minLength: 1, maxLength: 64 },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        unit_price_cents: { type: 'integer', minimum: 0 },
        description: { type: ['string', 'null'] },
        category_id: { type: ['string', 'null'], format: 'uuid' },
        product_type: { type: 'string', enum: ['product', 'service'] },
        unit_name: { type: ['string', 'null'] },
        cost_price_cents: { type: ['integer', 'null'], minimum: 0 },
        currency: { type: 'string' },
        tax_rate_id: { type: ['string', 'null'], format: 'uuid' },
        track_stock: { type: 'boolean' },
        low_stock_at: { type: ['number', 'null'] },
        status: { type: 'string', enum: ['active', 'archived'] },
        metadata: { type: 'object' },
      },
      required: ['sku', 'name', 'unit_price_cents'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_product',
    description:
      'Update a product (same validation as PATCH /api/v1/products/{id}). Requires version for If-Match. Stock is not writable — use adjust_product_stock.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        sku: { type: 'string', minLength: 1, maxLength: 64 },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        unit_price_cents: { type: 'integer', minimum: 0 },
        description: { type: ['string', 'null'] },
        category_id: { type: ['string', 'null'], format: 'uuid' },
        product_type: { type: 'string', enum: ['product', 'service'] },
        unit_name: { type: ['string', 'null'] },
        cost_price_cents: { type: ['integer', 'null'], minimum: 0 },
        currency: { type: 'string' },
        tax_rate_id: { type: ['string', 'null'], format: 'uuid' },
        track_stock: { type: 'boolean' },
        low_stock_at: { type: ['number', 'null'] },
        status: { type: 'string', enum: ['active', 'archived'] },
        metadata: { type: 'object' },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'adjust_product_stock',
    description:
      'Adjust product stock (POST /api/v1/products/{id}/adjust-stock). Optional idempotency_key for safe retries.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        quantity_delta: { type: 'number' },
        reason: {
          type: 'string',
          enum: ['opening', 'adjustment', 'invoice', 'return', 'void'],
        },
        note: { type: ['string', 'null'] },
        occurred_at: { type: 'string' },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['id', 'quantity_delta'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_product_categories',
    description: 'List product categories in the organisation pinned to the API key.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_product_category',
    description: 'Get a product category by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_product_category',
    description:
      'Create a product category (same validation as POST /api/v1/product-categories).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        description: { type: ['string', 'null'] },
        position: { type: 'integer' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_product_category',
    description:
      'Update a product category (same validation as PATCH /api/v1/product-categories/{id}). Requires version for If-Match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1, maxLength: 120 },
        description: { type: ['string', 'null'] },
        position: { type: 'integer' },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
  },
]

export function listMcpTools(): ToolDef[] {
  return TOOLS
}

export function parseJsonRpcRequest(value: unknown): JsonRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'BAD_REQUEST', 'MCP body must be a JSON-RPC object')
  }
  const body = value as Record<string, unknown>
  if (body.jsonrpc !== undefined && body.jsonrpc !== '2.0') {
    throw new ApiError(400, 'BAD_REQUEST', 'jsonrpc must be "2.0"')
  }
  if (body.method !== undefined && typeof body.method !== 'string') {
    throw new ApiError(400, 'BAD_REQUEST', 'method must be a string')
  }
  return body as JsonRpcRequest
}

function asArgs(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {}
  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new ApiError(400, 'BAD_REQUEST', 'params must be an object')
  }
  const record = params as Record<string, unknown>
  const argumentsValue = record.arguments
  if (argumentsValue === undefined) return record
  if (
    argumentsValue === null ||
    typeof argumentsValue !== 'object' ||
    Array.isArray(argumentsValue)
  ) {
    throw new ApiError(400, 'BAD_REQUEST', 'params.arguments must be an object')
  }
  return argumentsValue as Record<string, unknown>
}

function toolName(params: unknown): string {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new ApiError(400, 'BAD_REQUEST', 'params must include name')
  }
  const name = (params as Record<string, unknown>).name
  if (typeof name !== 'string' || name.length < 1) {
    throw new ApiError(400, 'BAD_REQUEST', 'params.name must be a non-empty string')
  }
  return name
}

function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field]
  if (typeof value !== 'string' || value.length < 1) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} is required`, {
      [field]: 'Required',
    })
  }
  return value
}

/** MCP create_task gate: assignee is required (HTTP may still create unassigned). */
export function requireCreateTaskAssignee(args: Record<string, unknown>): string {
  const value = args.assignee_membership_id
  if (value === undefined || value === null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'assignee_membership_id is required', {
      assignee_membership_id: 'Required',
    })
  }
  if (typeof value !== 'string' || value.trim().length < 1) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'assignee_membership_id is required', {
      assignee_membership_id: 'Required',
    })
  }
  return parseUuid(value, 'assignee_membership_id')
}

function requireVersion(args: Record<string, unknown>): number {
  const version = args.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'version must be a positive integer', {
      version: 'Required positive integer',
    })
  }
  return version
}

/** Prefer caller-supplied key for retries; otherwise mint one (matches web client). */
function resolveIdempotencyKey(args: Record<string, unknown>): string {
  const provided = args.idempotency_key
  if (typeof provided === 'string' && provided.trim()) {
    return provided.trim()
  }
  return crypto.randomUUID()
}

function optionalQuery(args: Record<string, unknown>, keys: string[]): string {
  const params = new URLSearchParams()
  for (const key of keys) {
    const value = args[key]
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function syntheticRequest(
  method: string,
  pathWithQuery: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    ...(extraHeaders ?? {}),
  })
  return new Request(`http://mcp.local${pathWithQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function assertCanAccessContacts(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access contacts')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify contacts')
  }
}

function assertCanAccessPipeline(
  role: MembershipRole,
  method: string,
  resource: 'leads' | 'clients',
): void {
  if (resource === 'leads' && role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access leads')
  }
  if (resource === 'clients' && role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read clients')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', `Readonly members cannot modify ${resource}`)
  }
}

function assertCanAccessTasks(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access tasks')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify tasks')
  }
}

function assertCanAccessProjects(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access projects')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify projects')
  }
}

function assertCanAccessMeetings(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access meetings')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify meetings')
  }
}

function assertCanAccessQuotes(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access quotes')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify quotes')
  }
}

function assertCanAccessInvoices(role: MembershipRole, method: string): void {
  if (role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read invoices')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify invoices')
  }
}

function assertCanAccessPayments(role: MembershipRole, method: string): void {
  if (role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read payments')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify payments')
  }
}

function assertCanAccessCatalog(role: MembershipRole, method: string): void {
  if ((role === 'billing' || role === 'readonly') && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This membership cannot modify the product catalog',
    )
  }
}

function requireUserBackedActor(userId: string | null): string {
  if (!userId) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This route requires a user-backed actor (JWT or API key with created_by)',
    )
  }
  return userId
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

async function toolResultFromHttp(response: Response): Promise<Record<string, unknown>> {
  const payload = await responsePayload(response)
  if (response.ok) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
      structuredContent: payload,
      isError: false,
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    isError: true,
  }
}

/**
 * Tool-layer failure payload for thrown ApiErrors during tools/call.
 * Must stay inside JSON-RPC result (HTTP 200): Streamable HTTP clients (Cursor)
 * treat non-2xx MCP POSTs as transport errors and drop the session.
 */
export function mcpToolFailureResult(
  error: ApiError,
  requestId: string,
): Record<string, unknown> {
  const payload = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
      request_id: requestId,
    },
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    isError: true,
  }
}

async function callTool(
  auth: McpAuth,
  name: string,
  args: Record<string, unknown>,
  requestId: string,
): Promise<Record<string, unknown>> {
  const { db, orgId, membership } = auth

  switch (name) {
    case 'list_contacts': {
      assertCanAccessContacts(membership.role, 'GET')
      const path = `/api/v1/contacts${optionalQuery(args, ['limit', 'cursor', 'lifecycle_status'])}`
      const response = await handleContacts(
        syntheticRequest('GET', path),
        db,
        '/api/v1/contacts',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'get_contact': {
      assertCanAccessContacts(membership.role, 'GET')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/contacts/${id}`
      const response = await handleContacts(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_contact': {
      assertCanAccessContacts(membership.role, 'POST')
      if (!auth.userId) {
        throw new ApiError(
          403,
          'FORBIDDEN',
          'This route requires a user-backed actor (JWT or API key with created_by)',
        )
      }
      const response = await handleContacts(
        syntheticRequest('POST', '/api/v1/contacts', args),
        db,
        '/api/v1/contacts',
        orgId,
        requestId,
        auth.userId,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_contact': {
      assertCanAccessContacts(membership.role, 'PATCH')
      if (!auth.userId) {
        throw new ApiError(
          403,
          'FORBIDDEN',
          'This route requires a user-backed actor (JWT or API key with created_by)',
        )
      }
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/contacts/${id}`
      const response = await handleContacts(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
        auth.userId,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_clients': {
      assertCanAccessPipeline(membership.role, 'GET', 'clients')
      const path = `/api/v1/clients${optionalQuery(args, ['limit', 'cursor', 'status'])}`
      const response = await handleClients(
        syntheticRequest('GET', path),
        db,
        '/api/v1/clients',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'get_client': {
      assertCanAccessPipeline(membership.role, 'GET', 'clients')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/clients/${id}`
      const response = await handleClients(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_client': {
      assertCanAccessPipeline(membership.role, 'POST', 'clients')
      const response = await handleClients(
        syntheticRequest('POST', '/api/v1/clients', args),
        db,
        '/api/v1/clients',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_client': {
      assertCanAccessPipeline(membership.role, 'PATCH', 'clients')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/clients/${id}`
      const response = await handleClients(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_leads': {
      assertCanAccessPipeline(membership.role, 'GET', 'leads')
      const path = `/api/v1/leads${optionalQuery(args, ['limit', 'cursor', 'stage'])}`
      const response = await handleLeads(
        syntheticRequest('GET', path),
        db,
        '/api/v1/leads',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'get_lead': {
      assertCanAccessPipeline(membership.role, 'GET', 'leads')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/leads/${id}`
      const response = await handleLeads(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_lead': {
      assertCanAccessPipeline(membership.role, 'POST', 'leads')
      const response = await handleLeads(
        syntheticRequest('POST', '/api/v1/leads', args),
        db,
        '/api/v1/leads',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_lead': {
      assertCanAccessPipeline(membership.role, 'PATCH', 'leads')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/leads/${id}`
      const response = await handleLeads(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_tasks': {
      assertCanAccessTasks(membership.role, 'GET')
      const path = `/api/v1/tasks${
        optionalQuery(args, [
          'limit',
          'cursor',
          'status',
          'assignee',
          'entity_type',
          'entity_id',
        ])
      }`
      const response = await handleTasks(
        syntheticRequest('GET', path),
        db,
        '/api/v1/tasks',
        orgId,
        membership.role,
        membership.id,
        requestId,
        { actorType: 'api_key', apiKeyId: auth.apiKeyId },
      )
      return await toolResultFromHttp(response)
    }
    case 'get_task': {
      assertCanAccessTasks(membership.role, 'GET')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/tasks/${id}`
      const response = await handleTasks(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        membership.role,
        membership.id,
        requestId,
        { actorType: 'api_key', apiKeyId: auth.apiKeyId },
      )
      return await toolResultFromHttp(response)
    }
    case 'create_task': {
      assertCanAccessTasks(membership.role, 'POST')
      const assigneeMembershipId = requireCreateTaskAssignee(args)
      const response = await handleTasks(
        syntheticRequest('POST', '/api/v1/tasks', {
          ...args,
          assignee_membership_id: assigneeMembershipId,
        }),
        db,
        '/api/v1/tasks',
        orgId,
        membership.role,
        membership.id,
        requestId,
        { actorType: 'api_key', apiKeyId: auth.apiKeyId },
      )
      return await toolResultFromHttp(response)
    }
    case 'update_task': {
      assertCanAccessTasks(membership.role, 'PATCH')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/tasks/${id}`
      const response = await handleTasks(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        membership.role,
        membership.id,
        requestId,
        { actorType: 'api_key', apiKeyId: auth.apiKeyId },
      )
      return await toolResultFromHttp(response)
    }
    case 'add_timeline_note': {
      const entityType = requireString(args, 'entity_type')
      const entityId = parseUuid(requireString(args, 'entity_id'), 'entity_id')
      const title = requireString(args, 'title')
      const path = `/api/v1/entities/${entityType}/${entityId}/timeline-events`
      const body = {
        title,
        ...(typeof args.body === 'string' ? { body: args.body } : {}),
        ...(typeof args.kind === 'string' ? { kind: args.kind } : {}),
        ...(args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
          ? { payload: args.payload }
          : {}),
      }
      const response = await handleTimelineEvents(
        syntheticRequest('POST', path, body),
        db,
        path,
        orgId,
        membership.role,
        auth.userId,
        requestId,
        { actorType: 'api_key', apiKeyId: auth.apiKeyId },
      )
      return await toolResultFromHttp(response)
    }
    case 'list_projects': {
      assertCanAccessProjects(membership.role, 'GET')
      const path = `/api/v1/projects${optionalQuery(args, ['limit', 'cursor', 'status'])}`
      const response = await handleProjects(
        syntheticRequest('GET', path),
        db,
        '/api/v1/projects',
        orgId,
        membership.role,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'get_project': {
      assertCanAccessProjects(membership.role, 'GET')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/projects/${id}`
      const response = await handleProjects(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        membership.role,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_project': {
      assertCanAccessProjects(membership.role, 'POST')
      const actorUserId = requireUserBackedActor(auth.userId)
      const response = await handleProjects(
        syntheticRequest('POST', '/api/v1/projects', args),
        db,
        '/api/v1/projects',
        orgId,
        membership.role,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_project': {
      assertCanAccessProjects(membership.role, 'PATCH')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/projects/${id}`
      const response = await handleProjects(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        membership.role,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_meetings': {
      assertCanAccessMeetings(membership.role, 'GET')
      const path = `/api/v1/meetings${
        optionalQuery(args, [
          'limit',
          'cursor',
          'status',
          'upcoming',
          'starts_after',
          'starts_before',
          'entity_type',
          'entity_id',
        ])
      }`
      const response = await handleMeetings(
        syntheticRequest('GET', path),
        db,
        '/api/v1/meetings',
        orgId,
        membership.role,
        requestId,
        requireUserBackedActor(auth.userId),
        membership.id,
      )
      return await toolResultFromHttp(response)
    }
    case 'get_meeting': {
      assertCanAccessMeetings(membership.role, 'GET')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/meetings/${id}`
      const response = await handleMeetings(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        membership.role,
        requestId,
        requireUserBackedActor(auth.userId),
        membership.id,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_meeting': {
      assertCanAccessMeetings(membership.role, 'POST')
      const actorUserId = requireUserBackedActor(auth.userId)
      const response = await handleMeetings(
        syntheticRequest('POST', '/api/v1/meetings', args),
        db,
        '/api/v1/meetings',
        orgId,
        membership.role,
        requestId,
        actorUserId,
        membership.id,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_meeting': {
      assertCanAccessMeetings(membership.role, 'PATCH')
      const actorUserId = requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/meetings/${id}`
      const response = await handleMeetings(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        membership.role,
        requestId,
        actorUserId,
        membership.id,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_quotes': {
      assertCanAccessQuotes(membership.role, 'GET')
      const path = `/api/v1/quotes${
        optionalQuery(args, ['limit', 'cursor', 'status', 'client_id'])
      }`
      const response = await handleQuotes(
        syntheticRequest('GET', path),
        db,
        '/api/v1/quotes',
        orgId,
        requestId,
        requireUserBackedActor(auth.userId),
      )
      return await toolResultFromHttp(response)
    }
    case 'get_quote': {
      assertCanAccessQuotes(membership.role, 'GET')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/quotes/${id}`
      const response = await handleQuotes(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        requestId,
        requireUserBackedActor(auth.userId),
      )
      return await toolResultFromHttp(response)
    }
    case 'create_quote': {
      assertCanAccessQuotes(membership.role, 'POST')
      const actorUserId = requireUserBackedActor(auth.userId)
      const response = await handleQuotes(
        syntheticRequest('POST', '/api/v1/quotes', args),
        db,
        '/api/v1/quotes',
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_quote': {
      assertCanAccessQuotes(membership.role, 'PATCH')
      const actorUserId = requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/quotes/${id}`
      const response = await handleQuotes(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'send_quote': {
      assertCanAccessQuotes(membership.role, 'POST')
      requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const path = `/api/v1/quotes/${id}/send`
      const response = await handleQuotes(
        syntheticRequest('POST', path, {}, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'accept_quote': {
      assertCanAccessQuotes(membership.role, 'POST')
      requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const path = `/api/v1/quotes/${id}/accept`
      const response = await handleQuotes(
        syntheticRequest('POST', path, {}, {
          'if-match': `"${version}"`,
          'idempotency-key': resolveIdempotencyKey(args),
        }),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'reject_quote': {
      assertCanAccessQuotes(membership.role, 'POST')
      requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const path = `/api/v1/quotes/${id}/reject`
      const response = await handleQuotes(
        syntheticRequest('POST', path, {}, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_invoices': {
      assertCanAccessInvoices(membership.role, 'GET')
      const path = `/api/v1/invoices${
        optionalQuery(args, ['limit', 'cursor', 'status', 'client_id'])
      }`
      const response = await handleInvoices(
        syntheticRequest('GET', path),
        db,
        '/api/v1/invoices',
        orgId,
        requestId,
        requireUserBackedActor(auth.userId),
      )
      return await toolResultFromHttp(response)
    }
    case 'get_invoice': {
      assertCanAccessInvoices(membership.role, 'GET')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/invoices/${id}`
      const response = await handleInvoices(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        requestId,
        requireUserBackedActor(auth.userId),
      )
      return await toolResultFromHttp(response)
    }
    case 'create_invoice': {
      assertCanAccessInvoices(membership.role, 'POST')
      const actorUserId = requireUserBackedActor(auth.userId)
      const response = await handleInvoices(
        syntheticRequest('POST', '/api/v1/invoices', args),
        db,
        '/api/v1/invoices',
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_invoice': {
      assertCanAccessInvoices(membership.role, 'PATCH')
      const actorUserId = requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/invoices/${id}`
      const response = await handleInvoices(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'send_invoice': {
      assertCanAccessInvoices(membership.role, 'POST')
      requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const path = `/api/v1/invoices/${id}/send`
      const body: Record<string, unknown> = {}
      if (typeof args.sent_at === 'string') body.sent_at = args.sent_at
      const response = await handleInvoices(
        syntheticRequest('POST', path, body, {
          'if-match': `"${version}"`,
          'idempotency-key': resolveIdempotencyKey(args),
        }),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'void_invoice': {
      assertCanAccessInvoices(membership.role, 'POST')
      requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const voidReason = requireString(args, 'void_reason')
      const path = `/api/v1/invoices/${id}/void`
      const response = await handleInvoices(
        syntheticRequest(
          'POST',
          path,
          { void_reason: voidReason },
          {
            'if-match': `"${version}"`,
            'idempotency-key': resolveIdempotencyKey(args),
          },
        ),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_invoice_from_quote': {
      assertCanAccessInvoices(membership.role, 'POST')
      requireUserBackedActor(auth.userId)
      const quoteId = parseUuid(requireString(args, 'quote_id'), 'quote_id')
      const response = await handleInvoices(
        syntheticRequest('POST', '/api/v1/invoices/from-quote', {
          quote_id: quoteId,
        }),
        db,
        '/api/v1/invoices/from-quote',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_payments': {
      assertCanAccessPayments(membership.role, 'GET')
      const path = `/api/v1/payments${
        optionalQuery(args, [
          'limit',
          'cursor',
          'direction',
          'status',
          'client_id',
          'vendor_id',
          'invoice_id',
          'bill_id',
        ])
      }`
      const response = await handlePayments(
        syntheticRequest('GET', path),
        db,
        '/api/v1/payments',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'get_payment': {
      assertCanAccessPayments(membership.role, 'GET')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/payments/${id}`
      const response = await handlePayments(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_payment': {
      assertCanAccessPayments(membership.role, 'POST')
      const { idempotency_key: _ik, ...body } = args
      const response = await handlePayments(
        syntheticRequest('POST', '/api/v1/payments', body, {
          'idempotency-key': resolveIdempotencyKey(args),
        }),
        db,
        '/api/v1/payments',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'allocate_payment': {
      assertCanAccessPayments(membership.role, 'POST')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, idempotency_key: _ik, ...body } = args
      const path = `/api/v1/payments/${id}/allocate`
      const response = await handlePayments(
        syntheticRequest('POST', path, body, {
          'if-match': `"${version}"`,
          'idempotency-key': resolveIdempotencyKey(args),
        }),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'reverse_payment': {
      assertCanAccessPayments(membership.role, 'POST')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const reason = requireString(args, 'reason')
      const path = `/api/v1/payments/${id}/reverse`
      const response = await handlePayments(
        syntheticRequest(
          'POST',
          path,
          { reason },
          {
            'if-match': `"${version}"`,
            'idempotency-key': resolveIdempotencyKey(args),
          },
        ),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_products': {
      assertCanAccessCatalog(membership.role, 'GET')
      const actorUserId = requireUserBackedActor(auth.userId)
      const path = `/api/v1/products${
        optionalQuery(args, ['limit', 'cursor', 'status'])
      }`
      const response = await handleProducts(
        syntheticRequest('GET', path),
        db,
        '/api/v1/products',
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'get_product': {
      assertCanAccessCatalog(membership.role, 'GET')
      const actorUserId = requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/products/${id}`
      const response = await handleProducts(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_product': {
      assertCanAccessCatalog(membership.role, 'POST')
      const actorUserId = requireUserBackedActor(auth.userId)
      const response = await handleProducts(
        syntheticRequest('POST', '/api/v1/products', args),
        db,
        '/api/v1/products',
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_product': {
      assertCanAccessCatalog(membership.role, 'PATCH')
      const actorUserId = requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/products/${id}`
      const response = await handleProducts(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'adjust_product_stock': {
      assertCanAccessCatalog(membership.role, 'POST')
      const actorUserId = requireUserBackedActor(auth.userId)
      const id = parseUuid(requireString(args, 'id'), 'id')
      const { id: _id, idempotency_key: _ik, ...body } = args
      const path = `/api/v1/products/${id}/adjust-stock`
      const response = await handleProducts(
        syntheticRequest('POST', path, body, {
          'idempotency-key': resolveIdempotencyKey(args),
        }),
        db,
        path,
        orgId,
        requestId,
        actorUserId,
      )
      return await toolResultFromHttp(response)
    }
    case 'list_product_categories': {
      assertCanAccessCatalog(membership.role, 'GET')
      const path = `/api/v1/product-categories${
        optionalQuery(args, ['limit', 'cursor'])
      }`
      const response = await handleProductCategories(
        syntheticRequest('GET', path),
        db,
        '/api/v1/product-categories',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'get_product_category': {
      assertCanAccessCatalog(membership.role, 'GET')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const path = `/api/v1/product-categories/${id}`
      const response = await handleProductCategories(
        syntheticRequest('GET', path),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'create_product_category': {
      assertCanAccessCatalog(membership.role, 'POST')
      const response = await handleProductCategories(
        syntheticRequest('POST', '/api/v1/product-categories', args),
        db,
        '/api/v1/product-categories',
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    case 'update_product_category': {
      assertCanAccessCatalog(membership.role, 'PATCH')
      const id = parseUuid(requireString(args, 'id'), 'id')
      const version = requireVersion(args)
      const { id: _id, version: _version, ...patch } = args
      const path = `/api/v1/product-categories/${id}`
      const response = await handleProductCategories(
        syntheticRequest('PATCH', path, patch, {
          'if-match': `"${version}"`,
        }),
        db,
        path,
        orgId,
        requestId,
      )
      return await toolResultFromHttp(response)
    }
    default:
      throw new ApiError(404, 'NOT_FOUND', `Unknown tool: ${name}`)
  }
}

function rpcResult(id: JsonRpcId | undefined, result: unknown): unknown {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
  data?: unknown,
): unknown {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  }
}

function apiErrorToRpc(id: JsonRpcId | undefined, error: ApiError): unknown {
  const code = error.status === 404
    ? -32004
    : error.status === 403
    ? -32003
    : error.status === 401
    ? -32001
    : error.status === 412
    ? -32012
    : error.status === 409
    ? -32009
    : error.status === 422 || error.status === 400
    ? -32602
    : -32000
  return rpcError(id, code, error.message, {
    api_code: error.code,
    ...(error.fields ? { fields: error.fields } : {}),
  })
}

async function dispatchJsonRpc(
  auth: McpAuth,
  message: JsonRpcRequest,
  requestId: string,
): Promise<{ body: unknown; status: number } | null> {
  const method = message.method
  if (!method) {
    return {
      status: 200,
      body: rpcError(message.id, -32600, 'Invalid Request: method is required'),
    }
  }

  // Notifications have no id — acknowledge with empty success (no JSON-RPC body).
  const isNotification = message.id === undefined

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return isNotification ? null : { status: 200, body: rpcResult(message.id, {}) }
  }

  if (method === 'ping') {
    return { status: 200, body: rpcResult(message.id, {}) }
  }

  if (method === 'initialize') {
    return {
      status: 200,
      body: rpcResult(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      }),
    }
  }

  if (method === 'tools/list') {
    return {
      status: 200,
      body: rpcResult(message.id, { tools: TOOLS }),
    }
  }

  if (method === 'tools/call') {
    const name = toolName(message.params)
    const args = asArgs(message.params)
    const result = await callTool(auth, name, args, requestId)
    return { status: 200, body: rpcResult(message.id, result) }
  }

  return {
    status: 200,
    body: rpcError(message.id, -32601, `Method not found: ${method}`),
  }
}

export async function handleMcp(
  req: Request,
  auth: McpAuth,
  requestId: string,
): Promise<Response> {
  if (req.method === 'GET') {
    // Streamable HTTP without sessions: no long-lived SSE in v1.
    return jsonResponse(
      {
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'MCP v1 accepts POST JSON-RPC only (initialize, tools/list, tools/call)',
          request_id: requestId,
        },
      },
      405,
      requestId,
    )
  }

  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
  }

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Request body must be valid JSON')
  }

  const message = parseJsonRpcRequest(parsed)
  const headerMethod = req.headers.get('mcp-method')
  if (headerMethod && message.method && headerMethod !== message.method) {
    throw new ApiError(400, 'BAD_REQUEST', 'Mcp-Method header does not match JSON-RPC method')
  }
  if (message.method === 'tools/call') {
    const headerName = req.headers.get('mcp-name')
    try {
      const name = toolName(message.params)
      if (headerName && headerName !== name) {
        throw new ApiError(400, 'BAD_REQUEST', 'Mcp-Name header does not match params.name')
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw error
    }
  }

  try {
    const dispatched = await dispatchJsonRpc(auth, message, requestId)
    if (dispatched === null) {
      return new Response(null, {
        status: 202,
        headers: { 'x-request-id': requestId },
      })
    }
    return jsonResponse(dispatched.body, dispatched.status, requestId)
  } catch (error) {
    if (error instanceof ApiError) {
      // tools/call: never return non-2xx — Cursor Streamable HTTP maps that to
      // transport_error and fails the MCP connection (seen on If-Match 412).
      if (message.method === 'tools/call') {
        return jsonResponse(
          rpcResult(message.id, mcpToolFailureResult(error, requestId)),
          200,
          requestId,
        )
      }
      // Other JSON-RPC methods: keep protocol-ish statuses as JSON-RPC errors.
      if (
        error.status === 400 ||
        error.status === 422 ||
        error.status === 404 ||
        error.status === 403 ||
        error.status === 409 ||
        error.status === 412
      ) {
        return jsonResponse(apiErrorToRpc(message.id, error), 200, requestId)
      }
      return errorResponse(error, requestId)
    }
    throw error
  }
}
