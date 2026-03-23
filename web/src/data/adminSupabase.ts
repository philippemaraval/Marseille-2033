import { hasSupabase, supabase } from '../lib/supabase'
import type { StatusId } from '../types/map'

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
    return { ok: false, error: error.message }
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
    return { ok: false, error: error.message }
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
    return { ok: false, error: error.message }
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
    return { ok: false, error: error.message }
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
    return { ok: false, error: error.message }
  }

  const rows = (data || []) as VersionRow[]
  if (rows.length < 2) {
    return { ok: false, error: 'Aucune version precedente disponible.' }
  }

  const targetSnapshot = asSnapshot(rows[1].snapshot)
  if (!targetSnapshot) {
    return { ok: false, error: 'Snapshot de version invalide.' }
  }

  const { error: updateError } = await supabase
    .from('map_features')
    .update({
      name: targetSnapshot.name,
      status: targetSnapshot.status,
      category: targetSnapshot.category,
      layer_id: targetSnapshot.layer_id,
      layer_label: targetSnapshot.layer_label,
      layer_sort_order: targetSnapshot.layer_sort_order,
      color: targetSnapshot.color,
      geometry_type: targetSnapshot.geometry_type,
      coordinates: targetSnapshot.coordinates,
      sort_order: targetSnapshot.sort_order,
      source: targetSnapshot.source,
      deleted_at: targetSnapshot.deleted_at,
      deleted_by: targetSnapshot.deleted_by,
    })
    .eq('id', featureId)

  if (updateError) {
    return { ok: false, error: updateError.message }
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
    const { error } = await supabase
      .from('map_features')
      .update({ layer_sort_order: update.sortOrder })
      .eq('category', update.category)
      .eq('layer_id', update.layerId)

    if (error) {
      return { ok: false, error: error.message }
    }
  }

  return { ok: true, data: null }
}
