import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ChangeEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react'
import type {
  LatLngBoundsExpression,
  LatLngTuple,
  LeafletEvent,
  LeafletMouseEvent,
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
  useMapEvents,
} from 'react-leaflet'
import {
  type FeatureVersion,
  type ImportFeatureInsert,
  type TrashFeature,
  fetchFeatureVersions,
  fetchTrashFromSupabase,
  importFeaturesToSupabase,
  moveFeatureToTrash,
  persistLayerSortOrder,
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
import type { GeometryFeature, LayerConfig, StatusId } from './types/map'
import './App.css'

type BaseMapId = 'osm' | 'satellite' | 'carto_light' | 'carto_dark' | 'topo'
type DrawGeometry = GeometryFeature['geometry']
type AdminMode = 'view' | 'create' | 'edit' | 'delete'

interface BaseMapConfig {
  label: string
  url: string
  attribution: string
}

interface VisibleFeature {
  id: string
  name: string
  status: StatusId
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
}

interface EditDraft {
  name: string
  status: StatusId
  color: string
  category: string
  layerId: string
  layerLabel: string
  geometry: DrawGeometry
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

const MARSEILLE_CENTER: LatLngTuple = [43.2965, 5.3698]
const METROPOLE_BOUNDS: LatLngBoundsExpression = [
  [43.02, 4.95],
  [43.62, 5.86],
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
  propose: 'Propose',
}

const STATUS_COLORS: Record<StatusId, string> = {
  existant: '#15803d',
  'en cours': '#b45309',
  propose: '#1d4ed8',
}

const ADMIN_MODE_LABELS: Record<AdminMode, string> = {
  view: 'Lecture',
  create: 'Creation',
  edit: 'Edition',
  delete: 'Suppression',
}

const VERSION_OPERATION_LABELS: Record<string, string> = {
  insert: 'Creation',
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
  { id: 'tool-edit', label: 'Deplacer', hotkey: 'E', mode: 'edit' },
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
      error: 'Cle absente',
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
      error: 'Impossible de decoder la cle',
    }
  }
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

function toLayerId(value: string, layerLabel: string): string {
  const base = (value.trim() || layerLabel.trim()).toLowerCase()
  return base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
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

function getLayerSortOrderValue(layer: LayerConfig, fallback = 0): number {
  if (typeof layer.sortOrder === 'number' && Number.isFinite(layer.sortOrder)) {
    return layer.sortOrder
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
  const [isZoneSelectionMode, setIsZoneSelectionMode] = useState(false)
  const [isZoneSelectionDragging, setIsZoneSelectionDragging] = useState(false)
  const [zoneSelectionStart, setZoneSelectionStart] = useState<LatLngTuple | null>(
    null,
  )
  const [zoneSelectionCurrent, setZoneSelectionCurrent] =
    useState<LatLngTuple | null>(null)
  const [featureContextMenu, setFeatureContextMenu] =
    useState<FeatureContextMenuState | null>(null)
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() =>
    buildDefaultDraft(fallbackLayers),
  )
  const [createPoints, setCreatePoints] = useState<LatLngTuple[]>([])
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
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

  const isDrawingOnMap =
    isAdmin &&
    (adminMode === 'create' || (adminMode === 'edit' && isRedrawingEditGeometry))
  const isMapInteractionCaptureEnabled = isDrawingOnMap || isZoneSelectionMode
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
        setDataNotice('Supabase est configure mais la table map_features est vide.')
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

  const categories = useMemo(
    () =>
      Array.from(new Set(layers.map((layer) => layer.category))).sort((a, b) =>
        a.localeCompare(b, 'fr'),
      ),
    [layers],
  )

  const visibleLayers = useMemo(
    () =>
      layers.filter((layer) => {
        if (!activeLayers[layer.id]) {
          return false
        }
        if (categoryFilter === 'all') {
          return true
        }
        return layer.category === categoryFilter
      }),
    [layers, activeLayers, categoryFilter],
  )

  const visibleFeatures = useMemo<VisibleFeature[]>(
    () =>
      visibleLayers
        .flatMap((layer) =>
          layer.features
            .filter((feature) =>
              statusFilter === 'all' ? true : feature.status === statusFilter,
            )
            .map((feature) => ({
              id: feature.id,
              name: feature.name,
              status: feature.status,
              layerLabel: layer.label,
              color: feature.color,
            })),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [statusFilter, visibleLayers],
  )

  const visibleExportEntries = useMemo<FeatureEnvelope[]>(
    () =>
      visibleLayers.flatMap((layer) =>
        layer.features
          .filter((feature) =>
            statusFilter === 'all' ? true : feature.status === statusFilter,
          )
          .map((feature) => ({
            feature,
            category: layer.category,
            layerId: layer.id,
            layerLabel: layer.label,
          })),
      ),
    [statusFilter, visibleLayers],
  )

  const visibleStatuses = useMemo(
    () =>
      Array.from(new Set(visibleFeatures.map((feature) => feature.status))).sort(
        (a, b) => {
          const order: Record<StatusId, number> = {
            existant: 1,
            'en cours': 2,
            propose: 3,
          }
          return order[a] - order[b]
        },
      ),
    [visibleFeatures],
  )

  const layersByCategory = useMemo(
    () =>
      categories.map((category) => ({
        category,
        layers: layers.filter((layer) => layer.category === category),
      })),
    [categories, layers],
  )

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
          sortOrder: getLayerSortOrderValue(layer, index),
        }))
        .sort((a, b) => {
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

  const focusFeatureById = useCallback(
    (
      featureId: string,
      updateSelection: 'single' | 'preserve' | 'keep' = 'single',
    ) => {
      const match = featureById.get(featureId)
      if (!match) {
        return false
      }

      setSelectedFeatureId(featureId)
      if (updateSelection === 'single') {
        setSelectedFeatureIds([featureId])
      } else if (updateSelection === 'preserve') {
        setSelectedFeatureIds((current) =>
          current.includes(featureId) ? current : [...current, featureId],
        )
      }
      setEditDraft({
        name: match.feature.name,
        status: match.feature.status,
        color: match.feature.color,
        category: match.category,
        layerId: match.layerId,
        layerLabel: match.layerLabel,
        geometry: match.feature.geometry,
      })
      setEditPoints(getFeaturePoints(match.feature))
      setIsRedrawingEditGeometry(false)
      setAdminNotice(null)
      void refreshFeatureVersions(featureId)
      return true
    },
    [featureById, refreshFeatureVersions],
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

      if (event.originalEvent.shiftKey) {
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
          setSelectedFeatureIds((current) => [...current, featureId])
          void focusFeatureById(featureId, 'keep')
        }
        setAdminNotice('Selection multiple mise a jour.')
      } else {
        focusFeatureById(featureId, 'single')
      }

      if (adminMode === 'delete' || adminMode === 'edit') {
        return
      }
      setAdminMode('edit')
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

      const mouseEvent = event.originalEvent as MouseEvent
      setFeatureContextMenu({
        featureId,
        clientX: mouseEvent.clientX,
        clientY: mouseEvent.clientY,
      })
    },
    [isAdmin, isZoneSelectionMode],
  )

  const handleMapClick = useCallback(
    (position: LatLngTuple) => {
      if (!isAdmin) {
        return
      }
      setFeatureContextMenu(null)

      if (adminMode === 'create') {
        setCreatePoints((current) =>
          createDraft.geometry === 'point' ? [position] : [...current, position],
        )
        setAdminNotice(null)
        return
      }

      if (adminMode === 'edit' && isRedrawingEditGeometry && editDraft) {
        setEditPoints((current) =>
          editDraft.geometry === 'point' ? [position] : [...current, position],
        )
        setAdminNotice(null)
      }
    },
    [adminMode, createDraft.geometry, editDraft, isAdmin, isRedrawingEditGeometry],
  )

  const handleMapMouseMove = useCallback(
    (position: LatLngTuple) => {
      if (
        !isAdmin ||
        !isZoneSelectionMode ||
        !isZoneSelectionDragging ||
        !zoneSelectionStart
      ) {
        return
      }
      setZoneSelectionCurrent(position)
    },
    [isAdmin, isZoneSelectionDragging, isZoneSelectionMode, zoneSelectionStart],
  )

  const handleMapMouseDown = useCallback(
    (position: LatLngTuple) => {
      if (!isAdmin || !isZoneSelectionMode) {
        return
      }
      setFeatureContextMenu(null)
      setZoneSelectionStart(position)
      setZoneSelectionCurrent(position)
      setIsZoneSelectionDragging(true)
      setAdminNotice('Selection zone en cours: relache pour valider.')
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
      setAdminNotice(
        uniqueIds.length > 0
          ? `${uniqueIds.length} element(s) selectionne(s) par zone.`
          : 'Aucun element dans la zone.',
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
        setIsZoneSelectionMode(false)
        setIsZoneSelectionDragging(false)
        setZoneSelectionStart(null)
        setZoneSelectionCurrent(null)
        setFeatureContextMenu(null)
        setCreateDraft((current) => ({
          ...current,
          geometry,
        }))
        setCreatePoints([])
        setIsRedrawingEditGeometry(false)
        return
      }

      if (mode === 'edit') {
        setAdminMode('edit')
        setFeatureContextMenu(null)
        setIsRedrawingEditGeometry(false)
        return
      }

      if (mode === 'delete') {
        setAdminMode('delete')
        setFeatureContextMenu(null)
      }
    },
    [isAdmin],
  )

  const handleAdminLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!supabase) {
      setAdminNotice('Supabase non configure.')
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
      setAdminNotice(`Connexion refusee: ${error.message}`)
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
    setTrashItems([])
    setVersionItems([])
    setAdminNotice('Mode admin desactive.')
  }

  const handleCreateFeature = async () => {
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
      `Element ${new Date().toLocaleString('fr-FR', {
        hour12: false,
      })}`

    if (!category || !layerLabel || !layerId) {
      setAdminNotice('Categorie et calque sont obligatoires.')
      return
    }

    if (!isHexColor(createDraft.color)) {
      setAdminNotice('Couleur invalide. Utilise le format #RRGGBB.')
      return
    }

    if (!isGeometryComplete(createDraft.geometry, createPoints)) {
      setAdminNotice('Geometrie incomplete: ajoute plus de points sur la carte.')
      return
    }

    const geometryPointsSnapshot = [...createPoints]
    const geometryCoordinates = toCoordinates(createDraft.geometry, createPoints)
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

    const { error } = await supabase.from('map_features').insert({
      id,
      name: finalName,
      status: createDraft.status,
      category,
      layer_id: layerId,
      layer_label: layerLabel,
      layer_sort_order: layerSortOrder,
      color: createDraft.color,
      geometry_type: createDraft.geometry,
      coordinates: geometryCoordinates,
      sort_order: sortOrder,
      source: 'manual',
    })

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
    })
    setEditPoints(geometryPointsSnapshot)
    setIsRedrawingEditGeometry(false)
    await syncSupabaseLayers(layerId)
    await refreshFeatureVersions(id)
    setAdminMode('edit')
    setIsSaving(false)
    setAdminNotice('Element cree et enregistre.')
  }

  const handleSaveEdition = async () => {
    if (!supabase || !isAdmin || !selectedFeatureId || !editDraft) {
      setAdminNotice('Selectionne un element a modifier.')
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
      setAdminNotice('Nom, categorie et calque sont obligatoires.')
      return
    }

    if (!isHexColor(editDraft.color)) {
      setAdminNotice('Couleur invalide. Utilise le format #RRGGBB.')
      return
    }

    if (!isGeometryComplete(editDraft.geometry, editPoints)) {
      setAdminNotice('Geometrie incomplete: ajoute plus de points sur la carte.')
      return
    }

    setIsSaving(true)
    setAdminNotice(null)

    const { error } = await supabase
      .from('map_features')
      .update({
        name,
        status: editDraft.status,
        category,
        layer_id: layerId,
        layer_label: layerLabel,
        layer_sort_order: layerSortOrder,
        color: editDraft.color,
        geometry_type: editDraft.geometry,
        coordinates: toCoordinates(editDraft.geometry, editPoints),
      })
      .eq('id', selectedFeatureId)

    if (error) {
      setIsSaving(false)
      setAdminNotice(`Erreur edition: ${error.message}`)
      return
    }

    await syncSupabaseLayers(layerId)
    setSelectedFeatureId(selectedFeatureId)
    setSelectedFeatureIds([selectedFeatureId])
    await refreshFeatureVersions(selectedFeatureId)
    setIsSaving(false)
    setAdminNotice('Element modifie.')
  }

  const handleDeleteFeatureByIds = useCallback(
    async (ids: string[]) => {
      if (!isAdmin) {
        setAdminNotice('Connexion admin requise.')
        return
      }

      const uniqueIds = Array.from(new Set(ids)).filter((id) => featureById.has(id))
      if (uniqueIds.length === 0) {
        setAdminNotice('Selectionne un element a supprimer.')
        return
      }

      const targetLabel =
        uniqueIds.length === 1
          ? `"${featureById.get(uniqueIds[0])?.feature.name ?? 'element'}"`
          : `${uniqueIds.length} elements`
      const confirmed = window.confirm(
        `Deplacer ${targetLabel} dans la corbeille ?`,
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
          ? `${deletedCount} element(s) deplaces dans la corbeille (avec erreurs partielles).`
          : `${deletedCount} element(s) deplaces dans la corbeille.`,
      )
    },
    [featureById, isAdmin, refreshTrash, syncSupabaseLayers],
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
      setAdminNotice('Selection zone annulee.')
      return
    }
    setFeatureContextMenu(null)
    setIsZoneSelectionMode(true)
    setIsZoneSelectionDragging(false)
    setZoneSelectionStart(null)
    setZoneSelectionCurrent(null)
    setAdminNotice('Selection zone active: clique-glisse sur la carte.')
  }, [adminMode, isAdmin, isZoneSelectionMode])

  const handleClearMultiSelection = useCallback(() => {
    setSelectedFeatureIds(selectedFeatureId ? [selectedFeatureId] : [])
    setAdminNotice('Selection multiple reinitialisee.')
  }, [selectedFeatureId])

  const handleContextMenuAction = useCallback(
    async (action: 'edit' | 'toggle' | 'delete') => {
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
          setSelectedFeatureIds((current) => [...current, featureId])
          void focusFeatureById(featureId, 'keep')
        }
        setAdminNotice('Selection multiple mise a jour.')
        return
      }

      await handleDeleteFeatureByIds([featureId])
    },
    [
      featureContextMenu,
      focusFeatureById,
      handleDeleteFeatureByIds,
      selectedFeatureIdSet,
      selectedFeatureIds,
    ],
  )

  const handleMapDoubleClick = () => {
    if (!isAdmin) {
      return
    }

    if (adminMode === 'create') {
      if (!isGeometryComplete(createDraft.geometry, createPoints)) {
        setAdminNotice(
          `Geometrie incomplete: ${MIN_POINTS_REQUIRED[createDraft.geometry]} point(s) minimum.`,
        )
        return
      }
      void handleCreateFeature()
      return
    }

    if (adminMode === 'edit' && isRedrawingEditGeometry && editDraft) {
      if (!isGeometryComplete(editDraft.geometry, editPoints)) {
        setAdminNotice(
          `Geometrie incomplete: ${MIN_POINTS_REQUIRED[editDraft.geometry]} point(s) minimum.`,
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
      setAdminNotice('Selection zone annulee.')
      return
    }

    if (adminMode === 'create' && createPoints.length > 0) {
      setCreatePoints((current) => current.slice(0, -1))
      return
    }

    if (adminMode === 'edit' && isRedrawingEditGeometry && editPoints.length > 0) {
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

  const handleEditVertexDragEnd = useCallback(
    (index: number, event: LeafletEvent) => {
      handleMoveEditVertex(index, markerEventToPosition(event))
      setAdminNotice('Geometrie ajustee. Clique sur "Enregistrer" pour valider.')
    },
    [handleMoveEditVertex],
  )

  const handleInsertEditVertex = useCallback(
    (afterIndex: number, position: LatLngTuple) => {
      if (!editDraft || editDraft.geometry === 'point') {
        return
      }
      setEditPoints((current) => {
        if (current.length < 2) {
          return current
        }
        const safeIndex = Math.min(Math.max(afterIndex, -1), current.length - 1)
        const next = [...current]
        next.splice(safeIndex + 1, 0, position)
        return next
      })
      setAdminNotice('Sommet ajoute. Clique sur "Enregistrer" pour valider.')
    },
    [editDraft],
  )

  const handleDeleteEditVertex = useCallback(
    (index: number) => {
      if (!editDraft || editDraft.geometry === 'point') {
        return
      }

      const minPoints = MIN_POINTS_REQUIRED[editDraft.geometry]
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
    [editDraft],
  )

  const handleToolbarToggleRedraw = useCallback(() => {
    if (!selectedFeature || !editDraft) {
      setAdminNotice('Selectionne un element sur la carte avant de redessiner.')
      return
    }

    if (isRedrawingEditGeometry) {
      setIsRedrawingEditGeometry(false)
      setEditPoints(getFeaturePoints(selectedFeature.feature))
      setAdminNotice(null)
      return
    }

    setAdminMode('edit')
    setIsRedrawingEditGeometry(true)
    setEditPoints([])
    setAdminNotice(
      'Redessin actif: clique sur la carte, puis Entrer pour enregistrer.',
    )
  }, [editDraft, isRedrawingEditGeometry, selectedFeature])

  const handleToolbarUndoLastPoint = useCallback(() => {
    if (adminMode === 'create') {
      setCreatePoints((current) => current.slice(0, -1))
      return
    }
    if (adminMode === 'edit' && isRedrawingEditGeometry) {
      setEditPoints((current) => current.slice(0, -1))
    }
  }, [adminMode, isRedrawingEditGeometry])

  const handleToolbarClearPoints = useCallback(() => {
    if (adminMode === 'create') {
      setCreatePoints([])
      return
    }
    if (adminMode === 'edit' && isRedrawingEditGeometry) {
      setEditPoints([])
    }
  }, [adminMode, isRedrawingEditGeometry])

  const handleToolbarPrimaryAction = () => {
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
  }

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
    setAdminNotice('Element restaure depuis la corbeille.')
  }

  const handleUndoFeatureVersion = async () => {
    if (!isAdmin || !selectedFeatureId) {
      setAdminNotice('Selectionne un element pour restaurer une version.')
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
    setAdminNotice('Version precedente restauree.')
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
    setAdminNotice('Ordre du calque mis a jour.')
  }

  const handleExportGeoJson = () => {
    if (visibleExportEntries.length === 0) {
      setAdminNotice('Aucun element visible a exporter.')
      return
    }

    const payload = buildGeoJsonExport(visibleExportEntries)
    const day = new Date().toISOString().slice(0, 10)
    downloadTextFile(
      `marseille2033-export-${day}.geojson`,
      JSON.stringify(payload, null, 2),
      'application/geo+json;charset=utf-8',
    )
    setAdminNotice(`Export GeoJSON cree (${visibleExportEntries.length} elements).`)
  }

  const handleExportKml = () => {
    if (visibleExportEntries.length === 0) {
      setAdminNotice('Aucun element visible a exporter.')
      return
    }

    const payload = buildKmlExport(visibleExportEntries)
    const day = new Date().toISOString().slice(0, 10)
    downloadTextFile(
      `marseille2033-export-${day}.kml`,
      payload,
      'application/vnd.google-earth.kml+xml;charset=utf-8',
    )
    setAdminNotice(`Export KML cree (${visibleExportEntries.length} elements).`)
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
        setAdminNotice('Fichier charge mais aucun element exploitable trouve.')
      } else {
        setAdminNotice(
          `Fichier charge: ${imported.length} element(s) detecte(s).`,
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
      setAdminNotice('Selectionne un fichier GeoJSON/KML a importer.')
      return
    }

    const layerLabel = importDraft.layerLabel.trim()
    const category = importDraft.category.trim()
    const layerId = toLayerId(importDraft.layerId, layerLabel)
    if (!layerLabel || !category || !layerId) {
      setAdminNotice('Categorie, identifiant calque et nom calque sont requis.')
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
        setAdminNotice('Aucun element importable detecte dans ce fichier.')
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
          geometryType: item.geometry,
          coordinates,
          sortOrder: existingFeatureCount + index + 1,
          source: 'manual_import',
        })
      }

      if (rows.length === 0) {
        setIsImporting(false)
        setAdminNotice('Aucun element valide apres normalisation.')
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
        `Import termine: ${result.data.inserted} element(s) ajoutes.`,
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
          setAdminNotice('Selection zone annulee.')
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
    handleToolbarToggleRedraw,
    handleToolbarToolClick,
    handleToolbarUndoLastPoint,
    isAdmin,
    isRedrawingEditGeometry,
    isZoneSelectionMode,
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
            radius={8}
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
              weight: 4,
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
              weight: 3,
              dashArray: '7 7',
              fillOpacity: 0.15,
            }}
          />
        )
      }

      return (
        <Polyline
          positions={createPoints}
          pathOptions={{
            color: createDraft.color,
            weight: 4,
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
            radius={9}
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
              weight: 5,
              opacity: 0.95,
            }}
          />
        )
      }

      return (
        <Polygon
          positions={editPoints}
          pathOptions={{
            color: editDraft.color,
            weight: 4,
            fillColor: editDraft.color,
            fillOpacity: 0.24,
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
            radius={8}
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
              weight: 4,
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
              weight: 3,
              dashArray: '7 7',
              fillOpacity: 0.15,
            }}
          />
        )
      }

      return (
        <Polyline
          positions={editPoints}
          pathOptions={{
            color: editDraft.color,
            weight: 4,
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

  const renderLayerFeatures = (layer: LayerConfig) =>
    layer.features
      .filter((feature) =>
        statusFilter === 'all' ? true : feature.status === statusFilter,
      )
      .map((feature) => {
        const isSelected = selectedFeatureIdSet.has(feature.id)
        const isFocusedSelection = selectedFeatureId === feature.id
        const isHiddenSelectedGeometry =
          isFocusedSelection &&
          adminMode === 'edit' &&
          editDraft !== null &&
          editPoints.length > 0

        if (isHiddenSelectedGeometry) {
          return null
        }

        const popup = (
          <Popup>
            <div className="popup-content">
              <h4>{feature.name}</h4>
              <p>
                <strong>Categorie:</strong> {layer.category}
              </p>
              <p>
                <strong>Calque:</strong> {layer.label}
              </p>
              <p>
                <strong>Statut:</strong> {STATUS_LABELS[feature.status]}
              </p>
              {isAdmin ? (
                <p>
                  <strong>Admin:</strong> clique l'element pour l'editer.
                </p>
              ) : null}
            </div>
          </Popup>
        )

        const eventHandlers = isAdmin
          ? {
              click: (event: LeafletMouseEvent) =>
                handleFeatureClick(feature.id, event),
              contextmenu: (event: LeafletMouseEvent) =>
                handleFeatureContextMenu(feature.id, event),
            }
          : undefined

        if (feature.geometry === 'point') {
          return (
            <CircleMarker
              key={feature.id}
              center={feature.position}
              radius={isSelected ? 8 : 6}
              eventHandlers={eventHandlers}
              pathOptions={{
                color: feature.color,
                fillColor: feature.color,
                fillOpacity: 0.85,
                weight: isSelected ? 4 : 2,
              }}
            >
              {popup}
            </CircleMarker>
          )
        }

        if (feature.geometry === 'line') {
          return (
            <Polyline
              key={feature.id}
              positions={feature.positions}
              eventHandlers={eventHandlers}
              pathOptions={{
                color: feature.color,
                weight: isSelected ? 5 : 3,
                opacity: 0.9,
              }}
            >
              {popup}
            </Polyline>
          )
        }

        return (
          <Polygon
            key={feature.id}
            positions={feature.positions}
            eventHandlers={eventHandlers}
            pathOptions={{
              color: feature.color,
              weight: isSelected ? 4 : 2,
              fillColor: feature.color,
              fillOpacity: isSelected ? 0.35 : 0.2,
            }}
          >
            {popup}
          </Polygon>
        )
      })

  const toolbarPointCount =
    adminMode === 'create'
      ? createPoints.length
      : adminMode === 'edit' && isRedrawingEditGeometry
        ? editPoints.length
        : 0
  const toolbarMinPoints =
    adminMode === 'create'
      ? MIN_POINTS_REQUIRED[createDraft.geometry]
      : adminMode === 'edit' && isRedrawingEditGeometry && editDraft
        ? MIN_POINTS_REQUIRED[editDraft.geometry]
        : 0
  const toolbarCanUndo =
    adminMode === 'create'
      ? createPoints.length > 0
      : adminMode === 'edit' && isRedrawingEditGeometry
        ? editPoints.length > 0
        : false
  const toolbarCanClear =
    adminMode === 'create'
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
    adminMode === 'create' ? 'Creation en cours' : 'Redessin en cours'

  return (
    <div className="app-shell">
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
              onClick={() => setIsAdminPanelOpen((current) => !current)}
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

        {isAdminPanelOpen ? (
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
                    Cle project-ref:{' '}
                    <code>{supabaseEnvDiagnostic.keyProjectRef ?? 'introuvable'}</code>
                  </li>
                  <li>
                    Cle role: <code>{supabaseEnvDiagnostic.keyRole ?? 'inconnu'}</code>
                  </li>
                  <li>
                    Cle expire le:{' '}
                    <code>{supabaseEnvDiagnostic.keyExpIso ?? 'inconnu'}</code>
                  </li>
                  <li>
                    Cle empreinte: <code>{supabaseEnvDiagnostic.keyFingerprint}</code>
                  </li>
                  <li>
                    URL/Cle:{' '}
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
                          : 'indetermine'}
                    </strong>
                  </li>
                  {supabaseEnvDiagnostic.keyError ? (
                    <li>
                      Erreur cle: <code>{supabaseEnvDiagnostic.keyError}</code>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {!hasSupabase ? (
              <p className="muted">
                Supabase n'est pas configure: edition indisponible.
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
                    Exporte les elements visibles ({visibleExportEntries.length}).
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
                        ? `| ${importPreviewCount} element(s) detecte(s)`
                        : ''}
                    </p>
                  ) : (
                    <p className="muted">Selectionne un fichier a importer.</p>
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
                      Categorie cible
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
                        <option value="propose">Propose</option>
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
                    <h3>Creation d'un element</h3>

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
                          <option value="propose">Propose</option>
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
                      Type de geometrie
                      <select
                        value={createDraft.geometry}
                        onChange={(event) => {
                          setCreateDraft((current) => ({
                            ...current,
                            geometry: event.target.value as DrawGeometry,
                          }))
                          setCreatePoints([])
                        }}
                      >
                        <option value="point">Point</option>
                        <option value="line">Ligne</option>
                        <option value="polygon">Polygone</option>
                      </select>
                    </label>

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
                        Categorie
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
                        onClick={() => setCreatePoints((current) => current.slice(0, -1))}
                        disabled={createPoints.length === 0}
                      >
                        Annuler dernier point
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setCreatePoints([])}
                        disabled={createPoints.length === 0}
                      >
                        Reinitialiser
                      </button>
                    </div>

                    <button
                      type="button"
                      className="solid-button"
                      disabled={isSaving}
                      onClick={handleCreateFeature}
                    >
                      {isSaving ? 'Sauvegarde...' : 'Creer l\'element'}
                    </button>
                  </div>
                ) : null}

                {adminMode === 'edit' ? (
                  <div className="editor-block">
                    <h3>Edition</h3>
                    {!selectedFeature || !editDraft ? (
                      <p className="muted">
                        Clique un element sur la carte pour le modifier.
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
                              <option value="propose">Propose</option>
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
                            Categorie
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
                          Geometrie: {editDraft.geometry} | points: {editPoints.length}
                        </p>
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
                            Redessiner geometrie
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() =>
                              setEditPoints((current) => current.slice(0, -1))
                            }
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
                            Restaurer geometrie
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
                        Clique un element sur la carte pour le supprimer.
                      </p>
                    ) : (
                      <>
                        <p className="muted">
                          Element selectionne: <strong>{selectedFeature.feature.name}</strong>
                        </p>
                        <button
                          type="button"
                          className="danger-button"
                          disabled={isSaving}
                          onClick={handleDeleteFeature}
                        >
                          {isSaving ? 'Suppression...' : 'Supprimer l\'element'}
                        </button>
                      </>
                    )}
                  </div>
                ) : null}

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
                <option value="propose">Propose</option>
              </select>
            </label>

            <label>
              Categorie
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
          </div>
        </section>

        <section className="panel-block">
          <h2>Calques</h2>
          {layersByCategory.map((block) => (
            <div key={block.category} className="layer-group">
              <h3>{block.category}</h3>
              {block.layers.map((layer, index) => (
                <div key={layer.id} className="layer-row">
                  <label className="control-row">
                    <input
                      type="checkbox"
                      checked={activeLayers[layer.id]}
                      onChange={() => toggleLayer(layer.id)}
                    />
                    <span>{layer.label}</span>
                  </label>
                  {isAdmin ? (
                    <div className="layer-order-actions">
                      <button
                        type="button"
                        className="ghost-button mini-button"
                        onClick={() => void handleMoveLayer(block.category, layer.id, 'up')}
                        disabled={isSaving || index === 0}
                        title="Monter"
                      >
                        ↑
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
                        ↓
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </section>

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
          <h2>Elements visibles ({visibleFeatures.length})</h2>
          {visibleFeatures.length === 0 ? (
            <p className="muted">Active un calque pour commencer.</p>
          ) : (
            <ul className="feature-list">
              {visibleFeatures.map((feature) => (
                <li key={feature.id}>
                  <span
                    className="legend-dot"
                    style={{ backgroundColor: feature.color }}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>{feature.name}</strong>
                    <p>
                      {feature.layerLabel} | {STATUS_LABELS[feature.status]}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <main
        className={`map-pane${isDrawingOnMap ? ' is-drawing' : ''}${isZoneSelectionMode ? ' is-zone-selecting' : ''}`}
      >
        {isAdmin ? (
          <div className="map-toolbar" role="toolbar" aria-label="Outils carte">
            <p className="map-toolbar-title">Outils carte</p>
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
              {adminMode === 'create'
                ? `Creation ${DRAW_GEOMETRY_LABELS[createDraft.geometry]}`
                : ADMIN_MODE_LABELS[adminMode]}
            </p>
            <p className="map-toolbar-shortcuts">
              Raccourcis: 1/2/3, E, D, R, Z, Shift+clic, Entrer, Retour, Esc
            </p>

            {adminMode === 'create' ? (
              <div className="map-toolbar-section">
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
                      <option value="propose">Propose</option>
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
                      Clique un element sur la carte pour l'editer.
                    </p>
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className={`ghost-button mini-button${isZoneSelectionMode ? ' active' : ''}`}
                        onClick={handleToggleZoneSelection}
                        title="Selection par zone (Z)"
                      >
                        {isZoneSelectionMode ? 'Annuler zone' : 'Selection zone'}
                      </button>
                    </div>
                    <p className="map-toolbar-meta">
                      Multi-selection: <strong>{selectedFeatureIds.length}</strong> element(s)
                    </p>
                  </>
                ) : (
                  <>
                    <p className="map-toolbar-meta">
                      Selection: <strong>{selectedFeature.feature.name}</strong>
                    </p>
                    <p className="map-toolbar-meta">
                      Multi-selection: <strong>{selectedFeatureIds.length}</strong> element(s)
                    </p>
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className={`ghost-button mini-button${isZoneSelectionMode ? ' active' : ''}`}
                        onClick={handleToggleZoneSelection}
                        title="Selection par zone (Z)"
                      >
                        {isZoneSelectionMode ? 'Annuler zone' : 'Selection zone'}
                      </button>
                      <button
                        type="button"
                        className={`ghost-button mini-button${isRedrawingEditGeometry ? ' active' : ''}`}
                        onClick={handleToolbarToggleRedraw}
                        title="Basculer redessin (R)"
                      >
                        {isRedrawingEditGeometry ? 'Arreter redessin' : 'Redessiner'}
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
                    {!isRedrawingEditGeometry ? (
                      <p className="map-toolbar-meta">
                        Astuce: glisse un sommet, clic sur + pour inserer, clic droit sur sommet pour supprimer.
                      </p>
                    ) : null}
                    <p className="map-toolbar-meta">
                      Selection multiple: Shift+clic ou bouton "Selection zone".
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
                      Clique un element sur la carte pour le supprimer.
                    </p>
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className={`ghost-button mini-button${isZoneSelectionMode ? ' active' : ''}`}
                        onClick={handleToggleZoneSelection}
                        title="Selection par zone (Z)"
                      >
                        {isZoneSelectionMode ? 'Annuler zone' : 'Selection zone'}
                      </button>
                    </div>
                    <p className="map-toolbar-meta">
                      Multi-selection: <strong>{selectedFeatureIds.length}</strong> element(s)
                    </p>
                  </>
                ) : (
                  <>
                    <p className="map-toolbar-meta">
                      Selection: <strong>{selectedFeature.feature.name}</strong>
                    </p>
                    <p className="map-toolbar-meta">
                      Multi-selection: <strong>{selectedFeatureIds.length}</strong> element(s)
                    </p>
                    <div className="map-toolbar-actions">
                      <button
                        type="button"
                        className={`ghost-button mini-button${isZoneSelectionMode ? ' active' : ''}`}
                        onClick={handleToggleZoneSelection}
                        title="Selection par zone (Z)"
                      >
                        {isZoneSelectionMode ? 'Annuler zone' : 'Selection zone'}
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
                      Shift+clic ajoute/retire un element de la selection.
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {isAdmin && isGuidedDrawing && guideGeometry ? (
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
        {isAdmin && featureContextMenu ? (
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
              Editer cet element
            </button>
            <button
              type="button"
              className="feature-context-menu-item"
              onClick={() => void handleContextMenuAction('toggle')}
            >
              Ajouter/retirer de la selection
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
          minZoom={10}
          maxZoom={18}
          maxBounds={METROPOLE_BOUNDS}
          maxBoundsViscosity={1}
          doubleClickZoom={!isMapInteractionCaptureEnabled}
          attributionControl={false}
          className="map"
        >
          <TileLayer
            url={BASE_MAPS[baseMapId].url}
            attribution={BASE_MAPS[baseMapId].attribution}
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
          {visibleLayers.map((layer) => renderLayerFeatures(layer))}
          {renderDraftGeometry()}
          {zoneSelectionBounds ? (
            <Rectangle
              bounds={zoneSelectionBounds}
              pathOptions={{
                color: '#0f172a',
                weight: 1.5,
                dashArray: '5 4',
                fillColor: '#93c5fd',
                fillOpacity: 0.16,
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
