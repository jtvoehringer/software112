// lib/email/crypto.ts – symmetrische Verschlüsselung für Zugangsdaten (Postfach-Passwörter, Tokens)
//
// Sicherheits-Welle 1 (23.9.2026, S2): kein Ersatzschlüssel mehr im Quellcode.
// Sicherheits-Welle 2 (23.9.2026, S2b): neues Format v2 mit AES-256-GCM (Integritätsschutz)
// und neuem Schlüssel EMAIL_CRYPT_SECRET_V2.
//
//   Alt (v1):  "<iv hex>:<daten hex>"                  AES-256-CBC, Schlüssel EMAIL_CRYPT_SECRET
//   Neu (v2):  "v2:<iv hex>:<tag hex>:<daten hex>"     AES-256-GCM, Schlüssel EMAIL_CRYPT_SECRET_V2
//
// Übergang: Ist EMAIL_CRYPT_SECRET_V2 gesetzt, wird nur noch v2 geschrieben; gelesen wird
// beides. Der Schlüsseltausch unter Administration → Systembericht schreibt alle
// v1-Werte einmalig als v2 neu. Danach kann EMAIL_CRYPT_SECRET entfernt werden.
// Schlüssel werden erst beim ersten Gebrauch abgeleitet (nicht beim Import), damit der
// Build ohne die Variablen durchläuft.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'crypto'

const V2 = 'v2:'
let KEY_V1: Buffer | null = null
let KEY_V2: Buffer | null = null

function secretV1(): string {
  const s = process.env.EMAIL_CRYPT_SECRET
  if (!s || s.length < 16) throw new Error('EMAIL_CRYPT_SECRET fehlt oder ist zu kurz – alte Zugangsdaten (v1) können nicht entschlüsselt werden.')
  return s
}
function secretV2(): string | null {
  const s = process.env.EMAIL_CRYPT_SECRET_V2
  if (!s) return null
  if (s.length < 32) throw new Error('EMAIL_CRYPT_SECRET_V2 ist zu kurz (mind. 32 Zeichen).')
  return s
}
function schluesselV1(): Buffer {
  if (!KEY_V1) KEY_V1 = scryptSync(secretV1(), 'salt', 32)
  return KEY_V1
}
function schluesselV2(): Buffer {
  const s = secretV2()
  if (!s) throw new Error('EMAIL_CRYPT_SECRET_V2 fehlt – Zugangsdaten im Format v2 können nicht entschlüsselt werden.')
  if (!KEY_V2) KEY_V2 = scryptSync(s, 's112-aes-256-gcm-v2', 32)
  return KEY_V2
}

/** Ist der neue Schlüssel konfiguriert? (dann wird v2 geschrieben) */
export function v2Aktiv(): boolean {
  return !!secretV2()
}

/** Ist ein gespeicherter Wert schon im neuen Format? */
export function istV2(enc: string | null | undefined): boolean {
  return typeof enc === 'string' && enc.startsWith(V2)
}

export function encryptPass(plain: string): string {
  if (v2Aktiv()) {
    const iv = randomBytes(12)
    const ciph = createCipheriv('aes-256-gcm', schluesselV2(), iv)
    const enc = Buffer.concat([ciph.update(plain, 'utf8'), ciph.final()])
    return `${V2}${iv.toString('hex')}:${ciph.getAuthTag().toString('hex')}:${enc.toString('hex')}`
  }
  const iv   = randomBytes(16)
  const ciph = createCipheriv('aes-256-cbc', schluesselV1(), iv)
  const enc  = Buffer.concat([ciph.update(plain, 'utf8'), ciph.final()])
  return iv.toString('hex') + ':' + enc.toString('hex')
}

export function decryptPass(enc: string): string {
  if (istV2(enc)) {
    const [ivHex, tagHex, dataHex] = enc.slice(V2.length).split(':')
    const deciph = createDecipheriv('aes-256-gcm', schluesselV2(), Buffer.from(ivHex, 'hex'))
    deciph.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([deciph.update(Buffer.from(dataHex, 'hex')), deciph.final()]).toString('utf8')
  }
  const [ivHex, dataHex] = enc.split(':')
  const deciph = createDecipheriv('aes-256-cbc', schluesselV1(), Buffer.from(ivHex, 'hex'))
  return Buffer.concat([deciph.update(Buffer.from(dataHex, 'hex')), deciph.final()]).toString('utf8')
}

/** Zweckgebundener Unterschlüssel (z. B. zum Signieren des OAuth-State); nimmt den neuen Schlüssel, sobald gesetzt */
export function unterschluessel(zweck: string): Buffer {
  return createHmac('sha256', secretV2() ?? secretV1()).update(`s112:${zweck}`).digest()
}
