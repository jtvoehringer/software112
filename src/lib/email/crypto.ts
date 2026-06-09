// lib/email/crypto.ts – einfache symmetrische Verschlüsselung für Credentials
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const SECRET = process.env.EMAIL_CRYPT_SECRET ?? 'software112-email-fallback-key-32!'
const KEY    = scryptSync(SECRET, 'salt', 32)

export function encryptPass(plain: string): string {
  const iv   = randomBytes(16)
  const ciph = createCipheriv('aes-256-cbc', KEY, iv)
  const enc  = Buffer.concat([ciph.update(plain, 'utf8'), ciph.final()])
  return iv.toString('hex') + ':' + enc.toString('hex')
}

export function decryptPass(enc: string): string {
  const [ivHex, dataHex] = enc.split(':')
  const iv     = Buffer.from(ivHex, 'hex')
  const data   = Buffer.from(dataHex, 'hex')
  const deciph = createDecipheriv('aes-256-cbc', KEY, iv)
  return Buffer.concat([deciph.update(data), deciph.final()]).toString('utf8')
}
