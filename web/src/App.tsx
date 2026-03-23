import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  LatLngBoundsExpression,
  LatLngTuple,
  LeafletMouseEvent,
} from 'leaflet'
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMapEvents,
} from 'react-leaflet'
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

interface MapClickCaptureProps {
  enabled: boolean
  onMapClick: (position: LatLngTuple) => void
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

const MIN_POINTS_REQUIRED: Record<DrawGeometry, number> = {
  point: 1,
  line: 2,
  polygon: 3,
}

function MapClickCapture({ enabled, onMapClick }: MapClickCaptureProps) {
  useMapEvents({
    click(event) {
      if (!enabled) {
        return
      }
      onMapClick([event.latlng.lat, event.latlng.lng])
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
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() =>
    buildDefaultDraft(fallbackLayers),
  )
  const [createPoints, setCreatePoints] = useState<LatLngTuple[]>([])
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editPoints, setEditPoints] = useState<LatLngTuple[]>([])
  const [isRedrawingEditGeometry, setIsRedrawingEditGeometry] = useState(false)

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

  const layerSuggestions = useMemo(
    () =>
      layers
        .map((layer) => ({
          id: layer.id,
          label: layer.label,
          category: layer.category,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    [layers],
  )

  const toggleLayer = (id: string) => {
    setActiveLayers((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }

  const handleFeatureClick = useCallback(
    (featureId: string, event: LeafletMouseEvent) => {
      if (!isAdmin) {
        return
      }
      const match = featureById.get(featureId)
      event.originalEvent.stopPropagation()
      setSelectedFeatureId(featureId)
      if (match) {
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
      }
      setAdminNotice(null)
      if (adminMode === 'delete' || adminMode === 'edit') {
        return
      }
      setAdminMode('edit')
    },
    [adminMode, featureById, isAdmin],
  )

  const handleMapClick = useCallback(
    (position: LatLngTuple) => {
      if (!isAdmin) {
        return
      }

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
    setEditDraft(null)
    setEditPoints([])
    setIsRedrawingEditGeometry(false)
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

    if (!name || !category || !layerLabel || !layerId) {
      setAdminNotice('Nom, categorie et calque sont obligatoires.')
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
    const sortOrder =
      (layers.find((layer) => layer.id === layerId)?.features.length ?? 0) + 1
    const id = `manual_${crypto.randomUUID()}`

    setIsSaving(true)
    setAdminNotice(null)

    const { error } = await supabase.from('map_features').insert({
      id,
      name,
      status: createDraft.status,
      category,
      layer_id: layerId,
      layer_label: layerLabel,
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
    setEditDraft({
      name,
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
    setIsSaving(false)
    setAdminNotice('Element modifie.')
  }

  const handleDeleteFeature = async () => {
    if (!supabase || !isAdmin || !selectedFeatureId || !selectedFeature) {
      setAdminNotice('Selectionne un element a supprimer.')
      return
    }

    const confirmed = window.confirm(
      `Supprimer "${selectedFeature.feature.name}" ? Cette action est irreversible.`,
    )
    if (!confirmed) {
      return
    }

    setIsSaving(true)
    setAdminNotice(null)

    const { error } = await supabase
      .from('map_features')
      .delete()
      .eq('id', selectedFeatureId)

    if (error) {
      setIsSaving(false)
      setAdminNotice(`Erreur suppression: ${error.message}`)
      return
    }

    setSelectedFeatureId(null)
    setEditDraft(null)
    setEditPoints([])
    setIsRedrawingEditGeometry(false)
    await syncSupabaseLayers()
    setIsSaving(false)
    setAdminNotice('Element supprime.')
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

  const renderLayerFeatures = (layer: LayerConfig) =>
    layer.features
      .filter((feature) =>
        statusFilter === 'all' ? true : feature.status === statusFilter,
      )
      .map((feature) => {
        const isSelected = selectedFeatureId === feature.id

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
            <h2>Mode admin</h2>

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

                        <button
                          type="button"
                          className="solid-button"
                          disabled={isSaving}
                          onClick={handleSaveEdition}
                        >
                          {isSaving ? 'Sauvegarde...' : 'Enregistrer'}
                        </button>
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
              {block.layers.map((layer) => (
                <label key={layer.id} className="control-row">
                  <input
                    type="checkbox"
                    checked={activeLayers[layer.id]}
                    onChange={() => toggleLayer(layer.id)}
                  />
                  <span>{layer.label}</span>
                </label>
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

      <main className="map-pane">
        <MapContainer
          center={MARSEILLE_CENTER}
          zoom={12}
          minZoom={10}
          maxZoom={18}
          maxBounds={METROPOLE_BOUNDS}
          maxBoundsViscosity={1}
          attributionControl={false}
          className="map"
        >
          <TileLayer
            url={BASE_MAPS[baseMapId].url}
            attribution={BASE_MAPS[baseMapId].attribution}
          />
          <MapClickCapture
            enabled={
              isAdmin &&
              (adminMode === 'create' ||
                (adminMode === 'edit' && isRedrawingEditGeometry))
            }
            onMapClick={handleMapClick}
          />
          {visibleLayers.map((layer) => renderLayerFeatures(layer))}
          {renderDraftGeometry()}
        </MapContainer>
      </main>
    </div>
  )
}

export default App
