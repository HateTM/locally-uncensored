import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Check, Search } from 'lucide-react'
import { usePopoverPlatz } from '../../../hooks/usePopoverPlatz'
import { cn } from './cn'

export interface SelectOption {
  value: string
  label: string
  sublabel?: string
  /** Tooltip der Zeile und des geschlossenen Feldes, etwa der Dateiname hinter
   *  einem Anzeigenamen. Die Suche findet den Eintrag auch darueber. */
  title?: string
  /** Ueberschrift ueber diesem und den folgenden Eintraegen derselben Gruppe. */
  group?: string
  badge?: { label: string; color: string }
  /** Kleine Marken hinter dem Namen, nur in der aufgeklappten Liste (etwa Stufe und Herkunft). */
  tags?: { label: string; color: string }[]
}

interface Props {
  options: SelectOption[]
  value: string
  onChange: (v: string) => void
  searchable?: boolean
  placeholder?: string
  size?: 'sm' | 'md'
  align?: 'left' | 'right'
  className?: string
  /** Hoeher wird die Liste nie, auch im grossen Fenster nicht. */
  maxHeight?: number
  /** Beschriftung fuer Bedienhilfen, wo kein sichtbarer Text danebensteht. */
  ariaLabel?: string
}

export function Select({
  options,
  value,
  onChange,
  searchable = false,
  placeholder = 'Select...',
  size = 'md',
  align = 'left',
  className,
  maxHeight = 280,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // GitHub #149: the menu used to do its own sums against the window height
  // and kept a minimum height, so in a short or zoomed window it ended up
  // under the window edge. Placement is the app-wide rule now: the side with
  // room, capped to that room, the list scrolls.
  const menu = usePopoverPlatz(menuRef, open, {
    anker: triggerRef,
    rolle: listRef,
    fest: align === 'right' ? 'rechts' : 'links',
  })

  const current = options.find((option) => option.value === value)

  const filtered = useMemo(() => {
    if (!query.trim()) return options

    const normalizedQuery = query.toLowerCase()

    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(normalizedQuery) ||
        option.sublabel?.toLowerCase().includes(normalizedQuery) ||
        option.title?.toLowerCase().includes(normalizedQuery),
    )
  }, [options, query])

  const closeMenu = () => {
    setOpen(false)
    setQuery('')
  }

  const toggle = () => {
    if (open) {
      closeMenu()
    } else {
      setOpen(true)
    }
  }

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node

      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu()
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const controlHeight =
    size === 'sm'
      ? 'h-[var(--control-h-sm)]'
      : 'h-[var(--control-h-md)]'

  return (
    <>
      <div
        ref={triggerRef}
        className={cn('relative', className)}
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            't-control inline-flex w-full items-center justify-between gap-2 px-2.5',
            'rounded-[var(--radius-control)] transition-colors',
            'bg-white/[0.04] border border-white/[0.08]',
            'hover:border-white/15 text-gray-200',
            controlHeight,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {current?.badge && (
              <Badge
                color={current.badge.color}
                label={current.badge.label}
              />
            )}

            <span className="truncate" title={current?.title}>
              {current?.label ?? placeholder}
            </span>
          </span>

          <ChevronDown
            size={13}
            className={cn(
              'shrink-0 text-gray-500 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={menuRef}
                initial={{
                  opacity: 0,
                  y: menu.nachOben ? 4 : -4,
                  scale: 0.98,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                }}
                exit={{
                  opacity: 0,
                  y: menu.nachOben ? 4 : -4,
                  scale: 0.98,
                }}
                transition={{ duration: 0.12 }}
                style={menu.style}
                className={cn(
                  'lu-elevated fixed z-[100] min-w-0',
                  'rounded-[var(--radius-panel)]',
                  'flex flex-col p-1 overflow-hidden',
                )}
              >
                {searchable && (
                  <div className="mb-1 flex shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-2 py-1.5">
                    <Search
                      size={13}
                      className="text-gray-500"
                    />

                    <input
                      autoFocus
                      value={query}
                      onChange={(event) =>
                        setQuery(event.target.value)
                      }
                      placeholder="Search..."
                      className="t-control w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                    />
                  </div>
                )}

                <div
                  ref={listRef}
                  role="listbox"
                  className="min-h-0 overflow-y-auto overscroll-contain scrollbar-thin"
                  style={{ maxHeight }}
                  onWheel={(event) => event.stopPropagation()}
                >
                  {filtered.length === 0 && (
                    <div className="t-control px-2.5 py-2 text-gray-600">
                      No matches
                    </div>
                  )}

                  {filtered.map((option, i) => {
                    const selected =
                      option.value === value
                    const head =
                      option.group &&
                      option.group !== filtered[i - 1]?.group
                        ? option.group
                        : null

                    return (
                      <div key={option.value}>
                      {head && (
                        <div className="t-control px-2.5 pt-2 pb-1 text-gray-600">
                          {head}
                        </div>
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        title={option.title}
                        onClick={() => {
                          onChange(option.value)
                          closeMenu()
                        }}
                        className={cn(
                          't-control flex w-full items-center justify-between gap-2',
                          'rounded-[6px] px-2.5 py-1.5 text-left transition-colors',
                          selected
                            ? 'bg-white/10 text-white'
                            : 'text-gray-300 hover:bg-white/[0.06]',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          {option.badge && (
                            <Badge
                              color={option.badge.color}
                              label={option.badge.label}
                            />
                          )}

                          <span className="truncate">
                            {option.label}
                          </span>

                          {option.tags?.map((t) => (
                            <Badge key={t.label} color={t.color} label={t.label} />
                          ))}

                          {option.sublabel && (
                            <span className="t-mono truncate text-gray-600">
                              {option.sublabel}
                            </span>
                          )}
                        </span>

                        {selected && (
                          <Check
                            size={13}
                            className="shrink-0 text-gray-300"
                          />
                        )}
                      </button>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}

function Badge({
  color,
  label,
}: {
  color: string
  label: string
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5',
        'text-[0.55rem] font-semibold',
        color,
      )}
    >
      {label}
    </span>
  )
}