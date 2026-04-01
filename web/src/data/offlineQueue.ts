import type { FeatureStyle, StatusId } from '../types/map'
import { hasSupabase, supabase } from '../lib/supabase'

const OFFLINE_QUEUE_STORAGE_KEY = 'marseille2033.pending-sync.v1'

type GeometryType = 'point' | 'line' | 'polygon'

interface FeatureMutationPayload {
  id: string
  name: string
  status: StatusId
  category: string
  layer_id: string
  layer_label: string
  layer_sort_order: number
  color: string
  style: FeatureStyle | null
  geometry_type: GeometryType
  coordinates: unknown
  sort_order: number
  source: string
}

export type PendingSyncMutation =
  | {
      id: string
      createdAt: number
      type: 'insert_feature'
      payload: FeatureMutationPayload
    }
  | {
      id: string
      createdAt: number
      type: 'update_feature'
      featureId: string
      expectedUpdatedAt?: string
      payload: FeatureMutationPayload
    }
  | {
      id: string
      createdAt: number
      type: 'trash_feature'
      featureId: string
      expectedUpdatedAt?: string
      deletedBy?: string | null
    }

export type PendingSyncResult =
  | { ok: true }
  | { ok: false; error: string; conflict?: boolean }

function isStatus(value: unknown): value is StatusId {
  return value === 'existant' || value === 'en cours' || value === 'propose'
}

function isGeometryType(value: unknown): value is GeometryType {
  return value === 'point' || value === 'line' || value === 'polygon'
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFeatureMutationPayload(value: unknown): value is FeatureMutationPayload {
  if (!isObjectRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isStatus(value.status) &&
    typeof value.category === 'string' &&
    typeof value.layer_id === 'string' &&
    typeof value.layer_label === 'string' &&
    typeof value.layer_sort_order === 'number' &&
    typeof value.color === 'string' &&
    (value.style === null || isObjectRecord(value.style)) &&
    isGeometryType(value.geometry_type) &&
    typeof value.sort_order === 'number' &&
    typeof value.source === 'string'
  )
}

function isPendingSyncMutation(value: unknown): value is PendingSyncMutation {
  if (!isObjectRecord(value) || typeof value.id !== 'string' || typeof value.createdAt !== 'number') {
    return false
  }

  if (value.type === 'insert_feature') {
    return isFeatureMutationPayload(value.payload)
  }
  if (value.type === 'update_feature') {
    return (
      typeof value.featureId === 'string' &&
      (value.expectedUpdatedAt === undefined ||
        typeof value.expectedUpdatedAt === 'string') &&
      isFeatureMutationPayload(value.payload)
    )
  }
  if (value.type === 'trash_feature') {
    return (
      typeof value.featureId === 'string' &&
      (value.expectedUpdatedAt === undefined ||
        typeof value.expectedUpdatedAt === 'string') &&
      (value.deletedBy === undefined ||
        value.deletedBy === null ||
        typeof value.deletedBy === 'string')
    )
  }

  return false
}

function normalizeQueueError(message: string): string {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('network') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch')
  ) {
    return 'Connexion indisponible.'
  }
  return message
}

function readQueue(): PendingSyncMutation[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((entry): entry is PendingSyncMutation => isPendingSyncMutation(entry))
  } catch {
    return []
  }
}

function writeQueue(entries: PendingSyncMutation[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(entries))
}

export function loadPendingSyncMutations(): PendingSyncMutation[] {
  return readQueue()
}

export function savePendingSyncMutations(entries: PendingSyncMutation[]) {
  writeQueue(entries)
}

export function enqueuePendingSyncMutation(
  mutation: PendingSyncMutation,
): PendingSyncMutation[] {
  const nextEntries = [...readQueue(), mutation]
  writeQueue(nextEntries)
  return nextEntries
}

async function fetchCurrentFeatureToken(featureId: string): Promise<PendingSyncResult | string> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  const { data, error } = await supabase
    .from('map_features')
    .select('updated_at')
    .eq('id', featureId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    return { ok: false, error: normalizeQueueError(error.message) }
  }

  const updatedAt = data?.updated_at
  if (typeof updatedAt !== 'string' || updatedAt.length === 0) {
    return { ok: false, error: 'Élément introuvable côté Supabase.', conflict: true }
  }

  return updatedAt
}

export async function executePendingSyncMutation(
  mutation: PendingSyncMutation,
): Promise<PendingSyncResult> {
  if (!hasSupabase || !supabase) {
    return { ok: false, error: 'Supabase non configure.' }
  }

  try {
    if (mutation.type === 'insert_feature') {
      const { error } = await supabase.from('map_features').insert(mutation.payload)
      if (error) {
        return { ok: false, error: normalizeQueueError(error.message) }
      }
      return { ok: true }
    }

    const currentToken = await fetchCurrentFeatureToken(mutation.featureId)
    if (typeof currentToken !== 'string') {
      return currentToken
    }

    if (
      mutation.expectedUpdatedAt &&
      mutation.expectedUpdatedAt.length > 0 &&
      mutation.expectedUpdatedAt !== currentToken
    ) {
      return {
        ok: false,
        error: 'Conflit détecté: la version distante a changé.',
        conflict: true,
      }
    }

    if (mutation.type === 'update_feature') {
      const { error } = await supabase
        .from('map_features')
        .update(mutation.payload)
        .eq('id', mutation.featureId)
      if (error) {
        return { ok: false, error: normalizeQueueError(error.message) }
      }
      return { ok: true }
    }

    const { error } = await supabase
      .from('map_features')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: mutation.deletedBy ?? null,
      })
      .eq('id', mutation.featureId)

    if (error) {
      return { ok: false, error: normalizeQueueError(error.message) }
    }

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? normalizeQueueError(error.message) : 'Erreur de synchronisation.',
    }
  }
}
