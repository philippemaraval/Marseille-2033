#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const ROOT_DIR = path.resolve(process.cwd())
const INPUT_JSON_FILE = path.resolve(ROOT_DIR, 'data/osm-layers.json')
dotenv.config({ path: path.resolve(ROOT_DIR, '.env.local') })
dotenv.config({ path: path.resolve(ROOT_DIR, '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE = Number(process.env.SUPABASE_BATCH_SIZE || '200')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
  )
  process.exit(1)
}

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function flattenLayers(payload) {
  const rows = []
  const layerOrderByCategory = new Map()

  for (const layer of payload.layers || []) {
    const category = String(layer.category)
    const layerId = String(layer.id)

    if (!layerOrderByCategory.has(category)) {
      layerOrderByCategory.set(category, new Map())
    }
    const categoryMap = layerOrderByCategory.get(category)
    if (!categoryMap.has(layerId)) {
      categoryMap.set(layerId, categoryMap.size)
    }
    const layerSortOrder = categoryMap.get(layerId)

    const features = Array.isArray(layer.features) ? layer.features : []
    for (let index = 0; index < features.length; index += 1) {
      const feature = features[index]
      const geometryType = feature.geometry
      const coordinates =
        geometryType === 'point' ? feature.position : feature.positions

      rows.push({
        id: String(feature.id),
        name: String(feature.name || feature.id),
        status: String(feature.status || 'existant'),
        category,
        layer_id: layerId,
        layer_label: String(layer.label),
        layer_sort_order: layerSortOrder,
        color: String(feature.color || '#1d4ed8'),
        geometry_type: geometryType,
        coordinates,
        sort_order: index,
        source: 'osm_import',
      })
    }
  }

  return rows
}

async function main() {
  const raw = await fs.readFile(INPUT_JSON_FILE, 'utf8')
  const payload = JSON.parse(raw)
  const rows = flattenLayers(payload)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(`Supabase sync start | rows=${rows.length} | batch=${BATCH_SIZE}`)
  const { error: deleteError } = await supabase
    .from('map_features')
    .delete()
    .eq('source', 'osm_import')

  if (deleteError) {
    throw new Error(`Delete existing osm_import failed: ${deleteError.message}`)
  }

  let inserted = 0
  const chunks = chunkArray(rows, BATCH_SIZE)
  for (const chunk of chunks) {
    const { error } = await supabase.from('map_features').upsert(chunk, {
      onConflict: 'id',
    })
    if (error) {
      throw new Error(`Upsert failed: ${error.message}`)
    }
    inserted += chunk.length
    console.log(`  -> upserted ${inserted}/${rows.length}`)
  }

  console.log('Supabase sync done.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
