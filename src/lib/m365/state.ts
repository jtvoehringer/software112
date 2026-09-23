// ── OAuth-State für die Microsoft-365-Anmeldung (server-only) ─────────────────
// Sicherheits-Welle 1 (23.9.2026, Befund S1): Vorher war der State einfach
// „tenantId:userId“ im Klartext, und der Rückkanal hat weder geprüft, ob der State
// von uns stammt, noch wer angemeldet ist. Ein Angreifer konnte so sein eigenes
// Postfach einem fremden Konto (oder Betrieb) unterschieben.
//
// Jetzt: State = base64url(JSON) + "." + HMAC, mit Zweck, Ablauf (10 min) und
// Einmal-Wert. Der Einmal-Wert liegt zusätzlich in einem HttpOnly-Cookie und muss
// beim Rückkanal übereinstimmen (Bindung an genau diesen Browser); außerdem muss
// die angemeldete Sitzung zum Benutzer im State passen.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { NextResponse } from 'next/server'
import { unterschluessel } from '@/lib/email/crypto'

export type StateZweck = 'betrieb' | 'benutzer'
export type StateInhalt = { tenantId: string; userId: string; zweck: StateZweck }

const COOKIE = 's112_m365_nonce'
const GUELTIG_MS = 10 * 60 * 1000

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sig = (daten: string) => createHmac('sha256', unterschluessel('m365-oauth-state')).update(daten).digest()

/** Liefert den State-String und den Einmal-Wert (für das Cookie) */
export function erzeugeStateWert(inhalt: StateInhalt): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url')
  const daten = b64(JSON.stringify({ t: inhalt.tenantId, u: inhalt.userId, z: inhalt.zweck, n: nonce, e: Date.now() + GUELTIG_MS }))
  return { state: `${daten}.${b64(sig(daten))}`, nonce }
}

/** Einmal-Wert als HttpOnly-Cookie setzen (nur für die Rückkanal-Pfade) */
export function setzeNonceCookie(res: NextResponse, nonce: string): NextResponse {
  res.cookies.set(COOKIE, nonce, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/m365', maxAge: GUELTIG_MS / 1000 })
  return res
}

/** Einmal-Wert-Cookie nach Verwendung löschen */
export function loescheNonceCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/m365', maxAge: 0 })
  return res
}

export const NONCE_COOKIE = COOKIE

/** State prüfen: Signatur, Ablauf, Zweck und Einmal-Wert aus dem Cookie. null = ungültig */
export function pruefeState(state: string | null, nonceCookie: string | undefined, zweck: StateZweck): StateInhalt | null {
  if (!state || !nonceCookie) return null
  const [daten, signatur] = state.split('.')
  if (!daten || !signatur) return null
  let erwartet: Buffer, erhalten: Buffer
  try {
    erwartet = sig(daten)
    erhalten = Buffer.from(signatur, 'base64url')
  } catch { return null }
  if (erhalten.length !== erwartet.length || !timingSafeEqual(erhalten, erwartet)) return null
  try {
    const j = JSON.parse(Buffer.from(daten, 'base64url').toString('utf8')) as { t: string; u: string; z: string; n: string; e: number }
    if (j.z !== zweck || typeof j.e !== 'number' || j.e < Date.now()) return null
    const a = Buffer.from(j.n), b = Buffer.from(nonceCookie)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    if (!j.t || !j.u) return null
    return { tenantId: j.t, userId: j.u, zweck }
  } catch { return null }
}
