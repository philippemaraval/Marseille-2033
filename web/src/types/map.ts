export type StatusId = 'existant' | 'en cours' | 'propose'

export type BuiltInPointIconId =
  | 'dot'
  | 'pin'
  | 'metro'
  | 'tram'
  | 'bus'
  | 'train'
  | 'bike'
  | 'park'
  | 'star'

export type PointIconId = BuiltInPointIconId | `custom:${string}`

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

export interface LayerPermission {
  isPublicVisible: boolean
  allowAuthenticatedWrite: boolean
  allowedEditorIds: string[]
}

export interface BaseFeature {
  id: string
  name: string
  status: StatusId
  color: string
  style?: FeatureStyle
  updatedAt?: string
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

export interface StyleLibraryEntry {
  id: string
  label: string
  style: FeatureStyle
  color: string
}

export interface StyleRule {
  id: string
  styleId: string
  statuses: StatusId[]
  categories: string[]
}

export interface LayerStyleBinding {
  baseStyleId: string | null
  rules: StyleRule[]
}

export interface LayerConfig {
  id: string
  label: string
  category: string
  sectionSortOrder?: number
  sortOrder?: number
  updatedAt?: string
  permissions?: LayerPermission
  features: GeometryFeature[]
}
