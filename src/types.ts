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
  /** Sub-items (e.g. a single sleeve) may have no barcode of their own */
  barcode: string | null
  name: string
  brand: string | null
  imageUrl: string | null
  /** Sub-item this product contains (e.g. box → sleeve) */
  childProductId?: string | null
  /** How many of the sub-item one of these contains (e.g. 18) */
  packSize?: number | null
  /** The sub-item product; included by the barcode lookup and create/update */
  child?: Product | null
  /** Set when this product is another product's sub-item (from GET /products) */
  parentId?: string | null
  parentName?: string | null
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

/** The box a sub-item comes in, as joined onto inventory rows. */
export interface ParentInfo {
  id: string
  barcode: string | null
  name: string
  brand: string | null
  imageUrl: string | null
  /** Sub-items per box */
  perParent: number
}

/** InventoryItem with its product data joined in (not stored — fetched on read). */
export interface InventoryWithProduct extends InventoryItem {
  product: Product
  /** Set when the product is a sub-item; the box count is derived from quantity */
  parent: ParentInfo | null
}

/** Sub-item definition sent when creating/updating a product. */
export interface SubItemInput {
  name: string
  barcode?: string | null
  perParent: number
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
  barcode: string | null
  name: string
  brand: string | null
  imageUrl: string | null
  /** Box this item comes in, if it's a sub-item */
  parentName: string | null
  parentPackSize: number | null
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
