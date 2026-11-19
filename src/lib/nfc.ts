// Web NFC helpers. Web NFC is only available in Chrome on Android, and only on
// secure origins (HTTPS, localhost, or an origin allow-listed in chrome://flags).
// Cheap "RFID stickers" are almost always NFC Forum tags (NTAG213/215/216),
// which this reads and writes as standard NDEF records.

// Minimal typings — Web NFC isn't in TypeScript's DOM lib yet.
interface NDEFRecordInit { recordType: string; data?: string | BufferSource; mediaType?: string }
interface NDEFMessageInit { records: NDEFRecordInit[] }
interface NDEFRecord { recordType: string; mediaType?: string; data?: DataView; encoding?: string }
interface NDEFReadingEvent extends Event { serialNumber: string; message: { records: NDEFRecord[] } }
interface NDEFReaderInstance extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>
  write(message: NDEFMessageInit | string, options?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>
  makeReadOnly(options?: { signal?: AbortSignal }): Promise<void>
  onreading: ((event: NDEFReadingEvent) => void) | null
  onreadingerror: ((event: Event) => void) | null
}
declare global {
  interface Window { NDEFReader?: { new (): NDEFReaderInstance } }
}

export type NfcSupport =
  | { ok: true }
  | { ok: false; reason: 'insecure' | 'unsupported' }

export function nfcSupport(): NfcSupport {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' }
  // On insecure origins Chrome hides NDEFReader entirely, so check this first
  // to give a more useful message.
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' }
  if (!window.NDEFReader) return { ok: false, reason: 'unsupported' }
  return { ok: true }
}

/** Writes a single URL record. Resolves once a tag has been written. */
export async function writeNfcUrl(url: string, opts: { lock?: boolean; signal?: AbortSignal } = {}) {
  const reader = new window.NDEFReader!()
  await reader.write({ records: [{ recordType: 'url', data: url }] }, { overwrite: true, signal: opts.signal })
  // Tag is still against the phone at this point, so locking needs no second tap
  if (opts.lock) await reader.makeReadOnly({ signal: opts.signal })
}

export interface NfcReadResult {
  serialNumber: string
  /** First URL or text record found, if any */
  value: string | null
}

/** Waits for one tag tap and returns its first URL/text record and serial number. */
export function readNfcOnce(signal: AbortSignal): Promise<NfcReadResult> {
  return new Promise((resolve, reject) => {
    const reader = new window.NDEFReader!()
    reader.onreading = (event) => {
      let value: string | null = null
      for (const record of event.message.records) {
        if ((record.recordType === 'url' || record.recordType === 'text' || record.recordType === 'absolute-url') && record.data) {
          value = new TextDecoder(record.encoding || 'utf-8').decode(record.data)
          break
        }
      }
      resolve({ serialNumber: event.serialNumber, value })
    }
    reader.onreadingerror = () => reject(new Error("Couldn't read that tag — try holding it still against the phone"))
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    reader.scan({ signal }).catch(reject)
  })
}

/** Turns Web NFC errors into something a person can act on. */
export function nfcErrorMessage(e: unknown): string {
  const err = e as { name?: string; message?: string }
  if (err?.name === 'NotAllowedError') return 'NFC permission was denied. Allow NFC for this site in Chrome settings.'
  if (err?.name === 'NotSupportedError') return 'NFC is off or not available. Turn on NFC in Android settings.'
  if (err?.name === 'NetworkError') return 'Lost contact with the tag — hold it steady and try again.'
  return err?.message || 'NFC operation failed'
}
