import { useQuery } from '@tanstack/react-query'
import { getSettings } from './api'

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 60_000 })
}

/** The configured public base URL, or the current browser origin as a fallback. */
export function resolveBaseUrl(publicBaseUrl?: string | null): string {
  if (publicBaseUrl) return publicBaseUrl
  return typeof window !== 'undefined' ? window.location.origin : ''
}

/** Short link printed on QR labels and written to NFC tags. */
export function locationShortUrl(base: string, locationId: string): string {
  return `${base}/l/${locationId.slice(0, 8)}`
}

/** True when a URL points at this machine only — phones can't open it. */
export function isLocalOnly(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}
