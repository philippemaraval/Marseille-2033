import { useMemo, useState } from 'react'
import type { LatLngBoundsExpression, LatLngTuple } from 'leaflet'
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
} from 'react-leaflet'
import { layerMeta, layers } from './data/layers'
import type { LayerConfig, StatusId } from './types/map'
import './App.css'

type BaseMapId = 'osm' | 'satellite' | 'carto_light' | 'carto_dark' | 'topo'

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

function App() {
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('osm')
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layers.map((layer) => [layer.id, false])),
  )
  const [statusFilter, setStatusFilter] = useState<StatusId | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')

  const categories = useMemo(
    () =>
      Array.from(new Set(layers.map((layer) => layer.category))).sort((a, b) =>
        a.localeCompare(b, 'fr'),
      ),
    [],
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
    [activeLayers, categoryFilter],
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
    [categories],
  )

  const toggleLayer = (id: string) => {
    setActiveLayers((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }

  const renderLayerFeatures = (layer: LayerConfig) =>
    layer.features
      .filter((feature) =>
        statusFilter === 'all' ? true : feature.status === statusFilter,
      )
      .map((feature) => {
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
            </div>
          </Popup>
        )

        if (feature.geometry === 'point') {
          return (
            <CircleMarker
              key={feature.id}
              center={feature.position}
              radius={6}
              pathOptions={{
                color: feature.color,
                fillColor: feature.color,
                fillOpacity: 0.85,
                weight: 2,
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
              pathOptions={{
                color: feature.color,
                weight: 3,
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
            pathOptions={{
              color: feature.color,
              weight: 2,
              fillColor: feature.color,
              fillOpacity: 0.2,
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
          <p className="kicker">Marseille 2033</p>
          <h1>Plateforme carte - V1</h1>
          <p className="intro">
            Donnees source: {layerMeta.mode} ({layerMeta.generatedAt})
          </p>
        </header>

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
          {visibleLayers.map((layer) => renderLayerFeatures(layer))}
        </MapContainer>
      </main>
    </div>
  )
}

export default App
