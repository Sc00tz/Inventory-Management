import express from 'express'
import QRCode from 'qrcode'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 4000
const DB_PATH = process.env.DB_PATH || '/data/inventory.db'

app.use(express.json())

// ── Database ──────────────────────────────────────────────────────────────────

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS locations (
    id          TEXT PRIMARY KEY,
    parentId    TEXT,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    barcode     TEXT,
    description TEXT,
    color       TEXT NOT NULL,
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id        TEXT PRIMARY KEY,
    barcode   TEXT NOT NULL UNIQUE,
    name      TEXT NOT NULL,
    brand     TEXT,
    imageUrl  TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id         TEXT PRIMARY KEY,
    locationId TEXT NOT NULL,
    productId  TEXT NOT NULL,
    quantity   REAL NOT NULL DEFAULT 1,
    notes      TEXT,
    addedAt    TEXT NOT NULL,
    updatedAt  TEXT NOT NULL,
    UNIQUE(locationId, productId)
  );

  CREATE INDEX IF NOT EXISTS idx_inventory_locationId ON inventory(locationId);
  CREATE INDEX IF NOT EXISTS idx_inventory_productId  ON inventory(productId);
  CREATE INDEX IF NOT EXISTS idx_locations_parentId   ON locations(parentId);
  CREATE INDEX IF NOT EXISTS idx_locations_barcode    ON locations(barcode);
`)

// ── Validation helpers ────────────────────────────────────────────────────────

function requireStrings(res, obj, fields) {
  for (const field of fields) {
    if (typeof obj[field] !== 'string' || !obj[field].trim()) {
      res.status(400).json({ error: `${field} is required` })
      return false
    }
  }
  return true
}

// ── QR code ───────────────────────────────────────────────────────────────────

app.get('/api/qr', async (req, res) => {
  const { url } = req.query

  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' })
  // Only allow http(s) to prevent javascript:/data: URIs being encoded into QR codes
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must be http(s)' })

  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 })
    res.setHeader('Content-Type', 'image/svg+xml')
    res.send(svg)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Short URL redirect ────────────────────────────────────────────────────────
// QR labels use /l/:shortId (first 8 chars of a UUID) to keep URLs short
// enough for label printers. The LIKE query is safe — UUID prefixes won't
// collide in a home inventory system.

app.get('/l/:shortId', (req, res) => {
  const { shortId } = req.params
  if (!/^[0-9a-f-]{8,36}$/i.test(shortId)) return res.status(400).send('Invalid ID')

  const row = db.prepare('SELECT id FROM locations WHERE id LIKE ?').get(shortId + '%')
  if (!row) return res.status(404).send('Location not found')

  res.redirect(`/locations/${row.id}`)
})

// ── Locations ─────────────────────────────────────────────────────────────────

// Resolve a short UUID prefix to a full location (used by the QR scanner flow)
app.get('/api/locations/short/:shortId', (req, res) => {
  const { shortId } = req.params
  if (!/^[0-9a-f-]{8,36}$/i.test(shortId)) return res.status(400).json({ error: 'Invalid ID' })

  const row = db.prepare('SELECT * FROM locations WHERE id LIKE ?').get(shortId + '%')
  if (!row) return res.status(404).json({ error: 'Not found' })

  res.json(row)
})

app.get('/api/locations', (req, res) => {
  res.json(db.prepare('SELECT * FROM locations ORDER BY name ASC').all())
})

app.get('/api/locations/barcode/:barcode', (req, res) => {
  const row = db.prepare('SELECT * FROM locations WHERE barcode = ?').get(req.params.barcode)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.get('/api/locations/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.post('/api/locations', (req, res) => {
  if (!requireStrings(res, req.body, ['name', 'type', 'color'])) return
  try {
    const { name, type, barcode, description, color, parentId } = req.body
    const id = randomUUID()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO locations (id, parentId, name, type, barcode, description, color, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, parentId || null, name, type, barcode || null, description || null, color, now, now)

    res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(id))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/locations/:id', (req, res) => {
  if (!requireStrings(res, req.body, ['name', 'type', 'color'])) return
  try {
    const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const { name, type, barcode, description, color, parentId } = req.body
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE locations
      SET name=?, type=?, barcode=?, description=?, color=?, parentId=?, updatedAt=?
      WHERE id=?
    `).run(name, type, barcode || null, description || null, color, parentId || null, now, req.params.id)

    res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Recursively deletes a location, all its descendants, and their inventory rows,
// wrapped in a transaction so a mid-cascade crash can't leave orphaned data.
const deleteLocationCascade = db.transaction((id) => {
  const children = db.prepare('SELECT id FROM locations WHERE parentId = ?').all(id)
  for (const child of children) deleteLocationCascade(child.id)
  db.prepare('DELETE FROM inventory WHERE locationId = ?').run(id)
  db.prepare('DELETE FROM locations WHERE id = ?').run(id)
})

app.delete('/api/locations/:id', (req, res) => {
  try {
    deleteLocationCascade(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Products ──────────────────────────────────────────────────────────────────

app.get('/api/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY name ASC').all())
})

app.get('/api/products/barcode/:barcode', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE barcode = ?').get(req.params.barcode)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.post('/api/products', (req, res) => {
  if (!requireStrings(res, req.body, ['barcode', 'name'])) return
  try {
    const { barcode, name, brand, imageUrl } = req.body
    const id = randomUUID()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO products (id, barcode, name, brand, imageUrl, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, barcode, name, brand || null, imageUrl || null, now, now)

    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/products/:id', (req, res) => {
  if (!requireStrings(res, req.body, ['name'])) return
  try {
    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const { name, brand, imageUrl } = req.body
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE products
      SET name=?, brand=?, imageUrl=?, updatedAt=?
      WHERE id=?
    `).run(name, brand || null, imageUrl || null, now, req.params.id)

    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Inventory counts ──────────────────────────────────────────────────────────

// Returns { [locationId]: count } for all locations in one query,
// used by the home page tree to display per-location counts without N+1 fetches.
app.get('/api/inventory-counts', (req, res) => {
  const rows = db.prepare('SELECT locationId, COUNT(*) as count FROM inventory GROUP BY locationId').all()
  res.json(Object.fromEntries(rows.map(r => [r.locationId, r.count])))
})

// ── Inventory ─────────────────────────────────────────────────────────────────

app.get('/api/inventory/:locationId', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        i.*,
        p.barcode   AS p_barcode,
        p.name      AS p_name,
        p.brand     AS p_brand,
        p.imageUrl  AS p_imageUrl,
        p.createdAt AS p_createdAt,
        p.updatedAt AS p_updatedAt
      FROM inventory i
      JOIN products p ON i.productId = p.id
      WHERE i.locationId = ?
      ORDER BY i.updatedAt DESC
    `).all(req.params.locationId)

    res.json(rows.map(r => ({
      id:         r.id,
      locationId: r.locationId,
      productId:  r.productId,
      quantity:   r.quantity,
      notes:      r.notes,
      addedAt:    r.addedAt,
      updatedAt:  r.updatedAt,
      product: {
        id:        r.productId,
        barcode:   r.p_barcode,
        name:      r.p_name,
        brand:     r.p_brand,
        imageUrl:  r.p_imageUrl,
        createdAt: r.p_createdAt,
        updatedAt: r.p_updatedAt,
      },
    })))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Adds delta to the existing quantity, or creates a new entry.
// Deletes the row when quantity reaches 0.
// Wrapped in a transaction to prevent a race between the SELECT and INSERT.
const upsertInventory = db.transaction((locationId, productId, delta) => {
  const now = new Date().toISOString()

  const existing = db.prepare(
    'SELECT * FROM inventory WHERE locationId = ? AND productId = ?'
  ).get(locationId, productId)

  if (existing) {
    const newQty = Math.max(0, existing.quantity + delta)
    if (newQty === 0) {
      db.prepare('DELETE FROM inventory WHERE id = ?').run(existing.id)
      return { ...existing, quantity: 0 }
    }
    db.prepare('UPDATE inventory SET quantity=?, updatedAt=? WHERE id=?').run(newQty, now, existing.id)
    return db.prepare('SELECT * FROM inventory WHERE id = ?').get(existing.id)
  }

  if (delta <= 0) throw Object.assign(new Error('Cannot remove an item not in inventory'), { status: 400 })

  const id = randomUUID()
  db.prepare(`
    INSERT INTO inventory (id, locationId, productId, quantity, addedAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, locationId, productId, delta, now, now)

  return db.prepare('SELECT * FROM inventory WHERE id = ?').get(id)
})

app.post('/api/inventory/upsert', (req, res) => {
  const { locationId, productId, delta } = req.body
  if (!locationId || !productId || typeof delta !== 'number') {
    return res.status(400).json({ error: 'locationId, productId, and delta (number) are required' })
  }
  try {
    res.json(upsertInventory(locationId, productId, delta))
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// Sets quantity directly; deletes the row when quantity reaches 0.
app.put('/api/inventory/:id/quantity', (req, res) => {
  try {
    const { quantity } = req.body
    if (typeof quantity !== 'number') return res.status(400).json({ error: 'quantity (number) is required' })
    const now = new Date().toISOString()

    if (quantity <= 0) {
      db.prepare('DELETE FROM inventory WHERE id = ?').run(req.params.id)
      return res.json({ deleted: true })
    }

    db.prepare('UPDATE inventory SET quantity=?, updatedAt=? WHERE id=?').run(quantity, now, req.params.id)
    res.json(db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/inventory/:id', (req, res) => {
  db.prepare('DELETE FROM inventory WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Frontend ──────────────────────────────────────────────────────────────────

app.use(express.static(join(__dirname, 'dist')))
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => console.log(`Inventory server running on port ${PORT}`))
