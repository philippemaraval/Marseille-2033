import type { LayerConfig } from '../types/map'
import { osmImportMeta, osmLayers } from './layers.generated'
import { seedLayers } from './layers.seed'

const hasImportedLayers = osmLayers.length > 0

export const layers: LayerConfig[] = hasImportedLayers ? osmLayers : seedLayers

export const layerMeta = {
  mode: hasImportedLayers ? 'osm-import' : 'seed',
  generatedAt: hasImportedLayers ? osmImportMeta.generatedAt : 'seed-data',
}
