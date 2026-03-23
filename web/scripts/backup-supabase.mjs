#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const ROOT_DIR = path.resolve(process.cwd())
dotenv.config({ path: path.resolve(ROOT_DIR, '.env.local') })
dotenv.config({ path: path.resolve(ROOT_DIR, '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const OUTPUT_DIR = path.resolve(ROOT_DIR, process.env.BACKUP_OUTPUT_DIR || 'backups')
const PAGE_SIZE = Number(process.env.SUPABASE_BACKUP_PAGE_SIZE || '1000')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
  )
  process.exit(1)
}

function nowTimestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function isMissingRelationError(message) {
  const normalized = String(message || '').toLowerCase()
  return normalized.includes('relation') && normalized.includes('does not exist')
}

async function fetchAllRows(supabase, table, orderColumn, { required = true } = {}) {
  let offset = 0
  const rows = []

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      if (!required && isMissingRelationError(error.message)) {
        return {
          ok: true,
          rows: [],
          warning: `Table '${table}' absente, backup partiel.`,
        }
      }
      return { ok: false, error: `${table}: ${error.message}` }
    }

    const batch = data || []
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) {
      break
    }
    offset += PAGE_SIZE
  }

  return { ok: true, rows, warning: null }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const featuresResult = await fetchAllRows(supabase, 'map_features', 'id', {
    required: true,
  })
  if (!featuresResult.ok) {
    throw new Error(featuresResult.error)
  }

  const versionsResult = await fetchAllRows(
    supabase,
    'map_feature_versions',
    'version_id',
    { required: false },
  )
  if (!versionsResult.ok) {
    throw new Error(versionsResult.error)
  }

  const generatedAt = new Date().toISOString()
  const payload = {
    generated_at: generatedAt,
    supabase_url: SUPABASE_URL,
    counts: {
      map_features: featuresResult.rows.length,
      map_feature_versions: versionsResult.rows.length,
    },
    warnings: [featuresResult.warning, versionsResult.warning].filter(Boolean),
    tables: {
      map_features: featuresResult.rows,
      map_feature_versions: versionsResult.rows,
    },
  }

  const timestamp = nowTimestamp()
  const datedFile = path.join(OUTPUT_DIR, `marseille2033-backup-${timestamp}.json`)
  const latestFile = path.join(OUTPUT_DIR, 'latest.json')

  await fs.writeFile(datedFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.writeFile(latestFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`Backup done: ${datedFile}`)
  console.log(`Rows map_features=${featuresResult.rows.length}`)
  console.log(`Rows map_feature_versions=${versionsResult.rows.length}`)
  if (payload.warnings.length > 0) {
    console.log(`Warnings: ${payload.warnings.join(' | ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
