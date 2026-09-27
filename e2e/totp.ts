// ── TOTP-Code (RFC 6238) für die Zwei-Faktor-Anmeldung im Test ────────────────
//
// Supabase-TOTP: SHA-1, 6 Stellen, 30 Sekunden, Geheimnis Base32 (so, wie es die
// Einrichtung auf /zwei-faktor als Text anzeigt). Nur node:crypto – kein Zusatzpaket.

import { createHmac } from 'node:crypto'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Dekodieren(geheimnis: string): Buffer {
  const s = geheimnis.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let wert = 0
  const bytes: number[] = []
  for (const z of s) {
    const i = BASE32.indexOf(z)
    if (i < 0) throw new Error('TOTP-Geheimnis ist kein gültiges Base32')
    wert = (wert << 5) | i
    bits += 5
    if (bits >= 8) {
      bytes.push((wert >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** HOTP-Wert für einen Zähler (RFC 4226) */
export function hotp(schluessel: Buffer, zaehler: number, stellen = 6): string {
  const puffer = Buffer.alloc(8)
  puffer.writeBigUInt64BE(BigInt(zaehler))
  const hmac = createHmac('sha1', schluessel).update(puffer).digest()
  const off = hmac[hmac.length - 1] & 0x0f
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]
  return String(bin % 10 ** stellen).padStart(stellen, '0')
}

export function totp(geheimnis: string, jetztMs: number = Date.now(), periode = 30): string {
  return hotp(base32Dekodieren(geheimnis), Math.floor(jetztMs / 1000 / periode))
}

/** Sekunden bis zum nächsten Codewechsel */
export function restSekunden(jetztMs: number = Date.now(), periode = 30): number {
  return periode - (Math.floor(jetztMs / 1000) % periode)
}
