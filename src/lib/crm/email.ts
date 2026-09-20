// E-Mail-Felder bereinigen und prüfen (20.9.2026) – client-sicher.
//
// Anlass: Nach dem Dynamics-Import standen bei Gebeshuber in 48 Datensätzen
// Anzeigenamen („Josh Greene <jgreene@…>“), mehrere Adressen in einem Feld
// („info@wottle.at  und   technik@wottle.at“), Telefonnummern oder Web-Adressen
// im E-Mail-Feld. Ab jetzt wird beim Speichern von Kontakten und Firmen:
//   * aus „Name <adresse>“ die Adresse herausgelöst,
//   * bei mehreren Adressen im Standardfeld die erste als Standard und der Rest
//     als weitere Adressen übernommen (Migration 211, email_weitere),
//   * alles klein geschrieben und dedupliziert,
//   * eine Eingabe ohne gültige Adresse mit klarer Meldung abgelehnt.

export const EMAIL_RE = /^[a-z0-9._%+'&-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i

/** Alle gültigen Adressen aus einem freien Text, in Reihenfolge, klein, ohne Doppelte. */
export function emailsAusText(roh: string | null | undefined): string[] {
  const text = (roh ?? '').trim()
  if (!text) return []
  const out: string[] = []
  const add = (e: string) => { const k = e.trim().toLowerCase(); if (k && EMAIL_RE.test(k) && !out.includes(k)) out.push(k) }
  // „Name <adresse>“ zuerst
  for (const m of text.matchAll(/<([^<>]+)>/g)) add(m[1])
  const ohneKlammern = text.replace(/<[^<>]+>/g, ' ')
  // Trenner: Komma, Strichpunkt, Doppelpunkt, Schrägstrich, Leerraum („und“ fällt als Token durch)
  for (const t of ohneKlammern.split(/[,;:/\s]+/)) add(t)
  return out
}

/** Text enthält neben Adressen noch anderes (z.B. „max aigner@aon.at“) – außer bei „Name <adresse>“ und Füllwörtern. */
function hatFremdtext(roh: string): boolean {
  if (/<[^<>]+>/.test(roh)) return false
  return roh.split(/[,;:/\s]+/).some(t => t && !t.includes('@') && !/^(und|oder|bzw\.?|&)$/i.test(t))
}

export type EmailFelder = { email: string | null; email_weitere: string[]; fehler?: string }

/** Standard- und Weitere-Feld eines Formulars → gespeicherte Werte oder Fehlermeldung. */
export function pruefeEmailFelder(standardRoh: string | null | undefined, weitereRoh: string | null | undefined): EmailFelder {
  const std = (standardRoh ?? '').trim()
  const ausStd = emailsAusText(std)
  if (std && (ausStd.length === 0 || hatFremdtext(std))) {
    return { email: null, email_weitere: [], fehler: `„${std}“ ist keine gültige E-Mail-Adresse.` }
  }
  const weitereText = (weitereRoh ?? '').trim()
  const ausWeitere = emailsAusText(weitereText)
  // Ungültige Reste im Weitere-Feld finden (alles, was ein @ enthält, aber nicht erkannt wurde)
  const reste = weitereText.split(/[,;\s]+/).map(t => t.trim().toLowerCase()).filter(t => t.includes('@') && !ausWeitere.includes(t.replace(/^<|>$/g, '')))
  if (reste.length) {
    return { email: null, email_weitere: [], fehler: `„${reste[0]}“ ist keine gültige E-Mail-Adresse.` }
  }
  const email = ausStd[0] ?? null
  const weitere: string[] = []
  for (const e of [...ausStd.slice(1), ...ausWeitere]) if (e !== email && !weitere.includes(e)) weitere.push(e)
  return { email, email_weitere: weitere }
}

/** Eine einzelne Adresse (z.B. „E-Mail hinzufügen“) – null, wenn ungültig. */
export function einzelneEmail(roh: string | null | undefined): string | null {
  const alle = emailsAusText(roh)
  return alle.length === 1 ? alle[0] : null
}
