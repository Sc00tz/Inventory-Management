import { useState, useEffect } from 'react'
import { Button } from '@blinkdotnew/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Location } from '../types'

const BUILT_IN_TYPES = ['room', 'shelf', 'bin', 'fridge', 'freezer', 'cupboard', 'pantry', 'other']

const COLORS = ['#F59F0A', '#EF4444', '#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#F97316', '#6B7280']

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

interface LocationFormModalProps {
  open: boolean
  location?: Location | null
  locations?: Location[]
  onSave: (data: { name: string; type: string; barcode: string; description: string; color: string; parentId: string | null }) => void
  onClose: () => void
}

function flattenTree(locations: Location[], excludeId?: string | null, parentId: string | null = null, depth = 0): { location: Location; depth: number }[] {
  const children = locations.filter(l => (l.parentId ?? null) === parentId)
  const result: { location: Location; depth: number }[] = []
  for (const loc of children) {
    if (loc.id === excludeId) continue
    result.push({ location: loc, depth })
    result.push(...flattenTree(locations, excludeId, loc.id, depth + 1))
  }
  return result
}

export function LocationFormModal({ open, location, locations = [], onSave, onClose }: LocationFormModalProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState('bin')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [parentId, setParentId] = useState<string | null>(null)
  const [addingType, setAddingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')

  useEffect(() => {
    if (location) {
      setName(location.name)
      setType(location.type)
      setDescription(location.description || '')
      setColor(location.color || COLORS[0])
      setParentId(location.parentId ?? null)
    } else {
      setName('')
      setType('bin')
      setDescription('')
      setColor(COLORS[0])
      setParentId(null)
    }
    setAddingType(false)
    setNewTypeName('')
  }, [location, open])

  const existingCustomTypes = [...new Set(locations.map(l => l.type))].filter(
    t => !BUILT_IN_TYPES.includes(t)
  )
  const allTypes = [...BUILT_IN_TYPES, ...existingCustomTypes]

  const commitNewType = () => {
    const trimmed = newTypeName.trim().toLowerCase()
    if (trimmed) {
      setType(trimmed)
    }
    setAddingType(false)
    setNewTypeName('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), type, barcode: '', description: description.trim(), color, parentId })
  }

  const parentOptions = flattenTree(locations, location?.id)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{location ? 'Edit Location' : 'New Location'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              placeholder="e.g. Costco Bin 1"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {allTypes.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium border transition-all',
                    type === t
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:border-primary/60 hover:text-foreground'
                  )}
                >
                  {capitalize(t)}
                </button>
              ))}

              {addingType ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitNewType() }
                      if (e.key === 'Escape') { setAddingType(false); setNewTypeName('') }
                    }}
                    onBlur={commitNewType}
                    placeholder="type name…"
                    className="w-24 rounded-md border border-primary bg-card px-2 py-1 text-xs text-foreground focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => { setAddingType(false); setNewTypeName('') }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingType(true)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-foreground transition-all flex items-center gap-1"
                >
                  <Plus size={11} /> New type
                </button>
              )}
            </div>
          </div>

          {locations.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Parent Location (optional)</label>
              <select
                value={parentId ?? ''}
                onChange={(e) => setParentId(e.target.value || null)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              >
                <option value="">— None (top level) —</option>
                {parentOptions.map(({ location: loc, depth }) => (
                  <option key={loc.id} value={loc.id}>
                    {'  '.repeat(depth)}{depth > 0 ? '└ ' : ''}{loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              placeholder="e.g. Under stairs, left side"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? 'white' : 'transparent',
                    transform: color === c ? 'scale(1.2)' : 'scale(1)',
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 mt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={!name.trim()}>
              {location ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
