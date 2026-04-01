import type { ReactNode } from 'react'
import './MarseilleMapContainer.css'

export type MarseilleSidebarTabId = 'calques' | 'carte' | 'journal' | 'outils'

interface MarseilleMapContainerProps {
  isPresentationMode: boolean
  children: ReactNode
}

interface MarseilleMapSidebarProps {
  isPresentationMode: boolean
  sidebarTab: MarseilleSidebarTabId
  onTabChange: (tab: MarseilleSidebarTabId) => void
  onToggleAdminPanel: () => void
  isOnline: boolean
  pendingSyncCount: number
  isFlushingPendingSync: boolean
  onFlushPendingSync: () => void
  children: ReactNode
}

interface MarseilleMapStageProps {
  isDrawingOnMap: boolean
  isZoneSelecting: boolean
  isMeasuring: boolean
  children: ReactNode
}

const SIDEBAR_TABS: Array<{ id: MarseilleSidebarTabId; label: string }> = [
  { id: 'calques', label: 'Calques' },
  { id: 'carte', label: 'Carte' },
  { id: 'journal', label: 'Journal' },
  { id: 'outils', label: 'Outils' },
]

export function MarseilleMapContainer({
  isPresentationMode,
  children,
}: MarseilleMapContainerProps) {
  return (
    <div
      className={`marseille-map-shell${isPresentationMode ? ' is-presentation' : ''}`}
    >
      {children}
    </div>
  )
}

export function MarseilleMapSidebar({
  isPresentationMode,
  sidebarTab,
  onTabChange,
  onToggleAdminPanel,
  isOnline,
  pendingSyncCount,
  isFlushingPendingSync,
  onFlushPendingSync,
  children,
}: MarseilleMapSidebarProps) {
  if (isPresentationMode) {
    return null
  }

  return (
    <aside className="marseille-sidebar">
      <div className="marseille-sidebar-inner">
        <header className="marseille-sidebar-header">
          <div className="marseille-sidebar-kicker-row">
            <span className="marseille-sidebar-kicker">Marseille 2033</span>
            <span className="marseille-sidebar-chip">Terre de Sienne</span>
          </div>
          <div className="marseille-sidebar-title-row">
            <div>
              <h1>Carnet cartographique</h1>
              <p>
                Carnet de terrain d&apos;architecte moderne, orienté pilotage territorial.
              </p>
            </div>
            <button
              type="button"
              className="marseille-admin-button"
              onClick={onToggleAdminPanel}
            >
              Admin
            </button>
          </div>
        </header>

        <nav className="marseille-sidebar-tabs" aria-label="Navigation principale">
          {SIDEBAR_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`marseille-sidebar-tab${sidebarTab === tab.id ? ' is-active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className={`marseille-sync-banner${isOnline ? '' : ' is-offline'}`}>
          <div>
            <strong>{isOnline ? 'Mode connecté' : 'Mode hors-ligne'}</strong>
            <p>
              {pendingSyncCount > 0
                ? `${pendingSyncCount} opération(s) en attente`
                : 'Aucune synchronisation en attente'}
            </p>
          </div>
          {pendingSyncCount > 0 ? (
            <button
              type="button"
              className="marseille-sync-button"
              onClick={onFlushPendingSync}
              disabled={!isOnline || isFlushingPendingSync}
            >
              {isFlushingPendingSync ? 'Envoi...' : 'Synchroniser'}
            </button>
          ) : null}
        </div>

        <div className="marseille-sidebar-content">{children}</div>
      </div>
    </aside>
  )
}

export function MarseilleMapStage({
  isDrawingOnMap,
  isZoneSelecting,
  isMeasuring,
  children,
}: MarseilleMapStageProps) {
  return (
    <main
      className={`marseille-map-stage map-pane${isDrawingOnMap ? ' is-drawing' : ''}${isZoneSelecting ? ' is-zone-selecting' : ''}${isMeasuring ? ' is-measuring' : ''}`}
    >
      {children}
    </main>
  )
}
