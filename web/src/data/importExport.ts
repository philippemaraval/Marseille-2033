import type { GeometryFeature, StatusId } from '../types/map'

export interface FeatureEnvelope {
  feature: GeometryFeature
  category: string
  layerId: string
  layerLabel: string
}

export interface ImportedGeometryFeature {
  name: string
  geometry: GeometryFeature['geometry']
  position?: [number, number]
  positions?: [number, number][]
  status?: StatusId
  color?: string
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

interface GeoJsonFeature {
  type: 'Feature'
  geometry: GeoJsonGeometry
  properties: Record<string, unknown>
}

type GeoJsonGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function closeRing(positions: [number, number][]): [number, number][] {
  if (positions.length === 0) {
    return positions
  }
  const first = positions[0]
  const last = positions[positions.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) {
    return positions
  }
  return [...positions, first]
}

function parseHexColor(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toLowerCase()
  }
  return null
}

function asStatus(value: unknown): StatusId | null {
  if (value === 'existant' || value === 'en cours' || value === 'propose') {
    return value
  }
  return null
}

function toKmlColor(hex: string): string {
  const normalized = parseHexColor(hex) ?? '#1d4ed8'
  const rr = normalized.slice(1, 3)
  const gg = normalized.slice(3, 5)
  const bb = normalized.slice(5, 7)
  return `ff${bb}${gg}${rr}`
}

function toLonLatText([lat, lng]: [number, number]): string {
  return `${lng},${lat},0`
}

function parseCoordinatesText(value: string): [number, number][] {
  return value
    .trim()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [lngRaw, latRaw] = entry.split(',')
      const lng = Number(lngRaw)
      const lat = Number(latRaw)
      return [lat, lng] as [number, number]
    })
    .filter(
      ([lat, lng]) =>
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180,
    )
}

function readProperties(
  value: unknown,
): { name: string; status?: StatusId; color?: string } {
  if (!value || typeof value !== 'object') {
    return { name: 'Element importe' }
  }

  const raw = value as Record<string, unknown>
  const nameCandidates = [raw.name, raw.title, raw.label]
  const foundName = nameCandidates.find((entry) => typeof entry === 'string')
  const status = asStatus(raw.status)
  const color = parseHexColor(typeof raw.color === 'string' ? raw.color : undefined)

  return {
    name:
      typeof foundName === 'string' && foundName.trim()
        ? foundName.trim()
        : 'Element importe',
    status: status ?? undefined,
    color: color ?? undefined,
  }
}

function toImportedFromGeometry(
  geometry: unknown,
  properties: { name: string; status?: StatusId; color?: string },
): ImportedGeometryFeature | null {
  if (!geometry || typeof geometry !== 'object') {
    return null
  }

  const raw = geometry as Record<string, unknown>
  if (raw.type === 'Point' && Array.isArray(raw.coordinates)) {
    const [lng, lat] = raw.coordinates
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null
    }
    return {
      name: properties.name,
      geometry: 'point',
      position: [Number(lat), Number(lng)],
      status: properties.status,
      color: properties.color,
    }
  }

  if (raw.type === 'MultiPoint' && Array.isArray(raw.coordinates)) {
    const first = raw.coordinates[0]
    if (!Array.isArray(first)) {
      return null
    }
    const [lng, lat] = first
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null
    }
    return {
      name: properties.name,
      geometry: 'point',
      position: [Number(lat), Number(lng)],
      status: properties.status,
      color: properties.color,
    }
  }

  if (raw.type === 'LineString' && Array.isArray(raw.coordinates)) {
    const positions = raw.coordinates
      .map((entry) =>
        Array.isArray(entry) && entry.length >= 2
          ? ([Number(entry[1]), Number(entry[0])] as [number, number])
          : null,
      )
      .filter(
        (entry): entry is [number, number] =>
          entry !== null &&
          Number.isFinite(entry[0]) &&
          Number.isFinite(entry[1]),
      )

    if (positions.length < 2) {
      return null
    }

    return {
      name: properties.name,
      geometry: 'line',
      positions,
      status: properties.status,
      color: properties.color,
    }
  }

  if (raw.type === 'MultiLineString' && Array.isArray(raw.coordinates)) {
    const longest = raw.coordinates
      .filter((entry) => Array.isArray(entry))
      .sort((left, right) => right.length - left.length)[0]
    if (!longest) {
      return null
    }
    return toImportedFromGeometry(
      { type: 'LineString', coordinates: longest },
      properties,
    )
  }

  if (raw.type === 'Polygon' && Array.isArray(raw.coordinates)) {
    const outerRing = raw.coordinates[0]
    if (!Array.isArray(outerRing)) {
      return null
    }
    const positions = outerRing
      .map((entry) =>
        Array.isArray(entry) && entry.length >= 2
          ? ([Number(entry[1]), Number(entry[0])] as [number, number])
          : null,
      )
      .filter(
        (entry): entry is [number, number] =>
          entry !== null &&
          Number.isFinite(entry[0]) &&
          Number.isFinite(entry[1]),
      )

    if (positions.length < 4) {
      return null
    }

    const closed = closeRing(positions)
    const trimmed =
      closed.length > 1 &&
      closed[0][0] === closed[closed.length - 1][0] &&
      closed[0][1] === closed[closed.length - 1][1]
        ? closed.slice(0, -1)
        : closed

    if (trimmed.length < 3) {
      return null
    }

    return {
      name: properties.name,
      geometry: 'polygon',
      positions: trimmed,
      status: properties.status,
      color: properties.color,
    }
  }

  if (raw.type === 'MultiPolygon' && Array.isArray(raw.coordinates)) {
    const selected = raw.coordinates
      .filter((entry) => Array.isArray(entry) && Array.isArray(entry[0]))
      .sort(
        (left, right) =>
          (Array.isArray(right[0]) ? right[0].length : 0) -
          (Array.isArray(left[0]) ? left[0].length : 0),
      )[0]
    if (!selected) {
      return null
    }
    return toImportedFromGeometry(
      { type: 'Polygon', coordinates: selected },
      properties,
    )
  }

  return null
}

function parseGeoJson(content: string): ImportedGeometryFeature[] {
  const parsed = JSON.parse(content) as unknown
  const imported: ImportedGeometryFeature[] = []

  const consumeFeature = (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return
    }
    const raw = value as Record<string, unknown>
    if (raw.type === 'Feature') {
      const props = readProperties(raw.properties)
      const item = toImportedFromGeometry(raw.geometry, props)
      if (item) {
        imported.push(item)
      }
      return
    }

    const item = toImportedFromGeometry(raw, { name: 'Element importe' })
    if (item) {
      imported.push(item)
    }
  }

  if (parsed && typeof parsed === 'object') {
    const root = parsed as Record<string, unknown>
    if (root.type === 'FeatureCollection' && Array.isArray(root.features)) {
      for (const feature of root.features) {
        consumeFeature(feature)
      }
    } else {
      consumeFeature(root)
    }
  }

  return imported
}

function findChildByLocalName(
  root: Element | Document,
  localName: string,
): Element | null {
  const list = root.getElementsByTagNameNS('*', localName)
  if (list.length > 0) {
    return list.item(0)
  }
  const fallbackList = root.getElementsByTagName(localName)
  if (fallbackList.length > 0) {
    return fallbackList.item(0)
  }
  return null
}

function parseKml(content: string): ImportedGeometryFeature[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(content, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('Fichier KML invalide.')
  }

  const placemarkList = doc.getElementsByTagNameNS('*', 'Placemark')
  const placemarks = Array.from(placemarkList)
  if (placemarks.length === 0) {
    return []
  }

  const imported: ImportedGeometryFeature[] = []

  for (const placemark of placemarks) {
    const nameNode = findChildByLocalName(placemark, 'name')
    const name = nameNode?.textContent?.trim() || 'Element importe'

    const pointNode = findChildByLocalName(placemark, 'Point')
    const lineNode = findChildByLocalName(placemark, 'LineString')
    const polygonNode = findChildByLocalName(placemark, 'Polygon')

    if (pointNode) {
      const coordinatesNode = findChildByLocalName(pointNode, 'coordinates')
      const coordinatesText = coordinatesNode?.textContent?.trim() || ''
      const positions = parseCoordinatesText(coordinatesText)
      if (positions.length > 0) {
        imported.push({
          name,
          geometry: 'point',
          position: positions[0],
        })
      }
      continue
    }

    if (lineNode) {
      const coordinatesNode = findChildByLocalName(lineNode, 'coordinates')
      const coordinatesText = coordinatesNode?.textContent?.trim() || ''
      const positions = parseCoordinatesText(coordinatesText)
      if (positions.length >= 2) {
        imported.push({
          name,
          geometry: 'line',
          positions,
        })
      }
      continue
    }

    if (polygonNode) {
      const outerNode = findChildByLocalName(polygonNode, 'outerBoundaryIs')
      const ringNode = outerNode
        ? findChildByLocalName(outerNode, 'LinearRing')
        : findChildByLocalName(polygonNode, 'LinearRing')
      const coordinatesNode = ringNode
        ? findChildByLocalName(ringNode, 'coordinates')
        : null
      const coordinatesText = coordinatesNode?.textContent?.trim() || ''
      const positions = parseCoordinatesText(coordinatesText)
      if (positions.length >= 4) {
        const closed = closeRing(positions)
        const trimmed =
          closed[0][0] === closed[closed.length - 1][0] &&
          closed[0][1] === closed[closed.length - 1][1]
            ? closed.slice(0, -1)
            : closed

        if (trimmed.length >= 3) {
          imported.push({
            name,
            geometry: 'polygon',
            positions: trimmed,
          })
        }
      }
    }
  }

  return imported
}

export function parseImportedFeatures(
  content: string,
  filename: string,
): ImportedGeometryFeature[] {
  const lower = filename.toLowerCase()

  if (lower.endsWith('.kml')) {
    return parseKml(content)
  }

  if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
    return parseGeoJson(content)
  }

  const trimmed = content.trim()
  if (trimmed.startsWith('<')) {
    return parseKml(content)
  }
  return parseGeoJson(content)
}

export function buildGeoJsonExport(
  entries: FeatureEnvelope[],
): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries.map((entry) => {
      const properties = {
        id: entry.feature.id,
        name: entry.feature.name,
        status: entry.feature.status,
        color: entry.feature.color,
        category: entry.category,
        layer_id: entry.layerId,
        layer_label: entry.layerLabel,
      }

      if (entry.feature.geometry === 'point') {
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [entry.feature.position[1], entry.feature.position[0]],
          },
          properties,
        }
      }

      if (entry.feature.geometry === 'line') {
        return {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: entry.feature.positions.map(([lat, lng]) => [lng, lat]),
          },
          properties,
        }
      }

      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            closeRing(entry.feature.positions).map(([lat, lng]) => [lng, lat]),
          ],
        },
        properties,
      }
    }),
  }
}

export function buildKmlExport(entries: FeatureEnvelope[]): string {
  const placemarks = entries
    .map((entry, index) => {
      const styleId = `style-${index}`
      const lineColor = toKmlColor(entry.feature.color)
      const polygonColor = lineColor
      const iconColor = lineColor

      let geometryBlock = ''
      if (entry.feature.geometry === 'point') {
        geometryBlock = `<Point><coordinates>${toLonLatText(entry.feature.position)}</coordinates></Point>`
      } else if (entry.feature.geometry === 'line') {
        geometryBlock = `<LineString><tessellate>1</tessellate><coordinates>${entry.feature.positions
          .map(toLonLatText)
          .join(' ')}</coordinates></LineString>`
      } else {
        geometryBlock = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${closeRing(
          entry.feature.positions,
        )
          .map(toLonLatText)
          .join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
      }

      return `<Placemark>
  <name>${escapeXml(entry.feature.name)}</name>
  <Style id="${styleId}">
    <IconStyle><color>${iconColor}</color></IconStyle>
    <LineStyle><color>${lineColor}</color><width>3</width></LineStyle>
    <PolyStyle><color>${polygonColor}</color><fill>1</fill><outline>1</outline></PolyStyle>
  </Style>
  <ExtendedData>
    <Data name="id"><value>${escapeXml(entry.feature.id)}</value></Data>
    <Data name="status"><value>${escapeXml(entry.feature.status)}</value></Data>
    <Data name="color"><value>${escapeXml(entry.feature.color)}</value></Data>
    <Data name="category"><value>${escapeXml(entry.category)}</value></Data>
    <Data name="layer_id"><value>${escapeXml(entry.layerId)}</value></Data>
    <Data name="layer_label"><value>${escapeXml(entry.layerLabel)}</value></Data>
  </ExtendedData>
  ${geometryBlock}
</Placemark>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
${placemarks}
</Document>
</kml>`
}
