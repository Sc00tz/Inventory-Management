import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Package, Trash2, Edit2, Plus, Search, Loader2, Camera } from 'lucide-react'
import { Button, toast } from '@blinkdotnew/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog'
import { ScanInput } from '../components/ScanInput'
import { CameraScanner } from '../components/CameraScanner'
import { getProducts, updateProduct, deleteProduct, createProduct, lookupBarcode } from '../lib/api'
import type { Product } from '../types'

export function ProductsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [searchCamera, setSearchCamera] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: getProducts,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setConfirmDeleteId(null)
      toast.success('Product deleted')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Product> }) => updateProduct(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setEditProduct(null)
      toast.success('Product updated')
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => createProduct(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setShowAdd(false)
      toast.success('Product added')
    },
  })

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.includes(search) ||
      (p.brand ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col gap-5 p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{products.length} known products</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={15} className="mr-1.5" /> Add Product
        </Button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, brand, or barcode…"
          className="w-full rounded-lg border border-border bg-card px-4 py-2.5 pl-9 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
        />
        <button
          onClick={() => setSearchCamera(true)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
          type="button"
          title="Scan barcode to search"
        >
          <Camera size={16} />
        </button>
      </div>
      {searchCamera && (
        <CameraScanner
          onScan={(val) => { setSearch(val); setSearchCamera(false) }}
          onClose={() => setSearchCamera(false)}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
          <Package size={28} className="text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">{search ? 'No matches' : 'No products yet'}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Products are added automatically when you scan an unknown barcode
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map((product) => (
              <div key={product.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 group transition-colors">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="w-10 h-10 rounded-md object-cover shrink-0 bg-muted" />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-muted shrink-0 flex items-center justify-center">
                    <Package size={16} className="text-muted-foreground/40" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{product.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {product.brand && <span className="text-xs text-muted-foreground">{product.brand}</span>}
                    <span className="text-xs font-mono text-muted-foreground/50">{product.barcode}</span>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => setEditProduct(product)}
                    className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Edit2 size={13} />
                  </button>
                  {confirmDeleteId === product.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteMutation.mutate(product.id)}
                        className="px-2 h-7 rounded text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 h-7 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(product.id)}
                      className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit modal */}
      <ProductEditModal
        open={editProduct !== null}
        product={editProduct}
        onSave={(data) => editProduct && updateMutation.mutate({ id: editProduct.id, data })}
        onClose={() => setEditProduct(null)}
      />

      {/* Add modal */}
      <ProductAddModal
        open={showAdd}
        onSave={(data) => createMutation.mutate(data)}
        onClose={() => setShowAdd(false)}
      />
    </div>
  )
}

// ── Product Edit Modal ────────────────────────────────────────────────────────

function ProductEditModal({
  open,
  product,
  onSave,
  onClose,
}: {
  open: boolean
  product: Product | null
  onSave: (data: Partial<Product>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(product?.name ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? '')

  useEffect(() => {
    if (product && open) {
      setName(product.name)
      setBrand(product.brand || '')
      setImageUrl(product.imageUrl || '')
    }
  }, [product, open])

  if (!product) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
        </DialogHeader>
        <div className="text-xs font-mono text-muted-foreground mb-3 bg-muted px-3 py-1.5 rounded">{product.barcode}</div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave({ name: name.trim(), brand: brand.trim() || null, imageUrl: imageUrl.trim() || null })
          }}
          className="flex flex-col gap-3"
        >
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Brand</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Image URL (optional)</label>
            {imageUrl && (
              <img src={imageUrl} alt="preview" className="w-16 h-16 object-cover rounded mb-1 bg-muted" />
            )}
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex gap-2 mt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Product Add Modal ─────────────────────────────────────────────────────────

function ProductAddModal({
  open,
  onSave,
  onClose,
}: {
  open: boolean
  onSave: (data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [barcode, setBarcode] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'looking' | 'found' | 'notfound'>('idle')

  useEffect(() => {
    if (!open) { setName(''); setBrand(''); setBarcode(''); setImageUrl(''); setLookupState('idle') }
  }, [open])

  const handleBarcode = async (val: string) => {
    setBarcode(val)
    setLookupState('looking')
    const result = await lookupBarcode(val)
    if (result) {
      setName(result.name || '')
      setBrand(result.brand || '')
      setImageUrl(result.imageUrl || '')
      setLookupState('found')
    } else {
      setLookupState('notfound')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Product</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave({ barcode: barcode.trim(), name: name.trim(), brand: brand.trim() || null, imageUrl: imageUrl || null })
          }}
          className="flex flex-col gap-3"
        >
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Barcode *</label>
            <ScanInput onScan={handleBarcode} placeholder="Scan or type barcode…" autoFocus closeOnScan />
            {barcode && <p className="text-xs font-mono text-muted-foreground mt-1">{barcode}</p>}
            {lookupState === 'looking' && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                <Loader2 size={12} className="animate-spin" /> Looking up barcode…
              </div>
            )}
            {lookupState === 'found' && (
              <p className="text-xs text-green-500 mt-1">Found — details pre-filled below</p>
            )}
            {lookupState === 'notfound' && (
              <p className="text-xs text-muted-foreground mt-1">Not found in OpenFoodFacts — enter details below</p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Brand</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex gap-2 mt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={!barcode.trim() || !name.trim()}>Add</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

