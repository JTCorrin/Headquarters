import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
import { ApiError, etag, jsonBody, jsonResponse, parseUuid, parseVersion } from './http.ts'

const ENTITY_TYPES = new Set([
  'client',
  'contact',
  'lead',
  'organisation',
  'meeting',
])

const CATEGORIES = new Set([
  'contract',
  'proposal',
  'invoice',
  'receipt',
  'transcript',
  'recording',
  'other',
])

const MAX_UPLOAD_BYTES = 52_428_800
const SIGNED_UPLOAD_SECONDS = 3600
const SIGNED_DOWNLOAD_SECONDS = 300

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

interface DatabaseError {
  code?: string
  message?: string
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  if (error.message?.toLowerCase().includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', error.message)
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', error.message ?? 'This action is not permitted')
  }
  if (error.code === 'P0002' || error.code === 'no_data_found') {
    return new ApiError(404, 'NOT_FOUND', error.message ?? 'Resource not found')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', error.message ?? 'Resource conflict')
  }
  if (
    error.code === '22023' ||
    error.code === '23514' ||
    error.code === '23503' ||
    error.code === '22003'
  ) {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'Validation failed')
  }
  console.error('Document RPC failed', { request_id: requestId, code: error.code })
  return new ApiError(500, 'INTERNAL_ERROR', 'Document operation failed')
}

function assertCanReadDocuments(role: MembershipRole): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access documents')
  }
}

function assertCanMutateDocuments(role: MembershipRole): void {
  assertCanReadDocuments(role)
  if (role === 'readonly') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify documents')
  }
}

function parseEntityType(value: string): string {
  if (!ENTITY_TYPES.has(value)) {
    throw new ApiError(400, 'BAD_REQUEST', 'entity_type is invalid', {
      entity_type: 'Must be a supported entity type',
    })
  }
  return value
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}

function serviceRoleClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Storage service credentials are unavailable',
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function validateUploadIntentBody(
  body: Record<string, unknown>,
): {
  name: string
  category: string
  mime_type: string
  size_bytes: number
  sha256: string
  folder_id: string | null
} {
  const fields: Record<string, string> = {}
  const writable = new Set([
    'name',
    'category',
    'mime_type',
    'size_bytes',
    'sha256',
    'folder_id',
  ])
  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Field is not writable'
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 160) fields.name = 'Must be 1–160 characters'

  const category = typeof body.category === 'string' ? body.category : ''
  if (!CATEGORIES.has(category)) fields.category = 'Must be a valid category'

  const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim() : ''
  if (!mimeType || mimeType.length > 255) fields.mime_type = 'Must be a MIME type'

  const sizeBytes = body.size_bytes
  if (
    typeof sizeBytes !== 'number' ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 0 ||
    sizeBytes > MAX_UPLOAD_BYTES
  ) {
    fields.size_bytes = `Must be an integer between 0 and ${MAX_UPLOAD_BYTES}`
  }

  const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : ''
  if (!isSha256(sha256)) fields.sha256 = 'Must be a 64-character hex digest'

  let folderId: string | null = null
  if ('folder_id' in body && body.folder_id !== null) {
    if (typeof body.folder_id !== 'string') {
      fields.folder_id = 'Must be a UUID or null'
    } else {
      try {
        folderId = parseUuid(body.folder_id, 'folder_id')
      } catch {
        fields.folder_id = 'Must be a UUID or null'
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Upload intent validation failed', fields)
  }

  return {
    name,
    category,
    mime_type: mimeType,
    size_bytes: sizeBytes as number,
    sha256,
    folder_id: folderId,
  }
}

export function validateFolderCreateBody(
  body: Record<string, unknown>,
): { name: string; parent_id: string | null } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'name' && key !== 'parent_id') fields[key] = 'Field is not writable'
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 160) fields.name = 'Must be 1–160 characters'

  let parentId: string | null = null
  if ('parent_id' in body && body.parent_id !== null) {
    if (typeof body.parent_id !== 'string') {
      fields.parent_id = 'Must be a UUID or null'
    } else {
      try {
        parentId = parseUuid(body.parent_id, 'parent_id')
      } catch {
        fields.parent_id = 'Must be a UUID or null'
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Folder validation failed', fields)
  }
  return { name, parent_id: parentId }
}

async function browseEntityDocuments(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const folderParam = url.searchParams.get('folder_id')
  const folderId = folderParam ? parseUuid(folderParam, 'folder_id') : null

  const { data, error } = await db.rpc('browse_entity_documents', {
    p_org_id: orgId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_folder_id: folderId,
  })
  if (error) throw databaseError(error, requestId)
  return jsonResponse({ data }, 200, requestId)
}

async function createFolder(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
  requestId: string,
): Promise<Response> {
  const body = validateFolderCreateBody(await jsonBody(req))
  const { data, error } = await db.rpc('create_document_folder', {
    p_org_id: orgId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_name: body.name,
    p_parent_id: body.parent_id,
  })
  if (error) throw databaseError(error, requestId)
  const folder = (data as { folder: { id: string; version: number } }).folder
  return jsonResponse({ data }, 201, requestId, {
    etag: etag(folder.version),
    location: `/api/v1/document-folders/${folder.id}`,
  })
}

async function createUploadIntent(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
  requestId: string,
): Promise<Response> {
  const body = validateUploadIntentBody(await jsonBody(req))
  const { data, error } = await db.rpc('create_document_upload_intent', {
    p_org_id: orgId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_folder_id: body.folder_id,
    p_name: body.name,
    p_category: body.category,
    p_mime_type: body.mime_type,
    p_size_bytes: body.size_bytes,
    p_sha256: body.sha256,
  })
  if (error) throw databaseError(error, requestId)

  const payload = data as {
    document: { id: string; bucket: string; storage_path: string; version: number }
    link: unknown
  }

  const admin = serviceRoleClient()
  const { data: signed, error: signError } = await admin.storage
    .from(payload.document.bucket)
    .createSignedUploadUrl(payload.document.storage_path)

  if (signError || !signed) {
    console.error('Signed upload URL failed', {
      request_id: requestId,
      message: signError?.message,
    })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Could not create signed upload URL')
  }

  return jsonResponse(
    {
      data: {
        ...payload,
        upload: {
          signed_url: signed.signedUrl,
          token: signed.token,
          path: signed.path,
          expires_in: SIGNED_UPLOAD_SECONDS,
        },
      },
    },
    201,
    requestId,
    {
      etag: etag(payload.document.version),
      location: `/api/v1/documents/${payload.document.id}`,
    },
  )
}

async function finalizeUpload(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  documentId: string,
  requestId: string,
): Promise<Response> {
  const body = (await jsonBody(req).catch(() => ({}))) as Record<string, unknown>
  let expectedSize: number | null = null
  let expectedSha: string | null = null
  if ('expected_size_bytes' in body && body.expected_size_bytes !== null) {
    if (
      typeof body.expected_size_bytes !== 'number' ||
      !Number.isInteger(body.expected_size_bytes)
    ) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'expected_size_bytes is invalid', {
        expected_size_bytes: 'Must be an integer',
      })
    }
    expectedSize = body.expected_size_bytes
  }
  if ('expected_sha256' in body && body.expected_sha256 !== null) {
    if (typeof body.expected_sha256 !== 'string' || !isSha256(body.expected_sha256)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'expected_sha256 is invalid', {
        expected_sha256: 'Must be a 64-character hex digest',
      })
    }
    expectedSha = body.expected_sha256.toLowerCase()
  }

  const { data, error } = await db.rpc('finalize_document_upload', {
    p_org_id: orgId,
    p_document_id: documentId,
    p_expected_size_bytes: expectedSize,
    p_expected_sha256: expectedSha,
  })
  if (error) throw databaseError(error, requestId)
  const document = (data as { document: { version: number } }).document
  return jsonResponse({ data }, 200, requestId, { etag: etag(document.version) })
}

async function downloadDocument(
  db: DatabaseClient,
  orgId: string,
  documentId: string,
  requestId: string,
): Promise<Response> {
  const { data: doc, error } = await db
    .from('documents')
    .select('id,org_id,bucket,storage_path,status,deleted_at,version,name,mime_type')
    .eq('org_id', orgId)
    .eq('id', documentId)
    .maybeSingle()

  if (error) {
    console.error('Document lookup failed', { request_id: requestId, code: error.code })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Document lookup failed')
  }
  if (!doc || doc.deleted_at) {
    throw new ApiError(404, 'NOT_FOUND', 'Document not found')
  }
  if (doc.status !== 'ready') {
    throw new ApiError(409, 'CONFLICT', 'Document is not ready for download')
  }

  const admin = serviceRoleClient()
  const { data: signed, error: signError } = await admin.storage
    .from(doc.bucket)
    .createSignedUrl(doc.storage_path, SIGNED_DOWNLOAD_SECONDS, {
      download: doc.name,
    })

  if (signError || !signed?.signedUrl) {
    console.error('Signed download URL failed', {
      request_id: requestId,
      message: signError?.message,
    })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Could not create signed download URL')
  }

  return jsonResponse(
    {
      data: {
        document_id: doc.id,
        signed_url: signed.signedUrl,
        expires_in: SIGNED_DOWNLOAD_SECONDS,
        mime_type: doc.mime_type,
        name: doc.name,
      },
    },
    200,
    requestId,
    { etag: etag(doc.version) },
  )
}

async function patchDocument(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  documentId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const body = await jsonBody(req)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 160 || Object.keys(body).some((k) => k !== 'name')) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Document rename validation failed', {
      name: 'Only name (1–160 characters) is writable',
    })
  }

  const { data, error } = await db.rpc('rename_document', {
    p_org_id: orgId,
    p_document_id: documentId,
    p_expected_version: version,
    p_name: name,
  })
  if (error) throw databaseError(error, requestId)
  const document = (data as { document: { version: number } }).document
  return jsonResponse({ data }, 200, requestId, { etag: etag(document.version) })
}

async function moveDocument(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  documentId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const body = await jsonBody(req)
  const fields: Record<string, string> = {}
  const entityType = typeof body.entity_type === 'string' ? body.entity_type : ''
  if (!ENTITY_TYPES.has(entityType)) fields.entity_type = 'Must be a supported entity type'

  let entityId = ''
  try {
    entityId = parseUuid(
      typeof body.entity_id === 'string' ? body.entity_id : null,
      'entity_id',
    )
  } catch {
    fields.entity_id = 'Must be a UUID'
  }

  let folderId: string | null = null
  if ('folder_id' in body && body.folder_id !== null) {
    try {
      folderId = parseUuid(
        typeof body.folder_id === 'string' ? body.folder_id : null,
        'folder_id',
      )
    } catch {
      fields.folder_id = 'Must be a UUID or null'
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Document move validation failed', fields)
  }

  const { data, error } = await db.rpc('move_document_link', {
    p_org_id: orgId,
    p_document_id: documentId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_expected_version: version,
    p_folder_id: folderId,
  })
  if (error) throw databaseError(error, requestId)
  const link = (data as { link: { version: number } }).link
  return jsonResponse({ data }, 200, requestId, { etag: etag(link.version) })
}

async function softDeleteDocument(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  documentId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { error } = await db.rpc('soft_delete_document', {
    p_org_id: orgId,
    p_document_id: documentId,
    p_expected_version: version,
  })
  if (error) throw databaseError(error, requestId)
  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function restoreDocument(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  documentId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { data, error } = await db.rpc('restore_document', {
    p_org_id: orgId,
    p_document_id: documentId,
    p_expected_version: version,
  })
  if (error) throw databaseError(error, requestId)
  const document = (data as { document: { version: number } }).document
  return jsonResponse({ data }, 200, requestId, { etag: etag(document.version) })
}

async function patchFolder(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  folderId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const body = await jsonBody(req)
  const hasName = 'name' in body
  const hasParent = 'parent_id' in body
  if (!hasName && !hasParent) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Folder update requires name or parent_id')
  }

  let data: Json | null = null
  if (hasName) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 160) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Folder name is invalid', {
        name: 'Must be 1–160 characters',
      })
    }
    const renamed = await db.rpc('rename_document_folder', {
      p_org_id: orgId,
      p_folder_id: folderId,
      p_expected_version: version,
      p_name: name,
    })
    if (renamed.error) throw databaseError(renamed.error, requestId)
    data = renamed.data as Json
  }

  if (hasParent) {
    const currentVersion = hasName
      ? (data as { folder: { version: number } }).folder.version
      : version
    let parentId: string | null = null
    if (body.parent_id !== null) {
      parentId = parseUuid(
        typeof body.parent_id === 'string' ? body.parent_id : null,
        'parent_id',
      )
    }
    const moved = await db.rpc('move_document_folder', {
      p_org_id: orgId,
      p_folder_id: folderId,
      p_expected_version: currentVersion,
      p_parent_id: parentId,
    })
    if (moved.error) throw databaseError(moved.error, requestId)
    data = moved.data as Json
  }

  const folder = (data as { folder: { version: number } }).folder
  return jsonResponse({ data }, 200, requestId, { etag: etag(folder.version) })
}

async function softDeleteFolder(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  folderId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { error } = await db.rpc('soft_delete_document_folder', {
    p_org_id: orgId,
    p_folder_id: folderId,
    p_expected_version: version,
  })
  if (error) throw databaseError(error, requestId)
  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function restoreFolder(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  folderId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { data, error } = await db.rpc('restore_document_folder', {
    p_org_id: orgId,
    p_folder_id: folderId,
    p_expected_version: version,
  })
  if (error) throw databaseError(error, requestId)
  const folder = (data as { folder: { version: number } }).folder
  return jsonResponse({ data }, 200, requestId, { etag: etag(folder.version) })
}

export function handleDocuments(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  const entityMatch = path.match(
    /^\/api\/v1\/entities\/([a-z]+)\/([0-9a-f-]{36})\/(documents|folders)(?:\/(upload-intent))?$/i,
  )
  if (entityMatch) {
    const entityType = parseEntityType(entityMatch[1])
    const entityId = parseUuid(entityMatch[2], 'entity_id')
    const resource = entityMatch[3]
    const action = entityMatch[4]

    if (resource === 'documents' && !action) {
      assertCanReadDocuments(role)
      if (req.method === 'GET') {
        return browseEntityDocuments(req, db, orgId, entityType, entityId, requestId)
      }
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }

    if (resource === 'documents' && action === 'upload-intent') {
      assertCanMutateDocuments(role)
      if (req.method === 'POST') {
        return createUploadIntent(req, db, orgId, entityType, entityId, requestId)
      }
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }

    if (resource === 'folders') {
      assertCanMutateDocuments(role)
      if (req.method === 'POST') {
        return createFolder(req, db, orgId, entityType, entityId, requestId)
      }
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }
  }

  const folderMatch = path.match(
    /^\/api\/v1\/document-folders\/([0-9a-f-]{36})(?:\/(restore))?$/i,
  )
  if (folderMatch) {
    const folderId = parseUuid(folderMatch[1], 'folder_id')
    const action = folderMatch[2]
    assertCanMutateDocuments(role)
    if (action === 'restore') {
      if (req.method === 'POST') return restoreFolder(req, db, orgId, folderId, requestId)
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }
    if (req.method === 'PATCH') return patchFolder(req, db, orgId, folderId, requestId)
    if (req.method === 'DELETE') return softDeleteFolder(req, db, orgId, folderId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  }

  const docMatch = path.match(
    /^\/api\/v1\/documents\/([0-9a-f-]{36})(?:\/(finalize|download|move|restore))?$/i,
  )
  if (docMatch) {
    const documentId = parseUuid(docMatch[1], 'document_id')
    const action = docMatch[2]

    if (action === 'download') {
      assertCanReadDocuments(role)
      if (req.method === 'GET') return downloadDocument(db, orgId, documentId, requestId)
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }

    assertCanMutateDocuments(role)
    if (action === 'finalize') {
      if (req.method === 'POST') {
        return finalizeUpload(req, db, orgId, documentId, requestId)
      }
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }
    if (action === 'move') {
      if (req.method === 'POST') return moveDocument(req, db, orgId, documentId, requestId)
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }
    if (action === 'restore') {
      if (req.method === 'POST') {
        return restoreDocument(req, db, orgId, documentId, requestId)
      }
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }
    if (!action) {
      if (req.method === 'PATCH') {
        return patchDocument(req, db, orgId, documentId, requestId)
      }
      if (req.method === 'DELETE') {
        return softDeleteDocument(req, db, orgId, documentId, requestId)
      }
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
