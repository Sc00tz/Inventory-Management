import type { Location, Product, InventoryItem, InventoryWithProduct } from '../types'

const BASE = '/api'

// Generic fetch wrapper — throws on non-2xx responses
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return res.json()
}

// ── Locations ─────────────────────────────────────────────────────────────────

export function getLocations(): Promise<Location[]> {
  return req('GET', '/locations')
}

export function getLocation(id: string): Promise<Location | null> {
  return req<Location>('GET', `/locations/${id}`).catch(() => null)
}

// Resolves the first 8 chars of a UUID (used by QR short links)
export function getLocationByShortId(shortId: string): Promise<Location | null> {
  return req<Location>('GET', `/locations/short/${shortId}`).catch(() => null)
}

export function getLocationByBarcode(barcode: string): Promise<Location | null> {
  return req<Location>('GET', `/locations/barcode/${encodeURIComponent(barcode)}`).catch(() => null)
}

export function createLocation(data: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>): Promise<Location> {
  return req('POST', '/locations', data)
}

export function updateLocation(id: string, data: Partial<Location>): Promise<Location> {
  return req('PUT', `/locations/${id}`, data)
}

export function deleteLocation(id: string): Promise<void> {
  return req('DELETE', `/locations/${id}`)
}

// ── Products ──────────────────────────────────────────────────────────────────

export function getProducts(): Promise<Product[]> {
  return req('GET', '/products')
}

export function getProductByBarcode(barcode: string): Promise<Product | null> {
  return req<Product>('GET', `/products/barcode/${encodeURIComponent(barcode)}`).catch(() => null)
}

export function createProduct(data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> {
  return req('POST', '/products', data)
}

export function updateProduct(id: string, data: Partial<Product>): Promise<Product> {
  return req('PUT', `/products/${id}`, data)
}

export function deleteProduct(id: string): Promise<void> {
  return req('DELETE', `/products/${id}`)
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export function getInventoryForLocation(locationId: string): Promise<InventoryWithProduct[]> {
  return req('GET', `/inventory/${locationId}`)
}

// Returns { [locationId]: itemCount } for every location in one request.
// Used by the home page tree to display per-location counts without N+1 fetches.
export function getInventoryCounts(): Promise<Record<string, number>> {
  return req('GET', '/inventory-counts')
}

// Adjusts quantity by delta (positive = add, negative = remove).
// The server deletes the row if quantity reaches 0.
export function upsertInventoryItem(locationId: string, productId: string, delta: number): Promise<InventoryItem> {
  return req('POST', '/inventory/upsert', { locationId, productId, delta })
}

// Sets quantity to an exact value. Returns null when the row was deleted (qty ≤ 0).
export async function setInventoryQuantity(id: string, quantity: number): Promise<InventoryItem | null> {
  const result = await req<InventoryItem & { deleted?: boolean }>('PUT', `/inventory/${id}/quantity`, { quantity })
  return result.deleted ? null : result
}

export function removeInventoryItem(id: string): Promise<void> {
  return req('DELETE', `/inventory/${id}`)
}

// ── External barcode lookup ───────────────────────────────────────────────────
// Tries three APIs in order: Open Food Facts (food/drink), Open Beauty Facts
// (cosmetics/household), then UPC Item DB (broad US coverage, 100 req/day on
// the free tier). Returns null if none recognise the barcode.

export interface OFFProduct {
  name: string
  brand: string | null
  imageUrl: string | null
}

export async function lookupBarcode(barcode: string): Promise<OFFProduct | null> {
  // 1. Open Food Facts
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`)
    if (res.ok) {
      const data = await res.json()
      if (data.status === 1) {
        const p = data.product
        const name = p.product_name || p.product_name_en || ''
        if (name) return { name, brand: p.brands || null, imageUrl: p.image_front_thumb_url || p.image_url || null }
      }
    }
  } catch { /* fall through to next source */ }

  // 2. Open Beauty Facts
  try {
    const res = await fetch(`https://world.openbeautyfacts.org/api/v0/product/${barcode}.json`)
    if (res.ok) {
      const data = await res.json()
      if (data.status === 1) {
        const p = data.product
        const name = p.product_name || ''
        if (name) return { name, brand: p.brands || null, imageUrl: p.image_front_thumb_url || null }
      }
    }
  } catch { /* fall through to next source */ }

  // 3. UPC Item DB
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`)
    if (res.ok) {
      const data = await res.json()
      const item = data.items?.[0]
      if (item?.title) return {
        name: item.title,
        brand: item.brand || null,
        imageUrl: item.images?.[0] || null,
      }
    }
  } catch { /* fall through */ }

  return null
}
