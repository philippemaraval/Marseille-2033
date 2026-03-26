import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
} from 'react'
import type {
  LatLngBoundsExpression,
  LatLngTuple,
  LeafletEvent,
  LeafletMouseEvent,
  Map as LeafletMap,
  Marker as LeafletMarker,
} from 'leaflet'
import { DivIcon } from 'leaflet'
import {
  CircleMarker,
  Marker,
  MapContainer,
  Polygon,
  Polyline,
  Popup,
  Rectangle,
  TileLayer,
  Tooltip,
  useMapEvents,
} from 'react-leaflet'
import {
  createLayerMetadata,
  deleteLayerMetadata,
  deleteLayerSection,
  type FeatureVersion,
  type ImportFeatureInsert,
  type TrashFeature,
  fetchFeatureVersions,
  fetchTrashFromSupabase,
  importFeaturesToSupabase,
  moveFeatureToTrash,
  persistLayerSortOrder,
  persistSectionSortOrder,
  renameLayerMetadata,
  renameLayerSection,
  restoreFeatureFromTrash,
  restorePreviousFeatureVersion,
} from './data/adminSupabase'
import {
  buildGeoJsonExport,
  buildKmlExport,
  parseImportedFeatures,
  type FeatureEnvelope,
  type ImportedGeometryFeature,
} from './data/importExport'
import { fetchLayersFromSupabase } from './data/fetchSupabaseLayers'
import { layerMeta, layers as fallbackLayers } from './data/layers'
import { hasSupabase, supabase } from './lib/supabase'
import type {
  FeatureStyle,
  GeometryFeature,
  LabelMode,
  LayerConfig,
  LineDashStyle,
  LineDirectionMode,
  PointIconId,
  PolygonBorderMode,
  PolygonPattern,
  StatusId,
} from './types/map'
import './App.css'

type BaseMapId = 'osm' | 'satellite' | 'carto_light' | 'carto_dark' | 'topo'
type SidebarTabId = 'calques' | 'carte' | 'outils'
type DrawGeometry = GeometryFeature['geometry']
type AdminMode = 'view' | 'create' | 'edit' | 'delete'
type VisibleFeatureSortMode = 'alpha' | 'status' | 'layer' | 'category'

interface BaseMapConfig {
  label: string
  url: string
  attribution: string
}

interface VisibleFeature {
  id: string
  name: string
  status: StatusId
  geometry: DrawGeometry
  category: string
  layerLabel: string
  color: string
}

interface FeatureRef {
  feature: GeometryFeature
  category: string
  layerId: string
  layerLabel: string
}

interface CreateDraft {
  name: string
  status: StatusId
  color: string
  category: string
  layerId: string
  layerLabel: string
  geometry: DrawGeometry
  pointRadius: number
  lineWidth: number
  fillOpacity: number
  pointIcon: PointIconId
  labelMode: LabelMode
  labelSize: number
  labelHalo: boolean
  labelPriority: number
  lineDash: LineDashStyle
  lineArrows: boolean
  lineDirection: LineDirectionMode
  polygonPattern: PolygonPattern
  polygonBorderMode: PolygonBorderMode
}

interface EditDraft {
  name: string
  status: StatusId
  color: string
  category: string
  layerId: string
  layerLabel: string
  geometry: DrawGeometry
  pointRadius: number
  lineWidth: number
  fillOpacity: number
  pointIcon: PointIconId
  labelMode: LabelMode
  labelSize: number
  labelHalo: boolean
  labelPriority: number
  lineDash: LineDashStyle
  lineArrows: boolean
  lineDirection: LineDirectionMode
  polygonPattern: PolygonPattern
  polygonBorderMode: PolygonBorderMode
}

interface ImportDraft {
  category: string
  layerId: string
  layerLabel: string
  defaultStatus: StatusId
  defaultColor: string
}

interface MapClickCaptureProps {
  enabled: boolean
  onMapClick: (position: LatLngTuple) => void
  onMapDoubleClick?: () => void
  onMapContextMenu?: () => void
  onMapMouseMove?: (position: LatLngTuple) => void
  onMapMouseDown?: (position: LatLngTuple) => void
  onMapMouseUp?: (position: LatLngTuple) => void
}

interface MapViewportCaptureProps {
  onViewportChange: (viewport: {
    center: LatLngTuple
    zoom: number
    bounds: [LatLngTuple, LatLngTuple]
  }) => void
  onMapReady?: (map: LeafletMap) => void
  onCursorMove?: (position: LatLngTuple | null) => void
}

interface SupabaseKeyMetadata {
  projectRef: string | null
  role: string | null
  expIso: string | null
  error: string | null
}

interface FeatureContextMenuState {
  featureId: string
  clientX: number
  clientY: number
}

type MeasureGeometry = 'line' | 'polygon'

interface SnapSegment {
  start: LatLngTuple
  end: LatLngTuple
}

interface SnapPreviewState {
  position: LatLngTuple
  type: 'vertex' | 'segment'
  distanceMeters: number
}

interface LocalHistorySnapshot {
  createPoints: LatLngTuple[]
  editPoints: LatLngTuple[]
  measurePoints: LatLngTuple[]
}

interface LocalHistoryEntry {
  label: string
  snapshot: LocalHistorySnapshot
  createdAt: number
}

interface MapSearchCandidate {
  id: string
  label: string
  subtitle: string
  position: LatLngTuple
  source: 'coords' | 'ban' | 'nominatim'
}

interface ViewBookmark {
  id: string
  name: string
  center: LatLngTuple
  zoom: number
  createdAt: number
}

interface LayerVisibilityPreset {
  id: string
  name: string
  layerIds: string[]
  createdAt: number
}

interface StyleTemplateOption {
  id: string
  label: string
  description: string
  patch: Partial<CreateDraft>
}

interface PersistedUiStateV1 {
  version: 1
  updatedAt: string
  baseMapId?: BaseMapId
  activeLayers?: Record<string, boolean>
  statusFilter?: StatusId | 'all'
  categoryFilter?: string | 'all'
  geometryFilter?: DrawGeometry | 'all'
  featureSearchQuery?: string
  featureSortMode?: VisibleFeatureSortMode
  isLabelOverlayEnabled?: boolean
  isLabelCollisionEnabled?: boolean
  labelMinZoom?: number
  isAdminPanelOpen?: boolean
  showDebugInfo?: boolean
  adminEmail?: string
  adminMode?: AdminMode
  selectedFeatureId?: string | null
  selectedFeatureIds?: string[]
  createDraft?: Partial<CreateDraft>
  createPoints?: LatLngTuple[]
  editDraft?: Partial<EditDraft> | null
  editPoints?: LatLngTuple[]
  importDraft?: Partial<ImportDraft>
  isRedrawingEditGeometry?: boolean
  isMeasureMode?: boolean
  measureGeometry?: MeasureGeometry
  measurePoints?: LatLngTuple[]
  isSnappingEnabled?: boolean
  snapToleranceMeters?: number
  isGridEnabled?: boolean
  localHistoryPast?: LocalHistoryEntry[]
  localHistoryFuture?: LocalHistoryEntry[]
  lockedLayers?: Record<string, boolean>
  collapsedLayerFolders?: Record<string, boolean>
  layerZoomVisibility?: Record<
    string,
    { minZoom: number; maxZoom: number }
  >
  layerOpacityByKey?: Record<string, number>
  layerPanelSearchQuery?: string
  layerPresetDraftName?: string
  layerVisibilityPresets?: LayerVisibilityPreset[]
  viewBookmarks?: ViewBookmark[]
  isNorthArrowVisible?: boolean
  isPresentationMode?: boolean
  showWelcomeHint?: boolean
  isMapToolbarCollapsed?: boolean
  mapView?: {
    center: LatLngTuple
    zoom: number
  } | null
}

interface SharedUrlState {
  center?: LatLngTuple
  zoom?: number
  baseMapId?: BaseMapId
  statusFilter?: StatusId | 'all'
  categoryFilter?: string | 'all'
  geometryFilter?: DrawGeometry | 'all'
  activeLayerIds?: string[]
  selectedFeatureId?: string | null
}

const MARSEILLE_CENTER: LatLngTuple = [43.2965, 5.3698]
const METROPOLE_LAT_MIN = 43.02
const METROPOLE_LAT_MAX = 43.62
const METROPOLE_LNG_MIN = 4.95
const METROPOLE_LNG_MAX = 5.86
const METROPOLE_BOUNDS: LatLngBoundsExpression = [
  [METROPOLE_LAT_MIN, METROPOLE_LNG_MIN],
  [METROPOLE_LAT_MAX, METROPOLE_LNG_MAX],
]

const BASE_MAPS: Record<BaseMapId, BaseMapConfig> = {
  osm: {
    label: 'OSM standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
  carto_light: {
    label: 'Carto clair',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  carto_dark: {
    label: 'Carto sombre',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  topo: {
    label: 'Topographique',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap',
  },
}

const STATUS_LABELS: Record<StatusId, string> = {
  existant: 'Existant',
  'en cours': 'En cours',
  propose: 'Proposé',
}

const STATUS_COLORS: Record<StatusId, string> = {
  existant: '#15803d',
  'en cours': '#b45309',
  propose: '#1d4ed8',
}

const STATUS_SORT_ORDER: Record<StatusId, number> = {
  existant: 1,
  'en cours': 2,
  propose: 3,
}

const ADMIN_MODE_LABELS: Record<AdminMode, string> = {
  view: 'Lecture',
  create: 'Création',
  edit: 'Édition',
  delete: 'Suppression',
}

const VERSION_OPERATION_LABELS: Record<string, string> = {
  insert: 'Création',
  update: 'Modification',
  trash: 'Corbeille',
  restore: 'Restauration',
  delete: 'Suppression',
}

const MIN_POINTS_REQUIRED: Record<DrawGeometry, number> = {
  point: 1,
  line: 2,
  polygon: 3,
}

const DRAW_GEOMETRY_LABELS: Record<DrawGeometry, string> = {
  point: 'point',
  line: 'ligne',
  polygon: 'polygone',
}

const MEASURE_GEOMETRY_LABELS: Record<MeasureGeometry, string> = {
  line: 'Distance',
  polygon: 'Surface',
}

const DEFAULT_POINT_RADIUS = 6
const DEFAULT_LINE_WIDTH = 3
const DEFAULT_POLYGON_FILL_OPACITY = 0.2
const DEFAULT_POINT_ICON: PointIconId = 'dot'
const DEFAULT_LABEL_MODE: LabelMode = 'auto'
const DEFAULT_LABEL_SIZE = 13
const DEFAULT_LABEL_HALO = true
const DEFAULT_LABEL_PRIORITY = 50
const DEFAULT_LINE_DASH: LineDashStyle = 'solid'
const DEFAULT_LINE_ARROWS = false
const DEFAULT_LINE_DIRECTION: LineDirectionMode = 'none'
const DEFAULT_POLYGON_PATTERN: PolygonPattern = 'none'
const DEFAULT_POLYGON_BORDER_MODE: PolygonBorderMode = 'normal'
const UI_STATE_STORAGE_KEY = 'marseille2033.ui-state.v1'
const MAX_VIEW_BOOKMARKS = 30
const MAX_LAYER_PRESETS = 30

const POINT_ICON_LABELS: Record<PointIconId, string> = {
  dot: 'Rond',
  pin: 'Épingle',
  metro: 'Métro',
  tram: 'Tram',
  bus: 'Bus',
  train: 'Train',
  bike: 'Vélo',
  park: 'Parc',
  star: 'Étoile',
}

const POINT_ICON_GLYPHS: Record<PointIconId, string> = {
  dot: '•',
  pin: '📍',
  metro: 'Ⓜ',
  tram: '🚋',
  bus: '🚌',
  train: '🚆',
  bike: '🚲',
  park: '🌳',
  star: '★',
}

const LINE_DASH_OPTIONS: Record<LineDashStyle, string> = {
  solid: 'Continue',
  dashed: 'Pointillée',
  dotted: 'Points',
}

const POLYGON_PATTERN_OPTIONS: Record<PolygonPattern, string> = {
  none: 'Aucun',
  diagonal: 'Diagonal',
  cross: 'Croisé',
  dots: 'Points',
}

const POLYGON_BORDER_MODE_OPTIONS: Record<PolygonBorderMode, string> = {
  normal: 'Normal',
  inner: 'Intérieur',
  outer: 'Extérieur',
}

const LABEL_MODE_OPTIONS: Record<LabelMode, string> = {
  auto: 'Auto',
  always: 'Toujours',
  hover: 'Survol',
}

const LINE_DIRECTION_OPTIONS: Record<LineDirectionMode, string> = {
  none: 'Aucun',
  forward: 'Sens principal',
  both: 'Deux sens',
}

const MAP_TOOLBAR_TOOLS: ReadonlyArray<{
  id: string
  label: string
  hotkey: string
  mode: AdminMode
  geometry?: DrawGeometry
}> = [
  {
    id: 'tool-create-point',
    label: 'Point',
    hotkey: '1',
    mode: 'create',
    geometry: 'point',
  },
  {
    id: 'tool-create-line',
    label: 'Ligne',
    hotkey: '2',
    mode: 'create',
    geometry: 'line',
  },
  {
    id: 'tool-create-polygon',
    label: 'Polygone',
    hotkey: '3',
    mode: 'create',
    geometry: 'polygon',
  },
  { id: 'tool-edit', label: 'Déplacer', hotkey: 'E', mode: 'edit' },
  { id: 'tool-delete', label: 'Supprimer', hotkey: 'D', mode: 'delete' },
]

function extractProjectRefFromUrl(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (!host.endsWith('.supabase.co')) {
      return null
    }

    const [projectRef] = host.split('.')
    return projectRef || null
  } catch {
    return null
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const paddingLength = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(paddingLength)
  return atob(padded)
}

function decodeSupabaseAnonKey(value: string | undefined): SupabaseKeyMetadata {
  if (!value) {
    return {
      projectRef: null,
      role: null,
      expIso: null,
      error: 'Clé absente',
    }
  }

  const parts = value.split('.')
  if (parts.length !== 3) {
    return {
      projectRef: null,
      role: null,
      expIso: null,
      error: 'Format JWT invalide',
    }
  }

  try {
    const payloadRaw = decodeBase64Url(parts[1])
    const payload = JSON.parse(payloadRaw) as {
      ref?: unknown
      role?: unknown
      exp?: unknown
    }

    const expIso =
      typeof payload.exp === 'number' && Number.isFinite(payload.exp)
        ? new Date(payload.exp * 1000).toISOString()
        : null

    return {
      projectRef: typeof payload.ref === 'string' ? payload.ref : null,
      role: typeof payload.role === 'string' ? payload.role : null,
      expIso,
      error: null,
    }
  } catch {
    return {
      projectRef: null,
      role: null,
      expIso: null,
      error: 'Impossible de décoder la clé',
    }
  }
}

function isMissingStyleColumnError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('column') &&
    normalized.includes('style') &&
    normalized.includes('does not exist')
  )
}

function fingerprintToken(value: string | undefined): string {
  if (!value) {
    return 'absente'
  }
  if (value.length < 20) {
    return `trop courte (${value.length})`
  }
  return `${value.slice(0, 10)}...${value.slice(-6)}`
}

function MapClickCapture({
  enabled,
  onMapClick,
  onMapDoubleClick,
  onMapContextMenu,
  onMapMouseMove,
  onMapMouseDown,
  onMapMouseUp,
}: MapClickCaptureProps) {
  useMapEvents({
    click(event) {
      if (!enabled) {
        return
      }
      onMapClick([event.latlng.lat, event.latlng.lng])
    },
    dblclick(event) {
      if (!enabled || !onMapDoubleClick) {
        return
      }
      event.originalEvent.preventDefault()
      onMapDoubleClick()
    },
    contextmenu(event) {
      if (!enabled || !onMapContextMenu) {
        return
      }
      event.originalEvent.preventDefault()
      onMapContextMenu()
    },
    mousemove(event) {
      if (!enabled || !onMapMouseMove) {
        return
      }
      onMapMouseMove([event.latlng.lat, event.latlng.lng])
    },
    mousedown(event) {
      if (!enabled || !onMapMouseDown) {
        return
      }
      onMapMouseDown([event.latlng.lat, event.latlng.lng])
    },
    mouseup(event) {
      if (!enabled || !onMapMouseUp) {
        return
      }
      onMapMouseUp([event.latlng.lat, event.latlng.lng])
    },
  })

  return null
}

function MapViewportCapture({
  onViewportChange,
  onMapReady,
  onCursorMove,
}: MapViewportCaptureProps) {
  const map = useMapEvents({
    moveend() {
      const bounds = map.getBounds()
      const center = map.getCenter()
      onViewportChange({
        center: [center.lat, center.lng],
        zoom: map.getZoom(),
        bounds: [
          [bounds.getSouth(), bounds.getWest()],
          [bounds.getNorth(), bounds.getEast()],
        ],
      })
    },
    zoomend() {
      const bounds = map.getBounds()
      const center = map.getCenter()
      onViewportChange({
        center: [center.lat, center.lng],
        zoom: map.getZoom(),
        bounds: [
          [bounds.getSouth(), bounds.getWest()],
          [bounds.getNorth(), bounds.getEast()],
        ],
      })
    },
    mousemove(event) {
      onCursorMove?.([event.latlng.lat, event.latlng.lng])
    },
    mouseout() {
      onCursorMove?.(null)
    },
  })

  useEffect(() => {
    onMapReady?.(map)
    const bounds = map.getBounds()
    const center = map.getCenter()
    onViewportChange({
      center: [center.lat, center.lng],
      zoom: map.getZoom(),
      bounds: [
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ],
    })
  }, [map, onMapReady, onViewportChange])

  return null
}

function getFeaturePoints(feature: GeometryFeature): LatLngTuple[] {
  if (feature.geometry === 'point') {
    return [feature.position]
  }
  return feature.positions
}

function toCoordinates(geometry: DrawGeometry, points: LatLngTuple[]): unknown {
  if (geometry === 'point') {
    return points[0]
  }
  return points
}

function isGeometryComplete(geometry: DrawGeometry, points: LatLngTuple[]): boolean {
  return points.length >= MIN_POINTS_REQUIRED[geometry]
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

function normalizePointRadius(value: number): number {
  return Math.max(3, Math.min(24, value))
}

function normalizeLineWidth(value: number): number {
  return Math.max(1, Math.min(14, value))
}

function normalizeFillOpacity(value: number): number {
  return Math.max(0.05, Math.min(0.95, value))
}

function normalizeLayerOpacity(value: number): number {
  return Math.round(clamp(value, 0.15, 1) * 100) / 100
}

function normalizeLabelSize(value: number): number {
  return Math.round(Math.max(10, Math.min(24, value)))
}

function normalizeLabelPriority(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)))
}

function normalizePointIcon(value: unknown): PointIconId {
  if (
    value === 'dot' ||
    value === 'pin' ||
    value === 'metro' ||
    value === 'tram' ||
    value === 'bus' ||
    value === 'train' ||
    value === 'bike' ||
    value === 'park' ||
    value === 'star'
  ) {
    return value
  }
  return DEFAULT_POINT_ICON
}

function normalizeLabelMode(value: unknown): LabelMode {
  if (value === 'auto' || value === 'always' || value === 'hover') {
    return value
  }
  return DEFAULT_LABEL_MODE
}

function normalizeLineDash(value: unknown): LineDashStyle {
  if (value === 'solid' || value === 'dashed' || value === 'dotted') {
    return value
  }
  return DEFAULT_LINE_DASH
}

function normalizeLineDirection(value: unknown): LineDirectionMode {
  if (value === 'none' || value === 'forward' || value === 'both') {
    return value
  }
  return DEFAULT_LINE_DIRECTION
}

function normalizePolygonPattern(value: unknown): PolygonPattern {
  if (value === 'none' || value === 'diagonal' || value === 'cross' || value === 'dots') {
    return value
  }
  return DEFAULT_POLYGON_PATTERN
}

function normalizePolygonBorderMode(value: unknown): PolygonBorderMode {
  if (value === 'normal' || value === 'inner' || value === 'outer') {
    return value
  }
  return DEFAULT_POLYGON_BORDER_MODE
}

function toDashArray(style: LineDashStyle): string | undefined {
  if (style === 'dashed') {
    return '10 6'
  }
  if (style === 'dotted') {
    return '2 8'
  }
  return undefined
}

function buildStatusTemplatePatch(status: StatusId): Partial<CreateDraft> {
  if (status === 'existant') {
    return {
      color: STATUS_COLORS.existant,
      lineDash: 'solid',
      fillOpacity: 0.22,
      labelPriority: 70,
    }
  }
  if (status === 'en cours') {
    return {
      color: STATUS_COLORS['en cours'],
      lineDash: 'dashed',
      fillOpacity: 0.18,
      labelPriority: 55,
    }
  }
  return {
    color: STATUS_COLORS.propose,
    lineDash: 'dotted',
    fillOpacity: 0.14,
    labelPriority: 42,
  }
}

function buildCategoryTemplatePatch(category: string): Partial<CreateDraft> {
  const normalized = normalizeSearchTerm(category)
  if (normalized.includes('transport')) {
    return {
      pointIcon: 'metro',
      lineWidth: 4,
      lineDash: 'solid',
      lineArrows: true,
      lineDirection: 'forward',
      labelPriority: 80,
    }
  }
  if (normalized.includes('piste') || normalized.includes('velo')) {
    return {
      pointIcon: 'bike',
      color: '#0f766e',
      lineDash: 'dashed',
      lineWidth: 3,
      labelPriority: 58,
    }
  }
  if (normalized.includes('parc') || normalized.includes('jardin')) {
    return {
      pointIcon: 'park',
      color: '#15803d',
      fillOpacity: 0.26,
      polygonPattern: 'dots',
      polygonBorderMode: 'inner',
      labelPriority: 52,
    }
  }
  if (normalized.includes('quartier') || normalized.includes('secteur')) {
    return {
      color: '#1d4ed8',
      fillOpacity: 0.13,
      polygonPattern: 'diagonal',
      polygonBorderMode: 'outer',
      labelPriority: 46,
    }
  }
  if (normalized.includes('pieton')) {
    return {
      color: '#b45309',
      polygonPattern: 'cross',
      fillOpacity: 0.2,
      lineDash: 'dashed',
      labelPriority: 48,
    }
  }
  return {
    labelPriority: 50,
  }
}

function normalizeTemplatePatch(patch: Partial<CreateDraft>): Partial<CreateDraft> {
  const normalized: Partial<CreateDraft> = {}
  if (typeof patch.color === 'string' && isHexColor(patch.color)) {
    normalized.color = patch.color
  }
  if (typeof patch.pointRadius === 'number' && Number.isFinite(patch.pointRadius)) {
    normalized.pointRadius = normalizePointRadius(patch.pointRadius)
  }
  if (typeof patch.lineWidth === 'number' && Number.isFinite(patch.lineWidth)) {
    normalized.lineWidth = normalizeLineWidth(patch.lineWidth)
  }
  if (typeof patch.fillOpacity === 'number' && Number.isFinite(patch.fillOpacity)) {
    normalized.fillOpacity = normalizeFillOpacity(patch.fillOpacity)
  }
  if (patch.pointIcon !== undefined) {
    normalized.pointIcon = normalizePointIcon(patch.pointIcon)
  }
  if (patch.labelMode !== undefined) {
    normalized.labelMode = normalizeLabelMode(patch.labelMode)
  }
  if (typeof patch.labelSize === 'number' && Number.isFinite(patch.labelSize)) {
    normalized.labelSize = normalizeLabelSize(patch.labelSize)
  }
  if (typeof patch.labelHalo === 'boolean') {
    normalized.labelHalo = patch.labelHalo
  }
  if (typeof patch.labelPriority === 'number' && Number.isFinite(patch.labelPriority)) {
    normalized.labelPriority = normalizeLabelPriority(patch.labelPriority)
  }
  if (patch.lineDash !== undefined) {
    normalized.lineDash = normalizeLineDash(patch.lineDash)
  }
  if (typeof patch.lineArrows === 'boolean') {
    normalized.lineArrows = patch.lineArrows
  }
  if (patch.lineDirection !== undefined) {
    normalized.lineDirection = normalizeLineDirection(patch.lineDirection)
  }
  if (patch.polygonPattern !== undefined) {
    normalized.polygonPattern = normalizePolygonPattern(patch.polygonPattern)
  }
  if (patch.polygonBorderMode !== undefined) {
    normalized.polygonBorderMode = normalizePolygonBorderMode(patch.polygonBorderMode)
  }
  return normalized
}

function resolveDraftStyle(
  geometry: DrawGeometry,
  style?: FeatureStyle,
): Pick<
  CreateDraft,
  | 'pointRadius'
  | 'lineWidth'
  | 'fillOpacity'
  | 'pointIcon'
  | 'labelMode'
  | 'labelSize'
  | 'labelHalo'
  | 'labelPriority'
  | 'lineDash'
  | 'lineArrows'
  | 'lineDirection'
  | 'polygonPattern'
  | 'polygonBorderMode'
> {
  const pointRadius =
    typeof style?.pointRadius === 'number' && Number.isFinite(style.pointRadius)
      ? style.pointRadius
      : DEFAULT_POINT_RADIUS
  const lineWidth =
    typeof style?.lineWidth === 'number' && Number.isFinite(style.lineWidth)
      ? style.lineWidth
      : DEFAULT_LINE_WIDTH
  const fillOpacity =
    typeof style?.fillOpacity === 'number' && Number.isFinite(style.fillOpacity)
      ? style.fillOpacity
      : DEFAULT_POLYGON_FILL_OPACITY
  const pointIcon = normalizePointIcon(style?.pointIcon)
  const labelMode = normalizeLabelMode(style?.labelMode)
  const labelSize =
    typeof style?.labelSize === 'number' && Number.isFinite(style.labelSize)
      ? normalizeLabelSize(style.labelSize)
      : DEFAULT_LABEL_SIZE
  const labelHalo =
    typeof style?.labelHalo === 'boolean' ? style.labelHalo : DEFAULT_LABEL_HALO
  const labelPriority =
    typeof style?.labelPriority === 'number' && Number.isFinite(style.labelPriority)
      ? normalizeLabelPriority(style.labelPriority)
      : DEFAULT_LABEL_PRIORITY
  const lineDash = normalizeLineDash(style?.lineDash)
  const lineArrows =
    typeof style?.lineArrows === 'boolean' ? style.lineArrows : DEFAULT_LINE_ARROWS
  const lineDirection = normalizeLineDirection(style?.lineDirection)
  const polygonPattern = normalizePolygonPattern(style?.polygonPattern)
  const polygonBorderMode = normalizePolygonBorderMode(style?.polygonBorderMode)

  const shared = {
    pointIcon,
    labelMode,
    labelSize,
    labelHalo,
    labelPriority,
    lineDash,
    lineArrows,
    lineDirection,
    polygonPattern,
    polygonBorderMode,
  }

  if (geometry === 'point') {
    return {
      pointRadius: normalizePointRadius(pointRadius),
      lineWidth: normalizeLineWidth(2),
      fillOpacity: normalizeFillOpacity(DEFAULT_POLYGON_FILL_OPACITY),
      ...shared,
    }
  }

  if (geometry === 'line') {
    return {
      pointRadius: normalizePointRadius(DEFAULT_POINT_RADIUS),
      lineWidth: normalizeLineWidth(lineWidth),
      fillOpacity: normalizeFillOpacity(DEFAULT_POLYGON_FILL_OPACITY),
      ...shared,
    }
  }

  return {
    pointRadius: normalizePointRadius(DEFAULT_POINT_RADIUS),
    lineWidth: normalizeLineWidth(lineWidth),
    fillOpacity: normalizeFillOpacity(fillOpacity),
    ...shared,
  }
}

function toFeatureStylePayload(
  geometry: DrawGeometry,
  draft: Pick<
    CreateDraft,
    | 'pointRadius'
    | 'lineWidth'
    | 'fillOpacity'
    | 'pointIcon'
    | 'labelMode'
    | 'labelSize'
    | 'labelHalo'
    | 'labelPriority'
    | 'lineDash'
    | 'lineArrows'
    | 'lineDirection'
    | 'polygonPattern'
    | 'polygonBorderMode'
  >,
): FeatureStyle {
  const base: FeatureStyle = {
    labelMode: normalizeLabelMode(draft.labelMode),
    labelSize: normalizeLabelSize(draft.labelSize),
    labelHalo: Boolean(draft.labelHalo),
    labelPriority: normalizeLabelPriority(draft.labelPriority),
  }
  if (geometry === 'point') {
    return {
      ...base,
      pointRadius: normalizePointRadius(draft.pointRadius),
      pointIcon: normalizePointIcon(draft.pointIcon),
    }
  }
  if (geometry === 'line') {
    return {
      ...base,
      lineWidth: normalizeLineWidth(draft.lineWidth),
      lineDash: normalizeLineDash(draft.lineDash),
      lineArrows: Boolean(draft.lineArrows),
      lineDirection: normalizeLineDirection(draft.lineDirection),
    }
  }
  return {
    ...base,
    lineWidth: normalizeLineWidth(draft.lineWidth),
    fillOpacity: normalizeFillOpacity(draft.fillOpacity),
    polygonPattern: normalizePolygonPattern(draft.polygonPattern),
    polygonBorderMode: normalizePolygonBorderMode(draft.polygonBorderMode),
  }
}

function toLayerId(value: string, layerLabel: string): string {
  const base = (value.trim() || layerLabel.trim()).toLowerCase()
  return base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function toLayerLockKey(category: string, layerId: string): string {
  return `${category}::${layerId}`
}

function buildDefaultDraft(layerList: LayerConfig[]): CreateDraft {
  const firstLayer = layerList[0]
  return {
    name: '',
    status: 'propose',
    color: STATUS_COLORS.propose,
    category: firstLayer?.category ?? 'transports en commun',
    layerId: firstLayer?.id ?? 'nouveau-calque',
    layerLabel: firstLayer?.label ?? 'Nouveau calque',
    geometry: 'point',
    pointRadius: DEFAULT_POINT_RADIUS,
    lineWidth: DEFAULT_LINE_WIDTH,
    fillOpacity: DEFAULT_POLYGON_FILL_OPACITY,
    pointIcon: DEFAULT_POINT_ICON,
    labelMode: DEFAULT_LABEL_MODE,
    labelSize: DEFAULT_LABEL_SIZE,
    labelHalo: DEFAULT_LABEL_HALO,
    labelPriority: DEFAULT_LABEL_PRIORITY,
    lineDash: DEFAULT_LINE_DASH,
    lineArrows: DEFAULT_LINE_ARROWS,
    lineDirection: DEFAULT_LINE_DIRECTION,
    polygonPattern: DEFAULT_POLYGON_PATTERN,
    polygonBorderMode: DEFAULT_POLYGON_BORDER_MODE,
  }
}

function buildDefaultImportDraft(layerList: LayerConfig[]): ImportDraft {
  const firstLayer = layerList[0]
  return {
    category: firstLayer?.category ?? 'transports en commun',
    layerId: firstLayer?.id ?? 'import-calque',
    layerLabel: firstLayer?.label ?? 'Import manuel',
    defaultStatus: 'propose',
    defaultColor: STATUS_COLORS.propose,
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return Array.from(new Set(cleaned))
}

function parseLatLngTuple(value: unknown): LatLngTuple | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null
  }
  const lat = value[0]
  const lng = value[1]
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    typeof lng !== 'number' ||
    !Number.isFinite(lng)
  ) {
    return null
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null
  }
  return [lat, lng]
}

function parseLatLngTupleArray(value: unknown): LatLngTuple[] {
  if (!Array.isArray(value)) {
    return []
  }
  const points: LatLngTuple[] = []
  for (const item of value) {
    const point = parseLatLngTuple(item)
    if (point) {
      points.push(point)
    }
  }
  return points
}

function clampPointToMetropole(point: LatLngTuple): LatLngTuple {
  return [
    clamp(point[0], METROPOLE_LAT_MIN, METROPOLE_LAT_MAX),
    clamp(point[1], METROPOLE_LNG_MIN, METROPOLE_LNG_MAX),
  ]
}

function parsePersistedMapView(value: unknown): { center: LatLngTuple; zoom: number } | null {
  if (!isObjectRecord(value)) {
    return null
  }
  const center = parseLatLngTuple(value.center)
  const zoomRaw = value.zoom
  if (!center || typeof zoomRaw !== 'number' || !Number.isFinite(zoomRaw)) {
    return null
  }
  return {
    center: clampPointToMetropole(center),
    zoom: clamp(zoomRaw, 10, 18),
  }
}

function parseStatusValue(value: unknown, fallback: StatusId): StatusId {
  if (value === 'existant' || value === 'en cours' || value === 'propose') {
    return value
  }
  return fallback
}

function parseDrawGeometryValue(value: unknown, fallback: DrawGeometry): DrawGeometry {
  if (value === 'point' || value === 'line' || value === 'polygon') {
    return value
  }
  return fallback
}

function parseMeasureGeometryValue(
  value: unknown,
  fallback: MeasureGeometry,
): MeasureGeometry {
  if (value === 'line' || value === 'polygon') {
    return value
  }
  return fallback
}

function parseAdminModeValue(value: unknown, fallback: AdminMode): AdminMode {
  if (value === 'view' || value === 'create' || value === 'edit' || value === 'delete') {
    return value
  }
  return fallback
}

function parseFeatureSortModeValue(
  value: unknown,
  fallback: VisibleFeatureSortMode,
): VisibleFeatureSortMode {
  if (
    value === 'alpha' ||
    value === 'status' ||
    value === 'layer' ||
    value === 'category'
  ) {
    return value
  }
  return fallback
}

function parseBaseMapIdValue(value: unknown, fallback: BaseMapId): BaseMapId {
  if (
    value === 'osm' ||
    value === 'satellite' ||
    value === 'carto_light' ||
    value === 'carto_dark' ||
    value === 'topo'
  ) {
    return value
  }
  return fallback
}

function parseBooleanRecord(value: unknown): Record<string, boolean> | null {
  if (!isObjectRecord(value)) {
    return null
  }
  const entries: Array<[string, boolean]> = []
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof key === 'string' && typeof entryValue === 'boolean') {
      entries.push([key, entryValue])
    }
  }
  return Object.fromEntries(entries)
}

function parseBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }
  return null
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return null
}

function parseTextValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  return value
}

function parseHexColorValue(value: unknown, fallback: string): string {
  if (typeof value === 'string' && isHexColor(value)) {
    return value
  }
  return fallback
}

function parseLocalHistoryEntries(value: unknown): LocalHistoryEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  const entries: LocalHistoryEntry[] = []
  for (const item of value) {
    if (!isObjectRecord(item)) {
      continue
    }
    const snapshot = isObjectRecord(item.snapshot) ? item.snapshot : null
    if (!snapshot) {
      continue
    }

    const label =
      typeof item.label === 'string' && item.label.trim().length > 0
        ? item.label
        : 'Action'
    const createdAt =
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
        ? item.createdAt
        : Date.now()

    entries.push({
      label,
      createdAt,
      snapshot: {
        createPoints: parseLatLngTupleArray(snapshot.createPoints),
        editPoints: parseLatLngTupleArray(snapshot.editPoints),
        measurePoints: parseLatLngTupleArray(snapshot.measurePoints),
      },
    })
  }

  return entries.slice(-60)
}

function parseViewBookmarks(value: unknown): ViewBookmark[] {
  if (!Array.isArray(value)) {
    return []
  }
  const items: ViewBookmark[] = []
  for (const item of value) {
    if (!isObjectRecord(item)) {
      continue
    }
    const center = parseLatLngTuple(item.center)
    const zoom = parseFiniteNumber(item.zoom)
    if (!center || zoom === null) {
      continue
    }
    const id =
      typeof item.id === 'string' && item.id.trim().length > 0
        ? item.id
        : `bookmark_${crypto.randomUUID()}`
    const name =
      typeof item.name === 'string' && item.name.trim().length > 0
        ? item.name.trim()
        : `Vue ${items.length + 1}`
    const createdAt =
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
        ? item.createdAt
        : Date.now()
    items.push({
      id,
      name,
      center: clampPointToMetropole(center),
      zoom: clamp(zoom, 10, 18),
      createdAt,
    })
  }
  return items.slice(0, MAX_VIEW_BOOKMARKS)
}

function parseLayerVisibilityPresets(value: unknown): LayerVisibilityPreset[] {
  if (!Array.isArray(value)) {
    return []
  }
  const items: LayerVisibilityPreset[] = []
  for (const item of value) {
    if (!isObjectRecord(item)) {
      continue
    }
    const layerIds = parseStringArray(item.layerIds)
    if (layerIds.length === 0) {
      continue
    }
    const id =
      typeof item.id === 'string' && item.id.trim().length > 0
        ? item.id
        : `layer_preset_${crypto.randomUUID()}`
    const name =
      typeof item.name === 'string' && item.name.trim().length > 0
        ? item.name.trim()
        : `Preset ${items.length + 1}`
    const createdAt =
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
        ? item.createdAt
        : Date.now()
    items.push({
      id,
      name,
      layerIds,
      createdAt,
    })
  }
  return items.slice(0, MAX_LAYER_PRESETS)
}

function parseLayerZoomVisibility(
  value: unknown,
): Record<string, { minZoom: number; maxZoom: number }> {
  if (!isObjectRecord(value)) {
    return {}
  }
  const result: Record<string, { minZoom: number; maxZoom: number }> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isObjectRecord(entry)) {
      continue
    }
    const minZoom = parseFiniteNumber(entry.minZoom)
    const maxZoom = parseFiniteNumber(entry.maxZoom)
    if (minZoom === null || maxZoom === null) {
      continue
    }
    const normalizedMin = clamp(Math.round(minZoom), 10, 18)
    const normalizedMax = clamp(Math.round(maxZoom), 10, 18)
    result[key] = {
      minZoom: Math.min(normalizedMin, normalizedMax),
      maxZoom: Math.max(normalizedMin, normalizedMax),
    }
  }
  return result
}

function parseLayerOpacityByKey(value: unknown): Record<string, number> {
  if (!isObjectRecord(value)) {
    return {}
  }
  const result: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseFiniteNumber(entry)
    if (parsed === null) {
      continue
    }
    result[key] = normalizeLayerOpacity(parsed)
  }
  return result
}

function parseSharedUrlState(search: string): SharedUrlState | null {
  if (!search || search.trim().length === 0) {
    return null
  }
  const params = new URLSearchParams(search)
  const state: SharedUrlState = {}

  const lat = parseFiniteNumber(
    params.has('lat') ? Number.parseFloat(params.get('lat') ?? '') : null,
  )
  const lng = parseFiniteNumber(
    params.has('lng') ? Number.parseFloat(params.get('lng') ?? '') : null,
  )
  const zoom = parseFiniteNumber(
    params.has('z') ? Number.parseFloat(params.get('z') ?? '') : null,
  )
  if (lat !== null && lng !== null) {
    const parsedCenter = parseLatLngTuple([lat, lng])
    if (parsedCenter) {
      state.center = clampPointToMetropole(parsedCenter)
    }
  }
  if (zoom !== null) {
    state.zoom = clamp(zoom, 10, 18)
  }

  const baseMapValue = params.get('b')
  if (
    baseMapValue === 'osm' ||
    baseMapValue === 'satellite' ||
    baseMapValue === 'carto_light' ||
    baseMapValue === 'carto_dark' ||
    baseMapValue === 'topo'
  ) {
    state.baseMapId = baseMapValue
  }

  const statusValue = params.get('st')
  if (
    statusValue === 'all' ||
    statusValue === 'existant' ||
    statusValue === 'en cours' ||
    statusValue === 'propose'
  ) {
    state.statusFilter = statusValue
  }

  const categoryValue = params.get('cat')
  if (categoryValue !== null) {
    const trimmed = categoryValue.trim()
    state.categoryFilter = trimmed.length > 0 ? trimmed : 'all'
  }

  const geometryValue = params.get('geo')
  if (
    geometryValue === 'all' ||
    geometryValue === 'point' ||
    geometryValue === 'line' ||
    geometryValue === 'polygon'
  ) {
    state.geometryFilter = geometryValue
  }

  const activeLayersValue = params.get('al')
  if (activeLayersValue) {
    state.activeLayerIds = parseStringArray(activeLayersValue.split(','))
  }

  const selectedFeatureId = params.get('sid')
  if (selectedFeatureId !== null) {
    const trimmed = selectedFeatureId.trim()
    state.selectedFeatureId = trimmed.length > 0 ? trimmed : null
  }

  const hasData =
    state.center !== undefined ||
    state.zoom !== undefined ||
    state.baseMapId !== undefined ||
    state.statusFilter !== undefined ||
    state.categoryFilter !== undefined ||
    state.geometryFilter !== undefined ||
    state.activeLayerIds !== undefined ||
    state.selectedFeatureId !== undefined
  return hasData ? state : null
}

function parseCoordinateQuery(value: string): LatLngTuple | null {
  const normalized = value
    .trim()
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
  if (!normalized) {
    return null
  }

  const matches = normalized.match(/-?\d+(?:\.\d+)?/g)
  if (!matches || matches.length < 2) {
    return null
  }

  const first = Number.parseFloat(matches[0])
  const second = Number.parseFloat(matches[1])
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null
  }

  const asLatLng =
    first >= -90 && first <= 90 && second >= -180 && second <= 180
      ? ([first, second] as LatLngTuple)
      : null
  const asLngLat =
    second >= -90 && second <= 90 && first >= -180 && first <= 180
      ? ([second, first] as LatLngTuple)
      : null

  if (asLatLng && asLngLat) {
    return clampPointToMetropole(asLatLng)
  }
  if (asLatLng) {
    return clampPointToMetropole(asLatLng)
  }
  if (asLngLat) {
    return clampPointToMetropole(asLngLat)
  }
  return null
}

async function fetchBanCandidates(query: string): Promise<MapSearchCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    limit: '5',
    autocomplete: '1',
  })
  const response = await fetch(`https://api-adresse.data.gouv.fr/search/?${params.toString()}`)
  if (!response.ok) {
    return []
  }

  const data = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] }
      properties?: { label?: string; city?: string; context?: string }
    }>
  }
  const features = Array.isArray(data.features) ? data.features : []
  return features
    .map<MapSearchCandidate | null>((feature, index) => {
      const lng = feature.geometry?.coordinates?.[0]
      const lat = feature.geometry?.coordinates?.[1]
      if (
        typeof lat !== 'number' ||
        !Number.isFinite(lat) ||
        typeof lng !== 'number' ||
        !Number.isFinite(lng)
      ) {
        return null
      }
      const label = feature.properties?.label?.trim()
      if (!label) {
        return null
      }
      const city = feature.properties?.city?.trim() ?? ''
      const context = feature.properties?.context?.trim() ?? ''
      return {
        id: `ban-${index}-${lat.toFixed(6)}-${lng.toFixed(6)}`,
        label,
        subtitle: [city, context].filter(Boolean).join(' | ') || 'BAN',
        position: clampPointToMetropole([lat, lng]),
        source: 'ban' as const,
      }
    })
    .filter((item): item is MapSearchCandidate => item !== null)
}

async function fetchNominatimCandidates(query: string): Promise<MapSearchCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '5',
    addressdetails: '1',
    countrycodes: 'fr',
  })
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
  )
  if (!response.ok) {
    return []
  }
  const data = (await response.json()) as Array<{
    place_id?: number
    display_name?: string
    lat?: string
    lon?: string
    type?: string
  }>
  if (!Array.isArray(data)) {
    return []
  }

  return data
    .map<MapSearchCandidate | null>((item, index) => {
      const lat = Number.parseFloat(item.lat ?? '')
      const lng = Number.parseFloat(item.lon ?? '')
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null
      }
      const displayName = (item.display_name ?? '').trim()
      if (!displayName) {
        return null
      }
      return {
        id: `nom-${item.place_id ?? index}`,
        label: displayName.split(',')[0] || displayName,
        subtitle: `OSM • ${item.type ?? 'lieu'}`,
        position: clampPointToMetropole([lat, lng]),
        source: 'nominatim' as const,
      }
    })
    .filter((item): item is MapSearchCandidate => item !== null)
}

function hydrateCreateDraftFromPartial(
  value: unknown,
  fallback: CreateDraft,
): CreateDraft {
  if (!isObjectRecord(value)) {
    return fallback
  }

  const geometry = parseDrawGeometryValue(value.geometry, fallback.geometry)
  const styleDraft = resolveDraftStyle(geometry, {
    pointRadius: parseFiniteNumber(value.pointRadius) ?? fallback.pointRadius,
    lineWidth: parseFiniteNumber(value.lineWidth) ?? fallback.lineWidth,
    fillOpacity: parseFiniteNumber(value.fillOpacity) ?? fallback.fillOpacity,
  })

  return {
    name: parseTextValue(value.name, fallback.name),
    status: parseStatusValue(value.status, fallback.status),
    color: parseHexColorValue(value.color, fallback.color),
    category: parseTextValue(value.category, fallback.category),
    layerId: parseTextValue(value.layerId, fallback.layerId),
    layerLabel: parseTextValue(value.layerLabel, fallback.layerLabel),
    geometry,
    pointRadius: styleDraft.pointRadius,
    lineWidth: styleDraft.lineWidth,
    fillOpacity: styleDraft.fillOpacity,
    pointIcon: normalizePointIcon(value.pointIcon ?? fallback.pointIcon),
    labelMode: normalizeLabelMode(value.labelMode ?? fallback.labelMode),
    labelSize: normalizeLabelSize(
      parseFiniteNumber(value.labelSize) ?? fallback.labelSize,
    ),
    labelHalo:
      typeof value.labelHalo === 'boolean' ? value.labelHalo : fallback.labelHalo,
    labelPriority: normalizeLabelPriority(
      parseFiniteNumber(value.labelPriority) ?? fallback.labelPriority,
    ),
    lineDash: normalizeLineDash(value.lineDash ?? fallback.lineDash),
    lineArrows:
      typeof value.lineArrows === 'boolean'
        ? value.lineArrows
        : fallback.lineArrows,
    lineDirection: normalizeLineDirection(
      value.lineDirection ?? fallback.lineDirection,
    ),
    polygonPattern: normalizePolygonPattern(
      value.polygonPattern ?? fallback.polygonPattern,
    ),
    polygonBorderMode: normalizePolygonBorderMode(
      value.polygonBorderMode ?? fallback.polygonBorderMode,
    ),
  }
}

function hydrateEditDraftFromPartial(value: unknown): EditDraft | null {
  if (value === null) {
    return null
  }
  if (!isObjectRecord(value)) {
    return null
  }

  const geometry = parseDrawGeometryValue(value.geometry, 'point')
  const styleDraft = resolveDraftStyle(geometry, {
    pointRadius: parseFiniteNumber(value.pointRadius) ?? DEFAULT_POINT_RADIUS,
    lineWidth: parseFiniteNumber(value.lineWidth) ?? DEFAULT_LINE_WIDTH,
    fillOpacity:
      parseFiniteNumber(value.fillOpacity) ?? DEFAULT_POLYGON_FILL_OPACITY,
  })

  return {
    name: parseTextValue(value.name, ''),
    status: parseStatusValue(value.status, 'propose'),
    color: parseHexColorValue(value.color, STATUS_COLORS.propose),
    category: parseTextValue(value.category, ''),
    layerId: parseTextValue(value.layerId, ''),
    layerLabel: parseTextValue(value.layerLabel, ''),
    geometry,
    pointRadius: styleDraft.pointRadius,
    lineWidth: styleDraft.lineWidth,
    fillOpacity: styleDraft.fillOpacity,
    pointIcon: normalizePointIcon(value.pointIcon),
    labelMode: normalizeLabelMode(value.labelMode),
    labelSize: normalizeLabelSize(
      parseFiniteNumber(value.labelSize) ?? DEFAULT_LABEL_SIZE,
    ),
    labelHalo:
      typeof value.labelHalo === 'boolean' ? value.labelHalo : DEFAULT_LABEL_HALO,
    labelPriority: normalizeLabelPriority(
      parseFiniteNumber(value.labelPriority) ?? DEFAULT_LABEL_PRIORITY,
    ),
    lineDash: normalizeLineDash(value.lineDash),
    lineArrows:
      typeof value.lineArrows === 'boolean'
        ? value.lineArrows
        : DEFAULT_LINE_ARROWS,
    lineDirection: normalizeLineDirection(value.lineDirection),
    polygonPattern: normalizePolygonPattern(value.polygonPattern),
    polygonBorderMode: normalizePolygonBorderMode(value.polygonBorderMode),
  }
}

function hydrateImportDraftFromPartial(
  value: unknown,
  fallback: ImportDraft,
): ImportDraft {
  if (!isObjectRecord(value)) {
    return fallback
  }
  return {
    category: parseTextValue(value.category, fallback.category),
    layerId: parseTextValue(value.layerId, fallback.layerId),
    layerLabel: parseTextValue(value.layerLabel, fallback.layerLabel),
    defaultStatus: parseStatusValue(value.defaultStatus, fallback.defaultStatus),
    defaultColor: parseHexColorValue(value.defaultColor, fallback.defaultColor),
  }
}

function getLayerSortOrderValue(layer: LayerConfig, fallback = 0): number {
  if (typeof layer.sortOrder === 'number' && Number.isFinite(layer.sortOrder)) {
    return layer.sortOrder
  }
  return fallback
}

function getSectionSortOrderValue(layer: LayerConfig, fallback = 0): number {
  if (
    typeof layer.sectionSortOrder === 'number' &&
    Number.isFinite(layer.sectionSortOrder)
  ) {
    return layer.sectionSortOrder
  }
  return fallback
}

function toCoordinatesFromImported(
  item: ImportedGeometryFeature,
): unknown | null {
  if (item.geometry === 'point') {
    return item.position ?? null
  }

  if (item.geometry === 'line') {
    return item.positions && item.positions.length >= 2 ? item.positions : null
  }

  return item.positions && item.positions.length >= 3 ? item.positions : null
}

function sanitizeFileBasename(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function isInputLikeElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

function markerEventToPosition(event: LeafletEvent): LatLngTuple {
  const marker = event.target as LeafletMarker
  const latLng = marker.getLatLng()
  return [latLng.lat, latLng.lng]
}

function normalizeBounds(
  first: LatLngTuple,
  second: LatLngTuple,
): [LatLngTuple, LatLngTuple] {
  const south = Math.min(first[0], second[0])
  const north = Math.max(first[0], second[0])
  const west = Math.min(first[1], second[1])
  const east = Math.max(first[1], second[1])
  return [
    [south, west],
    [north, east],
  ]
}

function isPointInsideBounds(
  point: LatLngTuple,
  bounds: [LatLngTuple, LatLngTuple],
): boolean {
  return (
    point[0] >= bounds[0][0] &&
    point[0] <= bounds[1][0] &&
    point[1] >= bounds[0][1] &&
    point[1] <= bounds[1][1]
  )
}

function featureIntersectsBounds(
  feature: GeometryFeature,
  bounds: [LatLngTuple, LatLngTuple],
): boolean {
  const points = getFeaturePoints(feature)
  return points.some((point) => isPointInsideBounds(point, bounds))
}

function midpoint(a: LatLngTuple, b: LatLngTuple): LatLngTuple {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function clonePointList(points: LatLngTuple[]): LatLngTuple[] {
  return points.map((point) => [point[0], point[1]])
}

function projectPointToMeters(point: LatLngTuple, latitudeRef: number) {
  const latitudeFactor = 110_540
  const longitudeFactor = 111_320 * Math.cos((latitudeRef * Math.PI) / 180)
  return {
    x: point[1] * longitudeFactor,
    y: point[0] * latitudeFactor,
  }
}

function unprojectPointFromMeters(
  projected: { x: number; y: number },
  latitudeRef: number,
): LatLngTuple {
  const latitudeFactor = 110_540
  const longitudeFactor = 111_320 * Math.cos((latitudeRef * Math.PI) / 180)
  return [projected.y / latitudeFactor, projected.x / longitudeFactor]
}

function distanceMeters(a: LatLngTuple, b: LatLngTuple): number {
  const refLat = (a[0] + b[0]) / 2
  const pa = projectPointToMeters(a, refLat)
  const pb = projectPointToMeters(b, refLat)
  const dx = pa.x - pb.x
  const dy = pa.y - pb.y
  return Math.hypot(dx, dy)
}

function closestPointOnSegment(
  point: LatLngTuple,
  segment: SnapSegment,
): { point: LatLngTuple; distanceMeters: number } {
  const latitudeRef = (point[0] + segment.start[0] + segment.end[0]) / 3
  const p = projectPointToMeters(point, latitudeRef)
  const a = projectPointToMeters(segment.start, latitudeRef)
  const b = projectPointToMeters(segment.end, latitudeRef)
  const abX = b.x - a.x
  const abY = b.y - a.y
  const abLengthSquared = abX * abX + abY * abY
  if (abLengthSquared === 0) {
    return {
      point: segment.start,
      distanceMeters: Math.hypot(p.x - a.x, p.y - a.y),
    }
  }

  const t = ((p.x - a.x) * abX + (p.y - a.y) * abY) / abLengthSquared
  const clamped = Math.max(0, Math.min(1, t))
  const projected = {
    x: a.x + clamped * abX,
    y: a.y + clamped * abY,
  }
  return {
    point: unprojectPointFromMeters(projected, latitudeRef),
    distanceMeters: Math.hypot(p.x - projected.x, p.y - projected.y),
  }
}

function computePolylineLength(points: LatLngTuple[]): number {
  if (points.length < 2) {
    return 0
  }
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1], points[index])
  }
  return total
}

function computePolygonArea(points: LatLngTuple[]): number {
  if (points.length < 3) {
    return 0
  }

  const latitudeRef =
    points.reduce((sum, point) => sum + point[0], 0) / points.length
  const projected = points.map((point) => projectPointToMeters(point, latitudeRef))
  let twiceArea = 0
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index]
    const next = projected[(index + 1) % projected.length]
    twiceArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(twiceArea) / 2
}

function formatDistance(valueMeters: number): string {
  if (!Number.isFinite(valueMeters) || valueMeters <= 0) {
    return '0 m'
  }
  if (valueMeters >= 1000) {
    return `${(valueMeters / 1000).toFixed(2)} km`
  }
  return `${Math.round(valueMeters)} m`
}

function formatSurface(valueSquareMeters: number): string {
  if (!Number.isFinite(valueSquareMeters) || valueSquareMeters <= 0) {
    return '0 m²'
  }
  if (valueSquareMeters >= 1_000_000) {
    return `${(valueSquareMeters / 1_000_000).toFixed(2)} km²`
  }
  if (valueSquareMeters >= 10_000) {
    return `${(valueSquareMeters / 10_000).toFixed(2)} ha`
  }
  return `${Math.round(valueSquareMeters)} m²`
}

function offsetFeatureCoordinates(
  geometry: DrawGeometry,
  points: LatLngTuple[],
  offset: LatLngTuple,
): unknown {
  if (geometry === 'point') {
    const point = points[0]
    return [point[0] + offset[0], point[1] + offset[1]]
  }
  return points.map((point) => [point[0] + offset[0], point[1] + offset[1]])
}

function getGridStepForZoom(zoom: number): number {
  if (zoom <= 10) {
    return 0.05
  }
  if (zoom <= 12) {
    return 0.02
  }
  if (zoom <= 14) {
    return 0.01
  }
  if (zoom <= 16) {
    return 0.005
  }
  return 0.002
}

function normalizeSearchTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function computeBoundsFromPoints(
  points: LatLngTuple[],
): [LatLngTuple, LatLngTuple] | null {
  if (points.length === 0) {
    return null
  }
  let south = points[0][0]
  let north = points[0][0]
  let west = points[0][1]
  let east = points[0][1]
  for (let index = 1; index < points.length; index += 1) {
    const [lat, lng] = points[index]
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  return [
    [south, west],
    [north, east],
  ]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function computeFeatureCenter(feature: GeometryFeature): LatLngTuple {
  if (feature.geometry === 'point') {
    return feature.position
  }
  const points = feature.positions
  if (points.length === 0) {
    return MARSEILLE_CENTER
  }
  const { lat, lng } = points.reduce(
    (accumulator, point) => ({
      lat: accumulator.lat + point[0],
      lng: accumulator.lng + point[1],
    }),
    { lat: 0, lng: 0 },
  )
  return [lat / points.length, lng / points.length]
}

function computeBearingDegrees(from: LatLngTuple, to: LatLngTuple): number {
  const lat1 = (from[0] * Math.PI) / 180
  const lat2 = (to[0] * Math.PI) / 180
  const dLng = ((to[1] - from[1]) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const bearing = (Math.atan2(y, x) * 180) / Math.PI
  return (bearing + 360) % 360
}

function buildLineArrowAnchors(
  points: LatLngTuple[],
  direction: LineDirectionMode,
): Array<{ id: string; position: LatLngTuple; angle: number }> {
  if (points.length < 2 || direction === 'none') {
    return []
  }
  const anchors: Array<{ id: string; position: LatLngTuple; angle: number }> = []
  const last = points.length - 1
  anchors.push({
    id: 'forward',
    position: points[last],
    angle: computeBearingDegrees(points[last - 1], points[last]),
  })
  if (direction === 'both') {
    anchors.push({
      id: 'backward',
      position: points[0],
      angle: computeBearingDegrees(points[1], points[0]),
    })
  }
  return anchors
}

function makePointIcon(
  iconId: PointIconId,
  color: string,
  selected: boolean,
  radius: number,
): DivIcon {
  const glyph = POINT_ICON_GLYPHS[iconId]
  const size = clamp(Math.round(radius * 2.7), 16, 46)
  const border = selected ? '#0f172a' : color
  const bg = iconId === 'dot' ? color : '#ffffff'
  const textColor = iconId === 'dot' ? '#ffffff' : color
  return new DivIcon({
    className: 'feature-point-icon-wrapper',
    html: `<span class="feature-point-icon${selected ? ' selected' : ''}" style="--icon-size:${size}px;--icon-border:${border};--icon-bg:${bg};--icon-color:${textColor};">${glyph}</span>`,
    iconSize: [size, size],
    iconAnchor: [Math.round(size / 2), Math.round(size / 2)],
  })
}

function makeLineArrowIcon(color: string, angle: number): DivIcon {
  return new DivIcon({
    className: 'feature-line-arrow-wrapper',
    html: `<span class="feature-line-arrow" style="--arrow-color:${color};--arrow-angle:${angle.toFixed(1)}deg;">▲</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function App() {
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('osm')
  const [dataSource, setDataSource] = useState(layerMeta.mode)
  const [sourceTimestamp, setSourceTimestamp] = useState(layerMeta.generatedAt)
  const [dataNotice, setDataNotice] = useState<string | null>(null)
  const [isSyncingSupabase, setIsSyncingSupabase] = useState(hasSupabase)
  const [layers, setLayers] = useState<LayerConfig[]>(fallbackLayers)
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(fallbackLayers.map((layer) => [layer.id, false])),
  )
  const [statusFilter, setStatusFilter] = useState<StatusId | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const [geometryFilter, setGeometryFilter] = useState<DrawGeometry | 'all'>('all')
  const [featureSearchQuery, setFeatureSearchQuery] = useState('')
  const [featureSortMode, setFeatureSortMode] =
    useState<VisibleFeatureSortMode>('alpha')
  const [isLabelOverlayEnabled, setIsLabelOverlayEnabled] = useState(false)
  const [isLabelCollisionEnabled, setIsLabelCollisionEnabled] = useState(true)
  const [labelMinZoom, setLabelMinZoom] = useState(14)
  const [collapsedLayerFolders, setCollapsedLayerFolders] = useState<
    Record<string, boolean>
  >({})
  const [lockedLayers, setLockedLayers] = useState<Record<string, boolean>>({})
  const [layerZoomVisibility, setLayerZoomVisibility] = useState<
    Record<string, { minZoom: number; maxZoom: number }>
  >({})
  const [layerOpacityByKey, setLayerOpacityByKey] = useState<Record<string, number>>({})
  const [mapSearchQuery, setMapSearchQuery] = useState('')
  const [mapSearchResults, setMapSearchResults] = useState<MapSearchCandidate[]>([])
  const [isSearchingMap, setIsSearchingMap] = useState(false)
  const [mapSearchNotice, setMapSearchNotice] = useState<string | null>(null)
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null)
  const [searchFocusPoint, setSearchFocusPoint] = useState<LatLngTuple | null>(null)
  const [bookmarkDraftName, setBookmarkDraftName] = useState('')
  const [viewBookmarks, setViewBookmarks] = useState<ViewBookmark[]>([])
  const [layerPanelSearchQuery, setLayerPanelSearchQuery] = useState('')
  const [layerPresetDraftName, setLayerPresetDraftName] = useState('')
  const [layerVisibilityPresets, setLayerVisibilityPresets] = useState<
    LayerVisibilityPreset[]
  >([])

  const [sidebarTab, setSidebarTab] = useState<SidebarTabId>('calques')
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false)
  const [showDebugInfo, setShowDebugInfo] = useState(false)
  const [isAuthReady, setIsAuthReady] = useState(!hasSupabase)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminEmail, setAdminEmail] = useState('philippe.maraval@protonmail.com')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminUserEmail, setAdminUserEmail] = useState<string | null>(null)

  const [adminMode, setAdminMode] = useState<AdminMode>('view')
  const [adminNotice, setAdminNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([])
  const [bulkStatus, setBulkStatus] = useState<StatusId | ''>('')
  const [bulkColor, setBulkColor] = useState('')
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkLayerLabel, setBulkLayerLabel] = useState('')
  const [bulkLayerId, setBulkLayerId] = useState('')
  const [isZoneSelectionMode, setIsZoneSelectionMode] = useState(false)
  const [isZoneSelectionDragging, setIsZoneSelectionDragging] = useState(false)
  const [zoneSelectionStart, setZoneSelectionStart] = useState<LatLngTuple | null>(
    null,
  )
  const [zoneSelectionCurrent, setZoneSelectionCurrent] =
    useState<LatLngTuple | null>(null)
  const [featureContextMenu, setFeatureContextMenu] =
    useState<FeatureContextMenuState | null>(null)
  const [isMeasureMode, setIsMeasureMode] = useState(false)
  const [measureGeometry, setMeasureGeometry] = useState<MeasureGeometry>('line')
  const [measurePoints, setMeasurePoints] = useState<LatLngTuple[]>([])
  const [isSnappingEnabled, setIsSnappingEnabled] = useState(true)
  const [snapToleranceMeters, setSnapToleranceMeters] = useState(20)
  const [snapPreview, setSnapPreview] = useState<SnapPreviewState | null>(null)
  const [isGridEnabled, setIsGridEnabled] = useState(false)
  const [isNorthArrowVisible, setIsNorthArrowVisible] = useState(true)
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false)
  const [isPresentationMode, setIsPresentationMode] = useState(false)
  const [showWelcomeHint, setShowWelcomeHint] = useState(true)
  const [isMapToolbarCollapsed, setIsMapToolbarCollapsed] = useState(false)
  const [mapViewport, setMapViewport] = useState<{
    center: LatLngTuple
    zoom: number
    bounds: [LatLngTuple, LatLngTuple]
  } | null>(null)
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null)
  const [cursorPosition, setCursorPosition] = useState<LatLngTuple | null>(null)
  const [localHistoryPast, setLocalHistoryPast] = useState<LocalHistoryEntry[]>([])
  const [localHistoryFuture, setLocalHistoryFuture] = useState<LocalHistoryEntry[]>([])
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() =>
    buildDefaultDraft(fallbackLayers),
  )
  const [createTemplateId, setCreateTemplateId] = useState('')
  const [createPoints, setCreatePoints] = useState<LatLngTuple[]>([])
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editTemplateId, setEditTemplateId] = useState('')
  const [editPoints, setEditPoints] = useState<LatLngTuple[]>([])
  const [isRedrawingEditGeometry, setIsRedrawingEditGeometry] = useState(false)
  const [importDraft, setImportDraft] = useState<ImportDraft>(() =>
    buildDefaultImportDraft(fallbackLayers),
  )
  const [importFile, setImportFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importPreviewCount, setImportPreviewCount] = useState<number | null>(null)
  const [trashItems, setTrashItems] = useState<TrashFeature[]>([])
  const [isTrashLoading, setIsTrashLoading] = useState(false)
  const [versionItems, setVersionItems] = useState<FeatureVersion[]>([])
  const [isVersionsLoading, setIsVersionsLoading] = useState(false)
  const hasHydratedUiStateRef = useRef(false)
  const persistedMapViewRef = useRef<{ center: LatLngTuple; zoom: number } | null>(
    null,
  )
  const pendingMapViewRestoreRef = useRef<{
    center: LatLngTuple
    zoom: number
  } | null>(null)
  const mapSearchRequestRef = useRef(0)

  const isDrawingOnMap =
    isAdmin &&
    (adminMode === 'create' || (adminMode === 'edit' && isRedrawingEditGeometry))
  const isMapInteractionCaptureEnabled =
    isDrawingOnMap || (isAdmin && (isZoneSelectionMode || isMeasureMode))
  const isDirectGeometryEditing =
    isAdmin && adminMode === 'edit' && !isRedrawingEditGeometry

  const pointHandleIcon = useMemo(
    () =>
      new DivIcon({
        className: 'point-handle-marker',
        html: '<span></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    [],
  )

  const vertexHandleIcon = useMemo(
    () =>
      new DivIcon({
        className: 'vertex-handle-marker',
        html: '<span></span>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    [],
  )

  const midpointHandleIcon = useMemo(
    () =>
      new DivIcon({
        className: 'midpoint-handle-marker',
        html: '<span>+</span>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    [],
  )

  const supabaseEnvDiagnostic = useMemo(() => {
    const urlValue = import.meta.env.VITE_SUPABASE_URL as string | undefined
    const keyValue = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    const urlProjectRef = extractProjectRefFromUrl(urlValue)
    const keyMeta = decodeSupabaseAnonKey(keyValue)
    const isMatch =
      urlProjectRef && keyMeta.projectRef
        ? urlProjectRef === keyMeta.projectRef
        : null

    return {
      urlProjectRef,
      keyProjectRef: keyMeta.projectRef,
      keyRole: keyMeta.role,
      keyExpIso: keyMeta.expIso,
      keyError: keyMeta.error,
      keyFingerprint: fingerprintToken(keyValue),
      isMatch,
    }
  }, [])

  const applyLoadedLayers = useCallback(
    (nextLayers: LayerConfig[], forceActiveLayerId?: string) => {
      setLayers(nextLayers)
      setActiveLayers((current) => {
        const merged = Object.fromEntries(
          nextLayers.map((layer) => [layer.id, current[layer.id] ?? false]),
        )
        if (forceActiveLayerId && merged[forceActiveLayerId] !== undefined) {
          merged[forceActiveLayerId] = true
        }
        return merged
      })
    },
    [],
  )

  const syncSupabaseLayers = useCallback(
    async (forceActiveLayerId?: string) => {
      if (!hasSupabase) {
        return
      }
      setIsSyncingSupabase(true)
      const result = await fetchLayersFromSupabase()

      if (result.ok && result.layers.length > 0) {
        applyLoadedLayers(result.layers, forceActiveLayerId)
        setDataSource('supabase')
        setSourceTimestamp(new Date().toISOString())
        setDataNotice(null)
      } else if (result.ok) {
        setDataSource(`${layerMeta.mode} (fallback)`)
        setDataNotice('Supabase est configuré mais la table map_features est vide.')
      } else {
        setDataSource(`${layerMeta.mode} (fallback)`)
        setDataNotice(`Erreur Supabase: ${result.error}`)
      }

      setIsSyncingSupabase(false)
    },
    [applyLoadedLayers],
  )

  useEffect(() => {
    if (!hasSupabase || !supabase) {
      return
    }

    const sb = supabase
    let isMounted = true
    const hydrateSession = async () => {
      const { data, error } = await sb.auth.getSession()
      if (!isMounted) {
        return
      }
      if (error) {
        setAdminNotice(`Erreur session: ${error.message}`)
      }
      setIsAdmin(Boolean(data.session?.user))
      setAdminUserEmail(data.session?.user?.email ?? null)
      setIsAuthReady(true)
    }

    void hydrateSession()

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      setIsAdmin(Boolean(session?.user))
      setAdminUserEmail(session?.user?.email ?? null)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!hasSupabase) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void syncSupabaseLayers()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [syncSupabaseLayers])

  useEffect(() => {
    if (!isAdmin) {
      setIsShortcutHelpOpen(false)
    }
  }, [isAdmin])

  useEffect(() => {
    if (isPresentationMode) {
      setIsShortcutHelpOpen(false)
    }
  }, [isPresentationMode])

  useEffect(() => {
    if (isMapToolbarCollapsed) {
      setIsShortcutHelpOpen(false)
    }
  }, [isMapToolbarCollapsed])

  useEffect(() => {
    if (!isPresentationMode) {
      return
    }
    setAdminMode('view')
    setIsMeasureMode(false)
    setIsZoneSelectionMode(false)
    setIsZoneSelectionDragging(false)
    setZoneSelectionStart(null)
    setZoneSelectionCurrent(null)
    setFeatureContextMenu(null)
    setSnapPreview(null)
  }, [isPresentationMode])

  useEffect(() => {
    if (hasHydratedUiStateRef.current || typeof window === 'undefined') {
      return
    }

    try {
      const raw = window.localStorage.getItem(UI_STATE_STORAGE_KEY)
      if (!raw) {
        return
      }

      const parsed = JSON.parse(raw) as unknown
      if (!isObjectRecord(parsed) || parsed.version !== 1) {
        return
      }

      const persisted = parsed as unknown as PersistedUiStateV1

      setBaseMapId((current) => parseBaseMapIdValue(persisted.baseMapId, current))

      const persistedActiveLayers = parseBooleanRecord(persisted.activeLayers)
      if (persistedActiveLayers) {
        setActiveLayers((current) => ({
          ...current,
          ...persistedActiveLayers,
        }))
      }
      const persistedLockedLayers = parseBooleanRecord(persisted.lockedLayers)
      if (persistedLockedLayers) {
        setLockedLayers(persistedLockedLayers)
      }
      const persistedCollapsedFolders = parseBooleanRecord(
        persisted.collapsedLayerFolders,
      )
      if (persistedCollapsedFolders) {
        setCollapsedLayerFolders(persistedCollapsedFolders)
      }
      if (persisted.layerZoomVisibility !== undefined) {
        setLayerZoomVisibility(
          parseLayerZoomVisibility(persisted.layerZoomVisibility),
        )
      }
      if (persisted.layerOpacityByKey !== undefined) {
        setLayerOpacityByKey(parseLayerOpacityByKey(persisted.layerOpacityByKey))
      }
      if (persisted.viewBookmarks !== undefined) {
        setViewBookmarks(parseViewBookmarks(persisted.viewBookmarks))
      }
      if (typeof persisted.layerPanelSearchQuery === 'string') {
        setLayerPanelSearchQuery(persisted.layerPanelSearchQuery)
      }
      if (typeof persisted.layerPresetDraftName === 'string') {
        setLayerPresetDraftName(persisted.layerPresetDraftName)
      }
      if (persisted.layerVisibilityPresets !== undefined) {
        setLayerVisibilityPresets(
          parseLayerVisibilityPresets(persisted.layerVisibilityPresets),
        )
      }

      const persistedStatusFilter = persisted.statusFilter
      if (
        persistedStatusFilter === 'all' ||
        persistedStatusFilter === 'existant' ||
        persistedStatusFilter === 'en cours' ||
        persistedStatusFilter === 'propose'
      ) {
        setStatusFilter(persistedStatusFilter)
      }

      if (
        persisted.geometryFilter === 'all' ||
        persisted.geometryFilter === 'point' ||
        persisted.geometryFilter === 'line' ||
        persisted.geometryFilter === 'polygon'
      ) {
        setGeometryFilter(persisted.geometryFilter)
      }

      if (typeof persisted.categoryFilter === 'string') {
        const normalizedCategory = persisted.categoryFilter.trim()
        setCategoryFilter(
          normalizedCategory.length > 0
            ? (normalizedCategory as string | 'all')
            : 'all',
        )
      }

      if (typeof persisted.featureSearchQuery === 'string') {
        setFeatureSearchQuery(persisted.featureSearchQuery)
      }

      setFeatureSortMode((current) =>
        parseFeatureSortModeValue(persisted.featureSortMode, current),
      )

      const persistedLabelOverlay = parseBooleanValue(persisted.isLabelOverlayEnabled)
      if (persistedLabelOverlay !== null) {
        setIsLabelOverlayEnabled(persistedLabelOverlay)
      }
      const persistedLabelCollision = parseBooleanValue(
        persisted.isLabelCollisionEnabled,
      )
      if (persistedLabelCollision !== null) {
        setIsLabelCollisionEnabled(persistedLabelCollision)
      }

      const persistedLabelMinZoom = parseFiniteNumber(persisted.labelMinZoom)
      if (persistedLabelMinZoom !== null) {
        setLabelMinZoom(Math.round(clamp(persistedLabelMinZoom, 10, 18)))
      }

      const persistedAdminPanelOpen = parseBooleanValue(persisted.isAdminPanelOpen)
      if (persistedAdminPanelOpen !== null) {
        setIsAdminPanelOpen(persistedAdminPanelOpen)
      }

      const persistedShowDebugInfo = parseBooleanValue(persisted.showDebugInfo)
      if (persistedShowDebugInfo !== null) {
        setShowDebugInfo(persistedShowDebugInfo)
      }

      if (typeof persisted.adminEmail === 'string' && persisted.adminEmail.trim()) {
        setAdminEmail(persisted.adminEmail.trim())
      }

      setAdminMode((current) => parseAdminModeValue(persisted.adminMode, current))

      if (persisted.selectedFeatureId === null) {
        setSelectedFeatureId(null)
      } else if (typeof persisted.selectedFeatureId === 'string') {
        const normalizedSelected = persisted.selectedFeatureId.trim()
        setSelectedFeatureId(normalizedSelected.length > 0 ? normalizedSelected : null)
      }

      if (persisted.selectedFeatureIds !== undefined) {
        setSelectedFeatureIds(parseStringArray(persisted.selectedFeatureIds))
      }

      if (persisted.createDraft !== undefined) {
        setCreateDraft((current) =>
          hydrateCreateDraftFromPartial(persisted.createDraft, current),
        )
      }
      if (persisted.createPoints !== undefined) {
        setCreatePoints(parseLatLngTupleArray(persisted.createPoints))
      }

      if (persisted.editDraft !== undefined) {
        setEditDraft(hydrateEditDraftFromPartial(persisted.editDraft))
      }
      if (persisted.editPoints !== undefined) {
        setEditPoints(parseLatLngTupleArray(persisted.editPoints))
      }

      if (persisted.importDraft !== undefined) {
        setImportDraft((current) =>
          hydrateImportDraftFromPartial(persisted.importDraft, current),
        )
      }

      const persistedRedraw = parseBooleanValue(persisted.isRedrawingEditGeometry)
      if (persistedRedraw !== null) {
        setIsRedrawingEditGeometry(persistedRedraw)
      }

      const persistedMeasureMode = parseBooleanValue(persisted.isMeasureMode)
      if (persistedMeasureMode !== null) {
        setIsMeasureMode(persistedMeasureMode)
      }

      setMeasureGeometry((current) =>
        parseMeasureGeometryValue(persisted.measureGeometry, current),
      )

      if (persisted.measurePoints !== undefined) {
        setMeasurePoints(parseLatLngTupleArray(persisted.measurePoints))
      }

      const persistedSnapping = parseBooleanValue(persisted.isSnappingEnabled)
      if (persistedSnapping !== null) {
        setIsSnappingEnabled(persistedSnapping)
      }

      const persistedSnapTolerance = parseFiniteNumber(persisted.snapToleranceMeters)
      if (persistedSnapTolerance !== null) {
        setSnapToleranceMeters(Math.round(clamp(persistedSnapTolerance, 5, 500)))
      }

      const persistedGrid = parseBooleanValue(persisted.isGridEnabled)
      if (persistedGrid !== null) {
        setIsGridEnabled(persistedGrid)
      }
      const persistedNorthArrow = parseBooleanValue(persisted.isNorthArrowVisible)
      if (persistedNorthArrow !== null) {
        setIsNorthArrowVisible(persistedNorthArrow)
      }
      const persistedPresentationMode = parseBooleanValue(persisted.isPresentationMode)
      if (persistedPresentationMode !== null) {
        setIsPresentationMode(persistedPresentationMode)
      }
      const persistedShowWelcomeHint = parseBooleanValue(persisted.showWelcomeHint)
      if (persistedShowWelcomeHint !== null) {
        setShowWelcomeHint(persistedShowWelcomeHint)
      }
      const persistedMapToolbarCollapsed = parseBooleanValue(
        persisted.isMapToolbarCollapsed,
      )
      if (persistedMapToolbarCollapsed !== null) {
        setIsMapToolbarCollapsed(persistedMapToolbarCollapsed)
      }

      if (persisted.localHistoryPast !== undefined) {
        setLocalHistoryPast(parseLocalHistoryEntries(persisted.localHistoryPast))
      }
      if (persisted.localHistoryFuture !== undefined) {
        setLocalHistoryFuture(parseLocalHistoryEntries(persisted.localHistoryFuture))
      }

      const hasMapView =
        Object.prototype.hasOwnProperty.call(persisted, 'mapView') ||
        persisted.mapView === null
      if (hasMapView) {
        const nextMapView = parsePersistedMapView(persisted.mapView)
        persistedMapViewRef.current = nextMapView
        pendingMapViewRestoreRef.current = nextMapView
      }

      const sharedState = parseSharedUrlState(window.location.search)
      if (sharedState) {
        if (sharedState.baseMapId) {
          setBaseMapId(sharedState.baseMapId)
        }
        if (sharedState.statusFilter) {
          setStatusFilter(sharedState.statusFilter)
        }
        if (sharedState.categoryFilter !== undefined) {
          setCategoryFilter(sharedState.categoryFilter)
        }
        if (sharedState.geometryFilter) {
          setGeometryFilter(sharedState.geometryFilter)
        }
        if (sharedState.activeLayerIds !== undefined) {
          const activeIdSet = new Set(sharedState.activeLayerIds)
          setActiveLayers((current) =>
            Object.fromEntries(
              Object.keys(current).map((layerId) => [layerId, activeIdSet.has(layerId)]),
            ),
          )
        }
        if (Object.prototype.hasOwnProperty.call(sharedState, 'selectedFeatureId')) {
          setSelectedFeatureId(sharedState.selectedFeatureId ?? null)
          if (sharedState.selectedFeatureId) {
            setSelectedFeatureIds([sharedState.selectedFeatureId])
          }
        }
        if (sharedState.center && sharedState.zoom !== undefined) {
          const nextMapView = {
            center: sharedState.center,
            zoom: sharedState.zoom,
          }
          persistedMapViewRef.current = nextMapView
          pendingMapViewRestoreRef.current = nextMapView
        }
      }
    } catch {
      window.localStorage.removeItem(UI_STATE_STORAGE_KEY)
    } finally {
      hasHydratedUiStateRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!mapInstance) {
      return
    }
    const mapView = pendingMapViewRestoreRef.current
    if (!mapView) {
      return
    }
    mapInstance.setView(mapView.center, mapView.zoom, { animate: false })
    pendingMapViewRestoreRef.current = null
  }, [mapInstance])

  useEffect(() => {
    if (!hasHydratedUiStateRef.current || typeof window === 'undefined') {
      return
    }

    const mapView =
      mapViewport !== null
        ? {
            center: [mapViewport.center[0], mapViewport.center[1]] as LatLngTuple,
            zoom: mapViewport.zoom,
          }
        : persistedMapViewRef.current

    if (mapView) {
      persistedMapViewRef.current = mapView
    }

    const payload: PersistedUiStateV1 = {
      version: 1,
      updatedAt: new Date().toISOString(),
      baseMapId,
      activeLayers,
      statusFilter,
      categoryFilter,
      geometryFilter,
      featureSearchQuery,
      featureSortMode,
      isLabelOverlayEnabled,
      isLabelCollisionEnabled,
      labelMinZoom,
      isAdminPanelOpen,
      showDebugInfo,
      adminEmail,
      adminMode,
      selectedFeatureId,
      selectedFeatureIds,
      createDraft,
      createPoints,
      editDraft,
      editPoints,
      importDraft,
      isRedrawingEditGeometry,
      isMeasureMode,
      measureGeometry,
      measurePoints,
      isSnappingEnabled,
      snapToleranceMeters,
      isGridEnabled,
      localHistoryPast,
      localHistoryFuture,
      lockedLayers,
      collapsedLayerFolders,
      layerZoomVisibility,
      layerOpacityByKey,
      layerPanelSearchQuery,
      layerPresetDraftName,
      layerVisibilityPresets,
      viewBookmarks,
      isNorthArrowVisible,
      isPresentationMode,
      showWelcomeHint,
      isMapToolbarCollapsed,
      mapView: mapView ?? null,
    }

    try {
      window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Ignore storage quota/private mode errors.
    }
  }, [
    activeLayers,
    adminEmail,
    adminMode,
    baseMapId,
    collapsedLayerFolders,
    categoryFilter,
    createDraft,
    createPoints,
    editDraft,
    editPoints,
    featureSearchQuery,
    featureSortMode,
    geometryFilter,
    importDraft,
    isAdminPanelOpen,
    isGridEnabled,
    isLabelOverlayEnabled,
    isLabelCollisionEnabled,
    isMeasureMode,
    isMapToolbarCollapsed,
    isNorthArrowVisible,
    isPresentationMode,
    isRedrawingEditGeometry,
    isSnappingEnabled,
    labelMinZoom,
    layerPanelSearchQuery,
    layerPresetDraftName,
    layerOpacityByKey,
    layerVisibilityPresets,
    layerZoomVisibility,
    lockedLayers,
    localHistoryFuture,
    localHistoryPast,
    mapViewport,
    measureGeometry,
    measurePoints,
    selectedFeatureId,
    selectedFeatureIds,
    showDebugInfo,
    showWelcomeHint,
    snapToleranceMeters,
    statusFilter,
    viewBookmarks,
  ])

  const sectionSortOrderByCategory = useMemo(() => {
    const orders = new Map<string, number>()
    for (const [index, layer] of layers.entries()) {
      const nextOrder = getSectionSortOrderValue(layer, index)
      const currentOrder = orders.get(layer.category)
      if (currentOrder === undefined || nextOrder < currentOrder) {
        orders.set(layer.category, nextOrder)
      }
    }
    return orders
  }, [layers])

  const categories = useMemo(
    () =>
      Array.from(sectionSortOrderByCategory.entries())
        .sort((left, right) => {
          if (left[1] !== right[1]) {
            return left[1] - right[1]
          }
          return left[0].localeCompare(right[0], 'fr')
        })
        .map(([category]) => category),
    [sectionSortOrderByCategory],
  )

  const visibleLayers = useMemo(
    () =>
      layers.filter((layer) => {
        if (!activeLayers[layer.id]) {
          return false
        }
        const zoomRule =
          layerZoomVisibility[toLayerLockKey(layer.category, layer.id)] ?? null
        const activeZoom = mapViewport?.zoom ?? 12
        if (zoomRule) {
          if (activeZoom < zoomRule.minZoom || activeZoom > zoomRule.maxZoom) {
            return false
          }
        }
        if (categoryFilter === 'all') {
          return true
        }
        return layer.category === categoryFilter
      }),
    [layers, activeLayers, categoryFilter, layerZoomVisibility, mapViewport],
  )

  const isFeatureVisibleByFilters = useCallback(
    (feature: GeometryFeature) => {
      const matchesStatus =
        statusFilter === 'all' ? true : feature.status === statusFilter
      const matchesGeometry =
        geometryFilter === 'all' ? true : feature.geometry === geometryFilter
      return matchesStatus && matchesGeometry
    },
    [geometryFilter, statusFilter],
  )

  const visibleFeaturesBase = useMemo<VisibleFeature[]>(
    () =>
      visibleLayers
        .flatMap((layer) =>
          layer.features
            .filter((feature) => isFeatureVisibleByFilters(feature))
            .map((feature) => ({
              id: feature.id,
              name: feature.name,
              status: feature.status,
              geometry: feature.geometry,
              category: layer.category,
              layerLabel: layer.label,
              color: feature.color,
            })),
        ),
    [isFeatureVisibleByFilters, visibleLayers],
  )

  const visibleFeatures = useMemo<VisibleFeature[]>(() => {
    const query = normalizeSearchTerm(featureSearchQuery)
    const filtered =
      query.length === 0
        ? visibleFeaturesBase
        : visibleFeaturesBase.filter((feature) => {
            const haystack = normalizeSearchTerm(
              `${feature.name} ${feature.layerLabel} ${feature.category}`,
            )
            return haystack.includes(query)
          })

    return [...filtered].sort((left, right) => {
      if (featureSortMode === 'status') {
        const byStatus = STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status]
        if (byStatus !== 0) {
          return byStatus
        }
        return left.name.localeCompare(right.name, 'fr')
      }
      if (featureSortMode === 'layer') {
        const byLayer = left.layerLabel.localeCompare(right.layerLabel, 'fr')
        if (byLayer !== 0) {
          return byLayer
        }
        return left.name.localeCompare(right.name, 'fr')
      }
      if (featureSortMode === 'category') {
        const byCategory = left.category.localeCompare(right.category, 'fr')
        if (byCategory !== 0) {
          return byCategory
        }
        const byLayer = left.layerLabel.localeCompare(right.layerLabel, 'fr')
        if (byLayer !== 0) {
          return byLayer
        }
        return left.name.localeCompare(right.name, 'fr')
      }
      return left.name.localeCompare(right.name, 'fr')
    })
  }, [featureSearchQuery, featureSortMode, visibleFeaturesBase])

  const mapVisibleFeatureEntries = useMemo(
    () =>
      visibleLayers.flatMap((layer) =>
        layer.features
          .filter((feature) => isFeatureVisibleByFilters(feature))
          .map((feature) => ({
            feature,
            category: layer.category,
            layerId: layer.id,
            layerLabel: layer.label,
          })),
      ),
    [isFeatureVisibleByFilters, visibleLayers],
  )

  const visibleExportEntries = useMemo<FeatureEnvelope[]>(
    () => mapVisibleFeatureEntries,
    [mapVisibleFeatureEntries],
  )

  const visibleStatuses = useMemo(
    () =>
      Array.from(new Set(visibleFeaturesBase.map((feature) => feature.status))).sort(
        (a, b) => STATUS_SORT_ORDER[a] - STATUS_SORT_ORDER[b],
      ),
    [visibleFeaturesBase],
  )

  const statusQuickCounts = useMemo(() => {
    const counts: Record<StatusId | 'all', number> = {
      all: 0,
      existant: 0,
      'en cours': 0,
      propose: 0,
    }
    for (const layer of visibleLayers) {
      for (const feature of layer.features) {
        if (geometryFilter !== 'all' && feature.geometry !== geometryFilter) {
          continue
        }
        counts.all += 1
        counts[feature.status] += 1
      }
    }
    return counts
  }, [geometryFilter, visibleLayers])

  const layerVisibleCountById = useMemo(() => {
    const counts = new Map<string, number>()
    for (const layer of layers) {
      counts.set(
        layer.id,
        layer.features.filter((feature) => isFeatureVisibleByFilters(feature)).length,
      )
    }
    return counts
  }, [isFeatureVisibleByFilters, layers])

  const normalizedLayerPanelSearchQuery = normalizeSearchTerm(layerPanelSearchQuery)

  const layersByCategory = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          layers: layers
            .filter((layer) => {
              if (layer.category !== category) {
                return false
              }
              if (normalizedLayerPanelSearchQuery.length === 0) {
                return true
              }
              const haystack = normalizeSearchTerm(`${layer.label} ${layer.category}`)
              return haystack.includes(normalizedLayerPanelSearchQuery)
            })
            .sort((left, right) => {
              const bySort =
                getLayerSortOrderValue(left) - getLayerSortOrderValue(right)
              if (bySort !== 0) {
                return bySort
              }
              return left.label.localeCompare(right.label, 'fr')
            }),
        }))
        .filter((block) => block.layers.length > 0),
    [categories, layers, normalizedLayerPanelSearchQuery],
  )

  const styleTemplates = useMemo<StyleTemplateOption[]>(() => {
    const templates: StyleTemplateOption[] = [
      {
        id: 'status-existant',
        label: 'Statut: Existant',
        description: 'Style solide et priorité de label élevée.',
        patch: buildStatusTemplatePatch('existant'),
      },
      {
        id: 'status-en-cours',
        label: 'Statut: En cours',
        description: 'Style intermédiaire, tirets et priorité moyenne.',
        patch: buildStatusTemplatePatch('en cours'),
      },
      {
        id: 'status-propose',
        label: 'Statut: Proposé',
        description: 'Style prospectif discret.',
        patch: buildStatusTemplatePatch('propose'),
      },
    ]

    for (const category of categories) {
      templates.push({
        id: `category-${category}`,
        label: `Catégorie: ${category}`,
        description: `Preset adapté à "${category}".`,
        patch: buildCategoryTemplatePatch(category),
      })
    }

    return templates
  }, [categories])

  useEffect(() => {
    setCollapsedLayerFolders((current) => {
      const next = { ...current }
      let changed = false
      for (const category of categories) {
        if (next[category] === undefined) {
          next[category] = false
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [categories])

  useEffect(() => {
    setLockedLayers((current) => {
      const validKeys = new Set(
        layers.map((layer) => toLayerLockKey(layer.category, layer.id)),
      )
      let changed = false
      const next: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(current)) {
        if (validKeys.has(key)) {
          next[key] = value
        } else {
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [layers])

  useEffect(() => {
    setLayerZoomVisibility((current) => {
      const validKeys = new Set(
        layers.map((layer) => toLayerLockKey(layer.category, layer.id)),
      )
      let changed = false
      const next: Record<string, { minZoom: number; maxZoom: number }> = {}
      for (const [key, value] of Object.entries(current)) {
        if (!validKeys.has(key)) {
          changed = true
          continue
        }
        next[key] = {
          minZoom: clamp(Math.round(value.minZoom), 10, 18),
          maxZoom: clamp(Math.round(value.maxZoom), 10, 18),
        }
      }
      return changed ? next : current
    })
  }, [layers])

  useEffect(() => {
    setLayerOpacityByKey((current) => {
      const validKeys = new Set(
        layers.map((layer) => toLayerLockKey(layer.category, layer.id)),
      )
      let changed = false
      const next: Record<string, number> = {}
      for (const [key, value] of Object.entries(current)) {
        if (!validKeys.has(key)) {
          changed = true
          continue
        }
        next[key] = normalizeLayerOpacity(value)
      }
      return changed ? next : current
    })
  }, [layers])

  const featureById = useMemo(() => {
    const lookup = new Map<string, FeatureRef>()
    for (const layer of layers) {
      for (const feature of layer.features) {
        lookup.set(feature.id, {
          feature,
          category: layer.category,
          layerId: layer.id,
          layerLabel: layer.label,
        })
      }
    }
    return lookup
  }, [layers])

  const isLayerLocked = useCallback(
    (category: string, layerId: string) =>
      Boolean(lockedLayers[toLayerLockKey(category, layerId)]),
    [lockedLayers],
  )

  const getLayerOpacity = useCallback(
    (category: string, layerId: string) =>
      layerOpacityByKey[toLayerLockKey(category, layerId)] ?? 1,
    [layerOpacityByKey],
  )

  const selectedFeature = useMemo(
    () => (selectedFeatureId ? featureById.get(selectedFeatureId) ?? null : null),
    [featureById, selectedFeatureId],
  )
  const selectedFeatureIdSet = useMemo(
    () => new Set(selectedFeatureIds),
    [selectedFeatureIds],
  )
  const zoneSelectionBounds = useMemo(() => {
    if (!zoneSelectionStart || !zoneSelectionCurrent) {
      return null
    }
    return normalizeBounds(zoneSelectionStart, zoneSelectionCurrent)
  }, [zoneSelectionCurrent, zoneSelectionStart])

  const layerSuggestions = useMemo(
    () =>
      layers
        .map((layer, index) => ({
          id: layer.id,
          label: layer.label,
          category: layer.category,
          sectionSortOrder: getSectionSortOrderValue(layer, index),
          sortOrder: getLayerSortOrderValue(layer, index),
        }))
        .sort((a, b) => {
          if (a.sectionSortOrder !== b.sectionSortOrder) {
            return a.sectionSortOrder - b.sectionSortOrder
          }
          const byCategory = a.category.localeCompare(b.category, 'fr')
          if (byCategory !== 0) {
            return byCategory
          }
          if (a.sortOrder !== b.sortOrder) {
            return a.sortOrder - b.sortOrder
          }
          return a.label.localeCompare(b.label, 'fr')
        }),
    [layers],
  )

  const snapCandidates = useMemo(() => {
    const vertices: LatLngTuple[] = []
    const segments: SnapSegment[] = []

    for (const entry of mapVisibleFeatureEntries) {
      const feature = entry.feature
      if (feature.geometry === 'point') {
        vertices.push(feature.position)
        continue
      }

      const points = feature.positions
      for (let index = 0; index < points.length; index += 1) {
        vertices.push(points[index])
        if (index > 0) {
          segments.push({
            start: points[index - 1],
            end: points[index],
          })
        }
      }
      if (feature.geometry === 'polygon' && points.length >= 3) {
        segments.push({
          start: points[points.length - 1],
          end: points[0],
        })
      }
    }

    return { vertices, segments }
  }, [mapVisibleFeatureEntries])

  const findSnapResult = useCallback(
    (rawPosition: LatLngTuple): SnapPreviewState | null => {
      if (!isSnappingEnabled) {
        return null
      }

      let best: SnapPreviewState | null = null
      for (const vertex of snapCandidates.vertices) {
        const dist = distanceMeters(rawPosition, vertex)
        if (dist > snapToleranceMeters) {
          continue
        }
        if (!best || dist < best.distanceMeters) {
          best = {
            position: vertex,
            type: 'vertex',
            distanceMeters: dist,
          }
        }
      }

      for (const segment of snapCandidates.segments) {
        const projected = closestPointOnSegment(rawPosition, segment)
        if (projected.distanceMeters > snapToleranceMeters) {
          continue
        }
        if (!best || projected.distanceMeters < best.distanceMeters) {
          best = {
            position: projected.point,
            type: 'segment',
            distanceMeters: projected.distanceMeters,
          }
        }
      }

      return best
    },
    [isSnappingEnabled, snapCandidates.segments, snapCandidates.vertices, snapToleranceMeters],
  )

  const measureLengthMeters = useMemo(
    () => computePolylineLength(measurePoints),
    [measurePoints],
  )
  const measurePerimeterMeters = useMemo(() => {
    if (measureGeometry !== 'polygon' || measurePoints.length < 3) {
      return 0
    }
    return computePolylineLength([...measurePoints, measurePoints[0]])
  }, [measureGeometry, measurePoints])
  const measureAreaSquareMeters = useMemo(() => {
    if (measureGeometry !== 'polygon') {
      return 0
    }
    return computePolygonArea(measurePoints)
  }, [measureGeometry, measurePoints])

  const gridLines = useMemo(() => {
    if (!isGridEnabled || !mapViewport) {
      return [] as Array<{ id: string; positions: LatLngTuple[] }>
    }

    const step = getGridStepForZoom(mapViewport.zoom)
    const [southWest, northEast] = mapViewport.bounds
    const south = southWest[0]
    const west = southWest[1]
    const north = northEast[0]
    const east = northEast[1]
    const latStart = Math.floor(south / step) * step
    const lngStart = Math.floor(west / step) * step

    const lines: Array<{ id: string; positions: LatLngTuple[] }> = []
    for (let lat = latStart; lat <= north + step; lat += step) {
      lines.push({
        id: `grid-lat-${lat.toFixed(6)}`,
        positions: [
          [lat, west],
          [lat, east],
        ],
      })
    }
    for (let lng = lngStart; lng <= east + step; lng += step) {
      lines.push({
        id: `grid-lng-${lng.toFixed(6)}`,
        positions: [
          [south, lng],
          [north, lng],
        ],
      })
    }
    return lines
  }, [isGridEnabled, mapViewport])

  const captureLocalHistorySnapshot = useCallback(
    (): LocalHistorySnapshot => ({
      createPoints: clonePointList(createPoints),
      editPoints: clonePointList(editPoints),
      measurePoints: clonePointList(measurePoints),
    }),
    [createPoints, editPoints, measurePoints],
  )

  const applyLocalHistorySnapshot = useCallback((snapshot: LocalHistorySnapshot) => {
    setCreatePoints(clonePointList(snapshot.createPoints))
    setEditPoints(clonePointList(snapshot.editPoints))
    setMeasurePoints(clonePointList(snapshot.measurePoints))
  }, [])

  const pushLocalHistory = useCallback(
    (label: string) => {
      const snapshot = captureLocalHistorySnapshot()
      const entry: LocalHistoryEntry = {
        label,
        snapshot,
        createdAt: Date.now(),
      }
      setLocalHistoryPast((current) => {
        const next = [...current, entry]
        return next.length > 60 ? next.slice(next.length - 60) : next
      })
      setLocalHistoryFuture([])
    },
    [captureLocalHistorySnapshot],
  )

  const handleLocalUndo = useCallback(() => {
    const entry = localHistoryPast[localHistoryPast.length - 1]
    if (!entry) {
      setAdminNotice('Aucune action à annuler.')
      return
    }

    const currentSnapshot = captureLocalHistorySnapshot()
    setLocalHistoryPast(localHistoryPast.slice(0, -1))
    setLocalHistoryFuture((current) => [
      ...current,
      {
        label: entry.label,
        snapshot: currentSnapshot,
        createdAt: Date.now(),
      },
    ])
    applyLocalHistorySnapshot(entry.snapshot)
    setSnapPreview(null)
    setAdminNotice(`Annule: ${entry.label}`)
  }, [
    applyLocalHistorySnapshot,
    captureLocalHistorySnapshot,
    localHistoryPast,
  ])

  const handleLocalRedo = useCallback(() => {
    const entry = localHistoryFuture[localHistoryFuture.length - 1]
    if (!entry) {
      setAdminNotice('Aucune action à rétablir.')
      return
    }

    const currentSnapshot = captureLocalHistorySnapshot()
    setLocalHistoryFuture(localHistoryFuture.slice(0, -1))
    setLocalHistoryPast((current) => [
      ...current,
      {
        label: entry.label,
        snapshot: currentSnapshot,
        createdAt: Date.now(),
      },
    ])
    applyLocalHistorySnapshot(entry.snapshot)
    setSnapPreview(null)
    setAdminNotice(`Retabli: ${entry.label}`)
  }, [
    applyLocalHistorySnapshot,
    captureLocalHistorySnapshot,
    localHistoryFuture,
  ])

  const visibleHistoryEntries = useMemo(
    () => localHistoryPast.slice(-6).reverse(),
    [localHistoryPast],
  )

  const refreshTrash = useCallback(async () => {
    if (!isAdmin) {
      setTrashItems([])
      return
    }

    setIsTrashLoading(true)
    const result = await fetchTrashFromSupabase()
    setIsTrashLoading(false)

    if (!result.ok) {
      setAdminNotice(`Erreur corbeille: ${result.error}`)
      return
    }

    setTrashItems(result.data)
  }, [isAdmin])

  const refreshFeatureVersions = useCallback(
    async (featureId: string | null) => {
      if (!isAdmin || !featureId) {
        setVersionItems([])
        return
      }

      setIsVersionsLoading(true)
      const result = await fetchFeatureVersions(featureId)
      setIsVersionsLoading(false)

      if (!result.ok) {
        setAdminNotice(`Erreur versions: ${result.error}`)
        return
      }

      setVersionItems(result.data)
    },
    [isAdmin],
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshTrash()
      void refreshFeatureVersions(selectedFeatureId)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isAdmin, refreshFeatureVersions, refreshTrash, selectedFeatureId])

  const toggleLayer = (id: string) => {
    setActiveLayers((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }

  const handleLayerOpacityChange = useCallback(
    (category: string, layerId: string, value: number) => {
      const key = toLayerLockKey(category, layerId)
      setLayerOpacityByKey((current) => ({
        ...current,
        [key]: normalizeLayerOpacity(value),
      }))
    },
    [],
  )

  const handleResetLayerOpacity = useCallback((category: string, layerId: string) => {
    const key = toLayerLockKey(category, layerId)
    setLayerOpacityByKey((current) => {
      if (current[key] === undefined) {
        return current
      }
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const handleLayerZoomChange = useCallback(
    (
      category: string,
      layerId: string,
      field: 'minZoom' | 'maxZoom',
      value: number,
    ) => {
      const key = toLayerLockKey(category, layerId)
      const numeric = clamp(Math.round(value), 10, 18)
      setLayerZoomVisibility((current) => {
        const existing = current[key] ?? { minZoom: 10, maxZoom: 18 }
        const nextEntry =
          field === 'minZoom'
            ? {
                minZoom: Math.min(numeric, existing.maxZoom),
                maxZoom: Math.max(numeric, existing.maxZoom),
              }
            : {
                minZoom: Math.min(existing.minZoom, numeric),
                maxZoom: Math.max(existing.minZoom, numeric),
              }
        return {
          ...current,
          [key]: nextEntry,
        }
      })
    },
    [],
  )

  const handleResetLayerZoom = useCallback((category: string, layerId: string) => {
    const key = toLayerLockKey(category, layerId)
    setLayerZoomVisibility((current) => {
      if (current[key] === undefined) {
        return current
      }
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const toggleLayerFolder = useCallback((category: string) => {
    setCollapsedLayerFolders((current) => ({
      ...current,
      [category]: !current[category],
    }))
  }, [])

  const handleExpandAllLayerFolders = useCallback(() => {
    setCollapsedLayerFolders((current) =>
      Object.fromEntries(Object.keys(current).map((category) => [category, false])),
    )
  }, [])

  const handleCollapseAllLayerFolders = useCallback(() => {
    setCollapsedLayerFolders((current) =>
      Object.fromEntries(Object.keys(current).map((category) => [category, true])),
    )
  }, [])

  const toggleLayerLock = useCallback(
    (category: string, layerId: string) => {
      const key = toLayerLockKey(category, layerId)
      const nextLocked = !lockedLayers[key]
      setLockedLayers((current) => ({
        ...current,
        [key]: nextLocked,
      }))

      if (!nextLocked) {
        setAdminNotice('Calque déverrouillé.')
        return
      }

      setFeatureContextMenu(null)
      if (
        selectedFeature &&
        selectedFeature.category === category &&
        selectedFeature.layerId === layerId
      ) {
        setEditDraft(null)
        setEditPoints([])
        setIsRedrawingEditGeometry(false)
        if (adminMode !== 'view') {
          setAdminMode('view')
        }
      }
      setAdminNotice('Calque verrouillé: édition/suppression/duplication bloquées.')
    },
    [adminMode, lockedLayers, selectedFeature],
  )

  const handleActivateAllLayers = useCallback(() => {
    setActiveLayers(Object.fromEntries(layers.map((layer) => [layer.id, true])))
  }, [layers])

  const handleDeactivateAllLayers = useCallback(() => {
    setActiveLayers(Object.fromEntries(layers.map((layer) => [layer.id, false])))
  }, [layers])

  const handleSoloLayer = useCallback(
    (category: string, layerId: string) => {
      const targetLayer = layers.find(
        (layer) => layer.id === layerId && layer.category === category,
      )
      setActiveLayers(
        Object.fromEntries(
          layers.map((layer) => [layer.id, layer.id === layerId && layer.category === category]),
        ),
      )
      if (targetLayer) {
        setAdminNotice(`Mode solo active: ${targetLayer.label}.`)
      }
    },
    [layers],
  )

  const handleFitLayer = useCallback(
    (category: string, layerId: string) => {
      const layer = layers.find(
        (candidate) => candidate.id === layerId && candidate.category === category,
      )
      if (!layer) {
        setAdminNotice('Calque introuvable.')
        return
      }
      const points = layer.features.flatMap((feature) => getFeaturePoints(feature))
      if (!mapInstance || points.length === 0) {
        setAdminNotice('Aucun élément à cadrer sur ce calque.')
        return
      }
      const bounds = computeBoundsFromPoints(points)
      if (!bounds) {
        setAdminNotice('Aucun élément à cadrer sur ce calque.')
        return
      }
      if (points.length === 1) {
        mapInstance.flyTo(points[0], Math.max(mapInstance.getZoom(), 15), {
          duration: 0.45,
        })
        return
      }
      mapInstance.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 16,
      })
    },
    [layers, mapInstance],
  )

  const handleSaveLayerVisibilityPreset = useCallback(() => {
    const activeIds = Object.entries(activeLayers)
      .filter(([, isActive]) => isActive)
      .map(([layerId]) => layerId)
    if (activeIds.length === 0) {
      setAdminNotice('Active au moins un calque pour enregistrer un preset.')
      return
    }
    const trimmedName = layerPresetDraftName.trim()
    const generatedName = `Preset ${new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`
    const preset: LayerVisibilityPreset = {
      id: `layer_preset_${crypto.randomUUID()}`,
      name: trimmedName || generatedName,
      layerIds: activeIds,
      createdAt: Date.now(),
    }
    setLayerVisibilityPresets((current) =>
      [preset, ...current].slice(0, MAX_LAYER_PRESETS),
    )
    setLayerPresetDraftName('')
    setAdminNotice('Preset de calques enregistré.')
  }, [activeLayers, layerPresetDraftName])

  const handleApplyLayerVisibilityPreset = useCallback(
    (presetId: string) => {
      const preset = layerVisibilityPresets.find((item) => item.id === presetId)
      if (!preset) {
        setAdminNotice('Preset introuvable.')
        return
      }
      const validLayerIds = new Set(layers.map((layer) => layer.id))
      const activeSet = new Set(preset.layerIds.filter((layerId) => validLayerIds.has(layerId)))
      setActiveLayers(
        Object.fromEntries(layers.map((layer) => [layer.id, activeSet.has(layer.id)])),
      )
      setAdminNotice(`Preset applique: ${preset.name}.`)
    },
    [layerVisibilityPresets, layers],
  )

  const handleDeleteLayerVisibilityPreset = useCallback((presetId: string) => {
    setLayerVisibilityPresets((current) =>
      current.filter((item) => item.id !== presetId),
    )
  }, [])

  const focusFeatureById = useCallback(
    (
      featureId: string,
      updateSelection: 'single' | 'preserve' | 'keep' = 'single',
    ) => {
      const match = featureById.get(featureId)
      if (!match) {
        return false
      }
      const layerLocked = isAdmin && isLayerLocked(match.category, match.layerId)

      setSelectedFeatureId(featureId)
      if (updateSelection === 'single') {
        setSelectedFeatureIds([featureId])
      } else if (updateSelection === 'preserve') {
        setSelectedFeatureIds((current) =>
          current.includes(featureId) ? current : [...current, featureId],
        )
      }
      if (layerLocked) {
        setEditDraft(null)
        setEditPoints([])
        setIsRedrawingEditGeometry(false)
        setAdminNotice('Calque verrouillé: lecture seule.')
        void refreshFeatureVersions(featureId)
        return false
      }
      const styleDraft = resolveDraftStyle(match.feature.geometry, match.feature.style)
      setEditDraft({
        name: match.feature.name,
        status: match.feature.status,
        color: match.feature.color,
        category: match.category,
        layerId: match.layerId,
        layerLabel: match.layerLabel,
        geometry: match.feature.geometry,
        pointRadius: styleDraft.pointRadius,
        lineWidth: styleDraft.lineWidth,
        fillOpacity: styleDraft.fillOpacity,
        pointIcon: styleDraft.pointIcon,
        labelMode: styleDraft.labelMode,
        labelSize: styleDraft.labelSize,
        labelHalo: styleDraft.labelHalo,
        labelPriority: styleDraft.labelPriority,
        lineDash: styleDraft.lineDash,
        lineArrows: styleDraft.lineArrows,
        lineDirection: styleDraft.lineDirection,
        polygonPattern: styleDraft.polygonPattern,
        polygonBorderMode: styleDraft.polygonBorderMode,
      })
      setEditPoints(getFeaturePoints(match.feature))
      setIsRedrawingEditGeometry(false)
      setAdminNotice(null)
      void refreshFeatureVersions(featureId)
      return true
    },
    [featureById, isAdmin, isLayerLocked, refreshFeatureVersions],
  )

  const zoomToPoints = useCallback(
    (points: LatLngTuple[]): boolean => {
      if (!mapInstance || points.length === 0) {
        return false
      }
      const bounds = computeBoundsFromPoints(points)
      if (!bounds) {
        return false
      }
      if (points.length === 1) {
        mapInstance.flyTo(points[0], Math.max(mapInstance.getZoom(), 15), {
          duration: 0.45,
        })
        return true
      }
      mapInstance.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 16,
      })
      return true
    },
    [mapInstance],
  )

  const handleCenterOnMarseille = useCallback(() => {
    if (!mapInstance) {
      return
    }
    mapInstance.flyTo(MARSEILLE_CENTER, 12, { duration: 0.45 })
  }, [mapInstance])

  const handleFitVisibleFeatures = useCallback(() => {
    const points = mapVisibleFeatureEntries.flatMap((entry) =>
      getFeaturePoints(entry.feature),
    )
    const didZoom = zoomToPoints(points)
    if (!didZoom) {
      setAdminNotice('Aucun élément visible à cadrer.')
    }
  }, [mapVisibleFeatureEntries, zoomToPoints])

  const handleFitSelection = useCallback(() => {
    const ids =
      selectedFeatureIds.length > 0
        ? selectedFeatureIds
        : selectedFeatureId
          ? [selectedFeatureId]
          : []
    const points = ids.flatMap((id) => {
      const match = featureById.get(id)
      return match ? getFeaturePoints(match.feature) : []
    })
    const didZoom = zoomToPoints(points)
    if (!didZoom) {
      setAdminNotice('Aucun élément sélectionné à cadrer.')
    }
  }, [featureById, selectedFeatureId, selectedFeatureIds, zoomToPoints])

  const zoomToPosition = useCallback(
    (position: LatLngTuple, zoom = 16) => {
      if (!mapInstance) {
        return false
      }
      mapInstance.flyTo(position, clamp(zoom, 10, 18), { duration: 0.45 })
      setSearchFocusPoint(position)
      return true
    },
    [mapInstance],
  )

  const handleMapSearch = useCallback(async () => {
    const query = mapSearchQuery.trim()
    if (!query) {
      setMapSearchResults([])
      setMapSearchNotice('Saisis une adresse ou des coordonnées.')
      return
    }

    const requestId = mapSearchRequestRef.current + 1
    mapSearchRequestRef.current = requestId
    setIsSearchingMap(true)
    setMapSearchNotice(null)

    const directCoordinates = parseCoordinateQuery(query)
    const directResults: MapSearchCandidate[] = directCoordinates
      ? [
          {
            id: `coord-${directCoordinates[0].toFixed(6)}-${directCoordinates[1].toFixed(6)}`,
            label: `${directCoordinates[0].toFixed(5)}, ${directCoordinates[1].toFixed(5)}`,
            subtitle: 'Coordonnées',
            position: directCoordinates,
            source: 'coords',
          },
        ]
      : []

    try {
      const [ban, nominatim] = await Promise.all([
        fetchBanCandidates(query).catch(() => [] as MapSearchCandidate[]),
        fetchNominatimCandidates(query).catch(() => [] as MapSearchCandidate[]),
      ])

      if (mapSearchRequestRef.current !== requestId) {
        return
      }

      const merged: MapSearchCandidate[] = []
      const seen = new Set<string>()
      for (const item of [...directResults, ...ban, ...nominatim]) {
        const key = `${item.position[0].toFixed(5)}:${item.position[1].toFixed(5)}`
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        merged.push(item)
        if (merged.length >= 8) {
          break
        }
      }

      setMapSearchResults(merged)
      if (merged.length === 0) {
        setMapSearchNotice('Aucun resultat.')
        return
      }

      void zoomToPosition(merged[0].position, 15)
      setMapSearchNotice(`${merged.length} resultat(s).`)
    } finally {
      if (mapSearchRequestRef.current === requestId) {
        setIsSearchingMap(false)
      }
    }
  }, [mapSearchQuery, zoomToPosition])

  const handleMapSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void handleMapSearch()
    },
    [handleMapSearch],
  )

  const handleUseCandidateForPointCreation = useCallback(
    (candidate: MapSearchCandidate) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise pour ajouter un point.')
        return
      }

      const targetLayerId = toLayerId(createDraft.layerId, createDraft.layerLabel)
      const targetCategory = createDraft.category.trim()
      const layerIsLocked = isLayerLocked(targetCategory, targetLayerId)

      let nextLayer = {
        category: createDraft.category,
        layerId: createDraft.layerId,
        layerLabel: createDraft.layerLabel,
      }
      if (layerIsLocked) {
        const firstUnlocked = layers.find(
          (layer) => !isLayerLocked(layer.category, layer.id),
        )
        if (!firstUnlocked) {
          setAdminNotice('Tous les calques sont verrouillés.')
          return
        }
        nextLayer = {
          category: firstUnlocked.category,
          layerId: firstUnlocked.id,
          layerLabel: firstUnlocked.label,
        }
      }

      setAdminMode('create')
      setFeatureContextMenu(null)
      setIsMeasureMode(false)
      setIsZoneSelectionMode(false)
      setIsZoneSelectionDragging(false)
      setZoneSelectionStart(null)
      setZoneSelectionCurrent(null)
      setSnapPreview(null)
      setIsRedrawingEditGeometry(false)
      setCreateDraft((current) => ({
        ...current,
        ...nextLayer,
        name: candidate.label,
        geometry: 'point',
        ...resolveDraftStyle('point', current),
      }))
      setCreatePoints([candidate.position])
      void zoomToPosition(candidate.position, 16)
      setAdminNotice(
        `Point préparé depuis "${candidate.label}". Clique "Enregistrer" pour créer l'élément.`,
      )
    },
    [createDraft, isAdmin, isLayerLocked, layers, zoomToPosition],
  )

  const handleAddViewBookmark = useCallback(() => {
    const viewFromMap =
      mapInstance !== null
        ? {
            center: [mapInstance.getCenter().lat, mapInstance.getCenter().lng] as LatLngTuple,
            zoom: mapInstance.getZoom(),
          }
        : null
    const sourceView =
      viewFromMap ??
      (mapViewport
        ? {
            center: mapViewport.center,
            zoom: mapViewport.zoom,
          }
        : null)
    if (!sourceView) {
      setMapSearchNotice('Aucune vue carte disponible à enregistrer.')
      return
    }

    const trimmedName = bookmarkDraftName.trim()
    const generatedName = `Vue ${new Date().toLocaleString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`
    const bookmark: ViewBookmark = {
      id: `view_${crypto.randomUUID()}`,
      name: trimmedName || generatedName,
      center: clampPointToMetropole(sourceView.center),
      zoom: clamp(sourceView.zoom, 10, 18),
      createdAt: Date.now(),
    }

    setViewBookmarks((current) => [bookmark, ...current].slice(0, MAX_VIEW_BOOKMARKS))
    setBookmarkDraftName('')
    setMapSearchNotice('Favori de vue ajouté.')
  }, [bookmarkDraftName, mapInstance, mapViewport])

  const handleGoToViewBookmark = useCallback(
    (bookmark: ViewBookmark) => {
      const didZoom = zoomToPosition(bookmark.center, bookmark.zoom)
      if (!didZoom) {
        setMapSearchNotice('Carte indisponible pour ce favori.')
      }
    },
    [zoomToPosition],
  )

  const handleDeleteViewBookmark = useCallback((bookmarkId: string) => {
    setViewBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId))
  }, [])

  const buildCurrentShareUrl = useCallback(() => {
    if (typeof window === 'undefined') {
      return null
    }
    const sourceView =
      mapViewport ??
      persistedMapViewRef.current ?? {
        center: MARSEILLE_CENTER,
        zoom: 12,
        bounds: METROPOLE_BOUNDS as [LatLngTuple, LatLngTuple],
      }

    const url = new URL(window.location.href)
    const params = new URLSearchParams()
    params.set('lat', sourceView.center[0].toFixed(6))
    params.set('lng', sourceView.center[1].toFixed(6))
    params.set('z', clamp(sourceView.zoom, 10, 18).toFixed(2))
    params.set('b', baseMapId)
    params.set('st', statusFilter)
    params.set('cat', categoryFilter)
    params.set('geo', geometryFilter)

    const activeLayerIds = Object.entries(activeLayers)
      .filter(([, isActive]) => isActive)
      .map(([layerId]) => layerId)
    if (activeLayerIds.length > 0) {
      params.set('al', activeLayerIds.join(','))
    }
    if (selectedFeatureId) {
      params.set('sid', selectedFeatureId)
    }

    url.search = params.toString()
    return url.toString()
  }, [
    activeLayers,
    baseMapId,
    categoryFilter,
    geometryFilter,
    mapViewport,
    selectedFeatureId,
    statusFilter,
  ])

  const handleCopyPermalink = useCallback(async () => {
    const url = buildCurrentShareUrl()
    if (!url) {
      setNavigationNotice('Lien non disponible.')
      return
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        setNavigationNotice('Lien de vue copie dans le presse-papiers.')
        return
      }
      setNavigationNotice(`Lien: ${url}`)
    } catch {
      setNavigationNotice(`Lien: ${url}`)
    }
  }, [buildCurrentShareUrl])

  const handleCopyCursorCoordinates = useCallback(async () => {
    if (!cursorPosition) {
      setNavigationNotice('Survole la carte pour copier des coordonnées.')
      return
    }
    const text = `${cursorPosition[0].toFixed(6)}, ${cursorPosition[1].toFixed(6)}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setNavigationNotice(`Coordonnées copiées: ${text}`)
        return
      }
      setNavigationNotice(text)
    } catch {
      setNavigationNotice(text)
    }
  }, [cursorPosition])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedUiStateRef.current) {
      return
    }
    const nextUrl = buildCurrentShareUrl()
    if (!nextUrl) {
      return
    }
    if (window.location.href !== nextUrl) {
      window.history.replaceState(null, '', nextUrl)
    }
  }, [buildCurrentShareUrl])

  const handleVisibleFeatureFocus = useCallback(
    (featureId: string) => {
      const match = featureById.get(featureId)
      if (!match) {
        return
      }
      zoomToPoints(getFeaturePoints(match.feature))
      if (isAdmin) {
        const didFocus = focusFeatureById(featureId, 'single')
        if (didFocus && adminMode !== 'delete') {
          setAdminMode('edit')
        }
      } else {
        setSelectedFeatureId(featureId)
        setSelectedFeatureIds([featureId])
      }
    },
    [adminMode, featureById, focusFeatureById, isAdmin, zoomToPoints],
  )

  const handleFeatureClick = useCallback(
    (featureId: string, event: LeafletMouseEvent) => {
      if (!isAdmin) {
        return
      }
      if (isZoneSelectionMode) {
        return
      }
      event.originalEvent.stopPropagation()
      setFeatureContextMenu(null)
      let didFocusEditable = false

      if (event.originalEvent.shiftKey) {
        const wasSelected = selectedFeatureIdSet.has(featureId)
        if (wasSelected) {
          const nextIds = selectedFeatureIds.filter((id) => id !== featureId)
          setSelectedFeatureIds(nextIds)
          if (nextIds.length > 0) {
            didFocusEditable = focusFeatureById(nextIds[0], 'keep')
          } else {
            setSelectedFeatureId(null)
            setEditDraft(null)
            setEditPoints([])
            setVersionItems([])
          }
        } else {
          setSelectedFeatureIds((current) =>
            current.includes(featureId) ? current : [...current, featureId],
          )
          didFocusEditable = focusFeatureById(featureId, 'keep')
        }
        setAdminNotice('Sélection multiple mise à jour.')
      } else {
        didFocusEditable = focusFeatureById(featureId, 'single')
      }

      if (adminMode === 'delete' || adminMode === 'edit') {
        return
      }
      if (didFocusEditable) {
        setAdminMode('edit')
      }
    },
    [
      adminMode,
      focusFeatureById,
      isAdmin,
      isZoneSelectionMode,
      selectedFeatureIdSet,
      selectedFeatureIds,
    ],
  )

  const handleFeatureContextMenu = useCallback(
    (featureId: string, event: LeafletMouseEvent) => {
      if (!isAdmin) {
        return
      }
      if (isZoneSelectionMode) {
        return
      }
      event.originalEvent.preventDefault()
      event.originalEvent.stopPropagation()
      const match = featureById.get(featureId)
      if (match && isLayerLocked(match.category, match.layerId)) {
        setAdminNotice("Calque verrouillé: menu d'édition indisponible.")
        return
      }

      const mouseEvent = event.originalEvent as MouseEvent
      setFeatureContextMenu({
        featureId,
        clientX: mouseEvent.clientX,
        clientY: mouseEvent.clientY,
      })
    },
    [featureById, isAdmin, isLayerLocked, isZoneSelectionMode],
  )

  const handleMapClick = useCallback(
    (position: LatLngTuple) => {
      if (!isAdmin) {
        return
      }
      setFeatureContextMenu(null)

      const snap = findSnapResult(position)
      const resolvedPosition = snap?.position ?? position

      if (isMeasureMode) {
        pushLocalHistory('Mesure: ajout point')
        setMeasurePoints((current) => [...current, resolvedPosition])
        if (snap) {
          setAdminNotice(
            `Mesure: point ajouté avec accroche ${snap.type} (${Math.round(
              snap.distanceMeters,
            )} m).`,
          )
        } else {
          setAdminNotice('Mesure: point ajouté.')
        }
        return
      }

      if (adminMode === 'create') {
        const targetLayerId = toLayerId(createDraft.layerId, createDraft.layerLabel)
        const targetCategory = createDraft.category.trim()
        if (isLayerLocked(targetCategory, targetLayerId)) {
          setAdminNotice('Calque verrouillé: ajoute ce point dans un autre calque.')
          return
        }
        pushLocalHistory('Création: ajout point')
        setCreatePoints((current) =>
          createDraft.geometry === 'point'
            ? [resolvedPosition]
            : [...current, resolvedPosition],
        )
        if (snap) {
          setAdminNotice(
            `Point accroche ${snap.type} (${Math.round(snap.distanceMeters)} m).`,
          )
        } else {
          setAdminNotice(null)
        }
        return
      }

      if (adminMode === 'edit' && isRedrawingEditGeometry && editDraft) {
        pushLocalHistory('Édition: ajout point')
        setEditPoints((current) =>
          editDraft.geometry === 'point'
            ? [resolvedPosition]
            : [...current, resolvedPosition],
        )
        if (snap) {
          setAdminNotice(
            `Point accroche ${snap.type} (${Math.round(snap.distanceMeters)} m).`,
          )
        } else {
          setAdminNotice(null)
        }
      }
    },
    [
      adminMode,
      createDraft.category,
      createDraft.geometry,
      createDraft.layerId,
      createDraft.layerLabel,
      editDraft,
      findSnapResult,
      isAdmin,
      isLayerLocked,
      isMeasureMode,
      isRedrawingEditGeometry,
      pushLocalHistory,
    ],
  )

  const handleMapMouseMove = useCallback(
    (position: LatLngTuple) => {
      if (
        !isAdmin ||
        !isZoneSelectionMode ||
        !isZoneSelectionDragging ||
        !zoneSelectionStart
      ) {
        const shouldPreviewSnap =
          isMeasureMode ||
          adminMode === 'create' ||
          (adminMode === 'edit' && isRedrawingEditGeometry)
        if (!shouldPreviewSnap) {
          if (snapPreview) {
            setSnapPreview(null)
          }
          return
        }
        setSnapPreview(findSnapResult(position))
        return
      }
      setZoneSelectionCurrent(position)
    },
    [
      adminMode,
      findSnapResult,
      isAdmin,
      isMeasureMode,
      isRedrawingEditGeometry,
      isZoneSelectionDragging,
      isZoneSelectionMode,
      snapPreview,
      zoneSelectionStart,
    ],
  )

  const handleMapMouseDown = useCallback(
    (position: LatLngTuple) => {
      if (!isAdmin || !isZoneSelectionMode) {
        return
      }
      setFeatureContextMenu(null)
      setSnapPreview(null)
      setZoneSelectionStart(position)
      setZoneSelectionCurrent(position)
      setIsZoneSelectionDragging(true)
      setAdminNotice('Sélection zone en cours: relâche pour valider.')
    },
    [isAdmin, isZoneSelectionMode],
  )

  const handleMapMouseUp = useCallback(
    (position: LatLngTuple) => {
      if (!isAdmin || !isZoneSelectionMode || !isZoneSelectionDragging || !zoneSelectionStart) {
        return
      }

      const bounds = normalizeBounds(zoneSelectionStart, position)
      const ids = visibleLayers
        .flatMap((layer) =>
          layer.features
            .filter((feature) =>
              statusFilter === 'all' ? true : feature.status === statusFilter,
            )
            .filter((feature) => featureIntersectsBounds(feature, bounds))
            .map((feature) => feature.id),
        )
      const uniqueIds = Array.from(new Set(ids))

      setSelectedFeatureIds(uniqueIds)
      if (uniqueIds.length > 0) {
        void focusFeatureById(uniqueIds[0], 'keep')
      } else {
        setSelectedFeatureId(null)
        setEditDraft(null)
        setEditPoints([])
        setVersionItems([])
      }
      setIsZoneSelectionDragging(false)
      setIsZoneSelectionMode(false)
      setZoneSelectionStart(null)
      setZoneSelectionCurrent(null)
      setSnapPreview(null)
      setAdminNotice(
        uniqueIds.length > 0
          ? `${uniqueIds.length} élément(s) sélectionne(s) par zone.`
          : 'Aucun élément dans la zone.',
      )
    },
    [
      focusFeatureById,
      isAdmin,
      isZoneSelectionDragging,
      isZoneSelectionMode,
      statusFilter,
      visibleLayers,
      zoneSelectionStart,
    ],
  )

  const handleToolbarToolClick = useCallback(
    (mode: AdminMode, geometry?: DrawGeometry) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }

      if (mode === 'create' && geometry) {
        setAdminMode('create')
        setIsMeasureMode(false)
        setSnapPreview(null)
        setIsZoneSelectionMode(false)
        setIsZoneSelectionDragging(false)
        setZoneSelectionStart(null)
        setZoneSelectionCurrent(null)
        setFeatureContextMenu(null)
        setCreateDraft((current) => ({
          ...current,
          geometry,
          ...resolveDraftStyle(geometry, current),
        }))
        setCreatePoints([])
        setIsRedrawingEditGeometry(false)
        return
      }

      if (mode === 'edit') {
        setAdminMode('edit')
        setIsMeasureMode(false)
        setSnapPreview(null)
        setFeatureContextMenu(null)
        setIsRedrawingEditGeometry(false)
        return
      }

      if (mode === 'delete') {
        setAdminMode('delete')
        setIsMeasureMode(false)
        setSnapPreview(null)
        setFeatureContextMenu(null)
      }
    },
    [isAdmin],
  )

  const handleAdminLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!supabase) {
      setAdminNotice('Supabase non configuré.')
      return
    }

    if (!adminEmail.trim() || !adminPassword) {
      setAdminNotice('Email et mot de passe requis.')
      return
    }

    setAdminNotice(null)
    setIsAuthenticating(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: adminEmail.trim(),
      password: adminPassword,
    })

    setIsAuthenticating(false)

    if (error) {
      setAdminNotice(`Connexion refusée: ${error.message}`)
      return
    }

    setAdminPassword('')
    void refreshTrash()
    setAdminNotice('Mode admin active.')
  }

  const handleAdminLogout = async () => {
    if (!supabase) {
      return
    }

    const { error } = await supabase.auth.signOut()
    if (error) {
      setAdminNotice(`Erreur deconnexion: ${error.message}`)
      return
    }

    setAdminMode('view')
    setSelectedFeatureId(null)
    setSelectedFeatureIds([])
    setEditDraft(null)
    setEditPoints([])
    setIsRedrawingEditGeometry(false)
    setIsZoneSelectionMode(false)
    setIsZoneSelectionDragging(false)
    setZoneSelectionStart(null)
    setZoneSelectionCurrent(null)
    setFeatureContextMenu(null)
    setIsMeasureMode(false)
    setMeasurePoints([])
    setSnapPreview(null)
    setLocalHistoryPast([])
    setLocalHistoryFuture([])
    setTrashItems([])
    setVersionItems([])
    setAdminNotice('Mode admin désactivé.')
  }

  const handleCreateFeature = useCallback(async () => {
    if (!supabase || !isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }

    const layerId = toLayerId(createDraft.layerId, createDraft.layerLabel)
    const layerLabel = createDraft.layerLabel.trim()
    const category = createDraft.category.trim()
    const name = createDraft.name.trim()
    const finalName =
      name ||
      `Élément ${new Date().toLocaleString('fr-FR', {
        hour12: false,
      })}`

    if (!category || !layerLabel || !layerId) {
      setAdminNotice('Catégorie et calque sont obligatoires.')
      return
    }
    if (isLayerLocked(category, layerId)) {
      setAdminNotice('Calque verrouillé: impossible de créer un nouvel élément.')
      return
    }

    if (!isHexColor(createDraft.color)) {
      setAdminNotice('Couleur invalide. Utilise le format #RRGGBB.')
      return
    }

    if (!isGeometryComplete(createDraft.geometry, createPoints)) {
      setAdminNotice('Géométrie incomplète: ajoute plus de points sur la carte.')
      return
    }

    const geometryPointsSnapshot = [...createPoints]
    const geometryCoordinates = toCoordinates(createDraft.geometry, createPoints)
    const stylePayload = toFeatureStylePayload(createDraft.geometry, createDraft)
    const existingLayer = layers.find(
      (layer) => layer.id === layerId && layer.category === category,
    )
    const layerSortOrder =
      existingLayer !== undefined
        ? getLayerSortOrderValue(existingLayer)
        : layers
            .filter((layer) => layer.category === category)
            .reduce(
              (maxOrder, layer, index) =>
                Math.max(maxOrder, getLayerSortOrderValue(layer, index)),
              -1,
            ) + 1
    const sortOrder =
      (layers.find((layer) => layer.id === layerId)?.features.length ?? 0) + 1
    const id = `manual_${crypto.randomUUID()}`

    setIsSaving(true)
    setAdminNotice(null)

    const insertPayload = {
      id,
      name: finalName,
      status: createDraft.status,
      category,
      layer_id: layerId,
      layer_label: layerLabel,
      layer_sort_order: layerSortOrder,
      color: createDraft.color,
      style: stylePayload,
      geometry_type: createDraft.geometry,
      coordinates: geometryCoordinates,
      sort_order: sortOrder,
      source: 'manual',
    }
    let didFallbackWithoutStyle = false
    let { error } = await supabase.from('map_features').insert(insertPayload)
    if (error && isMissingStyleColumnError(error.message)) {
      const legacyPayload = { ...insertPayload, style: undefined }
      const retry = await supabase.from('map_features').insert(legacyPayload)
      error = retry.error
      didFallbackWithoutStyle = !error
    }

    if (error) {
      setIsSaving(false)
      setAdminNotice(`Erreur creation: ${error.message}`)
      return
    }

    setCreatePoints([])
    setSelectedFeatureId(id)
    setSelectedFeatureIds([id])
    setEditDraft({
      name: finalName,
      status: createDraft.status,
      color: createDraft.color,
      category,
      layerId,
      layerLabel,
      geometry: createDraft.geometry,
      pointRadius: createDraft.pointRadius,
      lineWidth: createDraft.lineWidth,
      fillOpacity: createDraft.fillOpacity,
      pointIcon: createDraft.pointIcon,
      labelMode: createDraft.labelMode,
      labelSize: createDraft.labelSize,
      labelHalo: createDraft.labelHalo,
      labelPriority: createDraft.labelPriority,
      lineDash: createDraft.lineDash,
      lineArrows: createDraft.lineArrows,
      lineDirection: createDraft.lineDirection,
      polygonPattern: createDraft.polygonPattern,
      polygonBorderMode: createDraft.polygonBorderMode,
    })
    setEditPoints(geometryPointsSnapshot)
    setIsRedrawingEditGeometry(false)
    await syncSupabaseLayers(layerId)
    await refreshFeatureVersions(id)
    setAdminMode('edit')
    setIsSaving(false)
    setAdminNotice(
      didFallbackWithoutStyle
        ? 'Élément créé. Applique web/supabase/schema.sql pour persister les styles individuels.'
        : 'Élément créé et enregistré.',
    )
  }, [
    createDraft,
    createPoints,
    isAdmin,
    isLayerLocked,
    layers,
    refreshFeatureVersions,
    syncSupabaseLayers,
  ])

  const handleSaveEdition = useCallback(async () => {
    if (!supabase || !isAdmin || !selectedFeatureId || !editDraft) {
      setAdminNotice('Sélectionne un élément à modifier.')
      return
    }

    const selectedRef = featureById.get(selectedFeatureId)
    if (
      selectedRef &&
      isLayerLocked(selectedRef.category, selectedRef.layerId)
    ) {
      setAdminNotice('Calque verrouillé: édition interdite.')
      return
    }

    const name = editDraft.name.trim()
    const category = editDraft.category.trim()
    const layerLabel = editDraft.layerLabel.trim()
    const layerId = toLayerId(editDraft.layerId, layerLabel)
    const targetLayer = layers.find(
      (layer) => layer.id === layerId && layer.category === category,
    )
    const layerSortOrder =
      targetLayer !== undefined
        ? getLayerSortOrderValue(targetLayer)
        : layers
            .filter((layer) => layer.category === category)
            .reduce(
              (maxOrder, layer, index) =>
                Math.max(maxOrder, getLayerSortOrderValue(layer, index)),
              -1,
            ) + 1

    if (!name || !category || !layerLabel || !layerId) {
      setAdminNotice('Nom, catégorie et calque sont obligatoires.')
      return
    }
    if (isLayerLocked(category, layerId)) {
      setAdminNotice('Calque cible verrouillé: déplace vers un calque non verrouillé.')
      return
    }

    if (!isHexColor(editDraft.color)) {
      setAdminNotice('Couleur invalide. Utilise le format #RRGGBB.')
      return
    }

    if (!isGeometryComplete(editDraft.geometry, editPoints)) {
      setAdminNotice('Géométrie incomplète: ajoute plus de points sur la carte.')
      return
    }
    const stylePayload = toFeatureStylePayload(editDraft.geometry, editDraft)

    setIsSaving(true)
    setAdminNotice(null)

    const updatePayload = {
      name,
      status: editDraft.status,
      category,
      layer_id: layerId,
      layer_label: layerLabel,
      layer_sort_order: layerSortOrder,
      color: editDraft.color,
      style: stylePayload,
      geometry_type: editDraft.geometry,
      coordinates: toCoordinates(editDraft.geometry, editPoints),
    }
    let didFallbackWithoutStyle = false
    let { error } = await supabase
      .from('map_features')
      .update(updatePayload)
      .eq('id', selectedFeatureId)
    if (error && isMissingStyleColumnError(error.message)) {
      const legacyPayload = { ...updatePayload, style: undefined }
      const retry = await supabase
        .from('map_features')
        .update(legacyPayload)
        .eq('id', selectedFeatureId)
      error = retry.error
      didFallbackWithoutStyle = !error
    }

    if (error) {
      setIsSaving(false)
      setAdminNotice(`Erreur édition: ${error.message}`)
      return
    }

    await syncSupabaseLayers(layerId)
    setSelectedFeatureId(selectedFeatureId)
    setSelectedFeatureIds([selectedFeatureId])
    await refreshFeatureVersions(selectedFeatureId)
    setIsSaving(false)
    setAdminNotice(
      didFallbackWithoutStyle
        ? 'Élément modifié. Applique web/supabase/schema.sql pour persister les styles individuels.'
        : 'Élément modifié.',
    )
  }, [
    editDraft,
    editPoints,
    featureById,
    isAdmin,
    isLayerLocked,
    layers,
    refreshFeatureVersions,
    selectedFeatureId,
    syncSupabaseLayers,
  ])

  const handleApplyBulkUpdate = useCallback(async () => {
    if (!supabase || !isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }

    const ids =
      selectedFeatureIds.length > 0
        ? selectedFeatureIds
        : selectedFeatureId
          ? [selectedFeatureId]
          : []
    if (ids.length === 0) {
      setAdminNotice('Sélectionne au moins un élément.')
      return
    }

    const refs = ids
      .map((id) => featureById.get(id))
      .filter((value): value is FeatureRef => Boolean(value))
    if (refs.length === 0) {
      setAdminNotice('Aucun élément sélectionné.')
      return
    }
    if (refs.some((ref) => isLayerLocked(ref.category, ref.layerId))) {
      setAdminNotice('Édition en masse refusée: sélection sur calque verrouillé.')
      return
    }

    const statusPatch = bulkStatus || null
    const colorPatch = bulkColor.trim() || null
    const categoryPatch = bulkCategory.trim() || null
    const layerLabelPatch = bulkLayerLabel.trim() || null
    const layerIdPatch = bulkLayerId.trim() || null

    const hasAnyPatch =
      statusPatch !== null ||
      colorPatch !== null ||
      categoryPatch !== null ||
      layerLabelPatch !== null ||
      layerIdPatch !== null
    if (!hasAnyPatch) {
      setAdminNotice("Renseigne au moins un champ pour l'édition en masse.")
      return
    }

    if (colorPatch && !isHexColor(colorPatch)) {
      setAdminNotice('Couleur invalide pour édition en masse (#RRGGBB).')
      return
    }

    const targetLayerCounters = new Map<string, number>()

    setIsSaving(true)
    setAdminNotice(null)

    let updated = 0
    let firstError: string | null = null
    let firstTargetLayerId: string | undefined

    for (const ref of refs) {
      const nextCategory = categoryPatch ?? ref.category
      const nextLayerLabel = layerLabelPatch ?? ref.layerLabel
      const rawLayerId = layerIdPatch ?? ref.layerId
      const nextLayerId = toLayerId(rawLayerId, nextLayerLabel)

      if (!nextCategory || !nextLayerLabel || !nextLayerId) {
        firstError = 'Catégorie/calque invalide pour édition en masse.'
        break
      }
      if (isLayerLocked(nextCategory, nextLayerId)) {
        firstError = `Calque cible verrouillé (${nextLayerLabel}).`
        break
      }

      const key = `${nextCategory}::${nextLayerId}`
      const baseSortCount =
        targetLayerCounters.get(key) ??
        (layers.find(
          (layer) => layer.category === nextCategory && layer.id === nextLayerId,
        )?.features.length ?? 0)
      const nextSortCount = baseSortCount + 1
      targetLayerCounters.set(key, nextSortCount)

      const targetLayer = layers.find(
        (layer) => layer.category === nextCategory && layer.id === nextLayerId,
      )
      const layerSortOrder =
        targetLayer !== undefined
          ? getLayerSortOrderValue(targetLayer)
          : layers
              .filter((layer) => layer.category === nextCategory)
              .reduce(
                (maxOrder, layer, index) =>
                  Math.max(maxOrder, getLayerSortOrderValue(layer, index)),
                -1,
              ) + 1

      const updatePayload: Record<string, unknown> = {
        category: nextCategory,
        layer_id: nextLayerId,
        layer_label: nextLayerLabel,
        layer_sort_order: layerSortOrder,
        sort_order: nextSortCount,
      }
      if (statusPatch) {
        updatePayload.status = statusPatch
      }
      if (colorPatch) {
        updatePayload.color = colorPatch
      }

      const { error } = await supabase
        .from('map_features')
        .update(updatePayload)
        .eq('id', ref.feature.id)
      if (error) {
        firstError = error.message
        break
      }

      updated += 1
      if (!firstTargetLayerId) {
        firstTargetLayerId = nextLayerId
      }
    }

    if (firstError) {
      setIsSaving(false)
      setAdminNotice(
        updated > 0
          ? `${updated} élément(s) modifiés, puis erreur: ${firstError}`
          : `Erreur édition en masse: ${firstError}`,
      )
      return
    }

    await syncSupabaseLayers(firstTargetLayerId)
    if (selectedFeatureId) {
      await refreshFeatureVersions(selectedFeatureId)
    }
    setIsSaving(false)
    setAdminNotice(`${updated} élément(s) mis à jour en masse.`)
  }, [
    bulkCategory,
    bulkColor,
    bulkLayerId,
    bulkLayerLabel,
    bulkStatus,
    featureById,
    isAdmin,
    isLayerLocked,
    layers,
    refreshFeatureVersions,
    selectedFeatureId,
    selectedFeatureIds,
    syncSupabaseLayers,
  ])

  const handleDeleteFeatureByIds = useCallback(
    async (ids: string[]) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }

      const uniqueIds = Array.from(new Set(ids)).filter((id) => featureById.has(id))
      if (uniqueIds.length === 0) {
        setAdminNotice('Sélectionne un élément à supprimer.')
        return
      }

       const lockedIds = uniqueIds.filter((id) => {
        const ref = featureById.get(id)
        return ref ? isLayerLocked(ref.category, ref.layerId) : false
      })
      if (lockedIds.length > 0) {
        setAdminNotice('Suppression refusée: la sélection contient un calque verrouillé.')
        return
      }

      const targetLabel =
        uniqueIds.length === 1
          ? `"${featureById.get(uniqueIds[0])?.feature.name ?? 'élément'}"`
          : `${uniqueIds.length} éléments`
      const confirmed = window.confirm(
        `Déplacer ${targetLabel} dans la corbeille ?`,
      )
      if (!confirmed) {
        return
      }

      setIsSaving(true)
      setAdminNotice(null)

      let deletedCount = 0
      let firstError: string | null = null
      for (const id of uniqueIds) {
        const result = await moveFeatureToTrash(id)
        if (!result.ok) {
          if (!firstError) {
            firstError = result.error
          }
          continue
        }
        deletedCount += 1
      }

      if (deletedCount === 0) {
        setIsSaving(false)
        setAdminNotice(`Erreur suppression: ${firstError ?? 'suppression impossible.'}`)
        return
      }

      setSelectedFeatureId(null)
      setSelectedFeatureIds([])
      setEditDraft(null)
      setEditPoints([])
      setIsRedrawingEditGeometry(false)
      setVersionItems([])
      await syncSupabaseLayers()
      await refreshTrash()
      setIsSaving(false)
      setAdminNotice(
        firstError
          ? `${deletedCount} élément(s) déplacés dans la corbeille (avec erreurs partielles).`
          : `${deletedCount} élément(s) déplacés dans la corbeille.`,
      )
    },
    [featureById, isAdmin, isLayerLocked, refreshTrash, syncSupabaseLayers],
  )

  const handleDeleteFeature = useCallback(async () => {
    if (!isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }
    const ids = selectedFeatureIds.length > 0 ? selectedFeatureIds : []
    if (ids.length === 0 && selectedFeatureId) {
      await handleDeleteFeatureByIds([selectedFeatureId])
      return
    }
    await handleDeleteFeatureByIds(ids)
  }, [handleDeleteFeatureByIds, isAdmin, selectedFeatureId, selectedFeatureIds])

  const handleDuplicateSelection = useCallback(async (targetIds?: string[]) => {
    if (!supabase || !isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }

    const ids =
      targetIds && targetIds.length > 0
        ? targetIds
        : selectedFeatureIds.length > 0
        ? selectedFeatureIds
        : selectedFeatureId
          ? [selectedFeatureId]
          : []
    if (ids.length === 0) {
      setAdminNotice('Sélectionne un élément à dupliquer.')
      return
    }

    const refs = ids
      .map((id) => featureById.get(id))
      .filter((value): value is FeatureRef => Boolean(value))
    if (refs.length === 0) {
      setAdminNotice('Aucun élément duplicable.')
      return
    }
    if (refs.some((ref) => isLayerLocked(ref.category, ref.layerId))) {
      setAdminNotice('Duplication refusée: la sélection contient un calque verrouillé.')
      return
    }

    const baseOffset: LatLngTuple = [0.00035, 0.00035]
    const layerCounts = new Map<string, number>()
    const rows = refs.map((ref, index) => {
      const key = `${ref.category}::${ref.layerId}`
      const currentCount =
        layerCounts.get(key) ??
        (layers.find((layer) => layer.id === ref.layerId)?.features.length ?? 0)
      const nextCount = currentCount + 1
      layerCounts.set(key, nextCount)

      const layerEntry = layers.find(
        (layer) => layer.id === ref.layerId && layer.category === ref.category,
      )
      const layerSortOrder =
        layerEntry !== undefined
          ? getLayerSortOrderValue(layerEntry)
          : layers
              .filter((layer) => layer.category === ref.category)
              .reduce(
                (maxOrder, layer, layerIndex) =>
                  Math.max(maxOrder, getLayerSortOrderValue(layer, layerIndex)),
                -1,
              ) + 1

      const offset: LatLngTuple = [
        baseOffset[0] * (index + 1),
        baseOffset[1] * (index + 1),
      ]
      const newId = `duplicate_${crypto.randomUUID()}`
      const points = getFeaturePoints(ref.feature)
      return {
        id: newId,
        name: `${ref.feature.name} (copie)`,
        status: ref.feature.status,
        category: ref.category,
        layer_id: ref.layerId,
        layer_label: ref.layerLabel,
        layer_sort_order: layerSortOrder,
        color: ref.feature.color,
        style: ref.feature.style ?? null,
        geometry_type: ref.feature.geometry,
        coordinates: offsetFeatureCoordinates(ref.feature.geometry, points, offset),
        sort_order: nextCount,
        source: 'manual_duplicate',
      }
    })

    setIsSaving(true)
    setAdminNotice(null)
    let didFallbackWithoutStyle = false
    let { error } = await supabase.from('map_features').insert(rows)
    if (error && isMissingStyleColumnError(error.message)) {
      const legacyRows = rows.map((row) => ({
        ...row,
        style: undefined,
      }))
      const retry = await supabase.from('map_features').insert(legacyRows)
      error = retry.error
      didFallbackWithoutStyle = !error
    }
    if (error) {
      setIsSaving(false)
      setAdminNotice(`Erreur duplication: ${error.message}`)
      return
    }

    const firstLayerId = rows[0]?.layer_id
    await syncSupabaseLayers(firstLayerId)
    const duplicatedIds = rows.map((row) => row.id)
    setSelectedFeatureIds(duplicatedIds)
    if (duplicatedIds[0]) {
      void focusFeatureById(duplicatedIds[0], 'keep')
    }
    setAdminMode('edit')
    setIsSaving(false)
    setAdminNotice(
      duplicatedIds.length > 1
        ? didFallbackWithoutStyle
          ? `${duplicatedIds.length} éléments dupliqués (styles non persistés: applique web/supabase/schema.sql).`
          : `${duplicatedIds.length} éléments dupliqués.`
        : didFallbackWithoutStyle
          ? 'Élément dupliqué (style non persisté: applique web/supabase/schema.sql).'
          : 'Élément dupliqué.',
    )
  }, [
    featureById,
    focusFeatureById,
    isAdmin,
    isLayerLocked,
    layers,
    selectedFeatureId,
    selectedFeatureIds,
    syncSupabaseLayers,
  ])

  const handleToggleZoneSelection = useCallback(() => {
    if (!isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }
    if (adminMode === 'create') {
      setAdminMode('edit')
    }
    if (isZoneSelectionMode) {
      setIsZoneSelectionMode(false)
      setIsZoneSelectionDragging(false)
      setZoneSelectionStart(null)
      setZoneSelectionCurrent(null)
      setAdminNotice('Sélection zone annulée.')
      return
    }
    setFeatureContextMenu(null)
    setIsMeasureMode(false)
    setSnapPreview(null)
    setIsZoneSelectionMode(true)
    setIsZoneSelectionDragging(false)
    setZoneSelectionStart(null)
    setZoneSelectionCurrent(null)
    setAdminNotice('Sélection zone active: clique-glisse sur la carte.')
  }, [adminMode, isAdmin, isZoneSelectionMode])

  const handleClearMultiSelection = useCallback(() => {
    setSelectedFeatureIds(selectedFeatureId ? [selectedFeatureId] : [])
    setAdminNotice('Sélection multiple réinitialisée.')
  }, [selectedFeatureId])

  const handleToggleMeasureMode = useCallback(() => {
    if (!isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }
    if (isMeasureMode) {
      setIsMeasureMode(false)
      setSnapPreview(null)
      setAdminNotice('Outil mesure désactivé.')
      return
    }

    setFeatureContextMenu(null)
    setIsZoneSelectionMode(false)
    setIsZoneSelectionDragging(false)
    setZoneSelectionStart(null)
    setZoneSelectionCurrent(null)
    setSnapPreview(null)
    setIsMeasureMode(true)
    setAdminNotice('Outil mesure actif: clique sur la carte pour poser des points.')
  }, [isAdmin, isMeasureMode])

  const handleResetMeasure = useCallback(() => {
    if (measurePoints.length === 0) {
      return
    }
    pushLocalHistory('Mesure: réinitialiser')
    setMeasurePoints([])
    setSnapPreview(null)
    setAdminNotice('Mesure réinitialisée.')
  }, [measurePoints.length, pushLocalHistory])

  const handleChangeMeasureGeometry = useCallback(
    (geometry: MeasureGeometry) => {
      if (geometry === measureGeometry) {
        return
      }
      if (measurePoints.length > 0) {
        pushLocalHistory('Mesure: changement de type')
      }
      setMeasureGeometry(geometry)
      setMeasurePoints([])
      setSnapPreview(null)
      setAdminNotice(`Mesure basculée en mode ${MEASURE_GEOMETRY_LABELS[geometry]}.`)
    },
    [measureGeometry, measurePoints.length, pushLocalHistory],
  )

  const handleToggleGrid = useCallback(() => {
    const next = !isGridEnabled
    setIsGridEnabled(next)
    setAdminNotice(next ? "Grille d'aide activée." : "Grille d'aide désactivée.")
  }, [isGridEnabled])

  const handleToggleSnapping = useCallback(() => {
    const next = !isSnappingEnabled
    setIsSnappingEnabled(next)
    setAdminNotice(next ? 'Snapping actif.' : 'Snapping désactivé.')
    setSnapPreview(null)
  }, [isSnappingEnabled])

  const applyStyleToCurrentDraft = useCallback(
    (
      changes: Partial<
        Pick<
          CreateDraft,
          | 'pointRadius'
          | 'lineWidth'
          | 'fillOpacity'
          | 'pointIcon'
          | 'labelMode'
          | 'labelSize'
          | 'labelHalo'
          | 'labelPriority'
          | 'lineDash'
          | 'lineArrows'
          | 'lineDirection'
          | 'polygonPattern'
          | 'polygonBorderMode'
        >
      >,
    ) => {
      const normalized: Partial<CreateDraft> = {}
      if (typeof changes.pointRadius === 'number' && Number.isFinite(changes.pointRadius)) {
        normalized.pointRadius = normalizePointRadius(changes.pointRadius)
      }
      if (typeof changes.lineWidth === 'number' && Number.isFinite(changes.lineWidth)) {
        normalized.lineWidth = normalizeLineWidth(changes.lineWidth)
      }
      if (typeof changes.fillOpacity === 'number' && Number.isFinite(changes.fillOpacity)) {
        normalized.fillOpacity = normalizeFillOpacity(changes.fillOpacity)
      }
      if (changes.pointIcon !== undefined) {
        normalized.pointIcon = normalizePointIcon(changes.pointIcon)
      }
      if (changes.labelMode !== undefined) {
        normalized.labelMode = normalizeLabelMode(changes.labelMode)
      }
      if (typeof changes.labelSize === 'number' && Number.isFinite(changes.labelSize)) {
        normalized.labelSize = normalizeLabelSize(changes.labelSize)
      }
      if (typeof changes.labelHalo === 'boolean') {
        normalized.labelHalo = changes.labelHalo
      }
      if (
        typeof changes.labelPriority === 'number' &&
        Number.isFinite(changes.labelPriority)
      ) {
        normalized.labelPriority = normalizeLabelPriority(changes.labelPriority)
      }
      if (changes.lineDash !== undefined) {
        normalized.lineDash = normalizeLineDash(changes.lineDash)
      }
      if (typeof changes.lineArrows === 'boolean') {
        normalized.lineArrows = changes.lineArrows
      }
      if (changes.lineDirection !== undefined) {
        normalized.lineDirection = normalizeLineDirection(changes.lineDirection)
      }
      if (changes.polygonPattern !== undefined) {
        normalized.polygonPattern = normalizePolygonPattern(changes.polygonPattern)
      }
      if (changes.polygonBorderMode !== undefined) {
        normalized.polygonBorderMode = normalizePolygonBorderMode(
          changes.polygonBorderMode,
        )
      }
      if (Object.keys(normalized).length === 0) {
        return
      }

      if (adminMode === 'create') {
        setCreateDraft((current) => ({
          ...current,
          ...normalized,
        }))
        return
      }
      if (adminMode === 'edit') {
        setEditDraft((current) =>
          current
            ? {
                ...current,
                ...normalized,
              }
            : current,
        )
      }
    },
    [adminMode],
  )

  const applyTemplateToCreateDraft = useCallback(
    (templateId: string) => {
      const template = styleTemplates.find((item) => item.id === templateId)
      if (!template) {
        return
      }
      const normalizedPatch = normalizeTemplatePatch(template.patch)
      setCreateDraft((current) => ({
        ...current,
        ...normalizedPatch,
      }))
      setCreateTemplateId(templateId)
      setAdminNotice(`Template applique: ${template.label}.`)
    },
    [styleTemplates],
  )

  const applyTemplateToEditDraft = useCallback(
    (templateId: string) => {
      if (!editDraft) {
        return
      }
      const template = styleTemplates.find((item) => item.id === templateId)
      if (!template) {
        return
      }
      const normalizedPatch = normalizeTemplatePatch(template.patch)
      setEditDraft({
        ...editDraft,
        ...normalizedPatch,
      })
      setEditTemplateId(templateId)
      setAdminNotice(`Template applique: ${template.label}.`)
    },
    [editDraft, styleTemplates],
  )

  const handleClearLocalHistory = useCallback(() => {
    setLocalHistoryPast([])
    setLocalHistoryFuture([])
    setAdminNotice('Historique local efface.')
  }, [])

  const handleContextMenuAction = useCallback(
    async (action: 'edit' | 'toggle' | 'duplicate' | 'delete') => {
      if (!featureContextMenu) {
        return
      }
      const featureId = featureContextMenu.featureId
      setFeatureContextMenu(null)

      if (action === 'edit') {
        const didFocus = focusFeatureById(featureId, 'single')
        if (didFocus) {
          setAdminMode('edit')
        }
        return
      }

      if (action === 'toggle') {
        const wasSelected = selectedFeatureIdSet.has(featureId)
        if (wasSelected) {
          const nextIds = selectedFeatureIds.filter((id) => id !== featureId)
          setSelectedFeatureIds(nextIds)
          if (nextIds.length > 0) {
            void focusFeatureById(nextIds[0], 'keep')
          } else {
            setSelectedFeatureId(null)
            setEditDraft(null)
            setEditPoints([])
            setVersionItems([])
          }
        } else {
          setSelectedFeatureIds((current) =>
            current.includes(featureId) ? current : [...current, featureId],
          )
          void focusFeatureById(featureId, 'keep')
        }
        setAdminNotice('Sélection multiple mise à jour.')
        return
      }

      if (action === 'duplicate') {
        await handleDuplicateSelection([featureId])
        return
      }

      await handleDeleteFeatureByIds([featureId])
    },
    [
      featureContextMenu,
      focusFeatureById,
      handleDuplicateSelection,
      handleDeleteFeatureByIds,
      selectedFeatureIdSet,
      selectedFeatureIds,
    ],
  )

  const handleMapDoubleClick = () => {
    if (!isAdmin) {
      return
    }

    if (isMeasureMode) {
      if (
        (measureGeometry === 'line' && measurePoints.length < 2) ||
        (measureGeometry === 'polygon' && measurePoints.length < 3)
      ) {
        setAdminNotice('Mesure incomplete: ajoute plus de points.')
        return
      }
      if (measureGeometry === 'line') {
        setAdminNotice(`Distance mesuree: ${formatDistance(measureLengthMeters)}.`)
      } else {
        setAdminNotice(
          `Surface mesuree: ${formatSurface(measureAreaSquareMeters)} (perimetre ${formatDistance(
            measurePerimeterMeters,
          )}).`,
        )
      }
      return
    }

    if (adminMode === 'create') {
      if (!isGeometryComplete(createDraft.geometry, createPoints)) {
        setAdminNotice(
          `Géométrie incomplète: ${MIN_POINTS_REQUIRED[createDraft.geometry]} point(s) minimum.`,
        )
        return
      }
      void handleCreateFeature()
      return
    }

    if (adminMode === 'edit' && isRedrawingEditGeometry && editDraft) {
      if (!isGeometryComplete(editDraft.geometry, editPoints)) {
        setAdminNotice(
          `Géométrie incomplète: ${MIN_POINTS_REQUIRED[editDraft.geometry]} point(s) minimum.`,
        )
        return
      }
      void handleSaveEdition()
    }
  }

  const handleMapContextMenu = () => {
    if (!isAdmin) {
      return
    }
    setFeatureContextMenu(null)

    if (isZoneSelectionMode) {
      setIsZoneSelectionMode(false)
      setIsZoneSelectionDragging(false)
      setZoneSelectionStart(null)
      setZoneSelectionCurrent(null)
      setSnapPreview(null)
      setAdminNotice('Sélection zone annulée.')
      return
    }

    if (isMeasureMode && measurePoints.length > 0) {
      pushLocalHistory('Mesure: annuler dernier point')
      setMeasurePoints((current) => current.slice(0, -1))
      return
    }

    if (adminMode === 'create' && createPoints.length > 0) {
      pushLocalHistory('Création: annuler dernier point')
      setCreatePoints((current) => current.slice(0, -1))
      return
    }

    if (adminMode === 'edit' && isRedrawingEditGeometry && editPoints.length > 0) {
      pushLocalHistory('Édition: annuler dernier point')
      setEditPoints((current) => current.slice(0, -1))
    }
  }

  const handleMoveEditVertex = useCallback((index: number, position: LatLngTuple) => {
    setEditPoints((current) => {
      if (index < 0 || index >= current.length) {
        return current
      }
      const next = [...current]
      next[index] = position
      return next
    })
  }, [])

  const handleEditVertexDrag = useCallback(
    (index: number, event: LeafletEvent) => {
      handleMoveEditVertex(index, markerEventToPosition(event))
    },
    [handleMoveEditVertex],
  )

  const handleEditVertexDragStart = useCallback(() => {
    pushLocalHistory('Édition: déplacement sommet')
  }, [pushLocalHistory])

  const handleEditVertexDragEnd = useCallback(
    (index: number, event: LeafletEvent) => {
      const rawPosition = markerEventToPosition(event)
      const snap = findSnapResult(rawPosition)
      handleMoveEditVertex(index, snap?.position ?? rawPosition)
      if (snap) {
        setAdminNotice(
          `Sommet ajuste avec accroche ${snap.type} (${Math.round(
            snap.distanceMeters,
          )} m).`,
        )
      } else {
        setAdminNotice('Géométrie ajustée. Clique sur "Enregistrer" pour valider.')
      }
    },
    [findSnapResult, handleMoveEditVertex],
  )

  const handleInsertEditVertex = useCallback(
    (afterIndex: number, position: LatLngTuple) => {
      if (!editDraft || editDraft.geometry === 'point') {
        return
      }
      pushLocalHistory('Édition: insertion sommet')
      setEditPoints((current) => {
        if (current.length < 2) {
          return current
        }
        const safeIndex = Math.min(Math.max(afterIndex, -1), current.length - 1)
        const next = [...current]
        next.splice(safeIndex + 1, 0, position)
        return next
      })
      setAdminNotice('Sommet ajouté. Clique sur "Enregistrer" pour valider.')
    },
    [editDraft, pushLocalHistory],
  )

  const handleDeleteEditVertex = useCallback(
    (index: number) => {
      if (!editDraft || editDraft.geometry === 'point') {
        return
      }

      const minPoints = MIN_POINTS_REQUIRED[editDraft.geometry]
      pushLocalHistory('Édition: suppression sommet')
      setEditPoints((current) => {
        if (current.length <= minPoints || index < 0 || index >= current.length) {
          return current
        }
        const next = [...current]
        next.splice(index, 1)
        return next
      })
      setAdminNotice('Sommet supprime. Clique sur "Enregistrer" pour valider.')
    },
    [editDraft, pushLocalHistory],
  )

  const handleToolbarToggleRedraw = useCallback(() => {
    if (!selectedFeature || !editDraft) {
      setAdminNotice('Sélectionne un élément sur la carte avant de redessiner.')
      return
    }
    if (isLayerLocked(selectedFeature.category, selectedFeature.layerId)) {
      setAdminNotice('Calque verrouillé: redessin indisponible.')
      return
    }

    if (isRedrawingEditGeometry) {
      setIsRedrawingEditGeometry(false)
      setEditPoints(getFeaturePoints(selectedFeature.feature))
      setAdminNotice(null)
      return
    }

    setAdminMode('edit')
    pushLocalHistory('Édition: démarrer redessin')
    setIsRedrawingEditGeometry(true)
    setEditPoints([])
    setAdminNotice(
      'Redessin actif: clique sur la carte, puis Entrer pour enregistrer.',
    )
  }, [
    editDraft,
    isLayerLocked,
    isRedrawingEditGeometry,
    pushLocalHistory,
    selectedFeature,
  ])

  const handleToolbarUndoLastPoint = useCallback(() => {
    if (isMeasureMode) {
      if (measurePoints.length === 0) {
        return
      }
      pushLocalHistory('Mesure: annuler dernier point')
      setMeasurePoints((current) => current.slice(0, -1))
      return
    }
    if (adminMode === 'create') {
      if (createPoints.length === 0) {
        return
      }
      pushLocalHistory('Création: annuler dernier point')
      setCreatePoints((current) => current.slice(0, -1))
      return
    }
    if (adminMode === 'edit' && isRedrawingEditGeometry) {
      if (editPoints.length === 0) {
        return
      }
      pushLocalHistory('Édition: annuler dernier point')
      setEditPoints((current) => current.slice(0, -1))
    }
  }, [
    adminMode,
    createPoints.length,
    editPoints.length,
    isMeasureMode,
    isRedrawingEditGeometry,
    measurePoints.length,
    pushLocalHistory,
  ])

  const handleToolbarClearPoints = useCallback(() => {
    if (isMeasureMode) {
      if (measurePoints.length === 0) {
        return
      }
      pushLocalHistory('Mesure: effacer')
      setMeasurePoints([])
      return
    }
    if (adminMode === 'create') {
      if (createPoints.length === 0) {
        return
      }
      pushLocalHistory('Création: effacer')
      setCreatePoints([])
      return
    }
    if (adminMode === 'edit' && isRedrawingEditGeometry) {
      if (editPoints.length === 0) {
        return
      }
      pushLocalHistory('Édition: effacer')
      setEditPoints([])
    }
  }, [
    adminMode,
    createPoints.length,
    editPoints.length,
    isMeasureMode,
    isRedrawingEditGeometry,
    measurePoints.length,
    pushLocalHistory,
  ])

  const handleToolbarPrimaryAction = useCallback(() => {
    if (adminMode === 'create') {
      void handleCreateFeature()
      return
    }
    if (adminMode === 'edit' && selectedFeatureId && editDraft) {
      void handleSaveEdition()
      return
    }
    if (
      adminMode === 'delete' &&
      (selectedFeatureIds.length > 0 || selectedFeatureId)
    ) {
      void handleDeleteFeature()
    }
  }, [
    adminMode,
    editDraft,
    handleCreateFeature,
    handleDeleteFeature,
    handleSaveEdition,
    selectedFeatureId,
    selectedFeatureIds,
  ])

  const handleRestoreFromTrash = async (featureId: string) => {
    if (!isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }

    setIsSaving(true)
    setAdminNotice(null)

    const result = await restoreFeatureFromTrash(featureId)
    if (!result.ok) {
      setIsSaving(false)
      setAdminNotice(`Erreur restauration: ${result.error}`)
      return
    }

    await syncSupabaseLayers()
    await refreshTrash()
    setSelectedFeatureId(featureId)
    setSelectedFeatureIds([featureId])
    await refreshFeatureVersions(featureId)
    setIsSaving(false)
    setAdminMode('edit')
    setAdminNotice('Élément restauré depuis la corbeille.')
  }

  const handleUndoFeatureVersion = async () => {
    if (!isAdmin || !selectedFeatureId) {
      setAdminNotice('Sélectionne un élément pour restaurer une version.')
      return
    }

    setIsSaving(true)
    setAdminNotice(null)

    const result = await restorePreviousFeatureVersion(selectedFeatureId)
    if (!result.ok) {
      setIsSaving(false)
      setAdminNotice(`Undo impossible: ${result.error}`)
      return
    }

    await syncSupabaseLayers()
    await refreshTrash()
    await refreshFeatureVersions(selectedFeatureId)
    setIsSaving(false)
    setAdminNotice('Version précédente restaurée.')
  }

  const handleMoveLayer = async (
    category: string,
    layerId: string,
    direction: 'up' | 'down',
  ) => {
    if (!isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }

    const categoryLayers = layers
      .filter((layer) => layer.category === category)
      .sort((left, right) => {
        const leftSort = getLayerSortOrderValue(left)
        const rightSort = getLayerSortOrderValue(right)
        if (leftSort !== rightSort) {
          return leftSort - rightSort
        }
        return left.label.localeCompare(right.label, 'fr')
      })

    const currentIndex = categoryLayers.findIndex((layer) => layer.id === layerId)
    if (currentIndex === -1) {
      return
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= categoryLayers.length) {
      return
    }

    const currentLayer = categoryLayers[currentIndex]
    const targetLayer = categoryLayers[targetIndex]
    const currentSort = getLayerSortOrderValue(currentLayer, currentIndex)
    const targetSort = getLayerSortOrderValue(targetLayer, targetIndex)

    setIsSaving(true)
    setAdminNotice(null)

    const result = await persistLayerSortOrder([
      { category, layerId: currentLayer.id, sortOrder: targetSort },
      { category, layerId: targetLayer.id, sortOrder: currentSort },
    ])

    if (!result.ok) {
      setIsSaving(false)
      setAdminNotice(`Erreur ordre manuel: ${result.error}`)
      return
    }

    await syncSupabaseLayers()
    setIsSaving(false)
    setAdminNotice('Ordre du calque mis à jour.')
  }

  const handleCreateLayer = useCallback(
    async (options?: { presetCategory?: string; requireNewSection?: boolean }) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }

      const categoryPromptDefault =
        options?.presetCategory?.trim() || categories[0] || ''
      const categoryPrompt = window.prompt(
        'Nom de la section cible',
        categoryPromptDefault || 'Nouvelle section',
      )
      if (categoryPrompt === null) {
        return
      }

      const nextCategory = categoryPrompt.trim()
      if (!nextCategory) {
        setAdminNotice('Nom de section invalide.')
        return
      }

      if (
        options?.requireNewSection &&
        categories.some(
          (category) =>
            category.localeCompare(nextCategory, 'fr', {
              sensitivity: 'base',
            }) === 0,
        )
      ) {
        setAdminNotice(`La section "${nextCategory}" existe déjà.`)
        return
      }

      const labelPrompt = window.prompt('Nom du nouveau calque', 'Nouveau calque')
      if (labelPrompt === null) {
        return
      }
      const nextLabel = labelPrompt.trim()
      if (!nextLabel) {
        setAdminNotice('Nom de calque invalide.')
        return
      }

      const defaultLayerId =
        toLayerId('', nextLabel) || `layer-${crypto.randomUUID().slice(0, 8)}`
      const idPrompt = window.prompt(
        'Identifiant technique du calque',
        defaultLayerId,
      )
      if (idPrompt === null) {
        return
      }

      const nextLayerId = toLayerId(idPrompt, nextLabel)
      if (!nextLayerId) {
        setAdminNotice('Identifiant de calque invalide.')
        return
      }

      if (layers.some((layer) => layer.id === nextLayerId)) {
        setAdminNotice(`Un calque avec l'identifiant "${nextLayerId}" existe déjà.`)
        return
      }

      const labelExistsInSection = layers.some(
        (layer) =>
          layer.category === nextCategory &&
          layer.label.localeCompare(nextLabel, 'fr', { sensitivity: 'base' }) === 0,
      )
      if (labelExistsInSection) {
        setAdminNotice(`Un calque "${nextLabel}" existe déjà dans cette section.`)
        return
      }

      const siblingLayers = layers.filter((layer) => layer.category === nextCategory)
      const nextLayerSortOrder =
        siblingLayers.reduce(
          (maxOrder, layer, index) =>
            Math.max(maxOrder, getLayerSortOrderValue(layer, index)),
          -1,
        ) + 1

      const existingSectionOrder = sectionSortOrderByCategory.get(nextCategory)
      const nextSectionSortOrder =
        sectionSortOrderByCategory.size === 0
          ? 0
          : Math.max(...Array.from(sectionSortOrderByCategory.values())) + 1

      setIsSaving(true)
      setAdminNotice(null)

      const result = await createLayerMetadata({
        layerId: nextLayerId,
        label: nextLabel,
        category: nextCategory,
        sortOrder: nextLayerSortOrder,
        sectionSortOrder: existingSectionOrder ?? nextSectionSortOrder,
      })

      if (!result.ok) {
        setIsSaving(false)
        setAdminNotice(`Erreur création calque: ${result.error}`)
        return
      }

      await syncSupabaseLayers(nextLayerId)
      setActiveLayers((current) => ({
        ...current,
        [nextLayerId]: true,
      }))
      setCollapsedLayerFolders((current) => ({
        ...current,
        [nextCategory]: false,
      }))
      setCreateDraft((current) => ({
        ...current,
        category: nextCategory,
        layerId: nextLayerId,
        layerLabel: nextLabel,
      }))
      setImportDraft((current) => ({
        ...current,
        category: nextCategory,
        layerId: nextLayerId,
        layerLabel: nextLabel,
      }))

      setIsSaving(false)
      setAdminNotice(`Calque "${nextLabel}" créé dans "${nextCategory}".`)
    },
    [
      categories,
      isAdmin,
      layers,
      sectionSortOrderByCategory,
      syncSupabaseLayers,
    ],
  )

  const handleRenameLayer = useCallback(
    async (category: string, layerId: string, currentLabel: string) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }
      if (isLayerLocked(category, layerId)) {
        setAdminNotice('Calque verrouillé: renommage indisponible.')
        return
      }

      const promptValue = window.prompt('Nouveau nom du calque', currentLabel)
      if (promptValue === null) {
        return
      }
      const nextLabel = promptValue.trim()
      if (!nextLabel) {
        setAdminNotice('Nom de calque invalide.')
        return
      }
      if (
        nextLabel.localeCompare(currentLabel, 'fr', { sensitivity: 'base' }) === 0
      ) {
        return
      }

      const duplicateLabel = layers.some(
        (layer) =>
          layer.id !== layerId &&
          layer.category === category &&
          layer.label.localeCompare(nextLabel, 'fr', { sensitivity: 'base' }) === 0,
      )
      if (duplicateLabel) {
        setAdminNotice(`Un calque "${nextLabel}" existe déjà dans cette section.`)
        return
      }

      setIsSaving(true)
      setAdminNotice(null)

      const result = await renameLayerMetadata(category, layerId, nextLabel)
      if (!result.ok) {
        setIsSaving(false)
        setAdminNotice(`Erreur renommage calque: ${result.error}`)
        return
      }

      await syncSupabaseLayers(layerId)
      setCreateDraft((current) =>
        current.layerId === layerId && current.category === category
          ? { ...current, layerLabel: nextLabel }
          : current,
      )
      setImportDraft((current) =>
        current.layerId === layerId && current.category === category
          ? { ...current, layerLabel: nextLabel }
          : current,
      )
      setEditDraft((current) =>
        current && current.layerId === layerId && current.category === category
          ? { ...current, layerLabel: nextLabel }
          : current,
      )
      setIsSaving(false)
      setAdminNotice(`Calque renommé en "${nextLabel}".`)
    },
    [isAdmin, isLayerLocked, layers, syncSupabaseLayers],
  )

  const handleDeleteLayer = useCallback(
    async (category: string, layerId: string, label: string) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }
      if (isLayerLocked(category, layerId)) {
        setAdminNotice('Calque verrouillé: suppression indisponible.')
        return
      }

      const confirmed = window.confirm(
        `Supprimer le calque "${label}" ? Les éléments seront déplacés dans la corbeille.`,
      )
      if (!confirmed) {
        return
      }

      const shouldResetSelectedFeature =
        selectedFeatureId !== null &&
        (() => {
          const selectedRef = featureById.get(selectedFeatureId)
          return Boolean(
            selectedRef &&
              selectedRef.category === category &&
              selectedRef.layerId === layerId,
          )
        })()
      const shouldResetSelectedFeatures = selectedFeatureIds.some((featureId) => {
        const ref = featureById.get(featureId)
        return Boolean(ref && ref.category === category && ref.layerId === layerId)
      })

      setIsSaving(true)
      setAdminNotice(null)

      const result = await deleteLayerMetadata(category, layerId)
      if (!result.ok) {
        setIsSaving(false)
        setAdminNotice(`Erreur suppression calque: ${result.error}`)
        return
      }

      await syncSupabaseLayers()
      await refreshTrash()
      if (shouldResetSelectedFeature || shouldResetSelectedFeatures) {
        setSelectedFeatureId(null)
        setSelectedFeatureIds([])
        setEditDraft(null)
        setEditPoints([])
      }
      setIsSaving(false)
      setAdminNotice(`Calque "${label}" supprimé.`)
    },
    [
      featureById,
      isAdmin,
      isLayerLocked,
      refreshTrash,
      selectedFeatureId,
      selectedFeatureIds,
      syncSupabaseLayers,
    ],
  )

  const handleMoveSection = useCallback(
    async (category: string, direction: 'up' | 'down') => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }

      const currentIndex = categories.findIndex(
        (item) => item.localeCompare(category, 'fr', { sensitivity: 'base' }) === 0,
      )
      if (currentIndex === -1) {
        return
      }

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= categories.length) {
        return
      }

      const targetCategory = categories[targetIndex]
      const currentOrder =
        sectionSortOrderByCategory.get(category) ?? currentIndex
      const targetOrder =
        sectionSortOrderByCategory.get(targetCategory) ?? targetIndex

      setIsSaving(true)
      setAdminNotice(null)

      const result = await persistSectionSortOrder([
        { category, sortOrder: targetOrder },
        { category: targetCategory, sortOrder: currentOrder },
      ])

      if (!result.ok) {
        setIsSaving(false)
        setAdminNotice(`Erreur ordre section: ${result.error}`)
        return
      }

      await syncSupabaseLayers()
      setIsSaving(false)
      setAdminNotice('Ordre des sections mis à jour.')
    },
    [categories, isAdmin, sectionSortOrderByCategory, syncSupabaseLayers],
  )

  const handleRenameSection = useCallback(
    async (currentCategory: string) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }

      const promptValue = window.prompt(
        'Nouveau nom de section',
        currentCategory,
      )
      if (promptValue === null) {
        return
      }
      const nextCategory = promptValue.trim()
      if (!nextCategory) {
        setAdminNotice('Nom de section invalide.')
        return
      }
      if (
        nextCategory.localeCompare(currentCategory, 'fr', {
          sensitivity: 'base',
        }) === 0
      ) {
        return
      }

      const duplicateSection = categories.some(
        (category) =>
          category.localeCompare(nextCategory, 'fr', {
            sensitivity: 'base',
          }) === 0,
      )
      if (duplicateSection) {
        setAdminNotice(`La section "${nextCategory}" existe déjà.`)
        return
      }

      setIsSaving(true)
      setAdminNotice(null)

      const result = await renameLayerSection(currentCategory, nextCategory)
      if (!result.ok) {
        setIsSaving(false)
        setAdminNotice(`Erreur renommage section: ${result.error}`)
        return
      }

      await syncSupabaseLayers()
      setCollapsedLayerFolders((current) => {
        if (current[currentCategory] === undefined) {
          return current
        }
        const next = { ...current, [nextCategory]: current[currentCategory] }
        delete next[currentCategory]
        return next
      })
      setCreateDraft((current) =>
        current.category === currentCategory
          ? { ...current, category: nextCategory }
          : current,
      )
      setImportDraft((current) =>
        current.category === currentCategory
          ? { ...current, category: nextCategory }
          : current,
      )
      setEditDraft((current) =>
        current && current.category === currentCategory
          ? { ...current, category: nextCategory }
          : current,
      )
      setIsSaving(false)
      setAdminNotice(`Section renommée en "${nextCategory}".`)
    },
    [categories, isAdmin, syncSupabaseLayers],
  )

  const handleDeleteSection = useCallback(
    async (category: string) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }

      const hasLockedLayers = layers.some(
        (layer) => layer.category === category && isLayerLocked(category, layer.id),
      )
      if (hasLockedLayers) {
        setAdminNotice(
          'Section verrouillée: déverrouille les calques concernés avant suppression.',
        )
        return
      }

      const confirmed = window.confirm(
        `Supprimer la section "${category}" ? Tous ses calques seront supprimés et les éléments envoyés en corbeille.`,
      )
      if (!confirmed) {
        return
      }

      const shouldResetSelectedFeature =
        selectedFeatureId !== null &&
        (() => {
          const selectedRef = featureById.get(selectedFeatureId)
          return Boolean(selectedRef && selectedRef.category === category)
        })()
      const shouldResetSelectedFeatures = selectedFeatureIds.some((featureId) => {
        const ref = featureById.get(featureId)
        return Boolean(ref && ref.category === category)
      })

      setIsSaving(true)
      setAdminNotice(null)

      const result = await deleteLayerSection(category)
      if (!result.ok) {
        setIsSaving(false)
        setAdminNotice(`Erreur suppression section: ${result.error}`)
        return
      }

      await syncSupabaseLayers()
      await refreshTrash()
      if (shouldResetSelectedFeature || shouldResetSelectedFeatures) {
        setSelectedFeatureId(null)
        setSelectedFeatureIds([])
        setEditDraft(null)
        setEditPoints([])
      }
      setIsSaving(false)
      setAdminNotice(`Section "${category}" supprimée.`)
    },
    [
      featureById,
      isAdmin,
      isLayerLocked,
      layers,
      refreshTrash,
      selectedFeatureId,
      selectedFeatureIds,
      syncSupabaseLayers,
    ],
  )

  const handleDuplicateLayer = useCallback(
    async (category: string, layerId: string) => {
      if (!supabase || !isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }
      if (isLayerLocked(category, layerId)) {
        setAdminNotice('Calque verrouillé: duplication indisponible.')
        return
      }

      const sourceLayer = layers.find(
        (layer) => layer.category === category && layer.id === layerId,
      )
      if (!sourceLayer) {
        setAdminNotice('Calque introuvable.')
        return
      }
      if (sourceLayer.features.length === 0) {
        setAdminNotice('Duplication impossible: calque vide.')
        return
      }

      const siblingLayers = layers.filter((layer) => layer.category === category)
      const baseLabel = `${sourceLayer.label} (copie)`
      let duplicateLabel = baseLabel
      let duplicateLayerId = toLayerId('', duplicateLabel) || `${sourceLayer.id}-copie`
      let suffix = 2
      while (
        siblingLayers.some(
          (layer) =>
            layer.id === duplicateLayerId ||
            layer.label.localeCompare(duplicateLabel, 'fr', {
              sensitivity: 'base',
            }) === 0,
        )
      ) {
        duplicateLabel = `${baseLabel} ${suffix}`
        duplicateLayerId =
          toLayerId('', duplicateLabel) || `${sourceLayer.id}-copie-${suffix}`
        suffix += 1
      }

      const layerSortOrder =
        siblingLayers.reduce(
          (maxOrder, layer, index) =>
            Math.max(maxOrder, getLayerSortOrderValue(layer, index)),
          -1,
        ) + 1

      const rows = sourceLayer.features.map((feature, index) => ({
        id: `layerdup_${crypto.randomUUID()}`,
        name: feature.name,
        status: feature.status,
        category,
        layer_id: duplicateLayerId,
        layer_label: duplicateLabel,
        layer_sort_order: layerSortOrder,
        color: feature.color,
        style: feature.style ?? null,
        geometry_type: feature.geometry,
        coordinates: toCoordinates(feature.geometry, getFeaturePoints(feature)),
        sort_order: index + 1,
        source: 'manual_layer_duplicate',
      }))

      setIsSaving(true)
      setAdminNotice(null)
      let didFallbackWithoutStyle = false
      let { error } = await supabase.from('map_features').insert(rows)
      if (error && isMissingStyleColumnError(error.message)) {
        const legacyRows = rows.map((row) => ({
          ...row,
          style: undefined,
        }))
        const retry = await supabase.from('map_features').insert(legacyRows)
        error = retry.error
        didFallbackWithoutStyle = !error
      }
      if (error) {
        setIsSaving(false)
        setAdminNotice(`Erreur duplication calque: ${error.message}`)
        return
      }

      await syncSupabaseLayers(duplicateLayerId)
      setActiveLayers((current) => ({
        ...current,
        [duplicateLayerId]: true,
      }))
      setCollapsedLayerFolders((current) => ({
        ...current,
        [category]: false,
      }))
      setIsSaving(false)
      setAdminNotice(
        didFallbackWithoutStyle
          ? `Calque dupliqué (${rows.length} éléments), styles non persistés: applique web/supabase/schema.sql.`
          : `Calque dupliqué (${rows.length} éléments).`,
      )
    },
    [
      isAdmin,
      isLayerLocked,
      layers,
      syncSupabaseLayers,
    ],
  )

  const handleExportGeoJson = () => {
    if (visibleExportEntries.length === 0) {
      setAdminNotice('Aucun élément visible à exporter.')
      return
    }

    const payload = buildGeoJsonExport(visibleExportEntries)
    const day = new Date().toISOString().slice(0, 10)
    downloadTextFile(
      `marseille2033-export-${day}.geojson`,
      JSON.stringify(payload, null, 2),
      'application/geo+json;charset=utf-8',
    )
    setAdminNotice(`Export GeoJSON créé (${visibleExportEntries.length} éléments).`)
  }

  const handleExportKml = () => {
    if (visibleExportEntries.length === 0) {
      setAdminNotice('Aucun élément visible à exporter.')
      return
    }

    const payload = buildKmlExport(visibleExportEntries)
    const day = new Date().toISOString().slice(0, 10)
    downloadTextFile(
      `marseille2033-export-${day}.kml`,
      payload,
      'application/vnd.google-earth.kml+xml;charset=utf-8',
    )
    setAdminNotice(`Export KML créé (${visibleExportEntries.length} éléments).`)
  }

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setImportFile(file)
    setImportPreviewCount(null)
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const imported = parseImportedFeatures(text, file.name)
      setImportPreviewCount(imported.length)
      if (imported.length === 0) {
        setAdminNotice('Fichier chargé mais aucun élément exploitable trouvé.')
      } else {
        setAdminNotice(
          `Fichier chargé: ${imported.length} élément(s) détecté(s).`,
        )
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Lecture du fichier impossible.'
      setAdminNotice(`Erreur import: ${message}`)
    }
  }

  const handleImportFeatures = async () => {
    if (!isAdmin) {
      setAdminNotice('Connexion admin requise.')
      return
    }
    if (!importFile) {
      setAdminNotice('Sélectionne un fichier GeoJSON/KML à importer.')
      return
    }

    const layerLabel = importDraft.layerLabel.trim()
    const category = importDraft.category.trim()
    const layerId = toLayerId(importDraft.layerId, layerLabel)
    if (!layerLabel || !category || !layerId) {
      setAdminNotice('Catégorie, identifiant calque et nom calque sont requis.')
      return
    }

    if (!isHexColor(importDraft.defaultColor)) {
      setAdminNotice('Couleur par defaut invalide (#RRGGBB).')
      return
    }

    setIsImporting(true)
    setAdminNotice(null)

    try {
      const fileText = await importFile.text()
      const parsed = parseImportedFeatures(fileText, importFile.name)
      if (parsed.length === 0) {
        setIsImporting(false)
        setAdminNotice('Aucun élément importable détecté dans ce fichier.')
        return
      }

      const basename = sanitizeFileBasename(importFile.name) || 'import'
      const existingLayer = layers.find(
        (layer) => layer.id === layerId && layer.category === category,
      )
      const layerSortOrder =
        existingLayer !== undefined
          ? getLayerSortOrderValue(existingLayer)
          : layers
              .filter((layer) => layer.category === category)
              .reduce(
                (maxOrder, layer, index) =>
                  Math.max(maxOrder, getLayerSortOrderValue(layer, index)),
                -1,
              ) + 1

      const existingFeatureCount =
        layers.find((layer) => layer.id === layerId)?.features.length ?? 0

      const rows: ImportFeatureInsert[] = []
      for (let index = 0; index < parsed.length; index += 1) {
        const item = parsed[index]
        const coordinates = toCoordinatesFromImported(item)
        if (!coordinates) {
          continue
        }
        rows.push({
          id: `import_${basename}_${Date.now()}_${index}_${crypto.randomUUID().slice(0, 8)}`,
          name: item.name || `Import ${index + 1}`,
          status: item.status ?? importDraft.defaultStatus,
          category,
          layerId,
          layerLabel,
          layerSortOrder,
          color: item.color ?? importDraft.defaultColor,
          style: toFeatureStylePayload(item.geometry, {
            pointRadius: DEFAULT_POINT_RADIUS,
            lineWidth: DEFAULT_LINE_WIDTH,
            fillOpacity: DEFAULT_POLYGON_FILL_OPACITY,
            pointIcon: DEFAULT_POINT_ICON,
            labelMode: DEFAULT_LABEL_MODE,
            labelSize: DEFAULT_LABEL_SIZE,
            labelHalo: DEFAULT_LABEL_HALO,
            labelPriority: DEFAULT_LABEL_PRIORITY,
            lineDash: DEFAULT_LINE_DASH,
            lineArrows: DEFAULT_LINE_ARROWS,
            lineDirection: DEFAULT_LINE_DIRECTION,
            polygonPattern: DEFAULT_POLYGON_PATTERN,
            polygonBorderMode: DEFAULT_POLYGON_BORDER_MODE,
          }),
          geometryType: item.geometry,
          coordinates,
          sortOrder: existingFeatureCount + index + 1,
          source: 'manual_import',
        })
      }

      if (rows.length === 0) {
        setIsImporting(false)
        setAdminNotice('Aucun élément valide après normalisation.')
        return
      }

      const result = await importFeaturesToSupabase(rows)
      if (!result.ok) {
        setIsImporting(false)
        setAdminNotice(`Erreur import: ${result.error}`)
        return
      }

      setImportFile(null)
      setImportPreviewCount(null)
      await syncSupabaseLayers(layerId)
      setActiveLayers((current) => ({
        ...current,
        [layerId]: true,
      }))
      setIsImporting(false)
      setAdminNotice(
        `Import terminé: ${result.data.inserted} élément(s) ajoutés.`,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Import impossible.'
      setIsImporting(false)
      setAdminNotice(`Erreur import: ${message}`)
    }
  }

  const setCreateLayerTemplate = (layerId: string) => {
    const match = layerSuggestions.find((layer) => layer.id === layerId)
    if (!match) {
      return
    }

    setCreateDraft((current) => ({
      ...current,
      category: match.category,
      layerId: match.id,
      layerLabel: match.label,
    }))
  }

  const setEditLayerTemplate = (layerId: string) => {
    if (!editDraft) {
      return
    }

    const match = layerSuggestions.find((layer) => layer.id === layerId)
    if (!match) {
      return
    }

    setEditDraft({
      ...editDraft,
      category: match.category,
      layerId: match.id,
      layerLabel: match.label,
    })
  }

  const setImportLayerTemplate = (layerId: string) => {
    const match = layerSuggestions.find((layer) => layer.id === layerId)
    if (!match) {
      return
    }

    setImportDraft((current) => ({
      ...current,
      category: match.category,
      layerId: match.id,
      layerLabel: match.label,
    }))
  }

  useEffect(() => {
    if (!isAdmin) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isInputLikeElement(event.target)) {
        return
      }

      const key = event.key.toLowerCase()
      const isMeta = event.metaKey || event.ctrlKey
      if (isMeta && !event.shiftKey && key === 'z') {
        event.preventDefault()
        handleLocalUndo()
        return
      }
      if (isMeta && ((event.shiftKey && key === 'z') || key === 'y')) {
        event.preventDefault()
        handleLocalRedo()
        return
      }

      if (key === 'm') {
        event.preventDefault()
        handleToggleMeasureMode()
        return
      }
      if (key === 'g') {
        event.preventDefault()
        handleToggleGrid()
        return
      }
      if (key === 'x') {
        event.preventDefault()
        handleToggleSnapping()
        return
      }
      if (key === '?') {
        event.preventDefault()
        setIsShortcutHelpOpen((current) => !current)
        return
      }
      if (key === 'p') {
        event.preventDefault()
        setIsPresentationMode((current) => !current)
        return
      }
      if (key === '1') {
        event.preventDefault()
        handleToolbarToolClick('create', 'point')
        return
      }
      if (key === '2') {
        event.preventDefault()
        handleToolbarToolClick('create', 'line')
        return
      }
      if (key === '3') {
        event.preventDefault()
        handleToolbarToolClick('create', 'polygon')
        return
      }
      if (key === 'e') {
        event.preventDefault()
        handleToolbarToolClick('edit')
        return
      }
      if (key === 'd') {
        event.preventDefault()
        handleToolbarToolClick('delete')
        return
      }
      if (key === 'r' && adminMode === 'edit') {
        event.preventDefault()
        handleToolbarToggleRedraw()
        return
      }
      if (key === 'z' && (adminMode === 'edit' || adminMode === 'delete')) {
        event.preventDefault()
        handleToggleZoneSelection()
        return
      }

      if (event.key === 'Backspace') {
        if (adminMode === 'create' && createPoints.length > 0) {
          event.preventDefault()
          handleToolbarUndoLastPoint()
          return
        }
        if (adminMode === 'edit' && isRedrawingEditGeometry && editPoints.length > 0) {
          event.preventDefault()
          handleToolbarUndoLastPoint()
          return
        }
      }

      if (event.key === 'Enter') {
        if (
          adminMode === 'create' &&
          isGeometryComplete(createDraft.geometry, createPoints)
        ) {
          event.preventDefault()
          handleToolbarPrimaryAction()
          return
        }
        if (
          adminMode === 'edit' &&
          isRedrawingEditGeometry &&
          editDraft &&
          isGeometryComplete(editDraft.geometry, editPoints)
        ) {
          event.preventDefault()
          handleToolbarPrimaryAction()
          return
        }
        if (
          adminMode === 'edit' &&
          !isRedrawingEditGeometry &&
          selectedFeatureId &&
          editDraft
        ) {
          event.preventDefault()
          handleToolbarPrimaryAction()
          return
        }
        if (
          adminMode === 'delete' &&
          (selectedFeatureIds.length > 0 || selectedFeatureId)
        ) {
          event.preventDefault()
          handleToolbarPrimaryAction()
          return
        }
      }

      if (event.key === 'Escape') {
        if (isShortcutHelpOpen) {
          event.preventDefault()
          setIsShortcutHelpOpen(false)
          return
        }
        if (adminMode === 'create' && createPoints.length > 0) {
          event.preventDefault()
          setCreatePoints([])
          return
        }
        if (adminMode === 'edit' && isRedrawingEditGeometry) {
          event.preventDefault()
          setIsRedrawingEditGeometry(false)
          if (selectedFeature) {
            setEditPoints(getFeaturePoints(selectedFeature.feature))
          }
          return
        }
        if (isZoneSelectionMode) {
          event.preventDefault()
          setIsZoneSelectionMode(false)
          setIsZoneSelectionDragging(false)
          setZoneSelectionStart(null)
          setZoneSelectionCurrent(null)
          setAdminNotice('Sélection zone annulée.')
          return
        }
        if (isMeasureMode) {
          event.preventDefault()
          if (measurePoints.length > 0) {
            setMeasurePoints([])
            setAdminNotice('Mesure réinitialisée.')
          } else {
            setIsMeasureMode(false)
            setAdminNotice('Outil mesure désactivé.')
          }
          setSnapPreview(null)
          return
        }
        if (isPresentationMode) {
          event.preventDefault()
          setIsPresentationMode(false)
          return
        }
        if (adminMode !== 'view') {
          event.preventDefault()
          setAdminMode('view')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    adminMode,
    createDraft.geometry,
    createPoints,
    editDraft,
    editPoints,
    handleToolbarPrimaryAction,
    handleToggleZoneSelection,
    handleToggleGrid,
    handleToggleMeasureMode,
    handleToggleSnapping,
    handleToolbarToggleRedraw,
    handleToolbarToolClick,
    handleToolbarUndoLastPoint,
    handleLocalRedo,
    handleLocalUndo,
    isAdmin,
    isMeasureMode,
    isPresentationMode,
    isRedrawingEditGeometry,
    isShortcutHelpOpen,
    isZoneSelectionMode,
    measurePoints.length,
    selectedFeature,
    selectedFeatureId,
    selectedFeatureIds,
  ])

  useEffect(() => {
    if (!featureContextMenu) {
      return
    }

    const closeMenu = () => {
      setFeatureContextMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [featureContextMenu])

  const renderDraftGeometry = () => {
    if (!isAdmin) {
      return null
    }

    if (adminMode === 'create' && createPoints.length > 0) {
      if (createDraft.geometry === 'point') {
        return (
          <CircleMarker
            center={createPoints[0]}
            radius={normalizePointRadius(createDraft.pointRadius)}
            pathOptions={{
              color: '#111827',
              fillColor: createDraft.color,
              fillOpacity: 0.9,
              weight: 2,
            }}
          />
        )
      }

      if (createDraft.geometry === 'line') {
        return (
          <Polyline
            positions={createPoints}
            pathOptions={{
              color: createDraft.color,
              weight: normalizeLineWidth(createDraft.lineWidth),
              dashArray: '7 7',
            }}
          />
        )
      }

      if (createPoints.length >= 3) {
        return (
          <Polygon
            positions={createPoints}
            pathOptions={{
              color: createDraft.color,
              weight: normalizeLineWidth(createDraft.lineWidth),
              dashArray: '7 7',
              fillOpacity: normalizeFillOpacity(createDraft.fillOpacity),
            }}
          />
        )
      }

      return (
        <Polyline
          positions={createPoints}
          pathOptions={{
            color: createDraft.color,
            weight: normalizeLineWidth(createDraft.lineWidth),
            dashArray: '7 7',
          }}
        />
      )
    }

    if (
      adminMode === 'edit' &&
      editDraft &&
      editPoints.length > 0 &&
      !isRedrawingEditGeometry
    ) {
      if (editDraft.geometry === 'point') {
        return (
          <CircleMarker
            center={editPoints[0]}
            radius={clamp(normalizePointRadius(editDraft.pointRadius) + 1, 3, 24)}
            pathOptions={{
              color: '#111827',
              fillColor: editDraft.color,
              fillOpacity: 0.95,
              weight: 3,
            }}
          />
        )
      }

      if (editDraft.geometry === 'line') {
        return (
          <Polyline
            positions={editPoints}
            pathOptions={{
              color: editDraft.color,
              weight: clamp(normalizeLineWidth(editDraft.lineWidth) + 1, 1, 14),
              opacity: 0.95,
              dashArray: toDashArray(editDraft.lineDash),
            }}
          />
        )
      }

      const editPolygonDash =
        editDraft.polygonPattern === 'diagonal'
          ? '9 6'
          : editDraft.polygonPattern === 'cross'
            ? '4 4'
            : editDraft.polygonPattern === 'dots'
              ? '1 7'
              : undefined
      return (
        <Polygon
          positions={editPoints}
          pathOptions={{
            color: editDraft.color,
            weight: clamp(normalizeLineWidth(editDraft.lineWidth) + 1, 1, 14),
            fillColor: editDraft.color,
            fillOpacity: clamp(normalizeFillOpacity(editDraft.fillOpacity) + 0.08, 0.05, 0.95),
            dashArray: editPolygonDash,
          }}
        />
      )
    }

    if (
      adminMode === 'edit' &&
      isRedrawingEditGeometry &&
      editDraft &&
      editPoints.length > 0
    ) {
      if (editDraft.geometry === 'point') {
        return (
          <CircleMarker
            center={editPoints[0]}
            radius={normalizePointRadius(editDraft.pointRadius)}
            pathOptions={{
              color: '#111827',
              fillColor: editDraft.color,
              fillOpacity: 0.9,
              weight: 2,
            }}
          />
        )
      }

      if (editDraft.geometry === 'line') {
        return (
          <Polyline
            positions={editPoints}
            pathOptions={{
              color: editDraft.color,
              weight: normalizeLineWidth(editDraft.lineWidth),
              dashArray: '7 7',
            }}
          />
        )
      }

      if (editPoints.length >= 3) {
        return (
          <Polygon
            positions={editPoints}
            pathOptions={{
              color: editDraft.color,
              weight: normalizeLineWidth(editDraft.lineWidth),
              dashArray: '7 7',
              fillOpacity: normalizeFillOpacity(editDraft.fillOpacity),
            }}
          />
        )
      }

      return (
        <Polyline
          positions={editPoints}
          pathOptions={{
            color: editDraft.color,
            weight: normalizeLineWidth(editDraft.lineWidth),
            dashArray: '7 7',
          }}
        />
      )
    }

    return null
  }

  const renderDirectEditHandles = () => {
    if (
      !isDirectGeometryEditing ||
      !selectedFeatureId ||
      !selectedFeature ||
      !editDraft ||
      editPoints.length === 0
    ) {
      return null
    }

    if (editDraft.geometry === 'point') {
      return (
        <Marker
          key={`edit-handle-point-${selectedFeatureId}`}
          position={editPoints[0]}
          draggable
          icon={pointHandleIcon}
          eventHandlers={{
            dragstart: () => handleEditVertexDragStart(),
            drag: (event) => handleEditVertexDrag(0, event),
            dragend: (event) => handleEditVertexDragEnd(0, event),
          }}
        />
      )
    }

    const vertexMarkers = editPoints.map((position, index) => (
      <Marker
        key={`edit-handle-${selectedFeatureId}-${index}`}
        position={position}
        draggable
        icon={vertexHandleIcon}
        eventHandlers={{
          dragstart: () => handleEditVertexDragStart(),
          drag: (event) => handleEditVertexDrag(index, event),
          dragend: (event) => handleEditVertexDragEnd(index, event),
          contextmenu: (event: LeafletMouseEvent) => {
            event.originalEvent.preventDefault()
            event.originalEvent.stopPropagation()
            handleDeleteEditVertex(index)
          },
        }}
      />
    ))

    const midpointMarkers: ReactNode[] = []
    for (let index = 0; index < editPoints.length - 1; index += 1) {
      midpointMarkers.push(
        <Marker
          key={`edit-midpoint-${selectedFeatureId}-${index}`}
          position={midpoint(editPoints[index], editPoints[index + 1])}
          icon={midpointHandleIcon}
          eventHandlers={{
            click: (event: LeafletMouseEvent) => {
              event.originalEvent.preventDefault()
              event.originalEvent.stopPropagation()
              handleInsertEditVertex(index, midpoint(editPoints[index], editPoints[index + 1]))
            },
          }}
        />,
      )
    }

    if (editDraft.geometry === 'polygon' && editPoints.length >= 3) {
      const lastIndex = editPoints.length - 1
      midpointMarkers.push(
        <Marker
          key={`edit-midpoint-${selectedFeatureId}-close`}
          position={midpoint(editPoints[lastIndex], editPoints[0])}
          icon={midpointHandleIcon}
          eventHandlers={{
            click: (event: LeafletMouseEvent) => {
              event.originalEvent.preventDefault()
              event.originalEvent.stopPropagation()
              handleInsertEditVertex(lastIndex, midpoint(editPoints[lastIndex], editPoints[0]))
            },
          }}
        />,
      )
    }

    return [...vertexMarkers, ...midpointMarkers]
  }

  const renderLayerFeatures = (layer: LayerConfig) => {
    const layerLocked = isLayerLocked(layer.category, layer.id)
    const layerOpacity = getLayerOpacity(layer.category, layer.id)
    return layer.features
      .filter((feature) => isFeatureVisibleByFilters(feature))
      .flatMap((feature) => {
        const styleDraft = resolveDraftStyle(feature.geometry, feature.style)
        const isSelected = selectedFeatureIdSet.has(feature.id)
        const isFocusedSelection = selectedFeatureId === feature.id
        const isHiddenSelectedGeometry =
          isFocusedSelection &&
          adminMode === 'edit' &&
          editDraft !== null &&
          editPoints.length > 0

        if (isHiddenSelectedGeometry) {
          return [] as ReactElement[]
        }

        const popup = (
          <Popup>
            <div className="popup-content">
              <h4>{feature.name}</h4>
              <p>
                <strong>Catégorie:</strong> {layer.category}
              </p>
              <p>
                <strong>Calque:</strong> {layer.label}
              </p>
              <p>
                <strong>Statut:</strong> {STATUS_LABELS[feature.status]}
              </p>
              {layerLocked ? (
                <p>
                  <strong>Calque:</strong> verrouillé (lecture seule).
                </p>
              ) : null}
              {isAdmin ? (
                <p>
                  <strong>Admin:</strong> clique l'élément pour l'éditer.
                </p>
              ) : null}
            </div>
          </Popup>
        )

        const hoverLabelTooltip =
          styleDraft.labelMode === 'hover' ? (
            <Tooltip direction="top" sticky className="feature-hover-label">
              <span
                className="feature-hover-label-text"
                style={{
                  fontSize: `${styleDraft.labelSize}px`,
                  textShadow: styleDraft.labelHalo
                    ? '0 0 2px #fff, 0 0 5px #fff, 0 0 8px #fff'
                    : 'none',
                  opacity: clamp(layerOpacity + 0.1, 0.3, 1),
                }}
              >
                {feature.name}
              </span>
            </Tooltip>
          ) : null

        const eventHandlers = isAdmin
          ? {
              click: (event: LeafletMouseEvent) =>
                handleFeatureClick(feature.id, event),
              contextmenu: (event: LeafletMouseEvent) =>
                handleFeatureContextMenu(feature.id, event),
            }
          : undefined

        if (feature.geometry === 'point') {
          const radius = clamp(
            normalizePointRadius(styleDraft.pointRadius) + (isSelected ? 2 : 0),
            3,
            24,
          )
          if (styleDraft.pointIcon === 'dot') {
            return [
              <CircleMarker
                key={feature.id}
                center={feature.position}
                radius={radius}
                eventHandlers={eventHandlers}
                pathOptions={{
                  color: isSelected ? '#0f172a' : feature.color,
                  fillColor: feature.color,
                  opacity: clamp(layerOpacity + (isSelected ? 0.18 : 0), 0.15, 1),
                  fillOpacity: clamp(
                    (isSelected ? 0.95 : 0.85) * layerOpacity,
                    0.1,
                    1,
                  ),
                  weight: isSelected ? 3 : 2,
                }}
              >
                {popup}
                {hoverLabelTooltip}
              </CircleMarker>,
            ]
          }
          return [
            <Marker
              key={feature.id}
              position={feature.position}
              icon={makePointIcon(styleDraft.pointIcon, feature.color, isSelected, radius)}
              eventHandlers={eventHandlers}
              opacity={clamp(layerOpacity + (isSelected ? 0.15 : 0), 0.2, 1)}
            >
              {popup}
              {hoverLabelTooltip}
            </Marker>,
          ]
        }

        if (feature.geometry === 'line') {
          const lineDashArray = toDashArray(styleDraft.lineDash)
          const arrowMode: LineDirectionMode =
            styleDraft.lineDirection !== 'none'
              ? styleDraft.lineDirection
              : styleDraft.lineArrows
                ? 'forward'
                : 'none'
          const arrowAnchors = buildLineArrowAnchors(feature.positions, arrowMode)
          const elements: ReactElement[] = [
            <Polyline
              key={feature.id}
              positions={feature.positions}
              eventHandlers={eventHandlers}
              pathOptions={{
                color: feature.color,
                weight: clamp(
                  normalizeLineWidth(styleDraft.lineWidth) + (isSelected ? 1.3 : 0),
                  1,
                  14,
                ),
                opacity: clamp(0.9 * layerOpacity + (isSelected ? 0.14 : 0), 0.14, 1),
                dashArray: lineDashArray,
              }}
            >
              {popup}
              {hoverLabelTooltip}
            </Polyline>,
          ]
          for (const anchor of arrowAnchors) {
            elements.push(
              <Marker
                key={`${feature.id}-arrow-${anchor.id}`}
                position={anchor.position}
                icon={makeLineArrowIcon(feature.color, anchor.angle)}
                interactive={false}
                opacity={clamp(layerOpacity + (isSelected ? 0.1 : 0), 0.2, 1)}
              />,
            )
          }
          return elements
        }

        const polygonDashArray =
          styleDraft.polygonPattern === 'diagonal'
            ? '9 6'
            : styleDraft.polygonPattern === 'cross'
              ? '4 4'
              : styleDraft.polygonPattern === 'dots'
                ? '1 7'
                : undefined
        const baseWeight = clamp(
          normalizeLineWidth(styleDraft.lineWidth) + (isSelected ? 1 : 0),
          1,
          14,
        )
        const borderWeight =
          styleDraft.polygonBorderMode === 'inner'
            ? clamp(baseWeight - 1, 1, 14)
            : styleDraft.polygonBorderMode === 'outer'
              ? clamp(baseWeight + 1.4, 1, 14)
              : baseWeight
        const fillOpacity = clamp(
          normalizeFillOpacity(styleDraft.fillOpacity) +
            (isSelected ? 0.12 : 0) -
            (styleDraft.polygonPattern === 'none' ? 0 : 0.03),
          0.05,
          0.95,
        )

        const elements: ReactElement[] = [
          <Polygon
            key={feature.id}
            positions={feature.positions}
            eventHandlers={eventHandlers}
            pathOptions={{
              color: feature.color,
              weight: borderWeight,
              fillColor: feature.color,
              opacity: clamp(layerOpacity + (isSelected ? 0.12 : 0), 0.16, 1),
              fillOpacity: clamp(fillOpacity * layerOpacity, 0.05, 1),
              dashArray: polygonDashArray,
            }}
          >
            {popup}
            {hoverLabelTooltip}
          </Polygon>,
        ]
        if (styleDraft.polygonBorderMode === 'outer') {
          elements.push(
            <Polyline
              key={`${feature.id}-outer-border`}
              positions={[...feature.positions, feature.positions[0]]}
              interactive={false}
              pathOptions={{
                color: '#0f172a',
                weight: clamp(borderWeight + 2, 1, 14),
                opacity: clamp(0.24 * layerOpacity, 0.08, 0.8),
              }}
            />,
          )
        }
        return elements
      })
  }

  const toolbarPointCount =
    isMeasureMode
      ? measurePoints.length
      : adminMode === 'create'
      ? createPoints.length
      : adminMode === 'edit' && isRedrawingEditGeometry
        ? editPoints.length
        : 0
  const toolbarMinPoints =
    isMeasureMode
      ? measureGeometry === 'line'
        ? 2
        : 3
      : adminMode === 'create'
      ? MIN_POINTS_REQUIRED[createDraft.geometry]
      : adminMode === 'edit' && isRedrawingEditGeometry && editDraft
        ? MIN_POINTS_REQUIRED[editDraft.geometry]
        : 0
  const toolbarCanUndo =
    isMeasureMode
      ? measurePoints.length > 0
      : adminMode === 'create'
      ? createPoints.length > 0
      : adminMode === 'edit' && isRedrawingEditGeometry
        ? editPoints.length > 0
        : false
  const toolbarCanClear =
    isMeasureMode
      ? measurePoints.length > 0
      : adminMode === 'create'
      ? createPoints.length > 0
      : adminMode === 'edit' && isRedrawingEditGeometry
        ? editPoints.length > 0
        : false
  const toolbarCanConfirm =
    adminMode === 'create'
      ? isGeometryComplete(createDraft.geometry, createPoints)
      : adminMode === 'edit' && editDraft
        ? isRedrawingEditGeometry
          ? isGeometryComplete(editDraft.geometry, editPoints)
          : Boolean(selectedFeatureId)
        : adminMode === 'delete'
          ? selectedFeatureIds.length > 0 || Boolean(selectedFeatureId)
          : false

  const isGuidedDrawing =
    adminMode === 'create' || (adminMode === 'edit' && isRedrawingEditGeometry)
  const guideGeometry =
    adminMode === 'create'
      ? createDraft.geometry
      : adminMode === 'edit' && isRedrawingEditGeometry && editDraft
        ? editDraft.geometry
        : null
  const drawingGuideTitle =
    adminMode === 'create' ? 'Création en cours' : 'Redessin en cours'
  const canLocalUndo = localHistoryPast.length > 0
  const canLocalRedo = localHistoryFuture.length > 0
  const activeStyleDraft =
    adminMode === 'create'
      ? createDraft
      : adminMode === 'edit' && editDraft
        ? editDraft
        : null
  const activeTemplateId =
    adminMode === 'create'
      ? createTemplateId
      : adminMode === 'edit'
        ? editTemplateId
        : ''
  const canEditStyleIndividually =
    activeStyleDraft !== null && (adminMode === 'create' || selectedFeatureId !== null)
  const currentMapZoom = mapViewport?.zoom ?? 0
  const isLabelOverlayActive =
    isLabelOverlayEnabled && currentMapZoom >= labelMinZoom
  const mapLabelEntries = useMemo(() => {
    type LabelEntry = {
      id: string
      name: string
      color: string
      position: LatLngTuple
      labelSize: number
      labelHalo: boolean
      labelPriority: number
      labelMode: 'auto' | 'always'
      opacity: number
    }
    if (!isLabelOverlayActive) {
      return [] as LabelEntry[]
    }

    const candidates: LabelEntry[] = []
    for (const entry of mapVisibleFeatureEntries) {
      const style = resolveDraftStyle(entry.feature.geometry, entry.feature.style)
      if (style.labelMode === 'hover') {
        continue
      }
      candidates.push({
        id: entry.feature.id,
        name: entry.feature.name,
        color: entry.feature.color,
        position: computeFeatureCenter(entry.feature),
        labelSize: normalizeLabelSize(style.labelSize),
        labelHalo: style.labelHalo,
        labelPriority: normalizeLabelPriority(style.labelPriority),
        labelMode: style.labelMode === 'always' ? 'always' : 'auto',
        opacity: getLayerOpacity(entry.category, entry.layerId),
      })
    }
    candidates.sort((left, right) => right.labelPriority - left.labelPriority)

    if (!isLabelCollisionEnabled) {
      return candidates
    }

    const accepted: LabelEntry[] = []
    const baseThresholdMeters = Math.max(5, 1200 / Math.pow(2, currentMapZoom - 10))
    for (const candidate of candidates) {
      if (candidate.labelMode === 'always') {
        accepted.push(candidate)
        continue
      }
      const threshold = baseThresholdMeters * (candidate.labelSize / DEFAULT_LABEL_SIZE)
      const hasCollision = accepted.some(
        (entry) => distanceMeters(entry.position, candidate.position) < threshold,
      )
      if (!hasCollision) {
        accepted.push(candidate)
      }
    }
    return accepted
  }, [
    currentMapZoom,
    getLayerOpacity,
    isLabelCollisionEnabled,
    isLabelOverlayActive,
    mapVisibleFeatureEntries,
  ])

  const mapScaleHud = useMemo(() => {
    if (!mapViewport) {
      return null
    }
    const latitude = mapViewport.center[0]
    const zoom = mapViewport.zoom
    const metersPerPixel =
      (Math.cos((latitude * Math.PI) / 180) * 2 * Math.PI * 6_378_137) /
      (256 * Math.pow(2, zoom))
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
      return null
    }
    const targetPixelWidth = 96
    const maxMeters = metersPerPixel * targetPixelWidth
    const candidates = [
      20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000,
    ]
    let pickedMeters = candidates[0]
    for (const candidate of candidates) {
      if (candidate <= maxMeters) {
        pickedMeters = candidate
      }
    }
    const widthPx = clamp(pickedMeters / metersPerPixel, 34, 128)
    const label =
      pickedMeters >= 1000
        ? `${Number.isInteger(pickedMeters / 1000) ? pickedMeters / 1000 : (pickedMeters / 1000).toFixed(1)} km`
        : `${pickedMeters} m`
    return { widthPx, label }
  }, [mapViewport])

  return (
    <div className={`app-shell${isPresentationMode ? ' presentation-mode' : ''}`}>
      {!isPresentationMode ? (
        <aside className="sidebar">
        <header className="sidebar-header">
          <div className="title-row">
            <div>
              <p className="kicker">Marseille 2033</p>
              <h1>Plateforme carte - V1</h1>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setIsAdminPanelOpen((current) => !current)
                setSidebarTab('outils')
              }}
            >
              Admin
            </button>
          </div>

          <p className="intro">
            Donnees source: {dataSource} ({sourceTimestamp})
          </p>
          {isSyncingSupabase ? (
            <p className="muted">Synchronisation Supabase en cours...</p>
          ) : null}
          {dataNotice ? <p className="muted">{dataNotice}</p> : null}
        </header>

        <div className="sidebar-tabs" role="tablist" aria-label="Navigation panneau">
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'calques'}
            className={`sidebar-tab${sidebarTab === 'calques' ? ' active' : ''}`}
            onClick={() => setSidebarTab('calques')}
          >
            Calques
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'carte'}
            className={`sidebar-tab${sidebarTab === 'carte' ? ' active' : ''}`}
            onClick={() => setSidebarTab('carte')}
          >
            Carte
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'outils'}
            className={`sidebar-tab${sidebarTab === 'outils' ? ' active' : ''}`}
            onClick={() => setSidebarTab('outils')}
          >
            Outils
          </button>
        </div>

        {isAdminPanelOpen && sidebarTab === 'outils' ? (
          <section className="panel-block admin-panel">
            <div className="admin-title-row">
              <h2>Mode admin</h2>
              <button
                type="button"
                className="ghost-button mini-button"
                onClick={() => setShowDebugInfo((current) => !current)}
              >
                {showDebugInfo ? 'Masquer Debug' : 'Debug'}
              </button>
            </div>
            {showDebugInfo ? (
              <div className="diagnostic-block">
                <p className="diagnostic-title">
                  Diagnostic Supabase (build actuel)
                </p>
                <ul className="diagnostic-list">
                  <li>
                    URL project-ref:{' '}
                    <code>
                      {supabaseEnvDiagnostic.urlProjectRef ?? 'absent/invalide'}
                    </code>
                  </li>
                  <li>
                    Clé project-ref:{' '}
                    <code>{supabaseEnvDiagnostic.keyProjectRef ?? 'introuvable'}</code>
                  </li>
                  <li>
                    Clé role: <code>{supabaseEnvDiagnostic.keyRole ?? 'inconnu'}</code>
                  </li>
                  <li>
                    Clé expire le:{' '}
                    <code>{supabaseEnvDiagnostic.keyExpIso ?? 'inconnu'}</code>
                  </li>
                  <li>
                    Clé empreinte: <code>{supabaseEnvDiagnostic.keyFingerprint}</code>
                  </li>
                  <li>
                    URL/Clé:{' '}
                    <strong
                      className={
                        supabaseEnvDiagnostic.isMatch === false
                          ? 'diag-ko'
                          : 'diag-ok'
                      }
                    >
                      {supabaseEnvDiagnostic.isMatch === true
                        ? 'match'
                        : supabaseEnvDiagnostic.isMatch === false
                          ? 'mismatch'
                          : 'indéterminé'}
                    </strong>
                  </li>
                  {supabaseEnvDiagnostic.keyError ? (
                    <li>
                      Erreur clé: <code>{supabaseEnvDiagnostic.keyError}</code>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {!hasSupabase ? (
              <p className="muted">
                Supabase n'est pas configuré: édition indisponible.
              </p>
            ) : !isAdmin ? (
              <>
                {!isAuthReady ? (
                  <p className="muted">Verification de session...</p>
                ) : (
                  <form className="auth-form" onSubmit={handleAdminLogin}>
                    <label>
                      Email
                      <input
                        type="email"
                        value={adminEmail}
                        onChange={(event) => setAdminEmail(event.target.value)}
                        autoComplete="username"
                        required
                      />
                    </label>
                    <label>
                      Mot de passe
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(event) => setAdminPassword(event.target.value)}
                        autoComplete="current-password"
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      className="solid-button"
                      disabled={isAuthenticating}
                    >
                      {isAuthenticating ? 'Connexion...' : 'Se connecter'}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <div className="admin-content">
                <p className="muted">
                  Connecte en tant que <strong>{adminUserEmail ?? 'admin'}</strong>
                </p>

                <div className="admin-actions-row">
                  <label>
                    Mode
                    <select
                      value={adminMode}
                      onChange={(event) =>
                        setAdminMode(event.target.value as AdminMode)
                      }
                    >
                      {(
                        Object.entries(ADMIN_MODE_LABELS) as [AdminMode, string][]
                      ).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleAdminLogout}
                  >
                    Deconnexion
                  </button>
                </div>

                <div className="editor-block">
                  <h3>Exports</h3>
                  <p className="muted">
                    Exporte les éléments visibles ({visibleExportEntries.length}).
                  </p>
                  <div className="admin-actions-row">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={handleExportGeoJson}
                      disabled={visibleExportEntries.length === 0}
                    >
                      Export GeoJSON
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={handleExportKml}
                      disabled={visibleExportEntries.length === 0}
                    >
                      Export KML
                    </button>
                  </div>
                </div>

                <div className="editor-block">
                  <h3>Import GeoJSON / KML</h3>

                  <label>
                    Fichier
                    <input
                      type="file"
                      accept=".geojson,.json,.kml,application/geo+json,application/json,application/vnd.google-earth.kml+xml"
                      onChange={(event) => void handleImportFileChange(event)}
                    />
                  </label>

                  {importFile ? (
                    <p className="muted">
                      Fichier: <strong>{importFile.name}</strong>{' '}
                      {typeof importPreviewCount === 'number'
                        ? `| ${importPreviewCount} élément(s) détecté(s)`
                        : ''}
                    </p>
                  ) : (
                    <p className="muted">Sélectionne un fichier à importer.</p>
                  )}

                  <label>
                    Utiliser un calque existant
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) {
                          setImportLayerTemplate(event.target.value)
                        }
                      }}
                    >
                      <option value="">Choisir...</option>
                      {layerSuggestions.map((layer) => (
                        <option key={layer.id} value={layer.id}>
                          {layer.label} ({layer.category})
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid-2">
                    <label>
                      Catégorie cible
                      <input
                        type="text"
                        value={importDraft.category}
                        onChange={(event) =>
                          setImportDraft((current) => ({
                            ...current,
                            category: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <label>
                      Nom du calque
                      <input
                        type="text"
                        value={importDraft.layerLabel}
                        onChange={(event) =>
                          setImportDraft((current) => ({
                            ...current,
                            layerLabel: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="grid-2">
                    <label>
                      Identifiant du calque
                      <input
                        type="text"
                        value={importDraft.layerId}
                        onChange={(event) =>
                          setImportDraft((current) => ({
                            ...current,
                            layerId: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <label>
                      Statut par defaut
                      <select
                        value={importDraft.defaultStatus}
                        onChange={(event) =>
                          setImportDraft((current) => ({
                            ...current,
                            defaultStatus: event.target.value as StatusId,
                          }))
                        }
                      >
                        <option value="existant">Existant</option>
                        <option value="en cours">En cours</option>
                        <option value="propose">Proposé</option>
                      </select>
                    </label>
                  </div>

                  <label>
                    Couleur par defaut
                    <input
                      type="color"
                      value={importDraft.defaultColor}
                      onChange={(event) =>
                        setImportDraft((current) => ({
                          ...current,
                          defaultColor: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <button
                    type="button"
                    className="solid-button"
                    onClick={() => void handleImportFeatures()}
                    disabled={isImporting || !importFile}
                  >
                    {isImporting ? 'Import en cours...' : 'Importer dans la base'}
                  </button>
                </div>

                {adminMode === 'create' ? (
                  <div className="editor-block">
                    <h3>Création d'un élément</h3>

                    <label>
                      Nom
                      <input
                        type="text"
                        value={createDraft.name}
                        onChange={(event) =>
                          setCreateDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <div className="grid-2">
                      <label>
                        Statut
                        <select
                          value={createDraft.status}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              status: event.target.value as StatusId,
                              color: STATUS_COLORS[event.target.value as StatusId],
                            }))
                          }
                        >
                          <option value="existant">Existant</option>
                          <option value="en cours">En cours</option>
                          <option value="propose">Proposé</option>
                        </select>
                      </label>

                      <label>
                        Couleur
                        <input
                          type="color"
                          value={createDraft.color}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              color: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>

                    <label>
                      Type de géométrie
                      <select
                        value={createDraft.geometry}
                        onChange={(event) => {
                          const nextGeometry = event.target.value as DrawGeometry
                          setCreateDraft((current) => ({
                            ...current,
                            geometry: nextGeometry,
                            ...resolveDraftStyle(nextGeometry, current),
                          }))
                          setCreatePoints([])
                        }}
                      >
                        <option value="point">Point</option>
                        <option value="line">Ligne</option>
                        <option value="polygon">Polygone</option>
                      </select>
                    </label>

                    {createDraft.geometry === 'point' ? (
                      <label>
                        Taille du point ({Math.round(createDraft.pointRadius)} px)
                        <input
                          type="range"
                          min={3}
                          max={24}
                          step={1}
                          value={createDraft.pointRadius}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              pointRadius: normalizePointRadius(
                                Number.parseInt(event.target.value, 10),
                              ),
                            }))
                          }
                        />
                      </label>
                    ) : (
                      <label>
                        Epaisseur ({createDraft.lineWidth.toFixed(1)} px)
                        <input
                          type="range"
                          min={1}
                          max={14}
                          step={0.5}
                          value={createDraft.lineWidth}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              lineWidth: normalizeLineWidth(
                                Number.parseFloat(event.target.value),
                              ),
                            }))
                          }
                        />
                      </label>
                    )}
                    {createDraft.geometry === 'polygon' ? (
                      <label>
                        Opacite surface ({createDraft.fillOpacity.toFixed(2)})
                        <input
                          type="range"
                          min={0.05}
                          max={0.95}
                          step={0.05}
                          value={createDraft.fillOpacity}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              fillOpacity: normalizeFillOpacity(
                                Number.parseFloat(event.target.value),
                              ),
                            }))
                          }
                        />
                      </label>
                    ) : null}

                    <label>
                      Utiliser un calque existant
                      <select
                        value=""
                        onChange={(event) => {
                          if (event.target.value) {
                            setCreateLayerTemplate(event.target.value)
                          }
                        }}
                      >
                        <option value="">Choisir...</option>
                        {layerSuggestions.map((layer) => (
                          <option key={layer.id} value={layer.id}>
                            {layer.label} ({layer.category})
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid-2">
                      <label>
                        Catégorie
                        <input
                          type="text"
                          value={createDraft.category}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              category: event.target.value,
                            }))
                          }
                        />
                      </label>

                      <label>
                        Nom du calque
                        <input
                          type="text"
                          value={createDraft.layerLabel}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              layerLabel: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>

                    <label>
                      Identifiant du calque
                      <input
                        type="text"
                        value={createDraft.layerId}
                        onChange={(event) =>
                          setCreateDraft((current) => ({
                            ...current,
                            layerId: event.target.value,
                          }))
                        }
                        placeholder="ex: transports_tram"
                      />
                    </label>

                    <p className="muted">
                      Clic sur la carte: {createPoints.length} point(s) capture(s)
                    </p>

                    <div className="admin-actions-row">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={handleToolbarUndoLastPoint}
                        disabled={createPoints.length === 0}
                      >
                        Annuler dernier point
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={handleToolbarClearPoints}
                        disabled={createPoints.length === 0}
                      >
                        Réinitialiser
                      </button>
                    </div>

                    <button
                      type="button"
                      className="solid-button"
                      disabled={isSaving}
                      onClick={handleCreateFeature}
                    >
                      {isSaving ? 'Sauvegarde...' : 'Créer l\'élément'}
                    </button>
                  </div>
                ) : null}

                {adminMode === 'edit' ? (
                  <div className="editor-block">
                    <h3>Édition</h3>
                    {!selectedFeature || !editDraft ? (
                      <p className="muted">
                        Clique un élément sur la carte pour le modifier.
                      </p>
                    ) : (
                      <>
                        <label>
                          Nom
                          <input
                            type="text"
                            value={editDraft.name}
                            onChange={(event) =>
                              setEditDraft({
                                ...editDraft,
                                name: event.target.value,
                              })
                            }
                          />
                        </label>

                        <div className="grid-2">
                          <label>
                            Statut
                            <select
                              value={editDraft.status}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  status: event.target.value as StatusId,
                                })
                              }
                            >
                              <option value="existant">Existant</option>
                              <option value="en cours">En cours</option>
                              <option value="propose">Proposé</option>
                            </select>
                          </label>

                          <label>
                            Couleur
                            <input
                              type="color"
                              value={editDraft.color}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  color: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>

                        <label>
                          Utiliser un calque existant
                          <select
                            value=""
                            onChange={(event) => {
                              if (event.target.value) {
                                setEditLayerTemplate(event.target.value)
                              }
                            }}
                          >
                            <option value="">Choisir...</option>
                            {layerSuggestions.map((layer) => (
                              <option key={layer.id} value={layer.id}>
                                {layer.label} ({layer.category})
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="grid-2">
                          <label>
                            Catégorie
                            <input
                              type="text"
                              value={editDraft.category}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  category: event.target.value,
                                })
                              }
                            />
                          </label>

                          <label>
                            Nom du calque
                            <input
                              type="text"
                              value={editDraft.layerLabel}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  layerLabel: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>

                        <label>
                          Identifiant du calque
                          <input
                            type="text"
                            value={editDraft.layerId}
                            onChange={(event) =>
                              setEditDraft({
                                ...editDraft,
                                layerId: event.target.value,
                              })
                            }
                          />
                        </label>

                        <p className="muted">
                          Géométrie: {editDraft.geometry} | points: {editPoints.length}
                        </p>
                        {editDraft.geometry === 'point' ? (
                          <label>
                            Taille du point ({Math.round(editDraft.pointRadius)} px)
                            <input
                              type="range"
                              min={3}
                              max={24}
                              step={1}
                              value={editDraft.pointRadius}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  pointRadius: normalizePointRadius(
                                    Number.parseInt(event.target.value, 10),
                                  ),
                                })
                              }
                            />
                          </label>
                        ) : (
                          <label>
                            Epaisseur ({editDraft.lineWidth.toFixed(1)} px)
                            <input
                              type="range"
                              min={1}
                              max={14}
                              step={0.5}
                              value={editDraft.lineWidth}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  lineWidth: normalizeLineWidth(
                                    Number.parseFloat(event.target.value),
                                  ),
                                })
                              }
                            />
                          </label>
                        )}
                        {editDraft.geometry === 'polygon' ? (
                          <label>
                            Opacite surface ({editDraft.fillOpacity.toFixed(2)})
                            <input
                              type="range"
                              min={0.05}
                              max={0.95}
                              step={0.05}
                              value={editDraft.fillOpacity}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  fillOpacity: normalizeFillOpacity(
                                    Number.parseFloat(event.target.value),
                                  ),
                                })
                              }
                            />
                          </label>
                        ) : null}
                        {!isRedrawingEditGeometry ? (
                          <p className="muted">
                            Tu peux deplacer les points directement sur la carte par glisser-deposer.
                          </p>
                        ) : null}

                        <div className="admin-actions-row">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setIsRedrawingEditGeometry(true)
                              setEditPoints([])
                            }}
                          >
                            Redessiner géométrie
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={handleToolbarUndoLastPoint}
                            disabled={!isRedrawingEditGeometry || editPoints.length === 0}
                          >
                            Annuler dernier point
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setIsRedrawingEditGeometry(false)
                              setEditPoints(getFeaturePoints(selectedFeature.feature))
                            }}
                          >
                            Restaurer géométrie
                          </button>
                        </div>

                        <div className="admin-actions-row">
                          <button
                            type="button"
                            className="solid-button"
                            disabled={isSaving}
                            onClick={handleSaveEdition}
                          >
                            {isSaving ? 'Sauvegarde...' : 'Enregistrer'}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={isSaving || !selectedFeatureId}
                            onClick={() => void handleDuplicateSelection()}
                          >
                            Dupliquer
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={isSaving}
                            onClick={handleUndoFeatureVersion}
                          >
                            Restaurer version precedente
                          </button>
                        </div>

                        <div className="versions-block">
                          <h4>Historique ({versionItems.length})</h4>
                          {isVersionsLoading ? (
                            <p className="muted">Chargement des versions...</p>
                          ) : versionItems.length === 0 ? (
                            <p className="muted">Aucune version disponible.</p>
                          ) : (
                            <ul className="versions-list">
                              {versionItems.map((version) => (
                                <li key={version.versionId}>
                                  <strong>
                                    {VERSION_OPERATION_LABELS[version.operation] ??
                                      version.operation}
                                  </strong>
                                  <span>{new Date(version.createdAt).toLocaleString('fr-FR')}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {adminMode === 'delete' ? (
                  <div className="editor-block">
                    <h3>Suppression</h3>
                    {!selectedFeature ? (
                      <p className="muted">
                        Clique un élément sur la carte pour le supprimer.
                      </p>
                    ) : (
                      <>
                        <p className="muted">
                          Élément sélectionné: <strong>{selectedFeature.feature.name}</strong>
                        </p>
                        <button
                          type="button"
                          className="danger-button"
                          disabled={isSaving}
                          onClick={handleDeleteFeature}
                        >
                          {isSaving ? 'Suppression...' : 'Supprimer l\'élément'}
                        </button>
                      </>
                    )}
                  </div>
                ) : null}

                <div className="editor-block">
                  <h3>Édition en masse</h3>
                  <p className="muted">
                    Sélection:
                    {' '}
                    <strong>
                      {selectedFeatureIds.length > 0
                        ? selectedFeatureIds.length
                        : selectedFeatureId
                          ? 1
                          : 0}
                    </strong>{' '}
                    élément(s)
                  </p>
                  <div className="grid-2">
                    <label>
                      Statut
                      <select
                        value={bulkStatus}
                        onChange={(event) =>
                          setBulkStatus(event.target.value as StatusId | '')
                        }
                      >
                        <option value="">Conserver</option>
                        <option value="existant">Existant</option>
                        <option value="en cours">En cours</option>
                        <option value="propose">Proposé</option>
                      </select>
                    </label>
                    <label>
                      Couleur
                      <input
                        type="text"
                        value={bulkColor}
                        onChange={(event) => setBulkColor(event.target.value)}
                        placeholder="#RRGGBB (optionnel)"
                      />
                    </label>
                  </div>
                  <div className="grid-2">
                    <label>
                      Catégorie cible
                      <input
                        type="text"
                        value={bulkCategory}
                        onChange={(event) => setBulkCategory(event.target.value)}
                        placeholder="Conserver si vide"
                      />
                    </label>
                    <label>
                      Nom du calque cible
                      <input
                        type="text"
                        value={bulkLayerLabel}
                        onChange={(event) => setBulkLayerLabel(event.target.value)}
                        placeholder="Conserver si vide"
                      />
                    </label>
                  </div>
                  <label>
                    Identifiant calque cible
                    <input
                      type="text"
                      value={bulkLayerId}
                      onChange={(event) => setBulkLayerId(event.target.value)}
                      placeholder="Conserver si vide"
                    />
                  </label>
                  <div className="admin-actions-row">
                    <button
                      type="button"
                      className="solid-button"
                      disabled={isSaving}
                      onClick={() => void handleApplyBulkUpdate()}
                    >
                      {isSaving ? 'Mise à jour...' : 'Appliquer en masse'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setBulkStatus('')
                        setBulkColor('')
                        setBulkCategory('')
                        setBulkLayerLabel('')
                        setBulkLayerId('')
                      }}
                    >
                      Réinitialiser champs
                    </button>
                  </div>
                </div>

                <div className="editor-block">
                  <h3>Corbeille ({trashItems.length})</h3>
                  {isTrashLoading ? (
                    <p className="muted">Chargement de la corbeille...</p>
                  ) : trashItems.length === 0 ? (
                    <p className="muted">Corbeille vide.</p>
                  ) : (
                    <ul className="trash-list">
                      {trashItems.map((item) => (
                        <li key={item.id}>
                          <div>
                            <strong>{item.name}</strong>
                            <p>
                              {item.layerLabel} | {STATUS_LABELS[item.status]} |{' '}
                              {new Date(item.deletedAt).toLocaleString('fr-FR')}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="ghost-button mini-button"
                            onClick={() => void handleRestoreFromTrash(item.id)}
                            disabled={isSaving}
                          >
                            Restaurer
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {adminNotice ? <p className="muted admin-notice">{adminNotice}</p> : null}
          </section>
        ) : null}

        {sidebarTab === 'carte' ? (
          <section className="panel-block">
            <h2>Fond de carte</h2>
            <div className="radio-grid">
              {(Object.entries(BASE_MAPS) as [BaseMapId, BaseMapConfig][]).map(
                ([id, map]) => (
                  <label key={id} className="control-row">
                    <input
                      type="radio"
                      name="base-map"
                      checked={baseMapId === id}
                      onChange={() => setBaseMapId(id)}
                    />
                    <span>{map.label}</span>
                  </label>
                ),
              )}
            </div>
          </section>
        ) : null}

        {sidebarTab === 'carte' ? (
          <section className="panel-block">
            <h2>Filtres</h2>
            <div className="filters-grid">
              <label>
                Statut
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as StatusId | 'all')
                  }
                >
                  <option value="all">Tous</option>
                  <option value="existant">Existant</option>
                  <option value="en cours">En cours</option>
                  <option value="propose">Proposé</option>
                </select>
              </label>

              <label>
                Catégorie
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">Toutes</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Géométrie
                <select
                  value={geometryFilter}
                  onChange={(event) =>
                    setGeometryFilter(event.target.value as DrawGeometry | 'all')
                  }
                >
                  <option value="all">Toutes</option>
                  <option value="point">Points</option>
                  <option value="line">Lignes</option>
                  <option value="polygon">Polygones</option>
                </select>
              </label>
            </div>
            <div className="status-chip-grid">
              <button
                type="button"
                className={`ghost-button mini-button${statusFilter === 'all' ? ' active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                Tous ({statusQuickCounts.all})
              </button>
              <button
                type="button"
                className={`ghost-button mini-button${statusFilter === 'existant' ? ' active' : ''}`}
                onClick={() => setStatusFilter('existant')}
              >
                Existant ({statusQuickCounts.existant})
              </button>
              <button
                type="button"
                className={`ghost-button mini-button${statusFilter === 'en cours' ? ' active' : ''}`}
                onClick={() => setStatusFilter('en cours')}
              >
                En cours ({statusQuickCounts['en cours']})
              </button>
              <button
                type="button"
                className={`ghost-button mini-button${statusFilter === 'propose' ? ' active' : ''}`}
                onClick={() => setStatusFilter('propose')}
              >
                Proposé ({statusQuickCounts.propose})
              </button>
            </div>
          </section>
        ) : null}

        {sidebarTab === 'carte' ? (
          <section className="panel-block">
            <h2>Navigation carte</h2>
          <div className="admin-actions-row">
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={handleCenterOnMarseille}
            >
              Recentrer Marseille
            </button>
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={handleFitVisibleFeatures}
              disabled={mapVisibleFeatureEntries.length === 0}
            >
              Cadrer visibles
            </button>
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={handleFitSelection}
              disabled={
                selectedFeatureIds.length === 0 && selectedFeatureId === null
              }
            >
              Cadrer sélection
            </button>
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={() => void handleCopyPermalink()}
            >
              Copier lien
            </button>
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={() => void handleCopyCursorCoordinates()}
              disabled={!cursorPosition}
            >
              Copier coord.
            </button>
          </div>
          {navigationNotice ? <p className="muted">{navigationNotice}</p> : null}
          <p className="muted">
            Curseur:{' '}
            {cursorPosition
              ? `${cursorPosition[0].toFixed(5)}, ${cursorPosition[1].toFixed(5)}`
              : 'survole la carte'}
          </p>

          <form className="map-search-form" onSubmit={handleMapSearchSubmit}>
            <input
              type="text"
              value={mapSearchQuery}
              onChange={(event) => setMapSearchQuery(event.target.value)}
              placeholder="Adresse ou coordonnées (43.2965, 5.3698)"
            />
            <button type="submit" className="ghost-button mini-button" disabled={isSearchingMap}>
              {isSearchingMap ? '...' : 'Rechercher'}
            </button>
          </form>
          {mapSearchNotice ? <p className="muted">{mapSearchNotice}</p> : null}
          {mapSearchResults.length > 0 ? (
            <ul className="map-search-results">
              {mapSearchResults.map((candidate) => (
                <li key={candidate.id}>
                  <div>
                    <strong>{candidate.label}</strong>
                    <p>{candidate.subtitle}</p>
                  </div>
                  <div className="layer-order-actions">
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      onClick={() => {
                        void zoomToPosition(candidate.position, 16)
                      }}
                    >
                      Zoom
                    </button>
                    {isAdmin ? (
                      <button
                        type="button"
                        className="ghost-button mini-button"
                        onClick={() => handleUseCandidateForPointCreation(candidate)}
                      >
                        Point
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="bookmark-tools">
            <label>
              Nom du favori
              <input
                type="text"
                value={bookmarkDraftName}
                onChange={(event) => setBookmarkDraftName(event.target.value)}
                placeholder="Ex: Vieux-Port / Centre"
              />
            </label>
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={handleAddViewBookmark}
            >
              Ajouter favori
            </button>
          </div>
          {viewBookmarks.length === 0 ? (
            <p className="muted">Aucun favori de vue.</p>
          ) : (
            <ul className="bookmark-list">
              {viewBookmarks.map((bookmark) => (
                <li key={bookmark.id}>
                  <button
                    type="button"
                    className="bookmark-go"
                    onClick={() => handleGoToViewBookmark(bookmark)}
                    title="Aller à ce favori"
                  >
                    {bookmark.name}
                  </button>
                  <button
                    type="button"
                    className="ghost-button mini-button"
                    onClick={() => handleDeleteViewBookmark(bookmark.id)}
                    title="Supprimer ce favori"
                  >
                    Suppr.
                  </button>
                </li>
              ))}
            </ul>
          )}
          </section>
        ) : null}

        {sidebarTab === 'calques' ? (
          <section className="panel-block">
            <h2>Calques</h2>
          <div className="admin-actions-row">
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={handleActivateAllLayers}
            >
              Tout activer
            </button>
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={handleDeactivateAllLayers}
            >
              Tout désactiver
            </button>
            <details className="inline-actions-menu">
              <summary className="ghost-button mini-button">Plus</summary>
              <div className="inline-actions-menu-content">
                <button
                  type="button"
                  className="ghost-button mini-button"
                  onClick={handleExpandAllLayerFolders}
                >
                  Déplier catégories
                </button>
                <button
                  type="button"
                  className="ghost-button mini-button"
                  onClick={handleCollapseAllLayerFolders}
                >
                  Replier catégories
                </button>
                {isAdmin ? (
                  <>
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      onClick={() => void handleCreateLayer()}
                      disabled={isSaving}
                    >
                      Nouveau calque
                    </button>
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      onClick={() =>
                        void handleCreateLayer({
                          requireNewSection: true,
                        })
                      }
                      disabled={isSaving}
                    >
                      Nouvelle section
                    </button>
                  </>
                ) : null}
              </div>
            </details>
          </div>
          <div className="layer-preset-tools">
            <label>
              Recherche calque
              <input
                type="text"
                value={layerPanelSearchQuery}
                onChange={(event) => setLayerPanelSearchQuery(event.target.value)}
                placeholder="Nom de calque ou catégorie..."
              />
            </label>
            <label>
              Nom du preset
              <input
                type="text"
                value={layerPresetDraftName}
                onChange={(event) => setLayerPresetDraftName(event.target.value)}
                placeholder="Ex: transports + parcs"
              />
            </label>
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={handleSaveLayerVisibilityPreset}
            >
              Enregistrer preset
            </button>
          </div>
          {layerVisibilityPresets.length > 0 ? (
            <ul className="layer-preset-list">
              {layerVisibilityPresets.map((preset) => (
                <li key={preset.id}>
                  <div>
                    <strong>{preset.name}</strong>
                    <p>{preset.layerIds.length} calque(s)</p>
                  </div>
                  <div className="layer-order-actions">
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      onClick={() => handleApplyLayerVisibilityPreset(preset.id)}
                    >
                      Appliquer
                    </button>
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      onClick={() => handleDeleteLayerVisibilityPreset(preset.id)}
                    >
                      Suppr.
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Aucun preset de calques.</p>
          )}
          {layersByCategory.length === 0 ? (
            <p className="muted">Aucun calque ne correspond à ta recherche.</p>
          ) : null}
          {layersByCategory.map((block) => {
            const sectionIndex = categories.findIndex(
              (category) => category === block.category,
            )
            const isFirstSection = sectionIndex <= 0
            const isLastSection = sectionIndex === categories.length - 1

            return (
              <div key={block.category} className="layer-group">
                <div className="layer-folder-header">
                  <button
                    type="button"
                    className="layer-folder-toggle"
                    onClick={() => toggleLayerFolder(block.category)}
                    aria-expanded={!collapsedLayerFolders[block.category]}
                  >
                    <span>{collapsedLayerFolders[block.category] ? '▸' : '▾'}</span>
                    <strong>{block.category}</strong>
                    <small>
                      {block.layers.filter((layer) => activeLayers[layer.id]).length}/
                      {block.layers.length}
                    </small>
                  </button>
                  {isAdmin ? (
                    <details className="layer-folder-actions">
                      <summary className="ghost-button mini-button">Actions</summary>
                      <div className="layer-actions-menu">
                        <button
                          type="button"
                          className="ghost-button mini-button"
                          onClick={() =>
                            void handleCreateLayer({ presetCategory: block.category })
                          }
                          disabled={isSaving}
                          title="Créer un calque dans cette section"
                        >
                          + calque
                        </button>
                        <button
                          type="button"
                          className="ghost-button mini-button"
                          onClick={() => void handleRenameSection(block.category)}
                          disabled={isSaving}
                          title="Renommer la section"
                        >
                          Renommer
                        </button>
                        <button
                          type="button"
                          className="ghost-button mini-button"
                          onClick={() => void handleMoveSection(block.category, 'up')}
                          disabled={isSaving || isFirstSection}
                          title="Monter la section"
                        >
                          Monter
                        </button>
                        <button
                          type="button"
                          className="ghost-button mini-button"
                          onClick={() => void handleMoveSection(block.category, 'down')}
                          disabled={isSaving || isLastSection}
                          title="Descendre la section"
                        >
                          Descendre
                        </button>
                        <button
                          type="button"
                          className="danger-button mini-button"
                          onClick={() => void handleDeleteSection(block.category)}
                          disabled={isSaving}
                          title="Supprimer la section"
                        >
                          Supprimer
                        </button>
                      </div>
                    </details>
                  ) : null}
                </div>
                {collapsedLayerFolders[block.category]
                  ? null
                  : block.layers.map((layer, index) => {
                      const layerLocked = isLayerLocked(block.category, layer.id)
                      const layerZoomKey = toLayerLockKey(block.category, layer.id)
                      const zoomRule = layerZoomVisibility[layerZoomKey] ?? {
                        minZoom: 10,
                        maxZoom: 18,
                      }
                      const hasCustomZoomRule =
                        layerZoomVisibility[layerZoomKey] !== undefined
                      const layerOpacity = layerOpacityByKey[layerZoomKey] ?? 1
                      const hasCustomOpacity =
                        layerOpacityByKey[layerZoomKey] !== undefined
                      return (
                        <div
                          key={layer.id}
                          className={`layer-row${layerLocked ? ' is-locked' : ''}`}
                        >
                          <label className="control-row">
                            <input
                              type="checkbox"
                              checked={activeLayers[layer.id]}
                              onChange={() => toggleLayer(layer.id)}
                            />
                            <span>
                              {layer.label}
                              {layerLocked ? ' (verrouillé)' : ''}
                            </span>
                          </label>
                          <p className="layer-row-meta">
                            {layerVisibleCountById.get(layer.id) ?? 0}/{layer.features.length}{' '}
                            élément(s) avec filtres
                          </p>
                          {isAdmin ? (
                            <details className="layer-row-actions">
                              <summary className="ghost-button mini-button">Actions</summary>
                              <div className="layer-actions-menu">
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() => handleSoloLayer(block.category, layer.id)}
                                  title="Activer uniquement ce calque"
                                >
                                  Solo
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() => handleFitLayer(block.category, layer.id)}
                                  title="Cadrer ce calque"
                                >
                                  Cadrer
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() => toggleLayerLock(block.category, layer.id)}
                                  disabled={isSaving}
                                  title={layerLocked ? 'Déverrouiller' : 'Verrouiller'}
                                >
                                  {layerLocked ? 'Déverr.' : 'Verrou.'}
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() =>
                                    void handleRenameLayer(
                                      block.category,
                                      layer.id,
                                      layer.label,
                                    )
                                  }
                                  disabled={isSaving || layerLocked}
                                  title="Renommer le calque"
                                >
                                  Renommer
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() =>
                                    void handleDuplicateLayer(block.category, layer.id)
                                  }
                                  disabled={isSaving || layerLocked}
                                  title="Dupliquer le calque"
                                >
                                  Dupliquer
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() =>
                                    void handleMoveLayer(block.category, layer.id, 'up')
                                  }
                                  disabled={isSaving || index === 0}
                                  title="Monter"
                                >
                                  Monter
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() =>
                                    void handleMoveLayer(block.category, layer.id, 'down')
                                  }
                                  disabled={isSaving || index === block.layers.length - 1}
                                  title="Descendre"
                                >
                                  Descendre
                                </button>
                                <button
                                  type="button"
                                  className="danger-button mini-button"
                                  onClick={() =>
                                    void handleDeleteLayer(
                                      block.category,
                                      layer.id,
                                      layer.label,
                                    )
                                  }
                                  disabled={isSaving || layerLocked}
                                  title="Supprimer le calque"
                                >
                                  Supprimer
                                </button>
                              </div>
                            </details>
                          ) : null}
                          <details className="layer-display-details">
                            <summary className="ghost-button mini-button">
                              Affichage avancé
                            </summary>
                            <div className="layer-display-details-content">
                              <div className="layer-zoom-controls">
                                <label>
                                  min
                                  <input
                                    type="number"
                                    min={10}
                                    max={18}
                                    step={1}
                                    value={zoomRule.minZoom}
                                    onChange={(event) =>
                                      handleLayerZoomChange(
                                        block.category,
                                        layer.id,
                                        'minZoom',
                                        Number.parseInt(event.target.value || '10', 10),
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  max
                                  <input
                                    type="number"
                                    min={10}
                                    max={18}
                                    step={1}
                                    value={zoomRule.maxZoom}
                                    onChange={(event) =>
                                      handleLayerZoomChange(
                                        block.category,
                                        layer.id,
                                        'maxZoom',
                                        Number.parseInt(event.target.value || '18', 10),
                                      )
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() =>
                                    handleResetLayerZoom(block.category, layer.id)
                                  }
                                  disabled={!hasCustomZoomRule}
                                  title="Réinitialiser min/max zoom"
                                >
                                  Auto
                                </button>
                              </div>
                              <div className="layer-opacity-controls">
                                <label>
                                  Opacite {Math.round(layerOpacity * 100)}%
                                  <input
                                    type="range"
                                    min={15}
                                    max={100}
                                    step={5}
                                    value={Math.round(layerOpacity * 100)}
                                    onChange={(event) =>
                                      handleLayerOpacityChange(
                                        block.category,
                                        layer.id,
                                        Number.parseInt(event.target.value || '100', 10) /
                                          100,
                                      )
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="ghost-button mini-button"
                                  onClick={() =>
                                    handleResetLayerOpacity(block.category, layer.id)
                                  }
                                  disabled={!hasCustomOpacity}
                                  title="Réinitialiser opacité du calque"
                                >
                                  100%
                                </button>
                              </div>
                            </div>
                          </details>
                        </div>
                      )
                    })}
              </div>
            )
          })}
          </section>
        ) : null}

        {sidebarTab === 'calques' ? (
          <>
            <section className="panel-block legend-block">
              <h2>Legende dynamique</h2>
              {visibleStatuses.length === 0 ? (
                <p className="muted">Aucun statut visible.</p>
              ) : (
                <ul className="legend-list">
                  {visibleStatuses.map((status) => (
                    <li key={status}>
                      <span
                        className="legend-dot"
                        style={{ backgroundColor: STATUS_COLORS[status] }}
                        aria-hidden="true"
                      />
                      <span>{STATUS_LABELS[status]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel-block visible-list-block">
              <h2>Elements visibles ({mapVisibleFeatureEntries.length})</h2>
              <div className="filters-grid">
                <label>
                  Recherche rapide
                  <input
                    type="text"
                    value={featureSearchQuery}
                    onChange={(event) => setFeatureSearchQuery(event.target.value)}
                    placeholder="Nom, calque, catégorie..."
                  />
                </label>
                <label>
                  Tri
                  <select
                    value={featureSortMode}
                    onChange={(event) =>
                      setFeatureSortMode(event.target.value as VisibleFeatureSortMode)
                    }
                  >
                    <option value="alpha">Alphabétique</option>
                    <option value="status">Par statut</option>
                    <option value="layer">Par calque</option>
                    <option value="category">Par catégorie</option>
                  </select>
                </label>
              </div>
              <p className="muted">
                {visibleFeatures.length} resultat(s)
                {featureSearchQuery.trim() ? ` pour "${featureSearchQuery.trim()}"` : ''}
              </p>
              {visibleFeatures.length === 0 ? (
                <p className="muted">
                  {mapVisibleFeatureEntries.length === 0
                    ? 'Active un calque pour commencer.'
                    : 'Aucun élément ne correspond à la recherche.'}
                </p>
              ) : (
                <ul className="feature-list">
                  {visibleFeatures.map((feature) => (
                    <li key={feature.id}>
                      <button
                        type="button"
                        className="feature-list-item-button"
                        onClick={() => handleVisibleFeatureFocus(feature.id)}
                        title="Zoomer sur cet élément"
                      >
                        <span
                          className="legend-dot"
                          style={{ backgroundColor: feature.color }}
                          aria-hidden="true"
                        />
                        <div>
                          <strong>{feature.name}</strong>
                          <p>
                            {feature.layerLabel} | {feature.category} |{' '}
                            {STATUS_LABELS[feature.status]} |{' '}
                            {DRAW_GEOMETRY_LABELS[feature.geometry]}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
        </aside>
      ) : null}

      <main
        className={`map-pane${isDrawingOnMap ? ' is-drawing' : ''}${isAdmin && isZoneSelectionMode ? ' is-zone-selecting' : ''}${isAdmin && isMeasureMode ? ' is-measuring' : ''}`}
      >
        <div className="map-floating-actions">
          <button
            type="button"
            className="ghost-button mini-button"
            onClick={() => setIsPresentationMode((current) => !current)}
          >
            {isPresentationMode ? 'Quitter présentation' : 'Mode présentation'}
          </button>
          {!showWelcomeHint ? (
            <button
              type="button"
              className="ghost-button mini-button"
              onClick={() => setShowWelcomeHint(true)}
            >
              Astuces
            </button>
          ) : null}
        </div>
        {showWelcomeHint && !isPresentationMode ? (
          <div className="map-welcome-hint" role="status" aria-live="polite">
            <p className="map-welcome-title">Astuces rapides</p>
            <p className="map-welcome-text">
              Active des calques, clique un élément pour le focus, puis utilise "Copier lien"
              pour partager exactement cette vue.
            </p>
            <div className="map-welcome-actions">
              <button
                type="button"
                className="ghost-button mini-button"
                onClick={() => setShowWelcomeHint(false)}
              >
                Masquer
              </button>
            </div>
          </div>
        ) : null}
        {isAdmin && !isPresentationMode ? (
          <div
            className={`map-toolbar${isMapToolbarCollapsed ? ' is-collapsed' : ''}`}
            role="toolbar"
            aria-label="Outils carte"
          >
            <div className="map-toolbar-header">
              <p className="map-toolbar-title">Outils carte</p>
              <button
                type="button"
                className="ghost-button mini-button map-toolbar-toggle"
                onClick={() => setIsMapToolbarCollapsed((current) => !current)}
                aria-expanded={!isMapToolbarCollapsed}
                title={isMapToolbarCollapsed ? 'Déplier les outils' : 'Réduire les outils'}
              >
                {isMapToolbarCollapsed ? 'Déplier' : 'Réduire'}
              </button>
            </div>

            {!isMapToolbarCollapsed ? (
              <>
                <div className="map-toolbar-buttons">
              {MAP_TOOLBAR_TOOLS.map((tool) => {
                const isActive =
                  adminMode === tool.mode &&
                  (tool.mode !== 'create' || createDraft.geometry === tool.geometry)

                return (
                  <button
                    key={tool.id}
                    type="button"
                    className={`map-tool-button${isActive ? ' active' : ''}`}
                    onClick={() => handleToolbarToolClick(tool.mode, tool.geometry)}
                    aria-pressed={isActive}
                    title={`${tool.label} (${tool.hotkey})`}
                  >
                    <span>{tool.label}</span>
                    <kbd>{tool.hotkey}</kbd>
                  </button>
                )
              })}
            </div>
            <p className="map-toolbar-hint">
              Mode actif:{' '}
              {isMeasureMode
                ? `Mesure ${MEASURE_GEOMETRY_LABELS[measureGeometry]}`
                : adminMode === 'create'
                ? `Création ${DRAW_GEOMETRY_LABELS[createDraft.geometry]}`
                : ADMIN_MODE_LABELS[adminMode]}
            </p>
            <div className="map-toolbar-actions map-toolbar-actions-inline">
              <button
                type="button"
                className="ghost-button mini-button"
                onClick={() => setIsShortcutHelpOpen((current) => !current)}
              >
                {isShortcutHelpOpen ? 'Fermer aide' : 'Aide ?'}
              </button>
            </div>

            {adminMode === 'create' ? (
              <div className="map-toolbar-section">
                <details className="map-toolbar-collapsible">
                  <summary className="ghost-button mini-button">
                    Paramètres de création
                  </summary>
                  <div className="map-toolbar-collapsible-content">
                    <label className="map-toolbar-label">
                      Nom rapide
                      <input
                        type="text"
                        className="map-toolbar-input"
                        value={createDraft.name}
                        onChange={(event) =>
                          setCreateDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="Nom (sinon automatique)"
                      />
                    </label>
                    <div className="map-toolbar-row">
                      <label className="map-toolbar-label small">
                        Statut
                        <select
                          className="map-toolbar-select"
                          value={createDraft.status}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              status: event.target.value as StatusId,
                            }))
                          }
                        >
                          <option value="existant">Existant</option>
                          <option value="en cours">En cours</option>
                          <option value="propose">Proposé</option>
                        </select>
                      </label>
                      <label className="map-toolbar-label small">
                        Couleur
                        <input
                          type="color"
                          className="map-toolbar-color"
                          value={createDraft.color}
                          onChange={(event) =>
                            setCreateDraft((current) => ({
                              ...current,
                              color: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                </details>
                <p className="map-toolbar-meta">
                  Points: {toolbarPointCount} / {toolbarMinPoints}
                </p>
                <div className="map-toolbar-actions">
                  <button
                    type="button"
                    className="ghost-button mini-button"
                    onClick={handleToolbarUndoLastPoint}
                    disabled={!toolbarCanUndo}
                    title="Annuler dernier point (Retour)"
                  >
                    Annuler point
                  </button>
                  <button
                    type="button"
                    className="ghost-button mini-button"
                    onClick={handleToolbarClearPoints}
                    disabled={!toolbarCanClear}
                    title="Effacer le dessin (Esc)"
                  >
                    Effacer
                  </button>
                  <button
                    type="button"
                    className="solid-button mini-button"
                    onClick={handleToolbarPrimaryAction}
                    disabled={!toolbarCanConfirm || isSaving}
                    title="Enregistrer (Entrer)"
                  >
                    {isSaving ? '...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            ) : null}

            {adminMode === 'edit' ? (
              <div className="map-toolbar-section">
                {!selectedFeature || !editDraft ? (
                  <>
                    <p className="map-toolbar-meta">
                      Clique un élément sur la carte pour l'éditer.
                    </p>
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className="ghost-button mini-button"
                        onClick={() => void handleDuplicateSelection()}
                        disabled={isSaving || !selectedFeatureId}
                        title="Dupliquer rapidement la sélection"
                      >
                        Dupliquer
                      </button>
                      <button
                        type="button"
                        className={`ghost-button mini-button${isZoneSelectionMode ? ' active' : ''}`}
                        onClick={handleToggleZoneSelection}
                        title="Sélection par zone (Z)"
                      >
                        {isZoneSelectionMode ? 'Annuler zone' : 'Sélection zone'}
                      </button>
                    </div>
                    <p className="map-toolbar-meta">
                      Multi-sélection: <strong>{selectedFeatureIds.length}</strong> élément(s)
                    </p>
                  </>
                ) : (
                  <>
                    <p className="map-toolbar-meta">
                      Sélection: <strong>{selectedFeature.feature.name}</strong>
                    </p>
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className={`ghost-button mini-button${isZoneSelectionMode ? ' active' : ''}`}
                        onClick={handleToggleZoneSelection}
                        title="Sélection par zone (Z)"
                      >
                        {isZoneSelectionMode ? 'Annuler zone' : 'Sélection zone'}
                      </button>
                      <button
                        type="button"
                        className={`ghost-button mini-button${isRedrawingEditGeometry ? ' active' : ''}`}
                        onClick={handleToolbarToggleRedraw}
                        title="Basculer redessin (R)"
                      >
                        {isRedrawingEditGeometry ? 'Arrêter redessin' : 'Redessiner'}
                      </button>
                      {isRedrawingEditGeometry ? (
                        <button
                          type="button"
                          className="ghost-button mini-button"
                          onClick={handleToolbarUndoLastPoint}
                          disabled={!toolbarCanUndo}
                          title="Annuler dernier point (Retour)"
                        >
                          Annuler point
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="solid-button mini-button"
                        onClick={handleToolbarPrimaryAction}
                        disabled={!toolbarCanConfirm || isSaving}
                        title="Enregistrer (Entrer)"
                      >
                        {isSaving ? '...' : 'Enregistrer'}
                      </button>
                      {selectedFeatureIds.length > 1 ? (
                        <button
                          type="button"
                          className="ghost-button mini-button"
                          onClick={handleClearMultiSelection}
                        >
                          Garder 1
                        </button>
                      ) : null}
                    </div>
                    <p className="map-toolbar-meta">
                      Multi-sélection: <strong>{selectedFeatureIds.length}</strong> élément(s)
                    </p>
                    {isRedrawingEditGeometry ? (
                      <p className="map-toolbar-meta">
                        Redessin: {toolbarPointCount} / {toolbarMinPoints} points
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {adminMode === 'delete' ? (
              <div className="map-toolbar-section">
                {!selectedFeature ? (
                  <>
                    <p className="map-toolbar-meta">
                      Clique un élément sur la carte pour le supprimer.
                    </p>
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className={`ghost-button mini-button${isZoneSelectionMode ? ' active' : ''}`}
                        onClick={handleToggleZoneSelection}
                        title="Sélection par zone (Z)"
                      >
                        {isZoneSelectionMode ? 'Annuler zone' : 'Sélection zone'}
                      </button>
                    </div>
                    <p className="map-toolbar-meta">
                      Multi-sélection: <strong>{selectedFeatureIds.length}</strong> élément(s)
                    </p>
                  </>
                ) : (
                  <>
                    <p className="map-toolbar-meta">
                      Sélection: <strong>{selectedFeature.feature.name}</strong>
                    </p>
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className={`ghost-button mini-button${isZoneSelectionMode ? ' active' : ''}`}
                        onClick={handleToggleZoneSelection}
                        title="Sélection par zone (Z)"
                      >
                        {isZoneSelectionMode ? 'Annuler zone' : 'Sélection zone'}
                      </button>
                      <button
                        type="button"
                        className="danger-button mini-button"
                        onClick={handleToolbarPrimaryAction}
                        disabled={!toolbarCanConfirm || isSaving}
                      >
                        {isSaving
                          ? '...'
                          : selectedFeatureIds.length > 1
                            ? `Corbeille (${selectedFeatureIds.length})`
                            : 'Mettre en corbeille'}
                      </button>
                    </div>
                    <p className="map-toolbar-meta">
                      Multi-sélection: <strong>{selectedFeatureIds.length}</strong> élément(s)
                    </p>
                  </>
                )}
              </div>
            ) : null}

            <details className="map-toolbar-section map-toolbar-collapsible map-toolbar-advanced">
              <summary className="ghost-button mini-button">Outils avancés</summary>
              <div className="map-toolbar-collapsible-content">
              <div className="map-toolbar-actions">
                <button
                  type="button"
                  className={`ghost-button mini-button${isMeasureMode ? ' active' : ''}`}
                  onClick={handleToggleMeasureMode}
                  title="Outil mesure (M)"
                >
                  {isMeasureMode ? 'Mesure ON' : 'Mesure'}
                </button>
                <button
                  type="button"
                  className={`ghost-button mini-button${isSnappingEnabled ? ' active' : ''}`}
                  onClick={handleToggleSnapping}
                  title="Snapping magnétique (X)"
                >
                  {isSnappingEnabled ? 'Snap ON' : 'Snap OFF'}
                </button>
                <button
                  type="button"
                  className={`ghost-button mini-button${isGridEnabled ? ' active' : ''}`}
                  onClick={handleToggleGrid}
                  title="Grille d'aide (G)"
                >
                  {isGridEnabled ? 'Grille ON' : 'Grille'}
                </button>
                <button
                  type="button"
                  className={`ghost-button mini-button${isLabelOverlayEnabled ? ' active' : ''}`}
                  onClick={() => setIsLabelOverlayEnabled((current) => !current)}
                  title="Etiquettes de carte"
                >
                  {isLabelOverlayEnabled ? 'Labels ON' : 'Labels'}
                </button>
                <button
                  type="button"
                  className={`ghost-button mini-button${isLabelCollisionEnabled ? ' active' : ''}`}
                  onClick={() =>
                    setIsLabelCollisionEnabled((current) => !current)
                  }
                  title="Eviter le chevauchement des labels"
                >
                  {isLabelCollisionEnabled ? 'Collision ON' : 'Collision OFF'}
                </button>
                <button
                  type="button"
                  className={`ghost-button mini-button${isNorthArrowVisible ? ' active' : ''}`}
                  onClick={() => setIsNorthArrowVisible((current) => !current)}
                  title="Afficher le nord sur la carte"
                >
                  {isNorthArrowVisible ? 'Nord ON' : 'Nord OFF'}
                </button>
              </div>

              <label className="map-toolbar-label small">
                Tolerance snapping: {Math.round(snapToleranceMeters)} m
                <input
                  type="range"
                  min={5}
                  max={500}
                  step={5}
                  className="map-toolbar-range"
                  value={snapToleranceMeters}
                  onChange={(event) =>
                    setSnapToleranceMeters(Number.parseInt(event.target.value, 10))
                  }
                />
              </label>
              <p className="map-toolbar-meta">
                Candidats snap: {snapCandidates.vertices.length} sommets,{' '}
                {snapCandidates.segments.length} segments
              </p>

              {isLabelOverlayEnabled ? (
                <>
                  <label className="map-toolbar-label small">
                    Labels à partir du zoom {labelMinZoom}
                    <input
                      type="range"
                      min={10}
                      max={18}
                      step={1}
                      className="map-toolbar-range"
                      value={labelMinZoom}
                      onChange={(event) =>
                        setLabelMinZoom(Number.parseInt(event.target.value, 10))
                      }
                    />
                  </label>
                  <p className="map-toolbar-meta">
                    Collision labels: {isLabelCollisionEnabled ? 'active' : 'désactivée'}
                  </p>
                </>
              ) : null}

              <details className="map-toolbar-collapsible">
                <summary className="ghost-button mini-button">Style individuel</summary>
                <div className="map-toolbar-collapsible-content">
                  {!canEditStyleIndividually || !activeStyleDraft ? (
                    <p className="map-toolbar-meta">
                      Sélectionne ou crée un élément pour régler son style.
                    </p>
                  ) : (
                    <>
                  <label className="map-toolbar-label small">
                    Template
                    <select
                      className="map-toolbar-select"
                      value={activeTemplateId}
                      onChange={(event) => {
                        const next = event.target.value
                        if (adminMode === 'create') {
                          setCreateTemplateId(next)
                        } else if (adminMode === 'edit') {
                          setEditTemplateId(next)
                        }
                      }}
                    >
                      <option value="">Choisir...</option>
                      {styleTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="map-toolbar-actions">
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      disabled={!activeTemplateId}
                      onClick={() => {
                        if (!activeTemplateId) {
                          return
                        }
                        if (adminMode === 'create') {
                          applyTemplateToCreateDraft(activeTemplateId)
                          return
                        }
                        if (adminMode === 'edit') {
                          applyTemplateToEditDraft(activeTemplateId)
                        }
                      }}
                    >
                      Appliquer template
                    </button>
                  </div>
                  {activeStyleDraft.geometry === 'point' ? (
                    <>
                      <label className="map-toolbar-label small">
                        Taille du point: {Math.round(activeStyleDraft.pointRadius)} px
                        <input
                          type="range"
                          min={3}
                          max={24}
                          step={1}
                          className="map-toolbar-range"
                          value={activeStyleDraft.pointRadius}
                          onChange={(event) =>
                            applyStyleToCurrentDraft({
                              pointRadius: Number.parseInt(event.target.value, 10),
                            })
                          }
                        />
                      </label>
                      <label className="map-toolbar-label small">
                        Icone
                        <select
                          className="map-toolbar-select"
                          value={activeStyleDraft.pointIcon}
                          onChange={(event) =>
                            applyStyleToCurrentDraft({
                              pointIcon: event.target.value as PointIconId,
                            })
                          }
                        >
                          {(Object.entries(POINT_ICON_LABELS) as [
                            PointIconId,
                            string,
                          ][]).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="map-toolbar-label small">
                        Epaisseur: {activeStyleDraft.lineWidth.toFixed(1)} px
                        <input
                          type="range"
                          min={1}
                          max={14}
                          step={0.5}
                          className="map-toolbar-range"
                          value={activeStyleDraft.lineWidth}
                          onChange={(event) =>
                            applyStyleToCurrentDraft({
                              lineWidth: Number.parseFloat(event.target.value),
                            })
                          }
                        />
                      </label>
                      {activeStyleDraft.geometry === 'line' ? (
                        <>
                          <label className="map-toolbar-label small">
                            Trait
                            <select
                              className="map-toolbar-select"
                              value={activeStyleDraft.lineDash}
                              onChange={(event) =>
                                applyStyleToCurrentDraft({
                                  lineDash: event.target.value as LineDashStyle,
                                })
                              }
                            >
                              {(Object.entries(LINE_DASH_OPTIONS) as [
                                LineDashStyle,
                                string,
                              ][]).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="map-toolbar-label small">
                            Sens
                            <select
                              className="map-toolbar-select"
                              value={activeStyleDraft.lineDirection}
                              onChange={(event) =>
                                applyStyleToCurrentDraft({
                                  lineDirection: event.target.value as LineDirectionMode,
                                })
                              }
                            >
                              {(Object.entries(LINE_DIRECTION_OPTIONS) as [
                                LineDirectionMode,
                                string,
                              ][]).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className={`ghost-button mini-button${activeStyleDraft.lineArrows ? ' active' : ''}`}
                            onClick={() =>
                              applyStyleToCurrentDraft({
                                lineArrows: !activeStyleDraft.lineArrows,
                              })
                            }
                          >
                            Flèches {activeStyleDraft.lineArrows ? 'ON' : 'OFF'}
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                  {activeStyleDraft.geometry === 'polygon' ? (
                    <>
                      <label className="map-toolbar-label small">
                        Opacite surface: {activeStyleDraft.fillOpacity.toFixed(2)}
                        <input
                          type="range"
                          min={0.05}
                          max={0.95}
                          step={0.05}
                          className="map-toolbar-range"
                          value={activeStyleDraft.fillOpacity}
                          onChange={(event) =>
                            applyStyleToCurrentDraft({
                              fillOpacity: Number.parseFloat(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="map-toolbar-label small">
                        Motif
                        <select
                          className="map-toolbar-select"
                          value={activeStyleDraft.polygonPattern}
                          onChange={(event) =>
                            applyStyleToCurrentDraft({
                              polygonPattern: event.target.value as PolygonPattern,
                            })
                          }
                        >
                          {(Object.entries(POLYGON_PATTERN_OPTIONS) as [
                            PolygonPattern,
                            string,
                          ][]).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="map-toolbar-label small">
                        Bordure
                        <select
                          className="map-toolbar-select"
                          value={activeStyleDraft.polygonBorderMode}
                          onChange={(event) =>
                            applyStyleToCurrentDraft({
                              polygonBorderMode:
                                event.target.value as PolygonBorderMode,
                            })
                          }
                        >
                          {(Object.entries(POLYGON_BORDER_MODE_OPTIONS) as [
                            PolygonBorderMode,
                            string,
                          ][]).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : null}
                  <label className="map-toolbar-label small">
                    Label mode
                    <select
                      className="map-toolbar-select"
                      value={activeStyleDraft.labelMode}
                      onChange={(event) =>
                        applyStyleToCurrentDraft({
                          labelMode: event.target.value as LabelMode,
                        })
                      }
                    >
                      {(Object.entries(LABEL_MODE_OPTIONS) as [LabelMode, string][]).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="map-toolbar-label small">
                    Taille label: {activeStyleDraft.labelSize}px
                    <input
                      type="range"
                      min={10}
                      max={24}
                      step={1}
                      className="map-toolbar-range"
                      value={activeStyleDraft.labelSize}
                      onChange={(event) =>
                        applyStyleToCurrentDraft({
                          labelSize: Number.parseInt(event.target.value, 10),
                        })
                      }
                    />
                  </label>
                  <label className="map-toolbar-label small">
                    Priorite label: {activeStyleDraft.labelPriority}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      className="map-toolbar-range"
                      value={activeStyleDraft.labelPriority}
                      onChange={(event) =>
                        applyStyleToCurrentDraft({
                          labelPriority: Number.parseInt(event.target.value, 10),
                        })
                      }
                    />
                  </label>
                      <button
                        type="button"
                        className={`ghost-button mini-button${activeStyleDraft.labelHalo ? ' active' : ''}`}
                        onClick={() =>
                          applyStyleToCurrentDraft({
                            labelHalo: !activeStyleDraft.labelHalo,
                          })
                        }
                      >
                        Halo label {activeStyleDraft.labelHalo ? 'ON' : 'OFF'}
                      </button>
                    </>
                  )}
                </div>
              </details>

              {isMeasureMode ? (
                <details className="map-toolbar-collapsible" open>
                  <summary className="ghost-button mini-button">Mesure</summary>
                  <div className="map-toolbar-collapsible-content">
                    <label className="map-toolbar-label small">
                      Type de mesure
                      <select
                        className="map-toolbar-select"
                        value={measureGeometry}
                        onChange={(event) =>
                          handleChangeMeasureGeometry(event.target.value as MeasureGeometry)
                        }
                      >
                        <option value="line">Distance</option>
                        <option value="polygon">Surface</option>
                      </select>
                    </label>
                    <p className="map-toolbar-meta">
                      Mesure {MEASURE_GEOMETRY_LABELS[measureGeometry]}: {measurePoints.length}{' '}
                      point(s)
                    </p>
                    {measureGeometry === 'line' ? (
                      <p className="map-toolbar-meta">
                        Distance: <strong>{formatDistance(measureLengthMeters)}</strong>
                      </p>
                    ) : (
                      <>
                        <p className="map-toolbar-meta">
                          Perimetre: <strong>{formatDistance(measurePerimeterMeters)}</strong>
                        </p>
                        <p className="map-toolbar-meta">
                          Surface: <strong>{formatSurface(measureAreaSquareMeters)}</strong>
                        </p>
                      </>
                    )}
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className="ghost-button mini-button"
                        onClick={handleToolbarUndoLastPoint}
                        disabled={measurePoints.length === 0}
                      >
                        Annuler point
                      </button>
                      <button
                        type="button"
                        className="ghost-button mini-button"
                        onClick={handleResetMeasure}
                        disabled={measurePoints.length === 0}
                      >
                        Réinitialiser
                      </button>
                    </div>
                  </div>
                </details>
              ) : null}

              <details className="map-toolbar-collapsible">
                <summary className="ghost-button mini-button">
                  Historique (Ctrl/Cmd+Z | Ctrl/Cmd+Y)
                </summary>
                <div className="map-toolbar-collapsible-content">
                  <div className="map-toolbar-actions">
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      onClick={handleLocalUndo}
                      disabled={!canLocalUndo}
                    >
                      Undo ({localHistoryPast.length})
                    </button>
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      onClick={handleLocalRedo}
                      disabled={!canLocalRedo}
                    >
                      Redo ({localHistoryFuture.length})
                    </button>
                    <button
                      type="button"
                      className="ghost-button mini-button"
                      onClick={handleClearLocalHistory}
                      disabled={!canLocalUndo && !canLocalRedo}
                    >
                      Effacer
                    </button>
                  </div>
                  {visibleHistoryEntries.length > 0 ? (
                    <ul className="map-history-list">
                      {visibleHistoryEntries.map((entry) => (
                        <li key={`${entry.createdAt}-${entry.label}`}>
                          <span>{entry.label}</span>
                          <time>{new Date(entry.createdAt).toLocaleTimeString('fr-FR')}</time>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="map-toolbar-meta">Aucune action locale.</p>
                  )}
                </div>
              </details>
              </div>
            </details>
              </>
            ) : null}
          </div>
        ) : null}
        {mapScaleHud ? (
          <div className="map-scale-hud" aria-hidden="true">
            {isNorthArrowVisible ? (
              <div className="map-north-arrow">
                <span className="map-north-arrow-letter">N</span>
                <span className="map-north-arrow-glyph">▲</span>
              </div>
            ) : null}
            <div className="map-scale-bar-shell">
              <span className="map-scale-bar" style={{ width: `${mapScaleHud.widthPx}px` }} />
              <span className="map-scale-label">{mapScaleHud.label}</span>
            </div>
          </div>
        ) : null}
        <div className="map-cursor-hud" aria-live="polite">
          <span>Zoom {currentMapZoom.toFixed(1)}</span>
          <span>
            {cursorPosition
              ? `${cursorPosition[0].toFixed(5)}, ${cursorPosition[1].toFixed(5)}`
              : 'Survole pour lire les coordonnées'}
          </span>
        </div>
        {isAdmin && !isPresentationMode && isShortcutHelpOpen ? (
          <div
            className="shortcut-help-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Aide des raccourcis"
            onClick={() => setIsShortcutHelpOpen(false)}
          >
            <div
              className="shortcut-help-panel"
              onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
                event.stopPropagation()
              }}
            >
              <p className="shortcut-help-title">Raccourcis clavier</p>
              <ul className="shortcut-help-list">
                <li><kbd>1</kbd> Point</li>
                <li><kbd>2</kbd> Ligne</li>
                <li><kbd>3</kbd> Polygone</li>
                <li><kbd>E</kbd> Mode édition</li>
                <li><kbd>D</kbd> Mode suppression</li>
                <li><kbd>R</kbd> Redessiner (édition)</li>
                <li><kbd>Z</kbd> Sélection par zone</li>
                <li><kbd>M</kbd> Outil mesure</li>
                <li><kbd>G</kbd> Grille</li>
                <li><kbd>X</kbd> Snapping</li>
                <li><kbd>P</kbd> Mode présentation</li>
                <li><kbd>?</kbd> Ouvrir/fermer cette aide</li>
                <li><kbd>Enter</kbd> Valider</li>
                <li><kbd>Backspace</kbd> Annuler point</li>
                <li><kbd>Esc</kbd> Quitter/annuler</li>
                <li><kbd>Ctrl/Cmd+Z</kbd> Undo local</li>
                <li><kbd>Ctrl/Cmd+Y</kbd> Redo local</li>
              </ul>
              <div className="shortcut-help-actions">
                <button
                  type="button"
                  className="ghost-button mini-button"
                  onClick={() => setIsShortcutHelpOpen(false)}
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {isAdmin && !isPresentationMode && isGuidedDrawing && guideGeometry ? (
          <div className="map-drawing-hud" role="status" aria-live="polite">
            <p className="map-drawing-hud-title">{drawingGuideTitle}</p>
            <p className="map-drawing-hud-meta">
              {toolbarPointCount}/{toolbarMinPoints} point(s) pour le{' '}
              {DRAW_GEOMETRY_LABELS[guideGeometry]}
            </p>
            <p className="map-drawing-hud-help">
              Clic: ajouter | Clic droit: annuler | Double-clic: terminer
            </p>
            <div className="map-drawing-hud-actions">
              <button
                type="button"
                className="ghost-button mini-button"
                onClick={handleToolbarUndoLastPoint}
                disabled={!toolbarCanUndo}
              >
                Annuler point
              </button>
              <button
                type="button"
                className="solid-button mini-button"
                onClick={handleToolbarPrimaryAction}
                disabled={!toolbarCanConfirm || isSaving}
              >
                {isSaving ? '...' : 'Terminer'}
              </button>
            </div>
          </div>
        ) : null}
        {isAdmin && !isPresentationMode && featureContextMenu ? (
          <div
            className="feature-context-menu"
            role="menu"
            style={{
              left: `${featureContextMenu.clientX}px`,
              top: `${featureContextMenu.clientY}px`,
            }}
            onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
              event.stopPropagation()
            }}
          >
            <button
              type="button"
              className="feature-context-menu-item"
              onClick={() => void handleContextMenuAction('edit')}
            >
              Éditer cet élément
            </button>
            <button
              type="button"
              className="feature-context-menu-item"
              onClick={() => void handleContextMenuAction('toggle')}
            >
              Ajouter/retirer de la sélection
            </button>
            <button
              type="button"
              className="feature-context-menu-item"
              onClick={() => void handleContextMenuAction('duplicate')}
            >
              Dupliquer cet élément
            </button>
            <button
              type="button"
              className="feature-context-menu-item danger"
              onClick={() => void handleContextMenuAction('delete')}
            >
              Mettre en corbeille
            </button>
          </div>
        ) : null}
        <MapContainer
          center={MARSEILLE_CENTER}
          zoom={12}
          zoomControl={false}
          minZoom={10}
          maxZoom={18}
          maxBounds={METROPOLE_BOUNDS}
          maxBoundsViscosity={1}
          doubleClickZoom={!isMapInteractionCaptureEnabled}
          dragging={!(isAdmin && isZoneSelectionMode)}
          attributionControl={false}
          className="map"
        >
          <TileLayer
            url={BASE_MAPS[baseMapId].url}
            attribution={BASE_MAPS[baseMapId].attribution}
          />
          <MapViewportCapture
            onViewportChange={setMapViewport}
            onMapReady={setMapInstance}
            onCursorMove={setCursorPosition}
          />
          <MapClickCapture
            enabled={isMapInteractionCaptureEnabled}
            onMapClick={handleMapClick}
            onMapDoubleClick={handleMapDoubleClick}
            onMapContextMenu={handleMapContextMenu}
            onMapMouseMove={handleMapMouseMove}
            onMapMouseDown={handleMapMouseDown}
            onMapMouseUp={handleMapMouseUp}
          />
          {isGridEnabled
            ? gridLines.map((line) => (
                <Polyline
                  key={line.id}
                  positions={line.positions}
                  interactive={false}
                  pathOptions={{
                    color: '#334155',
                    weight: 1,
                    opacity: 0.24,
                  }}
                />
              ))
            : null}
          {visibleLayers.map((layer) => renderLayerFeatures(layer))}
          {mapLabelEntries.map((entry) => (
            <CircleMarker
              key={`label-${entry.id}`}
              center={entry.position}
              radius={1}
              interactive={false}
              pathOptions={{
                opacity: 0,
                fillOpacity: 0,
                stroke: false,
              }}
            >
              <Tooltip
                permanent
                direction="top"
                offset={[0, -4]}
                className="feature-inline-label"
              >
                <span
                  className="feature-inline-label-text"
                  style={{
                    borderColor: entry.color,
                    fontSize: `${entry.labelSize}px`,
                    textShadow: entry.labelHalo
                      ? '0 0 2px #fff, 0 0 5px #fff, 0 0 8px #fff'
                      : 'none',
                    opacity: clamp(entry.opacity + 0.1, 0.25, 1),
                  }}
                >
                  {entry.name}
                </span>
              </Tooltip>
            </CircleMarker>
          ))}
          {renderDraftGeometry()}
          {searchFocusPoint ? (
            <CircleMarker
              center={searchFocusPoint}
              radius={8}
              interactive={false}
              pathOptions={{
                color: '#0f172a',
                fillColor: '#38bdf8',
                fillOpacity: 0.38,
                weight: 2,
                dashArray: '5 4',
              }}
            />
          ) : null}
          {isAdmin && isMeasureMode && measurePoints.length > 0 ? (
            measureGeometry === 'polygon' ? (
              measurePoints.length >= 3 ? (
                <Polygon
                  positions={measurePoints}
                  interactive={false}
                  pathOptions={{
                    color: '#0284c7',
                    weight: 3,
                    dashArray: '6 5',
                    fillColor: '#38bdf8',
                    fillOpacity: 0.16,
                  }}
                />
              ) : (
                <Polyline
                  positions={measurePoints}
                  interactive={false}
                  pathOptions={{
                    color: '#0284c7',
                    weight: 3,
                    dashArray: '6 5',
                  }}
                />
              )
            ) : (
              <Polyline
                positions={measurePoints}
                interactive={false}
                pathOptions={{
                  color: '#0284c7',
                  weight: 3,
                  dashArray: '6 5',
                }}
              />
            )
          ) : null}
          {isAdmin && zoneSelectionBounds ? (
            <Rectangle
              bounds={zoneSelectionBounds}
              interactive={false}
              pathOptions={{
                color: '#0f172a',
                weight: 1.5,
                dashArray: '5 4',
                fillColor: '#93c5fd',
                fillOpacity: 0.16,
              }}
            />
          ) : null}
          {isAdmin && isSnappingEnabled && snapPreview ? (
            <CircleMarker
              center={snapPreview.position}
              radius={6}
              interactive={false}
              pathOptions={{
                color: snapPreview.type === 'vertex' ? '#0f172a' : '#1d4ed8',
                fillColor: '#ffffff',
                fillOpacity: 0.95,
                weight: 2,
              }}
            />
          ) : null}
          {renderDirectEditHandles()}
        </MapContainer>
      </main>
    </div>
  )
}

export default App
