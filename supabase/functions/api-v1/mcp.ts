import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { handleClients } from './clients.ts'
import { handleContacts } from './contacts.ts'
import { ApiError, errorResponse, jsonResponse, parseUuid } from './http.ts'
import { handleLeads } from './leads.ts'
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
    description: 'Create a task (same validation as POST /api/v1/tasks).',
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
        assignee_membership_id: { type: ['string', 'null'], format: 'uuid' },
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
      required: ['title'],
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
      const response = await handleTasks(
        syntheticRequest('POST', '/api/v1/tasks', args),
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
      const version = args.version
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'version must be a positive integer', {
          version: 'Required positive integer',
        })
      }
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
      // Protocol-level validation → JSON-RPC error envelope (HTTP 200).
      if (
        error.status === 400 ||
        error.status === 422 ||
        error.status === 404 ||
        error.status === 403
      ) {
        return jsonResponse(apiErrorToRpc(message.id, error), 200, requestId)
      }
      return errorResponse(error, requestId)
    }
    throw error
  }
}
