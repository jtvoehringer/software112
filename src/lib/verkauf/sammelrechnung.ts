// KAN-104 (08.10.2026): Sammelrechnung – nicht berechnete Lieferscheine je Kunde (ein Empfänger = gleiche kontakt_id und
// firma_id, wie s112_rechnung_erstellen prüft), mit Bruttobetrag je Lieferschein für die Freigabeliste.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type OffenerLieferschein = { id: string; nummer: string | null; datum: string; betrag: number; ohnePreis: boolean }
export type KundeMitLieferscheinen = { schluessel: string; name: string; lieferscheine: OffenerLieferschein[]; summe: number }

/** Bruttobetrag eines Lieferscheins (Positionen ohne Preis zählen nicht – ohnePreis = true, wenn eine fehlt) */
export function lieferscheinBetrag(positionen: readonly R[]): { betrag: number; ohnePreis: boolean } {
  let betrag = 0
  let ohnePreis = false
  for (const p of positionen) {
    if (p.preis_brutto == null) { ohnePreis = true; continue }
    betrag += Number(p.preis_brutto) * Number(p.menge) * (1 - Number(p.rabatt_pct ?? 0) / 100) * (1 - Number(p.sonderrabatt_pct ?? 0) / 100)
  }
  return { betrag: Math.round(betrag * 100) / 100, ohnePreis }
}

/** Lieferscheine (verkaufsposten ohne Rechnung) je Empfänger, Kunden nach Name, Lieferscheine nach Datum und Nummer */
export function offeneLieferscheineJeKunde(zeilen: readonly R[], name: (l: R) => string): KundeMitLieferscheinen[] {
  const je = new Map<string, KundeMitLieferscheinen>()
  for (const l of zeilen) {
    const schluessel = `${l.kontakt_id ?? ''}|${l.firma_id ?? ''}`
    const k = je.get(schluessel) ?? { schluessel, name: name(l), lieferscheine: [], summe: 0 }
    const { betrag, ohnePreis } = lieferscheinBetrag((l.verkauf_positionen ?? []) as R[])
    k.lieferscheine.push({ id: String(l.id), nummer: l.lieferscheinnummer ?? null, datum: String(l.datum), betrag, ohnePreis })
    k.summe = Math.round((k.summe + betrag) * 100) / 100
    je.set(schluessel, k)
  }
  for (const k of je.values()) {
    k.lieferscheine.sort((a, b) => a.datum.localeCompare(b.datum) || String(a.nummer ?? '').localeCompare(String(b.nummer ?? '')))
  }
  return [...je.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}
