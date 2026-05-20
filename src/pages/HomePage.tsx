import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, ScanBarcode, ChevronRight, ChevronDown, Box, Home, Layers } from 'lucide-react'
import { Archive, Refrigerator, Snowflake, Package2, BookOpen } from 'lucide-react'
import { Button, toast } from '@blinkdotnew/ui'
import { ScanInput } from '../components/ScanInput'
import { LocationFormModal } from '../components/LocationFormModal'
import { getLocations, getLocationByBarcode, getLocationByShortId, createLocation, getInventoryCounts } from '../lib/api'
import type { Location, LocationType } from '../types'

// Map of location type → icon component
const TYPE_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  room:     Home,
  shelf:    Layers,
  bin:      Archive,
  fridge:   Refrigerator,
  freezer:  Snowflake,
  cupboard: BookOpen,
  pantry:   Package2,
  other:    Box,
}

function getIcon(type: string) {
  return TYPE_ICONS[type] ?? Box
}

// ── Tree node ─────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  location: Location
  allLocations: Location[]
  counts: Record<string, number>
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onNavigate: (id: string) => void
}

function LocationTreeNode({ location, allLocations, counts, depth, expanded, onToggle, onNavigate }: TreeNodeProps) {
  const children = allLocations.filter(l => (l.parentId ?? null) === location.id)
  const hasChildren = children.length > 0
  const isExpanded = expanded.has(location.id)
  const Icon = getIcon(location.type)
  const count = counts[location.id]

  return (
    <div>
      <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 1.25}rem` }}>

        {/* Expand/collapse toggle — only rendered when children exist */}
        {hasChildren ? (
          <button
            onClick={() => onToggle(location.id)}
            className="w-6 h-6 flex items-center justify-center shrink-0 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}

        {/* Row — navigates to the location page on click */}
        <button
          onClick={() => onNavigate(location.id)}
          className="flex items-center gap-2.5 flex-1 min-w-0 py-2 px-2 rounded-lg text-left hover:bg-muted/50 active:bg-muted transition-colors"
        >
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${location.color}22`, color: location.color }}
          >
            <Icon size={14} />
          </div>
          <span className="flex-1 text-sm font-medium text-foreground truncate">{location.name}</span>
          <span className="text-xs text-muted-foreground shrink-0 mr-1">
            {count !== undefined ? `${count} item${count !== 1 ? 's' : ''}` : ''}
          </span>
          <ChevronRight size={13} className="text-muted-foreground shrink-0" />
        </button>
      </div>

      {/* Recursively render children when expanded */}
      {isExpanded && hasChildren && (
        <div>
          {children.map(child => (
            <LocationTreeNode
              key={child.id}
              location={child}
              allLocations={allLocations}
              counts={counts}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function HomePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showNewModal, setShowNewModal] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const didAutoExpand = useRef(false)

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations,
  })

  const { data: counts = {} } = useQuery({
    queryKey: ['inventory-counts'],
    queryFn: getInventoryCounts,
  })

  const topLevel = locations.filter(l => !l.parentId)

  // Expand all top-level locations on first data load so the tree is useful immediately
  useEffect(() => {
    if (!didAutoExpand.current && topLevel.length > 0) {
      didAutoExpand.current = true
      setExpanded(new Set(topLevel.map(l => l.id)))
    }
  }, [topLevel])

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createLocation>[0]) => createLocation(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      setShowNewModal(false)
      // If the new location has a parent, expand the parent so it's immediately visible
      if (created.parentId) {
        setExpanded(prev => new Set([...prev, created.parentId!]))
      }
      toast.success('Location created')
    },
    onError: () => toast.error('Failed to create location'),
  })

  const handleScan = async (value: string) => {
    // QR short link: /l/:shortId
    const shortMatch = value.match(/\/l\/([^/?#]+)/)
    if (shortMatch) {
      const loc = await getLocationByShortId(shortMatch[1])
      if (loc) navigate({ to: '/locations/$id', params: { id: loc.id } as never })
      return
    }

    // Full URL: /locations/:id
    const fullMatch = value.match(/\/locations\/([^/?#]+)/)
    if (fullMatch) {
      navigate({ to: '/locations/$id', params: { id: fullMatch[1] } as never })
      return
    }

    // Plain barcode assigned to a location
    const loc = await getLocationByBarcode(value)
    if (loc) {
      navigate({ to: '/locations/$id', params: { id: loc.id } as never })
    } else {
      toast('No location found', { description: 'Scan a location QR code to open it.' })
    }
  }

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Locations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Click a location to open it and manage its inventory</p>
        </div>
        <Button onClick={() => setShowNewModal(true)} size="sm">
          <Plus size={16} className="mr-1.5" /> New Location
        </Button>
      </div>

      {/* Scan box — opens the matching location from a QR code or barcode */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ScanBarcode size={16} className="text-primary" />
          <span className="text-sm font-medium text-foreground">Scan a Location</span>
        </div>
        <ScanInput onScan={handleScan} placeholder="Scan location barcode to open…" autoFocus closeOnScan />
        <p className="text-xs text-muted-foreground mt-2">Barcode scanners send Enter automatically. Or type and press Enter.</p>
      </div>

      {/* Location tree */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <ScanBarcode size={22} className="text-primary" />
          </div>
          <h3 className="font-medium text-foreground text-sm">No locations yet</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Create a location for each bin, shelf, or storage area. Print a barcode label and scan to open.
          </p>
          <Button onClick={() => setShowNewModal(true)} size="sm" className="mt-4">
            <Plus size={14} className="mr-1.5" /> Create your first location
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
          {topLevel.map(loc => (
            <LocationTreeNode
              key={loc.id}
              location={loc}
              allLocations={locations}
              counts={counts}
              depth={0}
              expanded={expanded}
              onToggle={toggleExpanded}
              onNavigate={(id) => navigate({ to: '/locations/$id', params: { id } as never })}
            />
          ))}
        </div>
      )}

      <LocationFormModal
        open={showNewModal}
        locations={locations}
        onSave={(data) =>
          createMutation.mutate({
            name:        data.name,
            type:        data.type as LocationType,
            barcode:     data.barcode || null,
            description: data.description || null,
            color:       data.color,
            parentId:    data.parentId,
          })
        }
        onClose={() => setShowNewModal(false)}
      />
    </div>
  )
}
