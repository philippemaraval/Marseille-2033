export type StatusId = 'existant' | 'en cours' | 'propose'

export type PointIconId =
  | 'dot'
  | 'pin'
  | 'metro'
  | 'tram'
  | 'bus'
  | 'train'
  | 'bike'
  | 'park'
  | 'star'

export type LabelMode = 'auto' | 'always' | 'hover'
export type LineDashStyle = 'solid' | 'dashed' | 'dotted'
export type LineDirectionMode = 'none' | 'forward' | 'both'
export type PolygonPattern = 'none' | 'diagonal' | 'cross' | 'dots'
export type PolygonBorderMode = 'normal' | 'inner' | 'outer'

export interface FeatureStyle {
  pointRadius?: number
  lineWidth?: number
  fillOpacity?: number
  pointIcon?: PointIconId
  labelMode?: LabelMode
  labelSize?: number
  labelHalo?: boolean
  labelPriority?: number
  lineDash?: LineDashStyle
  lineArrows?: boolean
  lineDirection?: LineDirectionMode
  polygonPattern?: PolygonPattern
  polygonBorderMode?: PolygonBorderMode
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
