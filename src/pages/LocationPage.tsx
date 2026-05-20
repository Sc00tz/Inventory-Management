import { useState, Fragment, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Plus, Minus, Trash2, Edit2, ScanBarcode, Package, QrCode, Copy, Check, ChevronRight, Box, Home, Layers } from 'lucide-react'
import { Archive, Refrigerator, Snowflake, Package2, BookOpen } from 'lucide-react'
import { Button, toast } from '@blinkdotnew/ui'
import { ScanInput } from '../components/ScanInput'
import { AddProductModal } from '../components/AddProductModal'
import { AddItemModal } from '../components/AddItemModal'
import { LocationFormModal } from '../components/LocationFormModal'
import {
  getLocation,
  getLocations,
  getProducts,
  getInventoryForLocation,
  getProductByBarcode,
  createProduct,
  upsertInventoryItem,
  setInventoryQuantity,
  removeInventoryItem,
  updateLocation,
  deleteLocation,
} from '../lib/api'
import type { Location, LocationType, InventoryWithProduct } from '../types'

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

// Walks up the location tree to build the breadcrumb chain for a given id
function buildAncestors(id: string, all: Location[]): Location[] {
  const map = new Map(all.map(l => [l.id, l]))
  const chain: Location[] = []
  let current = map.get(id)
  while (current?.parentId) {
    const parent = map.get(current.parentId)
    if (!parent) break
    chain.unshift(parent)
    current = parent
  }
  return chain
}

interface PendingScan { barcode: string }

// ── Page ──────────────────────────────────────────────────────────────────────

export function LocationPage() {
  const { id } = useParams({ from: '/locations/$id' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null)
  const [showAddItem, setShowAddItem] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Short URL for this location — used in the QR code and copy button
  const locationUrl = typeof window !== 'undefined' ? `${window.location.origin}/l/${id.slice(0, 8)}` : ''

  // Clear the copy-feedback timer on unmount to avoid a setState on an unmounted component
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(locationUrl)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy URL')
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: location, isLoading: locLoading } = useQuery({
    queryKey: ['location', id],
    queryFn: () => getLocation(id),
  })

  const { data: allLocations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations,
  })

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products'],
    queryFn: getProducts,
  })

  const { data: inventory = [], isLoading: invLoading } = useQuery({
    queryKey: ['inventory', id],
    queryFn: () => getInventoryForLocation(id),
  })

  const ancestors = buildAncestors(id, allLocations)
  const children = allLocations.filter(l => (l.parentId ?? null) === id)

  // Invalidates both the per-location inventory and the home-page counts badge
  const invalidateInventory = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', id] })
    queryClient.invalidateQueries({ queryKey: ['inventory-counts'] })
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  const adjustMutation = useMutation({
    mutationFn: ({ productId, delta }: { productId: string; delta: number }) =>
      upsertInventoryItem(id, productId, delta),
    onSuccess: invalidateInventory,
    onError: () => toast.error('Failed to update quantity'),
  })

  const setQtyMutation = useMutation({
    mutationFn: ({ entryId, qty }: { entryId: string; qty: number }) =>
      setInventoryQuantity(entryId, qty),
    onSuccess: invalidateInventory,
    onError: () => toast.error('Failed to update quantity'),
  })

  const removeMutation = useMutation({
    mutationFn: (entryId: string) => removeInventoryItem(entryId),
    onSuccess: () => { invalidateInventory(); toast.success('Item removed') },
    onError: () => toast.error('Failed to remove item'),
  })

  const updateLocMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateLocation>[1]) => updateLocation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location', id] })
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      setShowEditModal(false)
      toast.success('Location updated')
    },
  })

  const deleteLocMutation = useMutation({
    mutationFn: () => deleteLocation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      // Navigate to parent if one exists, otherwise go home
      const parentId = location?.parentId
      if (parentId) navigate({ to: '/locations/$id', params: { id: parentId } as never })
      else navigate({ to: '/' })
      toast.success('Location deleted')
    },
  })

  // ── Scan handler ─────────────────────────────────────────────────────────────

  // Keyed on location.id so the function identity is stable while viewing
  // the same location, but refreshes when navigating to a different one.
  const handleScan = useCallback(async (barcode: string) => {
    if (!location) return
    try {
      const existing = await getProductByBarcode(barcode)
      if (existing) {
        await adjustMutation.mutateAsync({ productId: existing.id, delta: 1 })
        toast.success(`+1 ${existing.name}`)
      } else {
        // Unknown barcode — prompt the user to name the new product
        setPendingScan({ barcode })
      }
    } catch {
      toast.error('Failed to process scan')
    }
  // adjustMutation.mutateAsync is stable for the lifetime of the mutation instance
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.id])

  const handleNewProduct = async (name: string, brand: string, barcode: string) => {
    try {
      const product = await createProduct({ barcode, name, brand: brand || null, imageUrl: null })
      await adjustMutation.mutateAsync({ productId: product.id, delta: 1 })
      toast.success(`+1 ${product.name}`)
      setPendingScan(null)
      queryClient.invalidateQueries({ queryKey: ['inventory', id] })
    } catch {
      toast.error('Failed to add product')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (locLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-4" />
        <div className="h-32 bg-muted rounded-xl animate-pulse" />
      </div>
    )
  }

  if (!location) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-muted-foreground">Location not found.</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft size={14} className="mr-1" /> Back
        </Button>
      </div>
    )
  }

  const Icon = getIcon(location.type)
  const parentId = location.parentId

  return (
    <div className="flex flex-col gap-5 p-6 max-w-3xl mx-auto">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
        <button onClick={() => navigate({ to: '/' })} className="hover:text-foreground transition-colors">
          Home
        </button>
        {ancestors.map(a => (
          <Fragment key={a.id}>
            <ChevronRight size={12} className="shrink-0" />
            <button
              onClick={() => navigate({ to: '/locations/$id', params: { id: a.id } as never })}
              className="hover:text-foreground transition-colors truncate max-w-[120px]"
            >
              {a.name}
            </button>
          </Fragment>
        ))}
        <ChevronRight size={12} className="shrink-0" />
        <span className="text-foreground font-medium truncate max-w-[140px]">{location.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 mt-0.5"
          onClick={() => {
            if (parentId) navigate({ to: '/locations/$id', params: { id: parentId } as never })
            else navigate({ to: '/' })
          }}
        >
          <ArrowLeft size={18} />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${location.color}22`, color: location.color }}
            >
              <Icon size={16} />
            </div>
            <h1 className="text-xl font-semibold text-foreground truncate">{location.name}</h1>
          </div>
          {location.description && (
            <p className="text-sm text-muted-foreground mt-0.5 ml-10">{location.description}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setShowQr(v => !v)}>
            <QrCode size={15} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowEditModal(true)}>
            <Edit2 size={15} />
          </Button>
        </div>
      </div>

      {/* QR code / URL panel */}
      {showQr && (
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1 font-mono truncate">{locationUrl}</p>
            <button
              onClick={handleCopy}
              className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="flex justify-center p-3 bg-white rounded-lg">
            <img src={`/api/qr?url=${encodeURIComponent(locationUrl)}`} alt="QR code" width={160} height={160} />
          </div>
          <p className="text-xs text-muted-foreground text-center">Scan to open this location directly</p>
        </div>
      )}

      {/* Child locations grid */}
      {children.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Inside</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {children.map(child => {
              const ChildIcon = getIcon(child.type)
              return (
                <button
                  key={child.id}
                  onClick={() => navigate({ to: '/locations/$id', params: { id: child.id } as never })}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:border-primary/60 hover:bg-muted/30 transition-all group"
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${child.color}22`, color: child.color }}
                  >
                    <ChildIcon size={13} />
                  </div>
                  <span className="text-sm font-medium text-foreground truncate flex-1">{child.name}</span>
                  <ChevronRight size={13} className="text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground transition-colors" />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Scan box — adds +1 of a known product, or prompts to create a new one */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ScanBarcode size={15} className="text-primary" />
          <span className="text-sm font-medium text-foreground">Scan a Product</span>
          <span className="text-xs text-muted-foreground">{inventory.length} item{inventory.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setShowAddItem(true)}
            className="ml-auto flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
          >
            <Plus size={13} /> Add manually
          </button>
        </div>
        <ScanInput onScan={handleScan} placeholder="Scan product barcode to add…" autoFocus closeOnScan />
        <p className="text-xs text-muted-foreground mt-2">
          Scan adds 1. Unknown barcodes prompt for a product name. First-time items are remembered.
        </p>
      </div>

      {/* Inventory list */}
      {invLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : inventory.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
          <Package size={28} className="text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">This location is empty</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Scan a barcode above, or use <strong className="text-muted-foreground">Add manually</strong> to pick from your product list
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] text-xs text-muted-foreground px-4 py-2 bg-muted/40 border-b border-border">
            <span>Product</span>
            <span className="text-right">Qty</span>
          </div>
          <div className="divide-y divide-border">
            {inventory.map((item) => (
              <InventoryRow
                key={item.id}
                item={item}
                onAdjust={(delta) => adjustMutation.mutate({ productId: item.productId, delta })}
                onSetQty={(qty) => setQtyMutation.mutate({ entryId: item.id, qty })}
                onRemove={() => removeMutation.mutate(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Danger zone */}
      <div className="border-t border-border pt-4 mt-2">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-muted-foreground/50 hover:text-destructive transition-colors"
          >
            Delete this location…
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-destructive">Delete "{location.name}" and all its inventory?</span>
            <Button variant="destructive" size="sm" onClick={() => deleteLocMutation.mutate()}>
              <Trash2 size={13} className="mr-1" /> Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div>
        )}
      </div>

      {/* Modals */}
      <AddItemModal
        open={showAddItem}
        products={allProducts}
        onAdd={(product, quantity) => {
          adjustMutation.mutate({ productId: product.id, delta: quantity })
          toast.success(`+${quantity} ${product.name}`)
        }}
        onClose={() => setShowAddItem(false)}
      />

      <AddProductModal
        open={pendingScan !== null}
        barcode={pendingScan?.barcode ?? ''}
        onConfirm={handleNewProduct}
        onCancel={() => setPendingScan(null)}
      />

      <LocationFormModal
        open={showEditModal}
        location={location}
        locations={allLocations}
        onSave={(data) =>
          updateLocMutation.mutate({
            name:        data.name,
            type:        data.type as LocationType,
            barcode:     data.barcode || null,
            description: data.description || null,
            color:       data.color,
            parentId:    data.parentId,
          })
        }
        onClose={() => setShowEditModal(false)}
      />
    </div>
  )
}

// ── Inventory row ─────────────────────────────────────────────────────────────

interface InventoryRowProps {
  item: InventoryWithProduct
  onAdjust: (delta: number) => void
  onSetQty: (qty: number) => void
  onRemove: () => void
}

function InventoryRow({ item, onAdjust, onSetQty, onRemove }: InventoryRowProps) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(String(item.quantity))

  const commitEdit = () => {
    const n = parseFloat(editVal)
    if (!isNaN(n) && n >= 0) onSetQty(n)
    setEditing(false)
  }

  // Display whole numbers without a decimal point, keep decimals for fractional quantities
  const displayQty = Number(item.quantity) % 1 === 0
    ? Math.floor(Number(item.quantity))
    : item.quantity

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group">
      {item.product.imageUrl && (
        <img
          src={item.product.imageUrl}
          alt={item.product.name}
          className="w-10 h-10 rounded-md object-cover shrink-0 bg-muted"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{item.product.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.product.brand && (
            <span className="text-xs text-muted-foreground">{item.product.brand}</span>
          )}
          <span className="text-xs font-mono text-muted-foreground/50">{item.product.barcode}</span>
        </div>
      </div>

      {/* Quantity controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onAdjust(-1)}
          className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/60 transition-colors"
        >
          <Minus size={13} />
        </button>

        {editing ? (
          <input
            autoFocus
            className="w-14 text-center text-sm font-mono bg-card border border-primary rounded px-1 py-0.5 focus:outline-none"
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
          />
        ) : (
          <button
            onClick={() => { setEditVal(String(item.quantity)); setEditing(true) }}
            className="w-10 text-center text-sm font-mono text-foreground hover:text-primary transition-colors"
          >
            {displayQty}
          </button>
        )}

        <button
          onClick={() => onAdjust(1)}
          className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/60 transition-colors"
        >
          <Plus size={13} />
        </button>

        <button
          onClick={onRemove}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/30 hover:text-destructive transition-colors ml-1 opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
