import { useState, useEffect, useRef } from 'react'
import { Button } from '@blinkdotnew/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'
import { Loader2, Search } from 'lucide-react'
import { lookupBarcode } from '../lib/api'

interface AddProductModalProps {
  open: boolean
  barcode: string
  onConfirm: (name: string, brand: string, barcode: string) => void
  onCancel: () => void
}

export function AddProductModal({ open, barcode, onConfirm, onCancel }: AddProductModalProps) {
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [looking, setLooking] = useState(false)
  const [looked, setLooked] = useState(false)
  const abortedRef = useRef(false)

  useEffect(() => {
    if (!open || !barcode) return
    abortedRef.current = false
    setName('')
    setBrand('')
    setLooked(false)
    setLooking(true)
    lookupBarcode(barcode).then((result) => {
      if (abortedRef.current) return
      setLooking(false)
      setLooked(true)
      if (result) {
        setName(result.name || '')
        setBrand(result.brand || '')
      }
    })
    return () => { abortedRef.current = true }
  }, [open, barcode])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onConfirm(name.trim(), brand.trim(), barcode)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Product</DialogTitle>
        </DialogHeader>
        <div className="text-xs font-mono text-muted-foreground mb-3 bg-muted px-3 py-1.5 rounded">{barcode}</div>

        {looking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Looking up barcode…
          </div>
        )}
        {looked && !name && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Search size={14} />
            Not found in OpenFoodFacts — enter details manually
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Product name *</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              placeholder="e.g. Olive Oil"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Brand (optional)</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              placeholder="e.g. Kirkland"
            />
          </div>
          <div className="flex gap-2 mt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={!name.trim() || looking}>
              Add to Inventory
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

