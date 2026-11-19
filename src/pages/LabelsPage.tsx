import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearch, Link } from '@tanstack/react-router'
import { Printer, Download, ExternalLink, RotateCcw, AlertTriangle, Search, Loader2, Check } from 'lucide-react'
import { Button, toast } from '@blinkdotnew/ui'
import { cn } from '@/lib/utils'
import { getLocations, getLabelTemplates, generateLabelsPdf, updateSettings, updateLocation } from '../lib/api'
import { useSettings, resolveBaseUrl, isLocalOnly } from '../lib/settings'
import type { Location, LabelTemplate } from '../types'

// Flattens the location tree into display order with depth for indentation
function flattenTree(locations: Location[], parentId: string | null = null, depth = 0): { location: Location; depth: number }[] {
  const out: { location: Location; depth: number }[] = []
  for (const loc of locations.filter(l => (l.parentId ?? null) === parentId)) {
    out.push({ location: loc, depth })
    out.push(...flattenTree(locations, loc.id, depth + 1))
  }
  return out
}

// Remembered "already used" cells per template, so a half-used sheet stays
// marked between visits. Browser-local by design — it describes the sheet
// sitting next to this computer's printer.
const usedKey = (templateId: string) => `scanbin.usedCells.${templateId}`
function loadUsed(templateId: string): Set<number> {
  try {
    const raw = localStorage.getItem(usedKey(templateId))
    return new Set(raw ? (JSON.parse(raw) as number[]) : [])
  } catch {
    return new Set()
  }
}
function saveUsed(templateId: string, used: Set<number>) {
  try { localStorage.setItem(usedKey(templateId), JSON.stringify([...used])) } catch { /* storage unavailable */ }
}

export function LabelsPage() {
  const search = useSearch({ from: '/labels' }) as { ids?: string }
  const queryClient = useQueryClient()

  const { data: templates = [] } = useQuery({ queryKey: ['label-templates'], queryFn: getLabelTemplates })
  const { data: locations = [] } = useQuery({ queryKey: ['locations'], queryFn: getLocations })
  const { data: settings } = useSettings()

  const [templateId, setTemplateId] = useState('avery-5263')
  const template = templates.find(t => t.id === templateId) ?? templates[0]

  const [selected, setSelected] = useState<Set<string>>(() => new Set(search.ids ? search.ids.split(',') : []))
  const [copies, setCopies] = useState(1)
  const [filter, setFilter] = useState('')
  const [outline, setOutline] = useState(false)
  const [used, setUsed] = useState<Set<number>>(() => loadUsed('avery-5263'))
  const [pdf, setPdf] = useState<{ url: string; kind: 'labels' | 'calibration'; count: number } | null>(null)
  const [busy, setBusy] = useState<'labels' | 'calibration' | null>(null)

  // Printer nudge (mm) — edited locally, saved to the server on blur
  const [offX, setOffX] = useState('0')
  const [offY, setOffY] = useState('0')
  useEffect(() => {
    if (settings) {
      setOffX(String(settings.labelOffsetXmm))
      setOffY(String(settings.labelOffsetYmm))
    }
  }, [settings?.labelOffsetXmm, settings?.labelOffsetYmm]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (template) setUsed(loadUsed(template.id)) }, [template?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url) }, [pdf])

  // Notes edits save on blur; Create PDF waits for any still in flight so the
  // server renders the latest text.
  const pendingSaves = useRef(new Set<Promise<unknown>>())
  const saveNotes = (loc: Location, description: string) => {
    const p = updateLocation(loc.id, {
      name: loc.name, type: loc.type, color: loc.color, parentId: loc.parentId,
      barcode: loc.barcode, description: description.trim() || null,
    })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['locations'] })
        queryClient.invalidateQueries({ queryKey: ['location', loc.id] })
      })
      .catch(() => { toast.error(`Couldn't save notes for ${loc.name}`) })
      .finally(() => pendingSaves.current.delete(p))
    pendingSaves.current.add(p)
    return p
  }

  const saveOffsets = useMutation({
    mutationFn: () => updateSettings({ labelOffsetXmm: Number(offX) || 0, labelOffsetYmm: Number(offY) || 0 }),
    onSuccess: (s) => queryClient.setQueryData(['settings'], s),
    onError: (e) => toast.error((e as Error).message),
  })

  const tree = useMemo(() => flattenTree(locations), [locations])
  const visible = filter.trim()
    ? tree.filter(({ location }) => location.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : tree

  // Labels in print order: tree order × copies
  const queue = useMemo(() => {
    const out: Location[] = []
    for (const { location } of tree) if (selected.has(location.id)) for (let i = 0; i < copies; i++) out.push(location)
    return out
  }, [tree, selected, copies])

  const perSheet = template ? template.cols * template.rows : 0
  const freeCells = useMemo(
    () => Array.from({ length: perSheet }, (_, i) => i).filter(i => !used.has(i)),
    [perSheet, used],
  )
  // Which label lands in which cell of the first sheet
  const assignment = useMemo(() => {
    const map = new Map<number, Location>()
    freeCells.forEach((cell, i) => { if (queue[i]) map.set(cell, queue[i]) })
    return map
  }, [freeCells, queue])
  const overflow = Math.max(queue.length - freeCells.length, 0)
  const extraSheets = overflow ? Math.ceil(overflow / perSheet) : 0

  const updateUsed = (next: Set<number>) => {
    setUsed(next)
    if (template) saveUsed(template.id, next)
  }
  const toggleCell = (i: number) => {
    const next = new Set(used)
    next.has(i) ? next.delete(i) : next.add(i)
    updateUsed(next)
  }

  const toggleLocation = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const baseUrl = resolveBaseUrl(settings?.publicBaseUrl)
  const localOnly = !settings?.publicBaseUrl && isLocalOnly(baseUrl)

  const generate = async (kind: 'labels' | 'calibration') => {
    if (!template) return
    setBusy(kind)
    try {
      await Promise.all([...pendingSaves.current])
      // Make sure the latest nudge is saved before the server renders
      if (Number(offX) !== settings?.labelOffsetXmm || Number(offY) !== settings?.labelOffsetYmm) {
        await saveOffsets.mutateAsync()
      }
      const blob = await generateLabelsPdf(kind === 'calibration'
        ? { templateId: template.id, calibration: true }
        : {
            templateId: template.id,
            locationIds: tree.filter(({ location }) => selected.has(location.id)).map(({ location }) => location.id),
            copies,
            skip: [...used],
            outline,
            baseUrl,
          })
      setPdf({ url: URL.createObjectURL(blob), kind, count: queue.length })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // After printing, record which cells are now gone so the next run skips them
  const markPrinted = () => {
    if (!pdf || pdf.kind !== 'labels') return
    const total = pdf.count
    if (total <= freeCells.length) {
      const next = new Set([...used, ...freeCells.slice(0, total)])
      if (next.size >= perSheet) {
        updateUsed(new Set())
        toast.success('Sheet used up — next print starts on a fresh sheet')
      } else {
        updateUsed(next)
        toast.success(`${perSheet - next.size} spots left on this sheet`)
      }
    } else {
      const lastCount = (total - freeCells.length) % perSheet
      updateUsed(new Set(Array.from({ length: lastCount }, (_, i) => i)))
      toast.success(lastCount ? `${perSheet - lastCount} spots left on the last sheet` : 'Sheets used up — next print starts on a fresh sheet')
    }
    setPdf(null)
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Print Labels</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pick locations, mark any spots already used on your sheet, and get a PDF to print.
        </p>
      </div>

      {localOnly && (
        <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-foreground">
            QR codes will point to <code className="font-mono">{baseUrl}</code>, which phones can't open.{' '}
            <Link to="/settings" className="text-primary underline underline-offset-2">Set a public address in Settings</Link> before printing.
          </p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,22rem)]">
        {/* ── Locations ── */}
        <section className="flex flex-col gap-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">1. Locations</h2>
            <div className="flex gap-3 text-xs">
              <button className="text-primary hover:text-primary/80" onClick={() => setSelected(new Set(visible.map(v => v.location.id)))}>
                Select {filter ? 'shown' : 'all'}
              </button>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter locations…"
              className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="rounded-xl border border-border divide-y divide-border max-h-[26rem] overflow-y-auto">
            {visible.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                {locations.length === 0 ? 'No locations yet.' : 'No matches.'}
              </p>
            )}
            {visible.map(({ location, depth }) => (
              <label
                key={location.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 cursor-pointer"
                style={{ paddingLeft: `${0.75 + (filter ? 0 : depth) * 1.25}rem` }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(location.id)}
                  onChange={() => toggleLocation(location.id)}
                  className="accent-primary"
                />
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: location.color }} />
                <span className="text-sm text-foreground truncate flex-1">{location.name}</span>
                <span className="text-xs text-muted-foreground/60">{location.type}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <label htmlFor="copies" className="text-muted-foreground">Copies of each</label>
            <input
              id="copies"
              type="number"
              min={1}
              max={20}
              value={copies}
              onChange={(e) => setCopies(Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 20))}
              className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <span className="text-xs text-muted-foreground ml-auto">{queue.length} label{queue.length !== 1 ? 's' : ''}</span>
          </div>
        </section>

        {/* ── Sheet ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">2. Sheet</h2>
          {templates.length > 1 && (
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
            >
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {template && <p className="text-xs text-muted-foreground -mt-1">{template.name}</p>}
          <p className="text-xs text-muted-foreground">
            Tap spots you've already peeled off. Labels fill the free spots in order.
          </p>
          {template && <SheetMap template={template} used={used} assignment={assignment} onToggle={toggleCell} />}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {freeCells.length} free
              {extraSheets > 0 && <span className="text-foreground"> · {overflow} more on {extraSheets} extra sheet{extraSheets > 1 ? 's' : ''}</span>}
            </span>
            {used.size > 0 && (
              <button onClick={() => updateUsed(new Set())} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <RotateCcw size={12} /> Fresh sheet
              </button>
            )}
          </div>
        </section>
      </div>

      {/* ── Notes ── */}
      {selected.size > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">Notes on each label</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Printed under the name. Saved to the location, so they also show in the app. Leave blank for a big QR + name label.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {tree.filter(({ location }) => selected.has(location.id)).map(({ location }) => (
              <NotesField key={location.id} location={location} onSave={(text) => saveNotes(location, text)} />
            ))}
          </div>
        </section>
      )}

      {/* ── Alignment ── */}
      <section className="rounded-xl border border-border p-4 flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">3. Alignment <span className="text-muted-foreground font-normal">(set once per printer)</span></h2>
        <p className="text-xs text-muted-foreground">
          Print the alignment test on plain paper, lay it over a label sheet and hold both up to a light.
          If the outlines sit left of the labels, increase X; if they sit too high, increase Y.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          {([['Nudge right (X)', offX, setOffX], ['Nudge down (Y)', offY, setOffY]] as const).map(([label, val, set]) => (
            <label key={label} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {label}
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step={0.5}
                  min={-20}
                  max={20}
                  value={val}
                  onChange={(e) => set(e.target.value)}
                  onBlur={() => saveOffsets.mutate()}
                  className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <span>mm</span>
              </div>
            </label>
          ))}
          <Button variant="outline" size="sm" onClick={() => generate('calibration')} disabled={busy !== null}>
            {busy === 'calibration' ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Printer size={14} className="mr-1.5" />}
            Alignment test
          </Button>
        </div>
      </section>

      {/* ── Generate ── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => generate('labels')} disabled={busy !== null || queue.length === 0}>
            {busy === 'labels' ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Printer size={15} className="mr-1.5" />}
            Create PDF{queue.length ? ` (${queue.length})` : ''}
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
            <input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} className="accent-primary" />
            Draw label outlines (for plain-paper test prints)
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          When printing, choose <strong className="text-foreground">Actual size / 100%</strong> — not "Fit to page" — or the labels won't line up.
        </p>

        {pdf && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
              <span className="text-sm text-foreground mr-auto">
                {pdf.kind === 'calibration' ? 'Alignment test' : `${pdf.count} label${pdf.count !== 1 ? 's' : ''}`}
              </span>
              <a href={pdf.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2 py-1">
                <ExternalLink size={13} /> Open
              </a>
              <a href={pdf.url} download={pdf.kind === 'calibration' ? 'alignment-test.pdf' : 'labels.pdf'} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2 py-1">
                <Download size={13} /> Download
              </a>
              {pdf.kind === 'labels' && (
                <Button size="sm" variant="outline" onClick={markPrinted}>Printed — mark spots used</Button>
              )}
            </div>
            <iframe src={pdf.url} title="Label preview" className="w-full h-[70vh] bg-white hidden md:block" />
          </div>
        )}
      </section>
    </div>
  )
}

// ── Notes field ───────────────────────────────────────────────────────────────

function NotesField({ location, onSave }: { location: Location; onSave: (text: string) => Promise<unknown> }) {
  const saved = location.description ?? ''
  const [text, setText] = useState(saved)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  // Pick up edits made elsewhere (e.g. the location page) when not mid-edit
  useEffect(() => { if (state !== 'saving') setText(saved) }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    if (text.trim() === saved.trim()) return
    setState('saving')
    await onSave(text)
    setState('saved')
  }

  return (
    <label className="flex flex-col gap-1 rounded-xl border border-border p-3">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: location.color }} />
        <span className="truncate flex-1">{location.name}</span>
        {state === 'saving' && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
        {state === 'saved' && <Check size={12} className="text-green-500" />}
      </span>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setState('idle') }}
        onBlur={commit}
        rows={2}
        placeholder="e.g. Dog treats, chicken toppers"
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
      />
    </label>
  )
}

// ── Sheet map ─────────────────────────────────────────────────────────────────
// A to-scale picture of the label sheet. Each cell is clickable to toggle
// "already used"; free cells show which location will print there.

function SheetMap({ template: t, used, assignment, onToggle }: {
  template: LabelTemplate
  used: Set<number>
  assignment: Map<number, Location>
  onToggle: (i: number) => void
}) {
  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  return (
    <div
      className="relative w-full bg-white rounded-md shadow-sm border border-border"
      style={{ aspectRatio: `${t.pageWidth} / ${t.pageHeight}` }}
    >
      {Array.from({ length: t.cols * t.rows }, (_, i) => {
        const col = i % t.cols
        const row = Math.floor(i / t.cols)
        const isUsed = used.has(i)
        const loc = assignment.get(i)
        return (
          <button
            key={i}
            onClick={() => onToggle(i)}
            title={isUsed ? 'Marked as used — tap to free' : 'Tap to mark as used'}
            className={cn(
              'absolute flex items-center gap-1.5 px-2 text-left rounded-[3px] border transition-colors overflow-hidden',
              isUsed
                ? 'border-neutral-300 bg-neutral-200 text-neutral-400'
                : loc
                  ? 'border-blue-400 bg-blue-50 text-neutral-800 hover:bg-blue-100'
                  : 'border-neutral-300 border-dashed bg-white text-neutral-400 hover:bg-neutral-50',
            )}
            style={{
              left: pct(t.marginLeft + col * t.pitchX, t.pageWidth),
              top: pct(t.marginTop + row * t.pitchY, t.pageHeight),
              width: pct(t.labelWidth, t.pageWidth),
              height: pct(t.labelHeight, t.pageHeight),
              ...(isUsed ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(0,0,0,0.06) 6px 12px)' } : {}),
            }}
          >
            <span className="text-[10px] font-mono shrink-0">{i + 1}</span>
            {isUsed ? (
              <span className="text-[11px]">Used</span>
            ) : loc ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: loc.color }} />
                <span className="text-[11px] font-medium truncate">{loc.name}</span>
              </>
            ) : (
              <span className="text-[11px]">Free</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
