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

interface MapLayerMetaRow {
  id: string
  label: string
  category: string
  section_sort_order: number | null
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
    source.pointIcon === 'dot' ||
    source.pointIcon === 'pin' ||
    source.pointIcon === 'metro' ||
    source.pointIcon === 'tram' ||
    source.pointIcon === 'bus' ||
    source.pointIcon === 'train' ||
    source.pointIcon === 'bike' ||
    source.pointIcon === 'park' ||
    source.pointIcon === 'star'
  ) {
    result.pointIcon = source.pointIcon
  }
  if (
    source.labelMode === 'auto' ||
    source.labelMode === 'always' ||
    source.labelMode === 'hover'
  ) {
    result.labelMode = source.labelMode
  }
  if (typeof source.labelSize === 'number' && Number.isFinite(source.labelSize)) {
    result.labelSize = source.labelSize
  }
  if (typeof source.labelHalo === 'boolean') {
    result.labelHalo = source.labelHalo
  }
  if (
    typeof source.labelPriority === 'number' &&
    Number.isFinite(source.labelPriority)
  ) {
    result.labelPriority = source.labelPriority
  }
  if (
    source.lineDash === 'solid' ||
    source.lineDash === 'dashed' ||
    source.lineDash === 'dotted'
  ) {
    result.lineDash = source.lineDash
  }
  if (typeof source.lineArrows === 'boolean') {
    result.lineArrows = source.lineArrows
  }
  if (
    source.lineDirection === 'none' ||
    source.lineDirection === 'forward' ||
    source.lineDirection === 'both'
  ) {
    result.lineDirection = source.lineDirection
  }
  if (
    source.polygonPattern === 'none' ||
    source.polygonPattern === 'diagonal' ||
    source.polygonPattern === 'cross' ||
    source.polygonPattern === 'dots'
  ) {
    result.polygonPattern = source.polygonPattern
  }
  if (
    source.polygonBorderMode === 'normal' ||
    source.polygonBorderMode === 'inner' ||
    source.polygonBorderMode === 'outer'
  ) {
    result.polygonBorderMode = source.polygonBorderMode
  }
  if (
    result.pointRadius === undefined &&
    result.lineWidth === undefined &&
    result.fillOpacity === undefined &&
    result.pointIcon === undefined &&
    result.labelMode === undefined &&
    result.labelSize === undefined &&
    result.labelHalo === undefined &&
    result.labelPriority === undefined &&
    result.lineDash === undefined &&
    result.lineArrows === undefined &&
    result.lineDirection === undefined &&
    result.polygonPattern === undefined &&
    result.polygonBorderMode === undefined
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
  return normalized.includes('column') && normalized.includes('does not exist')
}

function isMissingLayerMetadataSchemaError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    (normalized.includes('relation') &&
      normalized.includes('map_layers') &&
      normalized.includes('does not exist')) ||
    (normalized.includes('column') &&
      normalized.includes('section_sort_order') &&
      normalized.includes('does not exist'))
  )
}

function normalizeLayerSortOrder(value: number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return 0
}

function normalizeSectionSortOrder(value: number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return Number.MAX_SAFE_INTEGER
}

function sortLayers(items: LayerConfig[]): LayerConfig[] {
  return items.sort((a, b) => {
    const bySection =
      normalizeSectionSortOrder(a.sectionSortOrder) -
      normalizeSectionSortOrder(b.sectionSortOrder)
    if (bySection !== 0) {
      return bySection
    }
    const byCategory = a.category.localeCompare(b.category, 'fr')
    if (byCategory !== 0) {
      return byCategory
    }
    const leftSort = normalizeLayerSortOrder(a.sortOrder)
    const rightSort = normalizeLayerSortOrder(b.sortOrder)
    if (leftSort !== rightSort) {
      return leftSort - rightSort
    }
    return a.label.localeCompare(b.label, 'fr')
  })
}

function buildLayersFromFeatureRows(rows: MapFeatureRow[]): LayerConfig[] {
  const layerMap = new Map<string, LayerConfig>()
  const sectionSortByCategory = new Map<string, number>()
  let nextSectionSortOrder = 0

  for (const row of rows) {
    const feature = toFeature(row)
    if (!feature) {
      continue
    }

    if (!sectionSortByCategory.has(row.category)) {
      sectionSortByCategory.set(row.category, nextSectionSortOrder)
      nextSectionSortOrder += 1
    }

    const existingLayer = layerMap.get(row.layer_id)
    if (!existingLayer) {
      layerMap.set(row.layer_id, {
        id: row.layer_id,
        label: row.layer_label,
        category: row.category,
        sectionSortOrder: sectionSortByCategory.get(row.category) ?? 0,
        sortOrder: normalizeLayerSortOrder(row.layer_sort_order),
        features: [feature],
      })
      continue
    }

    if (
      typeof row.layer_sort_order === 'number' &&
      Number.isFinite(row.layer_sort_order)
    ) {
      existingLayer.sortOrder = Math.min(
        normalizeLayerSortOrder(existingLayer.sortOrder),
        row.layer_sort_order,
      )
    }

    existingLayer.features.push(feature)
  }

  return sortLayers(Array.from(layerMap.values()))
}

function buildLayersFromRowsWithMetadata(
  featureRows: MapFeatureRow[],
  metadataRows: MapLayerMetaRow[],
): LayerConfig[] {
  const layerMap = new Map<string, LayerConfig>()
  const sectionSortByCategory = new Map<string, number>()

  for (const metadata of metadataRows) {
    const normalizedSectionSort =
      typeof metadata.section_sort_order === 'number' &&
      Number.isFinite(metadata.section_sort_order)
        ? metadata.section_sort_order
        : 0

    const knownSectionSort = sectionSortByCategory.get(metadata.category)
    if (knownSectionSort === undefined || normalizedSectionSort < knownSectionSort) {
      sectionSortByCategory.set(metadata.category, normalizedSectionSort)
    }

    layerMap.set(metadata.id, {
      id: metadata.id,
      label: metadata.label,
      category: metadata.category,
      sectionSortOrder: normalizedSectionSort,
      sortOrder: normalizeLayerSortOrder(metadata.sort_order),
      features: [],
    })
  }

  let nextSectionSortOrder =
    sectionSortByCategory.size === 0
      ? 0
      : Math.max(...Array.from(sectionSortByCategory.values())) + 1

  for (const row of featureRows) {
    const feature = toFeature(row)
    if (!feature) {
      continue
    }

    if (!sectionSortByCategory.has(row.category)) {
      sectionSortByCategory.set(row.category, nextSectionSortOrder)
      nextSectionSortOrder += 1
    }

    const existingLayer = layerMap.get(row.layer_id)
    if (!existingLayer) {
      layerMap.set(row.layer_id, {
        id: row.layer_id,
        label: row.layer_label,
        category: row.category,
        sectionSortOrder: sectionSortByCategory.get(row.category) ?? 0,
        sortOrder: normalizeLayerSortOrder(row.layer_sort_order),
        features: [feature],
      })
      continue
    }

    existingLayer.features.push(feature)
  }

  return sortLayers(Array.from(layerMap.values()))
}

async function fetchRowsWithCurrentSchema(): Promise<
  | {
      ok: true
      rows: MapFeatureRow[]
    }
  | {
      ok: false
      error: string
    }
> {
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

async function fetchRowsWithCurrentSchemaWithoutStyle(): Promise<
  | {
      ok: true
      rows: MapFeatureRow[]
    }
  | {
      ok: false
      error: string
    }
> {
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

async function fetchRowsWithLegacySchema(): Promise<
  | {
      ok: true
      rows: MapFeatureRow[]
    }
  | {
      ok: false
      error: string
    }
> {
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

async function fetchLayerMetadataRows(): Promise<
  | { ok: true; rows: MapLayerMetaRow[] }
  | { ok: false; error: string; missingSchema: boolean }
> {
  if (!supabase) {
    return { ok: false, error: 'Supabase non configure.', missingSchema: false }
  }

  const pageSize = 1000
  let offset = 0
  const rows: MapLayerMetaRow[] = []

  for (;;) {
    const { data, error } = await supabase
      .from('map_layers')
      .select('id,label,category,section_sort_order,sort_order')
      .order('section_sort_order')
      .order('category')
      .order('sort_order')
      .order('label')
      .range(offset, offset + pageSize - 1)

    if (error) {
      return {
        ok: false,
        error: error.message,
        missingSchema: isMissingLayerMetadataSchemaError(error.message),
      }
    }

    const pageRows = (data || []) as MapLayerMetaRow[]
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
  let featureRows: MapFeatureRow[] = []

  if (currentSchemaResult.ok) {
    featureRows = currentSchemaResult.rows
  } else if (isMissingSchemaError(currentSchemaResult.error)) {
    const withoutStyleResult = await fetchRowsWithCurrentSchemaWithoutStyle()
    if (withoutStyleResult.ok) {
      featureRows = withoutStyleResult.rows
    } else {
      const legacySchemaResult = await fetchRowsWithLegacySchema()
      if (!legacySchemaResult.ok) {
        return { ok: false, error: legacySchemaResult.error }
      }
      featureRows = legacySchemaResult.rows
    }
  } else {
    return { ok: false, error: currentSchemaResult.error }
  }

  const metadataResult = await fetchLayerMetadataRows()

  if (metadataResult.ok) {
    const layers = buildLayersFromRowsWithMetadata(featureRows, metadataResult.rows)
    return { ok: true, layers }
  }

  if (metadataResult.missingSchema) {
    const layers = buildLayersFromFeatureRows(featureRows)
    return { ok: true, layers }
  }

  return { ok: false, error: metadataResult.error }
}
