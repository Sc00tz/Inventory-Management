// Shared domain types used across the app.
// LocationType is a plain string so users can define custom types
// (e.g. "wine fridge") beyond the built-in defaults.

export type LocationType = string

export interface Location {
  id: string
  /** Stored in the DB's barcode column with a "_p:" prefix — see api.ts encodeRow. */
  parentId: string | null
  name: string
  type: LocationType
  barcode: string | null
  description: string | null
  color: string
  createdAt: string
  updatedAt: string
}

export interface Product {
  id: string
  barcode: string
  name: string
  brand: string | null
  imageUrl: string | null
  /** Units inside one package (e.g. 18 sleeves in a box). null = single item. */
  packSize?: number | null
  /** What one unit is called, e.g. "sleeve". Only used when packSize is set. */
  unitName?: string | null
  createdAt: string
  updatedAt: string
}

export interface InventoryItem {
  id: string
  locationId: string
  productId: string
  quantity: number
  notes: string | null
  addedAt: string
  updatedAt: string
}

/** InventoryItem with its product data joined in (not stored — fetched on read). */
export interface InventoryWithProduct extends InventoryItem {
  product: Product
}

/** One (product, location) match from the full-inventory search endpoint. */
export interface InventorySearchResult {
  inventoryId: string
  quantity: number
  locationId: string
  locationName: string
  locationColor: string
  locationType: LocationType
  productId: string
  barcode: string
  name: string
  brand: string | null
  imageUrl: string | null
  packSize: number | null
  unitName: string | null
}

/** App-wide settings stored server-side. */
export interface Settings {
  /** Address phones use to reach the server, baked into QR codes / NFC tags. Empty = use current browser address. */
  publicBaseUrl: string
  /** Printer nudge for label sheets, in millimetres (+X = right, +Y = down). */
  labelOffsetXmm: number
  labelOffsetYmm: number
}

/** A label sheet layout. All measurements in inches. */
export interface LabelTemplate {
  id: string
  name: string
  pageWidth: number
  pageHeight: number
  cols: number
  rows: number
  labelWidth: number
  labelHeight: number
  marginLeft: number
  marginTop: number
  pitchX: number
  pitchY: number
  cornerRadius: number
}
