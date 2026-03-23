import type { GeometryFeature, LayerConfig, StatusId } from '../types/map'
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
  geometry_type: string
  coordinates: unknown
  sort_order: number | null
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

function toFeature(row: MapFeatureRow): GeometryFeature | null {
  const status = asStatus(row.status)
  if (!status) {
    return null
  }
  const color = row.color || STATUS_DEFAULT_COLOR[status]

  if (row.geometry_type === 'point') {
    if (!isLatLng(row.coordinates)) {
      return null
    }
    return {
      id: row.id,
      name: row.name,
      status,
      color,
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
      geometry: 'polygon',
      positions: row.coordinates,
    }
  }

  return null
}

export async function fetchLayersFromSupabase(): Promise<FetchResult> {
  if (!hasSupabase || !supabase) {
    return {
      ok: false,
      error: 'Supabase non configure (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
    }
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

    const pageRows = (data || []) as MapFeatureRow[]
    rows.push(...pageRows)

    if (pageRows.length < pageSize) {
      break
    }

    offset += pageSize
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
        features: [feature],
      })
      continue
    }

    existingLayer.features.push(feature)
  }

  const layers = Array.from(layerMap.values()).sort((a, b) => {
    const byCategory = a.category.localeCompare(b.category, 'fr')
    if (byCategory !== 0) {
      return byCategory
    }
    return a.label.localeCompare(b.label, 'fr')
  })

  return { ok: true, layers }
}
