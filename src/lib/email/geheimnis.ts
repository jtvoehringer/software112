// ── Geheimnisse in tenant_einstellungen (Sicherheit S11, 23.9.2026) ───────────
// Brevo-API-Key, SumUp-API-Key und bawb-Passwort lagen bisher im Klartext in der
// Datenbank. Jetzt verschlüsselt (AES-256-GCM, EMAIL_CRYPT_SECRET_V2) wie die
// E-Mail-/M365-Zugangsdaten. Altbestand im Klartext wird weiterhin gelesen und beim
// nächsten Speichern bzw. mit dem Schlüsseltausch im Systembericht verschlüsselt.
import { decryptPass, encryptPass, istV2 } from '@/lib/email/crypto'

/** Platzhalter, der statt eines hinterlegten Schlüssels an den Browser geht. */
export const GEHEIM_MASKE = '__hinterlegt__'

/** Nur serverseitig: Klartext aus DB-Wert (verschlüsselt oder Altbestand). */
export function geheimLesen(wert: string | null | undefined): string | null {
  if (!wert) return null
  return istV2(wert) ? decryptPass(wert) : wert
}

/** Für Formulare, die den Wert nicht anzeigen sollen (API-Keys). */
export function geheimMaskiert(wert: string | null | undefined): string | null {
  return wert ? GEHEIM_MASKE : null
}

/**
 * Wert aus einem Formular für die Datenbank aufbereiten.
 * undefined = unverändert lassen (Maske zurückgeschickt), null = löschen, sonst verschlüsselt.
 */
export function geheimSpeichern(roh: FormDataEntryValue | null): string | null | undefined {
  if (roh === null) return undefined
  const s = String(roh).trim()
  if (s === GEHEIM_MASKE) return undefined
  if (!s) return null
  return encryptPass(s)
}

/**
 * KAN-135: Feld für ein Update/Upsert – Maske (unverändert) lässt die Spalte ganz weg,
 * leer = löschen (null), sonst verschlüsselt. Nie `geheimSpeichern(…) ?? null` schreiben:
 * das macht aus „unverändert“ ein Löschen.
 */
export function geheimFeld<K extends string>(spalte: K, roh: FormDataEntryValue | null): Partial<Record<K, string | null>> {
  const wert = geheimSpeichern(roh)
  return wert === undefined ? {} : ({ [spalte]: wert } as Partial<Record<K, string | null>>)
}
