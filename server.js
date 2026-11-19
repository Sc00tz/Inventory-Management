import express from 'express'
import QRCode from 'qrcode'
import PDFDocument from 'pdfkit'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 4000
const DB_PATH = process.env.DB_PATH || '/data/inventory.db'
// Optional free key from https://upcdatabase.org — adds general-merchandise
// coverage (electronics, tools, household) the Open*Facts DBs don't carry.
const UPCDB_KEY = process.env.UPCDATABASE_API_KEY || ''

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
    id             TEXT PRIMARY KEY,
    barcode        TEXT UNIQUE,
    name           TEXT NOT NULL,
    brand          TEXT,
    imageUrl       TEXT,
    createdAt      TEXT NOT NULL,
    updatedAt      TEXT NOT NULL,
    packSize       INTEGER,
    unitName       TEXT,
    childProductId TEXT
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

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

// ── Migrations ────────────────────────────────────────────────────────────────
// Sub-items: a product (e.g. a box of Ritz) can contain N of another product
// (e.g. "Ritz sleeve"). The box stores childProductId + packSize (sleeves per
// box). Stock is kept on the sleeve; the box count is derived from it.
// unitName is left over from the earlier multipack version (see below).
{
  const cols = db.prepare('PRAGMA table_info(products)').all()
  const has = (n) => cols.some(c => c.name === n)
  if (!has('packSize')) db.exec('ALTER TABLE products ADD COLUMN packSize INTEGER')
  if (!has('unitName')) db.exec('ALTER TABLE products ADD COLUMN unitName TEXT')
  if (!has('childProductId')) db.exec('ALTER TABLE products ADD COLUMN childProductId TEXT')

  // Sub-items may not have their own barcode: rebuild the table so barcode is
  // optional (SQLite can't drop NOT NULL in place). UNIQUE still applies to
  // non-empty barcodes; SQLite allows any number of NULLs.
  if (cols.find(c => c.name === 'barcode')?.notnull) {
    db.exec(`
      BEGIN;
      CREATE TABLE products_new (
        id TEXT PRIMARY KEY, barcode TEXT UNIQUE, name TEXT NOT NULL, brand TEXT, imageUrl TEXT,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, packSize INTEGER, unitName TEXT, childProductId TEXT
      );
      INSERT INTO products_new (id, barcode, name, brand, imageUrl, createdAt, updatedAt, packSize, unitName, childProductId)
        SELECT id, barcode, name, brand, imageUrl, createdAt, updatedAt, packSize, unitName, childProductId FROM products;
      DROP TABLE products;
      ALTER TABLE products_new RENAME TO products;
      COMMIT;
    `)
  }
}

// node:sqlite has no better-sqlite3-style db.transaction(). This shim wraps a
// function so all its statements commit atomically or roll back together.
// Nested calls (e.g. recursive cascades) use SAVEPOINTs so an inner rollback
// doesn't abort the whole outer transaction.
let txDepth = 0
db.transaction = (fn) => (...args) => {
  const nested = txDepth > 0
  const sp = `sp_${txDepth}`
  db.exec(nested ? `SAVEPOINT ${sp}` : 'BEGIN')
  txDepth++
  try {
    const result = fn(...args)
    db.exec(nested ? `RELEASE ${sp}` : 'COMMIT')
    return result
  } catch (e) {
    db.exec(nested ? `ROLLBACK TO ${sp}` : 'ROLLBACK')
    throw e
  } finally {
    txDepth--
  }
}

// Earlier "multipack" products (packSize set, no sub-item) counted their stock
// in units on the box itself. Turn each into box + sub-item and move the unit
// stock onto the sub-item, so nothing is lost.
const convertOldMultipacks = db.transaction(() => {
  const rows = db.prepare('SELECT * FROM products WHERE packSize > 1 AND childProductId IS NULL').all()
  for (const p of rows) {
    const childId = randomUUID()
    const now = new Date().toISOString()
    const unit = p.unitName?.trim() || 'single'
    db.prepare(`
      INSERT INTO products (id, barcode, name, brand, imageUrl, createdAt, updatedAt)
      VALUES (?, NULL, ?, ?, NULL, ?, ?)
    `).run(childId, `${p.name} (${unit})`, p.brand, now, now)
    db.prepare('UPDATE products SET childProductId = ?, updatedAt = ? WHERE id = ?').run(childId, now, p.id)
    db.prepare('UPDATE inventory SET productId = ?, updatedAt = ? WHERE productId = ?').run(childId, now, p.id)
  }
  return rows.length
})
const converted = convertOldMultipacks()
if (converted) console.log(`Converted ${converted} multipack product(s) to box + sub-item`)

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

// Validates a sub-item definition: { name, barcode?, perParent }.
// Returns null when none was given, { error } when invalid.
function parseSubItem(v) {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return { error: 'subItem must be an object or null' }
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, 200) : ''
  const barcode = typeof v.barcode === 'string' && v.barcode.trim() ? v.barcode.trim().slice(0, 64) : null
  const perParent = Number(v.perParent)
  if (!Number.isInteger(perParent) || perParent < 1 || perParent > 10000) {
    return { error: 'perParent must be a whole number between 1 and 10000' }
  }
  return { name, barcode, perParent }
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

// ── Barcode lookup ──────────────────────────────────────────────────────────────
// Resolves a barcode to { name, brand, imageUrl } by trying several free product
// databases in order. Runs server-side (not in the browser) so that: the
// UPCDATABASE_API_KEY stays secret, and sources with restrictive CORS (e.g.
// UPCitemdb, which only allows its own origin) actually work.
//
// Order: Open Food Facts → Open Beauty Facts → Open Products Facts (all free,
// no key, but food/cosmetics/general-OFF only) → UPCdatabase.org (needs a free
// key, broad general-merchandise coverage) → UPCitemdb trial (100/day, no key).

const LOOKUP_UA = 'ScanBin/1.0 (self-hosted inventory app)'

// Each source returns { name, brand, imageUrl } on a hit, or null to fall through.
async function fromOpenFacts(host, barcode) {
  const res = await fetch(`https://${host}/api/v2/product/${barcode}.json`, {
    headers: { 'User-Agent': LOOKUP_UA },
  })
  if (!res.ok) return null
  const data = await res.json()
  if (data.status !== 1 || !data.product) return null
  const p = data.product
  const name = p.product_name || p.product_name_en || ''
  if (!name) return null
  return {
    name,
    brand: p.brands || null,
    imageUrl: p.image_front_thumb_url || p.image_front_url || p.image_url || null,
  }
}

async function fromUpcDatabase(barcode) {
  if (!UPCDB_KEY) return null
  // Key is passed as the ?apikey= query param (the Bearer-header form documented
  // on the site returns "invalid key format").
  const res = await fetch(`https://api.upcdatabase.org/product/${barcode}?apikey=${UPCDB_KEY}`, {
    headers: { 'User-Agent': LOOKUP_UA },
  })
  if (!res.ok) return null
  const data = await res.json()
  if (data.success !== true || !data.title) return null
  return {
    name: data.title,
    brand: data.brand || data.manufacturer || null,
    imageUrl: Array.isArray(data.images) && data.images.length ? data.images[0] : null,
  }
}

async function fromUpcItemDb(barcode) {
  const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, {
    headers: { 'User-Agent': LOOKUP_UA },
  })
  if (!res.ok) return null
  const data = await res.json()
  const item = data.items?.[0]
  if (!item?.title) return null
  return {
    name: item.title,
    brand: item.brand || null,
    imageUrl: Array.isArray(item.images) && item.images.length ? item.images[0] : null,
  }
}

app.get('/api/lookup/:barcode', async (req, res) => {
  const { barcode } = req.params
  if (!/^[0-9]{6,14}$/.test(barcode)) return res.status(400).json({ error: 'Invalid barcode' })

  const sources = [
    () => fromOpenFacts('world.openfoodfacts.org', barcode),
    () => fromOpenFacts('world.openbeautyfacts.org', barcode),
    () => fromOpenFacts('world.openproductsfacts.org', barcode),
    () => fromUpcDatabase(barcode),
    () => fromUpcItemDb(barcode),
  ]

  for (const source of sources) {
    try {
      const hit = await source()
      if (hit) return res.json(hit)
    } catch { /* network/parse error — try the next source */ }
  }

  res.status(404).json({ error: 'Not found' })
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

const getProduct = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id)
const withChild = (p) => p && { ...p, child: p.childProductId ? getProduct(p.childProductId) ?? null : null }

// ── Products ──────────────────────────────────────────────────────────────────

// Each product includes parentId/parentName when it is some product's sub-item
app.get('/api/products', (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, pp.id AS parentId, pp.name AS parentName
    FROM products p
    LEFT JOIN products pp ON pp.childProductId = p.id
    ORDER BY p.name COLLATE NOCASE ASC
  `).all())
})

// Includes `child` (the sub-item product) so a box scan knows what it adds
app.get('/api/products/barcode/:barcode', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE barcode = ?').get(req.params.barcode)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(withChild(row))
})


class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }

// Links (or creates) the sub-item for a product. An existing product is reused
// when the sub-item's barcode matches one, or (without a barcode) when a
// stand-alone product already has exactly that name.
function attachSubItem(parent, sub) {
  const now = new Date().toISOString()
  let child = sub.barcode ? db.prepare('SELECT * FROM products WHERE barcode = ?').get(sub.barcode) : null
  if (!child && sub.name) {
    child = db.prepare(`
      SELECT * FROM products
      WHERE name = ? COLLATE NOCASE AND id != ? AND childProductId IS NULL
        AND id NOT IN (SELECT childProductId FROM products WHERE childProductId IS NOT NULL)
      ORDER BY createdAt LIMIT 1
    `).get(sub.name, parent.id) ?? null
  }
  if (child) {
    if (child.id === parent.id) throw new ApiError(400, 'A product cannot contain itself')
    if (child.childProductId) throw new ApiError(400, `${child.name} has its own sub-item, so it can't also be one`)
    const owner = db.prepare('SELECT name FROM products WHERE childProductId = ? AND id != ?').get(child.id, parent.id)
    if (owner) throw new ApiError(409, `${child.name} is already the sub-item of ${owner.name}`)
  } else {
    if (!sub.name) throw new ApiError(400, 'Sub-item name is required')
    const id = randomUUID()
    db.prepare(`
      INSERT INTO products (id, barcode, name, brand, imageUrl, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(id, sub.barcode, sub.name, parent.brand, now, now)
    child = getProduct(id)
  }
  db.prepare('UPDATE products SET childProductId = ?, packSize = ?, updatedAt = ? WHERE id = ?')
    .run(child.id, sub.perParent, now, parent.id)

  // Existing stock of the box becomes sub-item stock: 2 boxes -> 36 sleeves
  const boxRows = db.prepare('SELECT * FROM inventory WHERE productId = ?').all(parent.id)
  for (const row of boxRows) {
    const qty = row.quantity * sub.perParent
    const existing = db.prepare('SELECT id FROM inventory WHERE locationId = ? AND productId = ?').get(row.locationId, child.id)
    if (existing) db.prepare('UPDATE inventory SET quantity = quantity + ?, updatedAt = ? WHERE id = ?').run(qty, now, existing.id)
    else db.prepare('INSERT INTO inventory (id, locationId, productId, quantity, addedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), row.locationId, child.id, qty, now, now)
    db.prepare('DELETE FROM inventory WHERE id = ?').run(row.id)
  }
}

// Turns SQLite's barcode uniqueness error into a readable 409
function sendError(res, e) {
  if (e instanceof ApiError) return res.status(e.status).json({ error: e.message })
  if (/UNIQUE constraint failed: products\.barcode/.test(e.message)) {
    return res.status(409).json({ error: 'That barcode already belongs to another product' })
  }
  res.status(500).json({ error: e.message })
}

const createProductTx = db.transaction((body, sub) => {
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO products (id, barcode, name, brand, imageUrl, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.barcode.trim(), body.name, body.brand || null, body.imageUrl || null, now, now)
  if (sub) attachSubItem(getProduct(id), sub)
  return withChild(getProduct(id))
})

// POST /api/products { barcode, name, brand?, imageUrl?, subItem?: { name, barcode?, perParent } }
app.post('/api/products', (req, res) => {
  if (!requireStrings(res, req.body, ['barcode', 'name'])) return
  const sub = parseSubItem(req.body.subItem)
  if (sub?.error) return res.status(400).json({ error: sub.error })
  try {
    res.json(createProductTx(req.body, sub))
  } catch (e) {
    sendError(res, e)
  }
})

// Updates a product. Sub-item handling only happens when `subItem` is in the body:
//   null            → unlink the sub-item (it stays as a normal product with its stock)
//   { ... } (none)  → add a sub-item, converting existing box stock into sub-item stock
//   { ... } (has)   → rename / re-barcode the sub-item and update the per-box count
const updateProductTx = db.transaction((id, body, hasSub, sub) => {
  const now = new Date().toISOString()
  db.prepare('UPDATE products SET name=?, brand=?, imageUrl=?, updatedAt=? WHERE id=?')
    .run(body.name, body.brand || null, body.imageUrl || null, now, id)
  if (hasSub) {
    const p = getProduct(id)
    if (!sub) {
      db.prepare('UPDATE products SET childProductId = NULL, packSize = NULL, updatedAt = ? WHERE id = ?').run(now, id)
    } else if (!p.childProductId) {
      if (db.prepare('SELECT 1 FROM products WHERE childProductId = ?').get(id)) {
        throw new ApiError(400, `${p.name} is itself a sub-item, so it can't have one`)
      }
      attachSubItem(p, sub)
    } else {
      if (sub.name) {
        db.prepare('UPDATE products SET name = ?, barcode = ?, updatedAt = ? WHERE id = ?')
          .run(sub.name, sub.barcode, now, p.childProductId)
      }
      db.prepare('UPDATE products SET packSize = ?, updatedAt = ? WHERE id = ?').run(sub.perParent, now, id)
    }
  }
  return withChild(getProduct(id))
})

app.put('/api/products/:id', (req, res) => {
  if (!requireStrings(res, req.body, ['name'])) return
  if (!getProduct(req.params.id)) return res.status(404).json({ error: 'Not found' })
  const hasSub = 'subItem' in req.body
  const sub = parseSubItem(req.body.subItem)
  if (sub?.error) return res.status(400).json({ error: sub.error })
  try {
    res.json(updateProductTx(req.params.id, req.body, hasSub, sub))
  } catch (e) {
    sendError(res, e)
  }
})

// Deleting a sub-item unlinks it from its box first
const deleteProductTx = db.transaction((id) => {
  db.prepare('UPDATE products SET childProductId = NULL, packSize = NULL WHERE childProductId = ?').run(id)
  db.prepare('DELETE FROM products WHERE id = ?').run(id)
})

app.delete('/api/products/:id', (req, res) => {
  try {
    deleteProductTx(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

// ── Inventory counts ──────────────────────────────────────────────────────────

// Returns { [locationId]: count } for all locations in one query,
// used by the home page tree to display per-location counts without N+1 fetches.
app.get('/api/inventory-counts', (req, res) => {
  const rows = db.prepare('SELECT locationId, COUNT(*) as count FROM inventory GROUP BY locationId').all()
  res.json(Object.fromEntries(rows.map(r => [r.locationId, r.count])))
})

// ── Inventory ─────────────────────────────────────────────────────────────────

// Full-inventory search across all locations. Matches the query against product
// name, brand, and barcode; returns one row per (product, location) with the
// quantity there. Registered BEFORE /api/inventory/:locationId so "search" isn't
// mistaken for a locationId.
app.get('/api/inventory/search', (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim()
    if (!q) return res.json([])

    const like = `%${q.replace(/[%_]/g, '\\$&')}%`
    const rows = db.prepare(`
      SELECT
        i.id         AS inventoryId,
        i.quantity   AS quantity,
        i.locationId AS locationId,
        l.name       AS locationName,
        l.color      AS locationColor,
        l.type       AS locationType,
        p.id         AS productId,
        p.barcode    AS barcode,
        p.name       AS name,
        p.brand      AS brand,
        p.imageUrl   AS imageUrl,
        pp.name      AS parentName,
        pp.packSize  AS parentPackSize
      FROM inventory i
      JOIN products p  ON i.productId  = p.id
      JOIN locations l ON i.locationId = l.id
      LEFT JOIN products pp ON pp.childProductId = p.id
      WHERE p.name LIKE ? ESCAPE '\\'
         OR p.brand LIKE ? ESCAPE '\\'
         OR p.barcode LIKE ? ESCAPE '\\'
         OR pp.name LIKE ? ESCAPE '\\'
         OR pp.barcode LIKE ? ESCAPE '\\'
      ORDER BY p.name COLLATE NOCASE ASC, l.name COLLATE NOCASE ASC
    `).all(like, like, like, like, like)

    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

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
        p.updatedAt AS p_updatedAt,
        pp.id       AS pp_id,
        pp.barcode  AS pp_barcode,
        pp.name     AS pp_name,
        pp.brand    AS pp_brand,
        pp.imageUrl AS pp_imageUrl,
        pp.packSize AS pp_packSize
      FROM inventory i
      JOIN products p ON i.productId = p.id
      LEFT JOIN products pp ON pp.childProductId = p.id
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
      // The box this item comes in, if it's a sub-item (e.g. sleeve → Ritz box)
      parent: r.pp_id ? {
        id:       r.pp_id,
        barcode:  r.pp_barcode,
        name:     r.pp_name,
        brand:    r.pp_brand,
        imageUrl: r.pp_imageUrl,
        perParent: r.pp_packSize,
      } : null,
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

// ── Settings ──────────────────────────────────────────────────────────────────
// Small key/value store. publicBaseUrl is the address phones use to reach this
// server (e.g. http://192.168.1.20:4000) — it's baked into QR codes and NFC tags,
// so it must not be "localhost". Label offsets nudge the printed layout to
// compensate for printer drift, in millimetres.

const SETTING_DEFAULTS = {
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  labelOffsetXmm: 0,
  labelOffsetYmm: 0,
}

function getSettings() {
  const out = { ...SETTING_DEFAULTS }
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (key in out) {
      try { out[key] = JSON.parse(value) } catch { /* ignore corrupt value */ }
    }
  }
  return out
}

app.get('/api/settings', (req, res) => {
  res.json(getSettings())
})

app.put('/api/settings', (req, res) => {
  const body = req.body || {}
  const updates = {}

  if ('publicBaseUrl' in body) {
    const url = String(body.publicBaseUrl ?? '').trim().replace(/\/+$/, '')
    if (url && !/^https?:\/\/[^\s/]+$/i.test(url)) {
      return res.status(400).json({ error: 'publicBaseUrl must look like http://host:port (no path)' })
    }
    updates.publicBaseUrl = url
  }
  for (const key of ['labelOffsetXmm', 'labelOffsetYmm']) {
    if (key in body) {
      const n = Number(body[key])
      if (!Number.isFinite(n) || Math.abs(n) > 20) {
        return res.status(400).json({ error: `${key} must be a number between -20 and 20` })
      }
      updates[key] = n
    }
  }

  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [key, value] of Object.entries(updates)) stmt.run(key, JSON.stringify(value))
  res.json(getSettings())
})

// Base URL used for QR codes / NFC: saved setting → client-supplied → request host
function resolveBaseUrl(req, clientBase) {
  const { publicBaseUrl } = getSettings()
  if (publicBaseUrl) return publicBaseUrl
  if (typeof clientBase === 'string' && /^https?:\/\/[^\s/]+$/i.test(clientBase)) return clientBase
  return `${req.protocol}://${req.get('host')}`
}

// ── Label printing (PDF) ──────────────────────────────────────────────────────
// Templates are measured in inches from the sheet's top-left corner. Cells are
// numbered row-major: left→right, then top→bottom, starting at 0.

const LABEL_TEMPLATES = {
  'avery-5263': {
    id: 'avery-5263',
    name: 'Avery 5263 / 5163 / 8163 — 2" × 4", 10 per sheet',
    pageWidth: 8.5,
    pageHeight: 11,
    cols: 2,
    rows: 5,
    labelWidth: 4,
    labelHeight: 2,
    marginLeft: 0.15625,
    marginTop: 0.5,
    pitchX: 4.1875,   // label width + 3/16" gutter
    pitchY: 2,        // rows butt together
    cornerRadius: 0.0625,
  },
}

app.get('/api/labels/templates', (req, res) => {
  res.json(Object.values(LABEL_TEMPLATES))
})

const PT = 72 // PDF points per inch
const MM = 72 / 25.4

// Draws a QR code as vector rectangles (crisp at any printer DPI).
// Horizontal runs of dark modules are merged to keep the PDF small.
function drawQr(doc, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const cell = size / n
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue }
      const start = c
      while (c < n && qr.modules.get(r, c)) c++
      // Tiny overlap avoids hairline gaps between modules in some PDF viewers
      doc.rect(x + start * cell, y + r * cell, (c - start) * cell + 0.05, cell + 0.05)
    }
  }
  doc.fill('#000000')
}

// Built-in PDF fonts only cover Latin-1; replace anything else so the
// text renders instead of producing garbage glyphs.
function pdfSafe(text) {
  return String(text ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .trim()
}

// Largest font size (max→min) at which `text` fits the box without breaking
// any word mid-way. Returns { size, fits } — fits=false means use min + ellipsis.
function fitText(doc, text, font, width, height, max, min, lineGap = 0) {
  doc.font(font)
  const words = text.split(/\s+/)
  // pdfkit keeps the space after a word attached to it; if "word " is wider than
  // the line, the space spills onto the next line as a stray indent. So measure
  // words with their trailing space, against a slightly narrower box.
  const fitWidth = width * 0.98
  for (let size = max; size >= min; size -= 0.5) {
    doc.fontSize(size)
    const widest = Math.max(...words.map(w => doc.widthOfString(w + ' ')))
    if (widest <= fitWidth && doc.heightOfString(text, { width: fitWidth, lineGap }) <= height) return { size, fits: true }
  }
  return { size: min, fits: false }
}

// Label layout (matches the agreed mock-up):
//   ┌──────────────────────────────────────┐
//   │ [QR]  Location Name                  │
//   │──────────────────────────────────────│
//   │ Notes / contents (location description)
//   └──────────────────────────────────────┘
// Without notes, the QR and name grow to fill the whole label.
function drawLocationLabel(doc, t, x, y, loc, baseUrl) {
  const W = t.labelWidth * PT
  const H = t.labelHeight * PT
  const pad = 0.1 * PT
  const gap = 0.08 * PT
  const shortId = loc.id.slice(0, 8)
  const name = pdfSafe(loc.name) || 'Untitled'
  // Keep line breaks the user typed; tidy everything else
  const notes = String(loc.description ?? '')
    .split(/\r?\n/).map(pdfSafe).join('\n').replace(/\n{3,}/g, '\n\n').trim()

  const qrSize = notes ? 0.62 * PT : H - pad * 2
  drawQr(doc, `${baseUrl}/l/${shortId}`, x + pad, y + pad, qrSize)

  // Name: as big as fits beside the QR, vertically centred on it
  const nx = x + pad + qrSize + gap
  const nw = x + W - pad - nx
  const { size: nameSize, fits: nameFits } = fitText(doc, name, 'Helvetica-Bold', nw, qrSize, notes ? 46 : 40, 12)
  doc.font('Helvetica-Bold').fontSize(nameSize).fillColor('#000000')
  const nameH = Math.min(doc.heightOfString(name, { width: nw, lineGap: 0 }), qrSize)
  // Helvetica's line box has extra space below the baseline; nudge down a touch so caps look centred
  const ny = y + pad + (qrSize - nameH) / 2 + nameSize * 0.06
  doc.text(name, nx, ny, { width: nw, height: nameH + 1, lineGap: 0, ellipsis: !nameFits })

  if (!notes) return

  // Divider
  const ry = y + pad + qrSize + gap
  doc.moveTo(x + pad, ry).lineTo(x + W - pad, ry).lineWidth(1).strokeColor('#000000').stroke()

  // Notes fill the rest of the label
  const tx = x + pad
  const ty = ry + gap
  const tw = W - pad * 2
  const th = y + H - pad - ty
  const { size: noteSize, fits: notesFit } = fitText(doc, notes, 'Helvetica-Bold', tw, th, 16, 6, 0)
  doc.font('Helvetica-Bold').fontSize(noteSize).fillColor('#000000')
    .text(notes, tx, ty, { width: tw, height: th, lineGap: 0, ellipsis: !notesFit })
}

// Calibration cell: outline, centre crosshair, cell number
function drawCalibrationCell(doc, t, x, y, index) {
  const W = t.labelWidth * PT
  const H = t.labelHeight * PT
  doc.lineWidth(0.5).strokeColor('#000000')
    .roundedRect(x, y, W, H, t.cornerRadius * PT).stroke()
  const cx = x + W / 2
  const cy = y + H / 2
  doc.moveTo(cx - 12, cy).lineTo(cx + 12, cy).moveTo(cx, cy - 12).lineTo(cx, cy + 12).stroke()
  doc.font('Helvetica').fontSize(9).fillColor('#000000')
    .text(`#${index + 1}`, x + 8, y + 8, { lineBreak: false })
}

// POST /api/labels/pdf
// { templateId, locationIds: string[], copies?: number, skip?: number[] (cells on
//   the FIRST sheet already used), calibration?: boolean, outline?: boolean,
//   baseUrl?: string }
app.post('/api/labels/pdf', (req, res) => {
  const body = req.body || {}
  const t = LABEL_TEMPLATES[body.templateId]
  if (!t) return res.status(400).json({ error: 'Unknown templateId' })

  const perSheet = t.cols * t.rows
  const skip = new Set((Array.isArray(body.skip) ? body.skip : [])
    .map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < perSheet))
  const copies = Math.min(Math.max(parseInt(body.copies, 10) || 1, 1), 20)
  const calibration = body.calibration === true
  const outline = body.outline === true

  // Expand selected locations (keeping the requested order) × copies
  const all = db.prepare('SELECT * FROM locations').all()
  const byId = new Map(all.map(l => [l.id, l]))
  const ids = Array.isArray(body.locationIds) ? body.locationIds : []
  const queue = []
  for (const id of ids) {
    const loc = byId.get(id)
    if (loc) for (let i = 0; i < copies; i++) queue.push(loc)
  }
  if (!calibration && queue.length === 0) return res.status(400).json({ error: 'No valid locations selected' })
  if (queue.length > 500) return res.status(400).json({ error: 'Too many labels (max 500)' })

  const { labelOffsetXmm, labelOffsetYmm } = getSettings()
  const ox = labelOffsetXmm * MM
  const oy = labelOffsetYmm * MM
  const baseUrl = resolveBaseUrl(req, body.baseUrl)

  const doc = new PDFDocument({
    size: [t.pageWidth * PT, t.pageHeight * PT],
    margin: 0,
    autoFirstPage: false,
    info: { Title: calibration ? 'ScanBin alignment test' : 'ScanBin labels', Creator: 'ScanBin' },
  })

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${calibration ? 'alignment-test' : 'labels'}.pdf"`)
  doc.pipe(res)

  const cellOrigin = (i) => {
    const col = i % t.cols
    const row = Math.floor(i / t.cols)
    return [
      (t.marginLeft + col * t.pitchX) * PT + ox,
      (t.marginTop + row * t.pitchY) * PT + oy,
    ]
  }

  if (calibration) {
    doc.addPage()
    for (let i = 0; i < perSheet; i++) drawCalibrationCell(doc, t, ...cellOrigin(i), i)
  } else {
    let sheet = 0
    while (queue.length) {
      doc.addPage()
      for (let i = 0; i < perSheet && queue.length; i++) {
        if (sheet === 0 && skip.has(i)) continue
        const [x, y] = cellOrigin(i)
        if (outline) {
          doc.lineWidth(0.3).strokeColor('#bbbbbb')
            .roundedRect(x, y, t.labelWidth * PT, t.labelHeight * PT, t.cornerRadius * PT).stroke()
        }
        drawLocationLabel(doc, t, x, y, queue.shift(), baseUrl)
      }
      sheet++
    }
  }

  doc.end()
})

// ── Frontend ──────────────────────────────────────────────────────────────────

app.use(express.static(join(__dirname, 'dist')))
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => console.log(`Inventory server running on port ${PORT}`))
