// Quantity helpers for multipacks. When a product has a packSize, its inventory
// quantity is counted in units (e.g. sleeves), and a scan adds a whole package.

interface PackInfo { packSize?: number | null; unitName?: string | null }

export function isMultipack(p: PackInfo): p is { packSize: number; unitName?: string | null } {
  return !!p.packSize && p.packSize > 1
}

function plural(word: string, n: number) {
  if (n === 1) return word
  if (/(s|x|ch|sh)$/i.test(word)) return `${word}es`
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

export function unitLabel(p: PackInfo, n: number) {
  return plural(p.unitName?.trim() || 'unit', n)
}

/** How much one scan / one "package" adds. */
export function unitsPerScan(p: PackInfo) {
  return isMultipack(p) ? p.packSize : 1
}

function fmt(n: number) {
  return Number(n) % 1 === 0 ? String(Math.trunc(Number(n))) : String(n)
}

/**
 * Short count for lists: "36 sleeves" for multipacks, plain number otherwise.
 * `detail` breaks it into packages: "2 packs" or "1 pack + 5".
 */
export function describeQuantity(p: PackInfo, qty: number): { count: string; detail: string | null } {
  if (!isMultipack(p)) return { count: fmt(qty), detail: null }
  const packs = Math.floor(qty / p.packSize)
  const rest = qty - packs * p.packSize
  const count = `${fmt(qty)} ${unitLabel(p, qty)}`
  if (packs === 0) return { count, detail: `opened pack (of ${p.packSize})` }
  const detail = `${packs} ${plural('pack', packs)}${rest ? ` + ${fmt(rest)}` : ''}`
  return { count, detail }
}
