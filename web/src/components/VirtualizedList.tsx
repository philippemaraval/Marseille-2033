import { useMemo, useState, type UIEvent } from 'react'
import type { ReactNode } from 'react'

interface VirtualizedListProps<T> {
  items: T[]
  height: number
  itemHeight: number
  overscan?: number
  className?: string
  getItemKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
}

export function VirtualizedList<T>({
  items,
  height,
  itemHeight,
  overscan = 6,
  className,
  getItemKey,
  renderItem,
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0)

  const { startIndex, offsetTop, totalHeight, visibleItems } = useMemo(() => {
    const safeHeight = Math.max(height, itemHeight)
    const maxVisibleCount = Math.ceil(safeHeight / itemHeight)
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const end = Math.min(
      items.length,
      start + maxVisibleCount + overscan * 2,
    )

    return {
      startIndex: start,
      offsetTop: start * itemHeight,
      totalHeight: items.length * itemHeight,
      visibleItems: items.slice(start, end),
    }
  }, [height, itemHeight, items, overscan, scrollTop])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }

  return (
    <div
      className={className}
      style={{ height: `${height}px`, overflowY: 'auto' }}
      onScroll={handleScroll}
    >
      <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${offsetTop}px)`,
          }}
        >
          {visibleItems.map((item, index) => {
            const absoluteIndex = startIndex + index
            return (
              <div
                key={getItemKey(item, absoluteIndex)}
                style={{ height: `${itemHeight}px`, overflow: 'hidden' }}
              >
                {renderItem(item, absoluteIndex)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
