#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'

const require = createRequire(import.meta.url)
const osmtogeojson = require('osmtogeojson')

const ROOT_DIR = path.resolve(process.cwd())
dotenv.config({ path: path.resolve(ROOT_DIR, '.env.local') })
dotenv.config({ path: path.resolve(ROOT_DIR, '.env') })

const OUTPUT_FILE = path.resolve(ROOT_DIR, 'src/data/layers.generated.ts')
const OUTPUT_JSON_FILE = path.resolve(ROOT_DIR, 'data/osm-layers.json')
const BBOX = process.env.OSM_BBOX || '43.02,4.95,43.62,5.86'
const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]
const OVERPASS_URLS = process.env.OVERPASS_URLS
  ? process.env.OVERPASS_URLS.split(',').map((url) => url.trim())
  : DEFAULT_OVERPASS_URLS
const MAX_FEATURES_PER_LAYER = Number(process.env.OSM_MAX_FEATURES || '300')
const MAX_LINE_POINTS = Number(process.env.OSM_MAX_LINE_POINTS || '80')
const MAX_POLYGON_POINTS = Number(process.env.OSM_MAX_POLYGON_POINTS || '60')

const LAYER_SPECS = [
  {
    id: 'transport_metro',
    label: 'Transports > Metro (lignes)',
    category: 'transports en commun',
    color: '#0055a4',
    mode: 'line',
    selectors: [
      `relation["route"="subway"](${BBOX});`,
      `way["railway"="subway"](${BBOX});`,
    ],
  },
  {
    id: 'transport_tram',
    label: 'Transports > Tram (lignes)',
    category: 'transports en commun',
    color: '#7c3aed',
    mode: 'line',
    selectors: [
      `relation["route"="tram"](${BBOX});`,
      `way["railway"="tram"](${BBOX});`,
    ],
  },
  {
    id: 'transport_bhns',
    label: 'Transports > BHNS (lignes)',
    category: 'transports en commun',
    color: '#0f766e',
    mode: 'line',
    selectors: [
      `relation["route"="bus"]["ref"~"^B"](${BBOX});`,
      `relation["route_master"="bus"]["ref"~"^B"](${BBOX});`,
    ],
  },
  {
    id: 'transport_ter',
    label: 'Transports > TER (lignes)',
    category: 'transports en commun',
    color: '#334155',
    mode: 'line',
    selectors: [
      `relation["route"="train"]["network"~"TER|SNCF|ZOU",i](${BBOX});`,
    ],
  },
  {
    id: 'transport_stations',
    label: 'Transports > Stations (multi-modes)',
    category: 'transports en commun',
    color: '#0f172a',
    mode: 'point',
    selectors: [
      `nwr["railway"~"station|halt|tram_stop"](${BBOX});`,
      `nwr["station"="subway"](${BBOX});`,
      `nwr["public_transport"="station"](${BBOX});`,
    ],
  },
  {
    id: 'parks_polygons',
    label: 'Parcs > Surfaces',
    category: 'parcs',
    color: '#166534',
    mode: 'polygon',
    selectors: [
      `way["leisure"~"park|garden|recreation_ground|nature_reserve"](${BBOX});`,
      `relation["leisure"~"park|garden|recreation_ground|nature_reserve"](${BBOX});`,
      `way["landuse"="recreation_ground"](${BBOX});`,
      `relation["landuse"="recreation_ground"](${BBOX});`,
    ],
  },
  {
    id: 'parks_points',
    label: 'Parcs > Points',
    category: 'parcs',
    color: '#166534',
    mode: 'point',
    selectors: [
      `node["leisure"~"park|garden|recreation_ground|nature_reserve"](${BBOX});`,
      `node["landuse"="recreation_ground"](${BBOX});`,
    ],
  },
  {
    id: 'decoupage_quartiers',
    label: 'Decoupages > Quartiers',
    category: 'quartiers, arrondissements et secteurs',
    color: '#be123c',
    mode: 'polygon-with-centroid',
    selectors: [
      `relation["boundary"="administrative"]["admin_level"="10"](${BBOX});`,
      `relation["boundary"="administrative"]["admin_level"="11"](${BBOX});`,
    ],
  },
  {
    id: 'decoupage_arrondissements',
    label: 'Decoupages > Arrondissements',
    category: 'quartiers, arrondissements et secteurs',
    color: '#991b1b',
    mode: 'polygon-with-centroid',
    selectors: [
      `relation["boundary"="administrative"]["admin_level"="9"](${BBOX});`,
    ],
  },
  {
    id: 'decoupage_secteurs',
    label: 'Decoupages > Secteurs',
    category: 'quartiers, arrondissements et secteurs',
    color: '#6b21a8',
    mode: 'polygon-with-centroid',
    selectors: [
      `relation["boundary"="administrative"]["name"~"Secteur",i](${BBOX});`,
      `relation["boundary"="administrative"]["name"~"sector",i](${BBOX});`,
    ],
  },
]

function toLatLng(coord) {
  return [Number(coord[1].toFixed(6)), Number(coord[0].toFixed(6))]
}

function samplePositions(positions, maxPoints) {
  if (!Array.isArray(positions) || positions.length <= maxPoints) {
    return positions
  }
  const selected = []
  const used = new Set()
  const step = (positions.length - 1) / (maxPoints - 1)

  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round(i * step)
    if (used.has(index)) {
      continue
    }
    used.add(index)
    selected.push(positions[index])
  }

  const first = positions[0]
  const last = positions[positions.length - 1]
  if (selected[0] !== first) {
    selected.unshift(first)
  }
  if (selected[selected.length - 1] !== last) {
    selected.push(last)
  }

  return selected
}

function cleanRing(positions) {
  if (positions.length < 3) {
    return positions
  }
  const first = positions[0]
  const last = positions[positions.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) {
    return positions.slice(0, -1)
  }
  return positions
}

function lineFromGeometry(geometry) {
  if (!geometry) {
    return null
  }
  if (geometry.type === 'LineString') {
    return samplePositions(geometry.coordinates.map(toLatLng), MAX_LINE_POINTS)
  }
  if (geometry.type === 'MultiLineString') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      return null
    }
    const longest = geometry.coordinates.reduce((max, current) =>
      current.length > max.length ? current : max,
    )
    return samplePositions(longest.map(toLatLng), MAX_LINE_POINTS)
  }
  return null
}

function polygonFromGeometry(geometry) {
  if (!geometry) {
    return null
  }
  if (geometry.type === 'Polygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      return null
    }
    return cleanRing(
      samplePositions(geometry.coordinates[0].map(toLatLng), MAX_POLYGON_POINTS),
    )
  }
  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      return null
    }
    const rings = geometry.coordinates
      .map((polygon) => polygon[0])
      .filter((ring) => Array.isArray(ring))
    if (rings.length === 0) {
      return null
    }
    const widestRing = rings.reduce((max, current) =>
      current.length > max.length ? current : max,
    )
    return cleanRing(samplePositions(widestRing.map(toLatLng), MAX_POLYGON_POINTS))
  }
  return null
}

function pointFromGeometry(geometry) {
  if (!geometry) {
    return null
  }
  if (geometry.type === 'Point') {
    return toLatLng(geometry.coordinates)
  }
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) {
    return toLatLng(geometry.coordinates[0])
  }
  return null
}

function centroid(positions) {
  const total = positions.reduce(
    (acc, [lat, lng]) => {
      acc.lat += lat
      acc.lng += lng
      return acc
    },
    { lat: 0, lng: 0 },
  )

  return [
    Number((total.lat / positions.length).toFixed(6)),
    Number((total.lng / positions.length).toFixed(6)),
  ]
}

function toName(properties, fallback) {
  return (
    properties?.name ||
    properties?.official_name ||
    properties?.ref ||
    properties?.loc_name ||
    fallback
  )
}

function makeQuery(selector) {
  return `[out:json][timeout:120];(${selector});out body geom;`
}

function mergePayloads(payloads) {
  const merged = {
    version: 0.6,
    generator: 'marseille2033-import',
    osm3s: {
      timestamp_osm_base: new Date().toISOString(),
    },
    elements: [],
  }
  const seen = new Set()

  for (const payload of payloads) {
    for (const element of payload.elements || []) {
      const key = `${element.type}:${element.id}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      merged.elements.push(element)
    }
  }

  return merged
}

async function postQuery(url, query) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: new URLSearchParams({ data: query }).toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Overpass error ${response.status} on ${url}: ${text.slice(0, 240)}`)
  }

  return response.json()
}

async function fetchSelectorJson(selector) {
  const query = makeQuery(selector)
  let lastError

  for (const url of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await postQuery(url, query)
      } catch (error) {
        lastError = error
        console.warn(`  retry ${attempt} failed on ${url}`)
      }
    }
  }

  throw lastError
}

async function fetchOverpassJson(selectors) {
  const payloads = []
  for (const selector of selectors) {
    payloads.push(await fetchSelectorJson(selector))
  }
  return mergePayloads(payloads)
}

function toLayer(spec, overpassJson) {
  const geojson = osmtogeojson(overpassJson)
  const output = []
  const seen = new Set()

  let index = 0
  for (const feature of geojson.features ?? []) {
    if (output.length >= MAX_FEATURES_PER_LAYER) {
      break
    }
    index += 1

    const baseName = toName(feature.properties, `${spec.label} ${index}`)
    const baseId = feature.id ? String(feature.id) : `${spec.id}-${index}`
    const featureId = `${spec.id}-${baseId.replaceAll('/', '-')}`

    if (spec.mode === 'line') {
      const positions = lineFromGeometry(feature.geometry)
      if (!positions || positions.length < 2) {
        continue
      }
      const dedupeKey = `${baseName}:${positions[0][0]}:${positions[0][1]}`
      if (seen.has(dedupeKey)) {
        continue
      }
      seen.add(dedupeKey)
      output.push({
        id: featureId,
        name: baseName,
        status: 'existant',
        color: spec.color,
        geometry: 'line',
        positions,
      })
      continue
    }

    if (spec.mode === 'point') {
      const position = pointFromGeometry(feature.geometry)
      if (!position) {
        continue
      }
      const dedupeKey = `${baseName}:${position[0]}:${position[1]}`
      if (seen.has(dedupeKey)) {
        continue
      }
      seen.add(dedupeKey)
      output.push({
        id: featureId,
        name: baseName,
        status: 'existant',
        color: spec.color,
        geometry: 'point',
        position,
      })
      continue
    }

    const polygon = polygonFromGeometry(feature.geometry)
    if (!polygon || polygon.length < 3) {
      continue
    }

    const dedupeKey = `${baseName}:${polygon[0][0]}:${polygon[0][1]}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)

    output.push({
      id: featureId,
      name: baseName,
      status: 'existant',
      color: spec.color,
      geometry: 'polygon',
      positions: polygon,
    })

    if (spec.mode === 'polygon-with-centroid') {
      const center = centroid(polygon)
      output.push({
        id: `${featureId}-center`,
        name: `Centre ${baseName}`,
        status: 'existant',
        color: spec.color,
        geometry: 'point',
        position: center,
      })
    }
  }

  return {
    id: spec.id,
    label: spec.label,
    category: spec.category,
    features: output,
  }
}

async function main() {
  const layers = []
  console.log(
    `OSM import start | bbox=${BBOX} | max/layer=${MAX_FEATURES_PER_LAYER}`,
  )
  console.log(`Overpass endpoints: ${OVERPASS_URLS.join(', ')}`)

  for (const spec of LAYER_SPECS) {
    console.log(`- Fetch ${spec.id}...`)
    const overpassJson = await fetchOverpassJson(spec.selectors)
    const layer = toLayer(spec, overpassJson)
    layers.push(layer)
    console.log(`  -> ${layer.features.length} features`)
  }

  const now = new Date().toISOString()
  const payload = {
    generatedAt: now,
    bbox: BBOX,
    overpassUrl: OVERPASS_URLS.join(','),
    layers,
  }
  const content = [
    "import type { LayerConfig } from '../types/map'",
    '',
    `export const osmImportMeta = ${JSON.stringify(
      {
        generatedAt: payload.generatedAt,
        bbox: payload.bbox,
        overpassUrl: payload.overpassUrl,
      },
      null,
      2,
    )} as const`,
    '',
    `export const osmLayers: LayerConfig[] = ${JSON.stringify(payload.layers, null, 2)}`,
    '',
  ].join('\n')

  await fs.mkdir(path.dirname(OUTPUT_JSON_FILE), { recursive: true })
  await fs.writeFile(OUTPUT_JSON_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.writeFile(OUTPUT_FILE, content, 'utf8')
  console.log(`OSM import done -> ${OUTPUT_FILE}`)
  console.log(`OSM import json -> ${OUTPUT_JSON_FILE}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
