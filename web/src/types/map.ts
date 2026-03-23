export type StatusId = 'existant' | 'en cours' | 'propose'

export interface FeatureStyle {
  pointRadius?: number
  lineWidth?: number
  fillOpacity?: number
}

export interface BaseFeature {
  id: string
  name: string
  status: StatusId
  color: string
  style?: FeatureStyle
}

export interface PointFeature extends BaseFeature {
  geometry: 'point'
  position: [number, number]
}

export interface LineFeature extends BaseFeature {
  geometry: 'line'
  positions: [number, number][]
}

export interface PolygonFeature extends BaseFeature {
  geometry: 'polygon'
  positions: [number, number][]
}

export type GeometryFeature = PointFeature | LineFeature | PolygonFeature

export interface LayerConfig {
  id: string
  label: string
  category: string
  sortOrder?: number
  features: GeometryFeature[]
}
