// lib/email/crypto.ts – symmetrische Verschlüsselung für Zugangsdaten (Postfach-Passwörter, Tokens)
//
// Sicherheits-Welle 1 (23.9.2026, Befund S2): Es gibt keinen Ersatzschlüssel mehr im
// Quellcode. Fehlt EMAIL_CRYPT_SECRET, schlägt jede Ver-/Entschlüsselung mit einer klaren
// Meldung fehl, statt still mit einem öffentlich bekannten Schlüssel zu arbeiten.
// Der Schlüssel wird erst beim ersten Gebrauch abgeleitet (nicht beim Import), damit der
// Build ohne die Variable weiterhin durchläuft.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'crypto'

let KEY: Buffer | null = null

function geheimnis(): string {
  const s = process.env.EMAIL_CRYPT_SECRET
  if (!s || s.length < 16) {
    throw new Error('EMAIL_CRYPT_SECRET fehlt oder ist zu kurz (mind. 16 Zeichen) – Zugangsdaten können nicht ver- oder entschlüsselt werden.')
  }
  return s
}

function schluessel(): Buffer {
  if (!KEY) KEY = scryptSync(geheimnis(), 'salt', 32)
  return KEY
}

export function encryptPass(plain: string): string {
  const iv   = randomBytes(16)
  const ciph = createCipheriv('aes-256-cbc', schluessel(), iv)
  const enc  = Buffer.concat([ciph.update(plain, 'utf8'), ciph.final()])
  return iv.toString('hex') + ':' + enc.toString('hex')
}

export function decryptPass(enc: string): string {
  const [ivHex, dataHex] = enc.split(':')
  const iv     = Buffer.from(ivHex, 'hex')
  const data   = Buffer.from(dataHex, 'hex')
  const deciph = createDecipheriv('aes-256-cbc', schluessel(), iv)
  return Buffer.concat([deciph.update(data), deciph.final()]).toString('utf8')
}

/** Zweckgebundener Unterschlüssel (z. B. zum Signieren des OAuth-State), abgeleitet aus EMAIL_CRYPT_SECRET */
export function unterschluessel(zweck: string): Buffer {
  return createHmac('sha256', geheimnis()).update(`s112:${zweck}`).digest()
}
