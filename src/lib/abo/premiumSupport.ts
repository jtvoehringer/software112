// ── Premium-Support als Zusatzpaket (KAN-226, 08.10.2026) ────────────────────────────────────────────────
//
// Entscheidungen Jörgen (Kommentar KAN-226): 79 € netto je Monat, monatlich kündbar zum Monatsende, in allen
// Paketen buchbar und in keinem enthalten; Reaktionszeit 2–4 Stunden Mo–Fr 09:00–17:00; Kanäle Telefon und
// Jira (Support-Anfrage, KAN-230); vorerst kein Kontingent.
//
// Kennzeichen am Betrieb: tenants.premium_support_seit / premium_support_bis (Datum, bis = letzter Tag mit
// Premium-Support; NULL = unbefristet). Bis Stripe steht (KAN-11), setzt der Plattform-Admin beides in
// Administration → Mandanten; danach der Stripe-Webhook.
//
// Bewusst frei von Server-Importen (wird auch in Client-Komponenten verwendet).

import { lokalerTag, wienJetzt } from '@/lib/datum/wien'

export const PREMIUM_SUPPORT = {
  preisMonatNetto: 79,
  reaktionszeit: '2 bis 4 Stunden',
  servicezeiten: 'Montag bis Freitag, 09:00–17:00 Uhr',
  kanaele: ['Telefon', 'Support-Anfrage (Jira)'],
  leistungen: [
    'Reaktion innerhalb von 2 bis 4 Stunden (Mo–Fr 09:00–17:00)',
    'Telefon-Support – wir legen die Anfrage für Sie an',
    'Support-Anfragen mit Link zum Bearbeitungsstand per E-Mail',
    'Monatlich kündbar zum Monatsende',
  ],
} as const

/**
 * Kontakt für den Support – aus Vercel-Umgebungsvariablen, damit Nummer und Adresse ohne Code-Änderung wechseln.
 * KAN-449 (13.11.2026): Die Telefonnummer sehen nur Betriebe mit gebuchtem Premium-Support – sie steht deshalb in der
 * serverseitigen Variable SUPPORT_TELEFON (kommt nie ins Browser-Paket); NEXT_PUBLIC_SUPPORT_TELEFON bleibt als
 * Rückfall für bestehende Einrichtungen. Vorerst Jörgens Nummer, später die Nummer mit KI-Annahme.
 */
export function supportKontakt(env: Record<string, string | undefined> = process.env): { telefon: string | null; email: string | null } {
  const telefon = (env.SUPPORT_TELEFON ?? '').trim() || (env.NEXT_PUBLIC_SUPPORT_TELEFON ?? '').trim()
  const email = (env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '').trim()
  return { telefon: telefon || null, email: email || null }
}

/** Nummer für einen tel:-Verweis: nur + und Ziffern (Leerzeichen, Punkte und Klammern fallen weg) */
export function telefonVerweis(nummer: string): string {
  return `tel:${nummer.replace(/[^+\d]/g, '')}`
}

export type PremiumSupportZeitraum = { seit: string | null; bis: string | null }

export type PremiumSupportStand =
  | { status: 'ohne' }
  | { status: 'geplant'; seit: string; bis: string | null }
  | { status: 'aktiv'; seit: string; bis: string | null }
  | { status: 'beendet'; seit: string; bis: string }

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/

function tag(v: string | null | undefined): string | null {
  if (!v) return null
  const s = String(v).slice(0, 10)
  return ISO_TAG.test(s) ? s : null
}

/** Heute als 'JJJJ-MM-TT' in Wiener Zeit */
export function heuteWien(jetzt: Date = new Date()): string {
  return lokalerTag(wienJetzt(jetzt))
}

/** Stand des Premium-Supports an einem Tag – „bis“ ist der letzte Tag MIT Premium-Support (inklusive) */
export function premiumSupportStand(z: PremiumSupportZeitraum, heute: string = heuteWien()): PremiumSupportStand {
  const seit = tag(z.seit)
  const bis = tag(z.bis)
  if (!seit) return { status: 'ohne' }
  if (heute < seit) return { status: 'geplant', seit, bis }
  if (bis && heute > bis) return { status: 'beendet', seit, bis }
  return { status: 'aktiv', seit, bis }
}

export function premiumSupportAktiv(z: PremiumSupportZeitraum, heute: string = heuteWien()): boolean {
  return premiumSupportStand(z, heute).status === 'aktiv'
}

/** Kündigung wirkt zum Ende des laufenden Monats: letzter Tag des Monats von `heute` */
export function kuendigungZumMonatsende(heute: string = heuteWien()): string {
  const [j, m] = heute.split('-').map(Number)
  const letzter = new Date(Date.UTC(j, m, 0)).getUTCDate()
  return `${String(j).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(letzter).padStart(2, '0')}`
}

/** Prüft die Eingabe des Plattform-Admins; leere Felder = kein Premium-Support bzw. unbefristet */
export function premiumSupportEingabeFehler(seitRoh: string, bisRoh: string): string | null {
  const seit = seitRoh.trim()
  const bis = bisRoh.trim()
  if (seit && !tag(seit)) return 'Beginn ist kein gültiges Datum.'
  if (bis && !tag(bis)) return 'Ende ist kein gültiges Datum.'
  if (bis && !seit) return 'Ohne Beginn kein Ende – zuerst den Beginn eintragen.'
  if (seit && bis && bis < seit) return 'Das Ende liegt vor dem Beginn.'
  if (seit && Number.isNaN(Date.parse(seit))) return 'Beginn ist kein gültiges Datum.'
  if (bis && Number.isNaN(Date.parse(bis))) return 'Ende ist kein gültiges Datum.'
  return null
}

/** Anzeige „TT.MM.JJJJ“ ohne Zeitzonen-Umrechnung */
export function tagText(iso: string): string {
  const [j, m, t] = iso.slice(0, 10).split('-')
  return `${t}.${m}.${j}`
}

export function premiumSupportText(stand: PremiumSupportStand): string {
  switch (stand.status) {
    case 'ohne':    return 'Nicht gebucht'
    case 'geplant': return `Ab ${tagText(stand.seit)}${stand.bis ? ` bis ${tagText(stand.bis)}` : ''}`
    case 'aktiv':   return stand.bis ? `Aktiv bis ${tagText(stand.bis)} (gekündigt)` : `Aktiv seit ${tagText(stand.seit)}`
    case 'beendet': return `Beendet am ${tagText(stand.bis)}`
  }
}
