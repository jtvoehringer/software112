// KAN-117 (07.10.2026): Schnellerfassung auf der Behälterseite (Ziel des QR-Codes am Gebinde).
// Inhalt des Gebindes, die letzten Maßnahmen und die Ziele der Kacheln – gemeinsam für Seite und Tests.
// Isomorph und ohne '@/'-Importe (node:test).

export type SchnellCharge = { id: string; name: string | null; menge_liter: number | string | null }

export type Massnahme = {
  key: string
  datum: string
  art: 'behandlung' | 'umzug' | 'filtration' | 'schwund' | 'analyse'
  titel: string
  detail: string | null
  href: string
}

const zahl = (x: unknown): number => {
  const n = typeof x === 'number' ? x : parseFloat(String(x ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Gesamtinhalt der aktiven Chargen (L) */
export function inhaltLiter(chargen: readonly SchnellCharge[]): number {
  return Math.round(chargen.reduce((s, c) => s + zahl(c.menge_liter), 0) * 100) / 100
}

/** Füllgrad in Prozent (ganzzahlig) – null ohne Volumen */
export function fuellgrad(liter: number, volumen: number | string | null | undefined): number | null {
  const v = zahl(volumen)
  if (!(v > 0)) return null
  return Math.round((liter / v) * 100)
}

type Roh = Record<string, unknown>
const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)

/**
 * Die letzten n Maßnahmen am Gebinde, neueste zuerst: Behandlungen (inkl. Notizen), Umzüge, Filtrationen und
 * Schwund dieses Gebindes sowie Analysen seiner Chargen. Stornierte Zeilen erwartet die Funktion schon gefiltert.
 * Bei gleichem Datum gehen Behandlungen vor Umzügen vor Analysen (stabile Reihenfolge).
 */
export function letzteMassnahmen(
  behaelterId: string,
  behandlungen: readonly Roh[],
  umzuege: readonly Roh[],
  analysen: readonly Roh[],
  n = 5,
  fmtLiter: (l: number) => string = l => `${l} L`,
): Massnahme[] {
  const liste: (Massnahme & { rang: number })[] = []
  for (const b of behandlungen) {
    const typ = text((b.typ as Roh | null)?.name) ?? text(b.typ_name_snapshot) ?? 'Behandlung'
    const menge = b.menge != null && b.menge !== '' ? `${zahl(b.menge).toLocaleString('de-DE')} ${text(b.einheit) ?? ''}`.trim() : null
    liste.push({
      key: `b-${b.id}`, datum: String(b.datum ?? ''), art: 'behandlung', titel: typ,
      detail: [menge, text(b.notizen)].filter(Boolean).join(' · ') || null,
      href: `/kellerbuch/behaelter/${behaelterId}/behandlungen`, rang: 0,
    })
  }
  for (const u of umzuege) {
    const typ = String(u.umzug_typ ?? 'normal')
    const art: Massnahme['art'] = typ === 'schwund' ? 'schwund' : typ === 'filtration' ? 'filtration' : 'umzug'
    const raus = String(u.von_behaelter_id ?? '') === behaelterId && String(u.nach_behaelter_id ?? '') !== behaelterId
    const liter = art === 'schwund' ? zahl(u.schwund_liter ?? u.brutto_liter) : zahl(u.menge_liter)
    const titel = art === 'schwund' ? 'Schwund' : art === 'filtration' ? 'Filtration' : raus ? 'Umzug (abgegeben)' : 'Umzug (erhalten)'
    liste.push({
      key: `u-${u.id}`, datum: String(u.datum ?? ''), art, titel,
      detail: [liter > 0 ? fmtLiter(liter) : null, text(u.notizen)].filter(Boolean).join(' · ') || null,
      href: `/kellerbuch/behaelter/${behaelterId}/bewegungen`, rang: 1,
    })
  }
  for (const a of analysen) {
    const werte = [
      a.alkohol_vol != null ? `${zahl(a.alkohol_vol).toLocaleString('de-DE')} % vol` : null,
      a.restzucker_gl != null ? `RZ ${zahl(a.restzucker_gl).toLocaleString('de-DE')} g/L` : null,
      a.gesamtsaeure_gl != null ? `S ${zahl(a.gesamtsaeure_gl).toLocaleString('de-DE')} g/L` : null,
    ].filter(Boolean)
    liste.push({
      key: `a-${a.id}`, datum: String(a.analyse_datum ?? ''), art: 'analyse', titel: 'Analyse',
      detail: werte.join(' · ') || text(a.notizen),
      href: a.weinausbau_id ? `/kellerbuch/weinausbau/${a.weinausbau_id}` : `/kellerbuch/behaelter/${behaelterId}`, rang: 2,
    })
  }
  return liste
    .sort((x, y) => (x.datum < y.datum ? 1 : x.datum > y.datum ? -1 : x.rang - y.rang))
    .slice(0, n)
    .map(({ rang: _rang, ...m }) => m)
}

/** Ziele der Kacheln mit Link (Behandlung, Analyse je Charge, Umziehen) */
export function schnellZiele(behaelterId: string, chargeId: string | null) {
  return {
    behandlung: `/kellerbuch/behaelter/${behaelterId}/behandlungen?neu=1`,
    analyse: chargeId ? `/kellerbuch/weinausbau/${chargeId}/analysen/neu` : null,
    umziehen: `/kellerbuch/umziehen?neu=1&von=${behaelterId}`,
  }
}

/** Schlüssel des Entwurfs im localStorage (je Gebinde und Formular) */
export function entwurfSchluessel(behaelterId: string, formular: 'notiz' | 'schwund'): string {
  return `s112:schnell:${formular}:${behaelterId}`
}

/** Notiz am Gebinde: Text Pflicht, höchstens 500 Zeichen; null = in Ordnung */
export function notizFehler(t: string): string | null {
  const s = t.trim()
  if (!s) return 'Bitte einen Text für die Notiz eingeben.'
  if (s.length > 500) return 'Die Notiz ist zu lang (höchstens 500 Zeichen).'
  return null
}

/** Name des Behandlungstyps für Notizen am Gebinde (Einheit „-“, ohne Wirkung auf die Prüfnummer) */
export const NOTIZ_TYP = 'Notiz'
