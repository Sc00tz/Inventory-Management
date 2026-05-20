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

// ── Database setup ────────────────────────────────────────────────────────────

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    barcode TEXT,
    description TEXT,
    color TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    barcode TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    imageUrl TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    locationId TEXT NOT NULL,
    productId TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    notes TEXT,
    addedAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    UNIQUE(locationId, productId)
  );

  CREATE INDEX IF NOT EXISTS idx_inventory_locationId ON inventory(locationId);
  CREATE INDEX IF NOT EXISTS idx_inventory_productId ON inventory(productId);
  CREATE INDEX IF NOT EXISTS idx_locations_parentId ON locations(parentId);
`)

// ── QR code generation ───────────────────────────────────────────────────────

app.get('/api/qr', async (req, res) => {
  const { url } = req.query
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' })
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must be http(s)' })
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 })
    res.setHeader('Content-Type', 'image/svg+xml')
    res.send(svg)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Short URL redirect ────────────────────────────────────────────────────────
// QR codes use /l/:shortId (first 8 chars of UUID) to keep URLs short enough
// for label makers. The LIKE query is safe — UUIDs are random enough that
// 8-char collisions won't occur in a home inventory system.

app.get('/l/:shortId', (req, res) => {
  const { shortId } = req.params
  if (!/^[0-9a-f-]{8,36}$/i.test(shortId)) return res.status(400).send('Invalid ID')
  const row = db.prepare("SELECT id FROM locations WHERE id LIKE ?").get(shortId + '%')
  if (!row) return res.status(404).send('Location not found')
  res.redirect(`/locations/${row.id}`)
})

// ── Locations ─────────────────────────────────────────────────────────────────

app.get('/api/locations/short/:shortId', (req, res) => {
  const { shortId } = req.params
  if (!/^[0-9a-f-]{8,36}$/i.test(shortId)) return res.status(400).json({ error: 'Invalid ID' })
  const row = db.prepare("SELECT * FROM locations WHERE id LIKE ?").get(shortId + '%')
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.get('/api/locations', (req, res) => {
  res.json(db.prepare('SELECT * FROM locations ORDER BY name ASC').all())
})

app.get('/api/locations/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.post('/api/locations', (req, res) => {
  try {
    const { name, type, barcode, description, color, parentId } = req.body
    const id = randomUUID()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO locations (id, parentId, name, type, barcode, description, color, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, parentId || null, name, type, barcode || null, description || null, color, now, now)
    res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(id))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/locations/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const { name, type, barcode, description, color, parentId } = req.body
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE locations SET name=?, type=?, barcode=?, description=?, color=?, parentId=?, updatedAt=? WHERE id=?
    `).run(name, type, barcode || null, description || null, color, parentId || null, now, req.params.id)
    res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

function deleteLocationCascade(id) {
  const children = db.prepare('SELECT id FROM locations WHERE parentId = ?').all(id)
  for (const child of children) deleteLocationCascade(child.id)
  db.prepare('DELETE FROM inventory WHERE locationId = ?').run(id)
  db.prepare('DELETE FROM locations WHERE id = ?').run(id)
}

app.delete('/api/locations/:id', (req, res) => {
  try {
    deleteLocationCascade(req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  try {
    const { barcode, name, brand, imageUrl } = req.body
    const id = randomUUID()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO products (id, barcode, name, brand, imageUrl, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, barcode, name, brand || null, imageUrl || null, now, now)
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/products/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const { name, brand, imageUrl } = req.body
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE products SET name=?, brand=?, imageUrl=?, updatedAt=? WHERE id=?
    `).run(name, brand || null, imageUrl || null, now, req.params.id)
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Inventory counts (single query for all locations) ────────────────────────

app.get('/api/inventory-counts', (req, res) => {
  const rows = db.prepare('SELECT locationId, COUNT(*) as count FROM inventory GROUP BY locationId').all()
  res.json(Object.fromEntries(rows.map(r => [r.locationId, r.count])))
})

// ── Inventory ─────────────────────────────────────────────────────────────────

app.get('/api/inventory/:locationId', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT i.*, p.barcode as p_barcode, p.name as p_name, p.brand as p_brand,
             p.imageUrl as p_imageUrl, p.createdAt as p_createdAt, p.updatedAt as p_updatedAt
      FROM inventory i JOIN products p ON i.productId = p.id
      WHERE i.locationId = ? ORDER BY i.updatedAt DESC
    `).all(req.params.locationId)

    res.json(rows.map(r => ({
      id: r.id, locationId: r.locationId, productId: r.productId,
      quantity: r.quantity, notes: r.notes, addedAt: r.addedAt, updatedAt: r.updatedAt,
      product: {
        id: r.productId, barcode: r.p_barcode, name: r.p_name, brand: r.p_brand,
        imageUrl: r.p_imageUrl, createdAt: r.p_createdAt, updatedAt: r.p_updatedAt
      }
    })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/inventory/upsert', (req, res) => {
  try {
    const { locationId, productId, delta } = req.body
    const now = new Date().toISOString()
    const existing = db.prepare(
      'SELECT * FROM inventory WHERE locationId = ? AND productId = ?'
    ).get(locationId, productId)

    if (existing) {
      const newQty = Math.max(0, existing.quantity + delta)
      if (newQty === 0) {
        db.prepare('DELETE FROM inventory WHERE id = ?').run(existing.id)
        return res.json({ ...existing, quantity: 0 })
      }
      db.prepare('UPDATE inventory SET quantity=?, updatedAt=? WHERE id=?').run(newQty, now, existing.id)
      return res.json(db.prepare('SELECT * FROM inventory WHERE id = ?').get(existing.id))
    }

    if (delta <= 0) return res.status(400).json({ error: 'Cannot remove item not in inventory' })
    const id = randomUUID()
    db.prepare(`
      INSERT INTO inventory (id, locationId, productId, quantity, addedAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, locationId, productId, delta, now, now)
    res.json(db.prepare('SELECT * FROM inventory WHERE id = ?').get(id))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/inventory/:id/quantity', (req, res) => {
  try {
    const { quantity } = req.body
    const now = new Date().toISOString()
    if (quantity <= 0) {
      db.prepare('DELETE FROM inventory WHERE id = ?').run(req.params.id)
      return res.json({ deleted: true })
    }
    db.prepare('UPDATE inventory SET quantity=?, updatedAt=? WHERE id=?').run(quantity, now, req.params.id)
    res.json(db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/inventory/:id', (req, res) => {
  db.prepare('DELETE FROM inventory WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Serve frontend ────────────────────────────────────────────────────────────

app.use(express.static(join(__dirname, 'dist')))
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => console.log(`Inventory server running on port ${PORT}`))
