import { hasSupabase, supabase } from '../lib/supabase'
import type { FeatureStyle, StatusId } from '../types/map'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

interface TrashFeatureRow {
  id: string
  name: string
  status: string
  category: string
  layer_id: string
  layer_label: string
  deleted_at: string
}

interface VersionRow {
  version_id: number
  operation: string
  snapshot: unknown
  created_at: string
}

interface SnapshotPayload {
  id: string
  name: string
  status: StatusId
  category: string
  layer_id: string
  layer_label: string
  layer_sort_order: number
  color: string
  style?: FeatureStyle | null
  geometry_type: 'point' | 'line' | 'polygon'
  coordinates: unknown
  sort_order: number
  source: string
  deleted_at: string | null
  deleted_by: string | null
}

export interface TrashFeature {
  id: string
  name: string
  status: StatusId
  category: string
  layerId: string
  layerLabel: string
  deletedAt: string
}

export interface FeatureVersion {
  versionId: number
  operation: string
  createdAt: string
}

interface PersistLayerOrderInput {
  category: string
  layerId: string
  sortOrder: number
}

interface PersistSectionOrderInput {
  category: string
  sortOrder: number
}

interface CreateLayerMetadataInput {
  layerId: string
  label: string
  category: string
  sortOrder: number
  sectionSortOrder: number
}

export interface ImportFeatureInsert {
  id: string
  name: string
  status: StatusId
  category: string
  layerId: string
  layerLabel: string
  layerSortOrder: number
  color: string
  style?: FeatureStyle | null
  geometryType: 'point' | 'line' | 'polygon'
  coordinates: unknown
  sortOrder: number
  source?: string
}

function normalizeAdminError(message: string): string {
  const normalized = message.toLowerCase()

  if (
    (normalized.includes('column') && normalized.includes('does not exist')) ||
    (normalized.includes('relation') && normalized.includes('does not exist')) ||
    normalized.includes('map_feature_versions') ||
    normalized.includes('map_layers')
  ) {
    return 'Schema Supabase incomplet. Execute web/supabase/schema.sql dans SQL Editor.'
  }

  return message
}

function isMissingLayerRegistrySchemaError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    (normalized.includes('relation') &&
      normalized.includes('map_layers') &&
      normalized.includes('does not exist')) ||
    (normalized.includes('could not find the table') &&
      normalized.includes('map_layers') &&
      normalized.includes('schema cache')) ||
    (normalized.includes('column') &&
      normalized.includes('section_sort_order') &&
      normalized.includes('does not exist'))
  )
}

function isMissingStyleColumnError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('column') &&
    normalized.includes('style') &&
    normalized.includes('does not exist')
  )
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function isStatus(value: unknown): value is StatusId {
  return value === 'existant' || value === 'en cours' || value === 'propose'
}

function toTrashFeature(row: TrashFeatureRow): TrashFeature | null {
  if (!isStatus(row.status)) {
    return null
  }
  if (!row.deleted_at) {
    return null
  }
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    category: row.category,
    layerId: row.layer_id,
    layerLabel: row.layer_label,
    deletedAt: row.deleted_at,
  }
}

function asSnapshot(value: unknown): SnapshotPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>

  if (
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    !isStatus(raw.status) ||
    typeof raw.category !== 'string' ||
    typeof raw.layer_id !== 'string' ||
    typeof raw.layer_label !== 'string' ||
    typeof raw.color !== 'string' ||
    (raw.geometry_type !== 'point' &&
      raw.geometry_type !== 'line' &&
      raw.geometry_type !== 'polygon') ||
    typeof raw.sort_order !== 'number'
  ) {
    return null
  }

  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    category: raw.category,
    layer_id: raw.layer_id,
    layer_label: raw.layer_label,
    layer_sort_order:
      typeof raw.layer_sort_order === 'number' ? raw.layer_sort_order : 0,
    color: raw.color,
    style:
      raw.style && typeof raw.style === 'object'
        ? (raw.style as FeatureStyle)
        : null,
    geometry_type: raw.geometry_type,
    coordinates: raw.coordinates,
    sort_order: raw.sort_order,
    source: typeof raw.source === 'string' ? raw.source : 'manual',
    deleted_at:
      raw.deleted_at === null || typeof raw.deleted_at === 'string'
        ? raw.deleted_at
        : null,
    deleted_by:
      raw.deleted_by === null || typeof raw.deleted_by === 'string'
        ? raw.deleted_by
        : null,
  }
}

export async function fetchTrashFromSupabase(): Promise<Result<TrashFeature[]>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const { data, error } = await supabase
    .from('map_features')
    .select('id,name,status,category,layer_id,layer_label,deleted_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(250)

  if (error) {
    return { ok: false, error: normalizeAdminError(error.message) }
  }

  const rows = (data || []) as TrashFeatureRow[]
  const items = rows
    .map(toTrashFeature)
    .filter((item): item is TrashFeature => item !== null)

  return { ok: true, data: items }
}

export async function moveFeatureToTrash(featureId: string): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const { data: authData } = await supabase.auth.getUser()
  const deletedBy = authData.user?.id ?? null

  const { error } = await supabase
    .from('map_features')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .eq('id', featureId)

  if (error) {
    return { ok: false, error: normalizeAdminError(error.message) }
  }

  return { ok: true, data: null }
}

export async function restoreFeatureFromTrash(
  featureId: string,
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const { error } = await supabase
    .from('map_features')
    .update({
      deleted_at: null,
      deleted_by: null,
    })
    .eq('id', featureId)

  if (error) {
    return { ok: false, error: normalizeAdminError(error.message) }
  }

  return { ok: true, data: null }
}

export async function fetchFeatureVersions(
  featureId: string,
): Promise<Result<FeatureVersion[]>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const { data, error } = await supabase
    .from('map_feature_versions')
    .select('version_id,operation,created_at')
    .eq('feature_id', featureId)
    .order('version_id', { ascending: false })
    .limit(20)

  if (error) {
    return { ok: false, error: normalizeAdminError(error.message) }
  }

  const items = ((data || []) as VersionRow[]).map((row) => ({
    versionId: row.version_id,
    operation: row.operation,
    createdAt: row.created_at,
  }))

  return { ok: true, data: items }
}

export async function restorePreviousFeatureVersion(
  featureId: string,
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const { data, error } = await supabase
    .from('map_feature_versions')
    .select('version_id,snapshot')
    .eq('feature_id', featureId)
    .order('version_id', { ascending: false })
    .limit(30)

  if (error) {
    return { ok: false, error: normalizeAdminError(error.message) }
  }

  const rows = (data || []) as VersionRow[]
  if (rows.length < 2) {
    return { ok: false, error: 'Aucune version precedente disponible.' }
  }

  const targetSnapshot = asSnapshot(rows[1].snapshot)
  if (!targetSnapshot) {
    return { ok: false, error: 'Snapshot de version invalide.' }
  }

  const updatePayload = {
    name: targetSnapshot.name,
    status: targetSnapshot.status,
    category: targetSnapshot.category,
    layer_id: targetSnapshot.layer_id,
    layer_label: targetSnapshot.layer_label,
    layer_sort_order: targetSnapshot.layer_sort_order,
    color: targetSnapshot.color,
    style: targetSnapshot.style ?? null,
    geometry_type: targetSnapshot.geometry_type,
    coordinates: targetSnapshot.coordinates,
    sort_order: targetSnapshot.sort_order,
    source: targetSnapshot.source,
    deleted_at: targetSnapshot.deleted_at,
    deleted_by: targetSnapshot.deleted_by,
  }

  let { error: updateError } = await supabase
    .from('map_features')
    .update(updatePayload)
    .eq('id', featureId)
  if (updateError && isMissingStyleColumnError(updateError.message)) {
    const legacyPayload = { ...updatePayload, style: undefined }
    const retry = await supabase
      .from('map_features')
      .update(legacyPayload)
      .eq('id', featureId)
    updateError = retry.error
  }

  if (updateError) {
    return { ok: false, error: normalizeAdminError(updateError.message) }
  }

  return { ok: true, data: null }
}

export async function persistLayerSortOrder(
  updates: PersistLayerOrderInput[],
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  for (const update of updates) {
    const { error: layerError } = await supabase
      .from('map_layers')
      .update({ sort_order: update.sortOrder })
      .eq('id', update.layerId)
      .eq('category', update.category)

    if (layerError && !isMissingLayerRegistrySchemaError(layerError.message)) {
      return { ok: false, error: normalizeAdminError(layerError.message) }
    }

    const { error } = await supabase
      .from('map_features')
      .update({ layer_sort_order: update.sortOrder })
      .eq('category', update.category)
      .eq('layer_id', update.layerId)

    if (error) {
      return { ok: false, error: normalizeAdminError(error.message) }
    }
  }

  return { ok: true, data: null }
}

export async function persistSectionSortOrder(
  updates: PersistSectionOrderInput[],
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  for (const update of updates) {
    const { error } = await supabase
      .from('map_layers')
      .update({ section_sort_order: update.sortOrder })
      .eq('category', update.category)

    if (error) {
      return { ok: false, error: normalizeAdminError(error.message) }
    }
  }

  return { ok: true, data: null }
}

export async function createLayerMetadata(
  input: CreateLayerMetadataInput,
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const payload = {
    id: input.layerId,
    label: input.label.trim(),
    category: input.category.trim(),
    sort_order: input.sortOrder,
    section_sort_order: input.sectionSortOrder,
  }

  const { error } = await supabase.from('map_layers').insert(payload)
  if (error) {
    return { ok: false, error: normalizeAdminError(error.message) }
  }

  return { ok: true, data: null }
}

export async function renameLayerMetadata(
  category: string,
  layerId: string,
  nextLabel: string,
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const normalizedLabel = nextLabel.trim()
  if (!normalizedLabel) {
    return { ok: false, error: 'Nom de calque vide.' }
  }

  const { error: layerError } = await supabase
    .from('map_layers')
    .update({ label: normalizedLabel })
    .eq('id', layerId)
    .eq('category', category)

  if (layerError) {
    return { ok: false, error: normalizeAdminError(layerError.message) }
  }

  const { error: featureError } = await supabase
    .from('map_features')
    .update({ layer_label: normalizedLabel })
    .eq('layer_id', layerId)
    .eq('category', category)

  if (featureError) {
    return { ok: false, error: normalizeAdminError(featureError.message) }
  }

  return { ok: true, data: null }
}

export async function deleteLayerMetadata(
  category: string,
  layerId: string,
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const { error: featureError } = await supabase
    .from('map_features')
    .delete()
    .eq('category', category)
    .eq('layer_id', layerId)

  if (featureError) {
    return { ok: false, error: normalizeAdminError(featureError.message) }
  }

  const { error: layerError } = await supabase
    .from('map_layers')
    .delete()
    .eq('id', layerId)
    .eq('category', category)

  if (layerError && !isMissingLayerRegistrySchemaError(layerError.message)) {
    return { ok: false, error: normalizeAdminError(layerError.message) }
  }

  return { ok: true, data: null }
}

export async function renameLayerSection(
  currentCategory: string,
  nextCategory: string,
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const normalizedNextCategory = nextCategory.trim()
  if (!normalizedNextCategory) {
    return { ok: false, error: 'Nom de section vide.' }
  }

  const { error: layerError } = await supabase
    .from('map_layers')
    .update({ category: normalizedNextCategory })
    .eq('category', currentCategory)

  if (layerError) {
    return { ok: false, error: normalizeAdminError(layerError.message) }
  }

  const { error: featureError } = await supabase
    .from('map_features')
    .update({ category: normalizedNextCategory })
    .eq('category', currentCategory)

  if (featureError) {
    return { ok: false, error: normalizeAdminError(featureError.message) }
  }

  return { ok: true, data: null }
}

export async function deleteLayerSection(
  category: string,
): Promise<Result<null>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const { error: featureError } = await supabase
    .from('map_features')
    .delete()
    .eq('category', category)

  if (featureError) {
    return { ok: false, error: normalizeAdminError(featureError.message) }
  }

  const { error: layerError } = await supabase
    .from('map_layers')
    .delete()
    .eq('category', category)

  if (layerError && !isMissingLayerRegistrySchemaError(layerError.message)) {
    return { ok: false, error: normalizeAdminError(layerError.message) }
  }

  return { ok: true, data: null }
}

export async function importFeaturesToSupabase(
  payload: ImportFeatureInsert[],
): Promise<Result<{ inserted: number }>> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  if (payload.length === 0) {
    return { ok: true, data: { inserted: 0 } }
  }

  const chunks = chunkArray(payload, 200)
  let inserted = 0

  for (const chunk of chunks) {
    const rows = chunk.map((entry) => ({
      id: entry.id,
      name: entry.name,
      status: entry.status,
      category: entry.category,
      layer_id: entry.layerId,
      layer_label: entry.layerLabel,
      layer_sort_order: entry.layerSortOrder,
      color: entry.color,
      style: entry.style ?? null,
      geometry_type: entry.geometryType,
      coordinates: entry.coordinates,
      sort_order: entry.sortOrder,
      source: entry.source ?? 'manual_import',
    }))

    let { error } = await supabase.from('map_features').insert(rows)
    if (error && isMissingStyleColumnError(error.message)) {
      const legacyRows = rows.map((row) => ({
        ...row,
        style: undefined,
      }))
      const retry = await supabase.from('map_features').insert(legacyRows)
      error = retry.error
    }
    if (error) {
      return { ok: false, error: normalizeAdminError(error.message) }
    }
    inserted += rows.length
  }

  return { ok: true, data: { inserted } }
}
