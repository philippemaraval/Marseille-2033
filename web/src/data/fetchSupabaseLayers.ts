import type {
  FeatureStyle,
  GeometryFeature,
  LayerConfig,
  StatusId,
} from '../types/map'
import { hasSupabase, supabase } from '../lib/supabase'

type FetchResult =
  | { ok: true; layers: LayerConfig[] }
  | { ok: false; error: string }

interface MapFeatureRow {
  id: string
  name: string
  status: string
  category: string
  layer_id: string
  layer_label: string
  color: string | null
  style: unknown | null
  geometry_type: string
  coordinates: unknown
  sort_order: number | null
  layer_sort_order: number | null
}

const STATUS_DEFAULT_COLOR: Record<StatusId, string> = {
  existant: '#15803d',
  'en cours': '#b45309',
  propose: '#1d4ed8',
}

function asStatus(value: string): StatusId | null {
  if (value === 'existant' || value === 'en cours' || value === 'propose') {
    return value
  }
  return null
}

function isLatLng(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    return false
  }
  return (
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

function isLatLngArray(value: unknown): value is [number, number][] {
  if (!Array.isArray(value) || value.length === 0) {
    return false
  }
  return value.every((entry) => isLatLng(entry))
}

function normalizeStyle(raw: unknown): FeatureStyle | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const source = raw as Record<string, unknown>
  const result: FeatureStyle = {}
  if (typeof source.pointRadius === 'number' && Number.isFinite(source.pointRadius)) {
    result.pointRadius = source.pointRadius
  }
  if (typeof source.lineWidth === 'number' && Number.isFinite(source.lineWidth)) {
    result.lineWidth = source.lineWidth
  }
  if (typeof source.fillOpacity === 'number' && Number.isFinite(source.fillOpacity)) {
    result.fillOpacity = source.fillOpacity
  }
  if (
    result.pointRadius === undefined &&
    result.lineWidth === undefined &&
    result.fillOpacity === undefined
  ) {
    return undefined
  }
  return result
}

function toFeature(row: MapFeatureRow): GeometryFeature | null {
  const status = asStatus(row.status)
  if (!status) {
    return null
  }
  const color = row.color || STATUS_DEFAULT_COLOR[status]
  const style = normalizeStyle(row.style)

  if (row.geometry_type === 'point') {
    if (!isLatLng(row.coordinates)) {
      return null
    }
    return {
      id: row.id,
      name: row.name,
      status,
      color,
      style,
      geometry: 'point',
      position: row.coordinates,
    }
  }

  if (row.geometry_type === 'line') {
    if (!isLatLngArray(row.coordinates) || row.coordinates.length < 2) {
      return null
    }
    return {
      id: row.id,
      name: row.name,
      status,
      color,
      style,
      geometry: 'line',
      positions: row.coordinates,
    }
  }

  if (row.geometry_type === 'polygon') {
    if (!isLatLngArray(row.coordinates) || row.coordinates.length < 3) {
      return null
    }
    return {
      id: row.id,
      name: row.name,
      status,
      color,
      style,
      geometry: 'polygon',
      positions: row.coordinates,
    }
  }

  return null
}

function isMissingSchemaError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('column') && normalized.includes('does not exist')
  )
}

async function fetchRowsWithCurrentSchema(): Promise<{
  ok: true
  rows: MapFeatureRow[]
} | {
  ok: false
  error: string
}> {
  if (!supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const pageSize = 1000
  let offset = 0
  const rows: MapFeatureRow[] = []

  for (;;) {
    const { data, error } = await supabase
      .from('map_features')
      .select(
        'id,name,status,category,layer_id,layer_label,color,style,geometry_type,coordinates,sort_order,layer_sort_order',
      )
      .is('deleted_at', null)
      .order('category')
      .order('layer_sort_order')
      .order('layer_label')
      .order('sort_order')
      .order('name')
      .range(offset, offset + pageSize - 1)

    if (error) {
      return { ok: false, error: error.message }
    }

    const pageRows = (data || []) as MapFeatureRow[]
    rows.push(...pageRows)

    if (pageRows.length < pageSize) {
      break
    }

    offset += pageSize
  }

  return { ok: true, rows }
}

async function fetchRowsWithCurrentSchemaWithoutStyle(): Promise<{
  ok: true
  rows: MapFeatureRow[]
} | {
  ok: false
  error: string
}> {
  if (!supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const pageSize = 1000
  let offset = 0
  const rows: MapFeatureRow[] = []

  for (;;) {
    const { data, error } = await supabase
      .from('map_features')
      .select(
        'id,name,status,category,layer_id,layer_label,color,geometry_type,coordinates,sort_order,layer_sort_order',
      )
      .is('deleted_at', null)
      .order('category')
      .order('layer_sort_order')
      .order('layer_label')
      .order('sort_order')
      .order('name')
      .range(offset, offset + pageSize - 1)

    if (error) {
      return { ok: false, error: error.message }
    }

    const pageRows = (data || []).map((row) => ({
      ...row,
      style: null,
    })) as MapFeatureRow[]
    rows.push(...pageRows)

    if (pageRows.length < pageSize) {
      break
    }

    offset += pageSize
  }

  return { ok: true, rows }
}

async function fetchRowsWithLegacySchema(): Promise<{
  ok: true
  rows: MapFeatureRow[]
} | {
  ok: false
  error: string
}> {
  if (!supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const pageSize = 1000
  let offset = 0
  const rows: MapFeatureRow[] = []

  for (;;) {
    const { data, error } = await supabase
      .from('map_features')
      .select(
        'id,name,status,category,layer_id,layer_label,color,geometry_type,coordinates,sort_order',
      )
      .order('category')
      .order('layer_label')
      .order('sort_order')
      .order('name')
      .range(offset, offset + pageSize - 1)

    if (error) {
      return { ok: false, error: error.message }
    }

    const pageRows = (data || []).map((row) => ({
      ...row,
      style: null,
      layer_sort_order: 0,
    })) as MapFeatureRow[]

    rows.push(...pageRows)

    if (pageRows.length < pageSize) {
      break
    }

    offset += pageSize
  }

  return { ok: true, rows }
}

export async function fetchLayersFromSupabase(): Promise<FetchResult> {
  if (!hasSupabase || !supabase) {
    return {
      ok: false,
      error: 'Supabase non configure (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
    }
  }

  const currentSchemaResult = await fetchRowsWithCurrentSchema()
  let rows: MapFeatureRow[] = []

  if (currentSchemaResult.ok) {
    rows = currentSchemaResult.rows
  } else if (isMissingSchemaError(currentSchemaResult.error)) {
    const withoutStyleResult = await fetchRowsWithCurrentSchemaWithoutStyle()
    if (withoutStyleResult.ok) {
      rows = withoutStyleResult.rows
    } else {
      const legacySchemaResult = await fetchRowsWithLegacySchema()
      if (!legacySchemaResult.ok) {
        return { ok: false, error: legacySchemaResult.error }
      }
      rows = legacySchemaResult.rows
    }
  } else {
    return { ok: false, error: currentSchemaResult.error }
  }

  const layerMap = new Map<string, LayerConfig>()

  for (const row of rows) {
    const feature = toFeature(row)
    if (!feature) {
      continue
    }

    const existingLayer = layerMap.get(row.layer_id)
    if (!existingLayer) {
      layerMap.set(row.layer_id, {
        id: row.layer_id,
        label: row.layer_label,
        category: row.category,
        sortOrder: row.layer_sort_order ?? 0,
        features: [feature],
      })
      continue
    }

    if (
      typeof row.layer_sort_order === 'number' &&
      Number.isFinite(row.layer_sort_order)
    ) {
      existingLayer.sortOrder = Math.min(
        existingLayer.sortOrder ?? row.layer_sort_order,
        row.layer_sort_order,
      )
    }

    existingLayer.features.push(feature)
  }

  const layers = Array.from(layerMap.values()).sort((a, b) => {
    const byCategory = a.category.localeCompare(b.category, 'fr')
    if (byCategory !== 0) {
      return byCategory
    }
    const leftSort = a.sortOrder ?? Number.MAX_SAFE_INTEGER
    const rightSort = b.sortOrder ?? Number.MAX_SAFE_INTEGER
    if (leftSort !== rightSort) {
      return leftSort - rightSort
    }
    return a.label.localeCompare(b.label, 'fr')
  })

  return { ok: true, layers }
}
