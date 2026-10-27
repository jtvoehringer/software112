// KAN-355 (23.10.2026): Periodensperre für das Rechnungsdatum – reine Regeln ohne Datenbank (isomorph, node:test).
// Die Datenbank lehnt eine Rechnung mit Datum in einem abgeschlossenen Monat (ea_monatsabschluss) oder einem per UVA
// übermittelten Monat/Quartal (ea_uva.gesperrt) ab (Trigger a_ea_periodensperre an rechnungen, gleiche Regel wie
// s112_ea_zeitraum_sperrgrund). Die App prüft vorher über pruefe_ea_zeitraum_offen (rechnungsdatum.ts) und zeigt den
// ersten offenen Tag als Hinweis bzw. als frühestes wählbares Datum.

export type Monatsabschluss = { jahr: number | string; monat: number | string }
export type UvaZeitraum = { jahr: number | string; zeitraum: string; gesperrt?: boolean | null }

const zwei = (n: number) => String(n).padStart(2, '0')

/** 'JJJJ-MM' aller gesperrten Monate: Monatsabschlüsse und gesperrte UVA (Monat '01'…'12' oder Quartal 'Q1'…'Q4') */
export function gesperrteMonate(abschluesse: Monatsabschluss[], uvas: UvaZeitraum[]): Set<string> {
  const s = new Set<string>()
  for (const a of abschluesse) {
    const j = Number(a.jahr), m = Number(a.monat)
    if (Number.isInteger(j) && m >= 1 && m <= 12) s.add(`${j}-${zwei(m)}`)
  }
  for (const u of uvas) {
    if (u.gesperrt === false) continue
    const j = Number(u.jahr)
    if (!Number.isInteger(j)) continue
    const q = /^Q([1-4])$/.exec(u.zeitraum ?? '')
    if (q) {
      const erster = (Number(q[1]) - 1) * 3 + 1
      for (let m = erster; m < erster + 3; m++) s.add(`${j}-${zwei(m)}`)
    } else if (/^(0[1-9]|1[0-2])$/.test(u.zeitraum ?? '')) {
      s.add(`${j}-${u.zeitraum}`)
    }
  }
  return s
}

/** Liegt der Tag (JJJJ-MM-TT) in einem gesperrten Monat? */
export function tagGesperrt(tag: string, gesperrt: Set<string>): boolean {
  return gesperrt.has(tag.slice(0, 7))
}

/**
 * Erster Tag des offenen Zeitraums, in dem „heute“ liegt: vom Monat von heute zurück bis zum ersten gesperrten Monat,
 * Ergebnis der Erste des Monats danach. null, wenn heute selbst gesperrt ist oder in den letzten `monate` Monaten
 * nichts gesperrt ist (dann gibt es keinen sinnvollen Hinweis).
 */
export function ersterOffenerTag(heute: string, gesperrt: Set<string>, monate = 36): string | null {
  let j = Number(heute.slice(0, 4))
  let m = Number(heute.slice(5, 7))
  if (gesperrt.has(`${j}-${zwei(m)}`)) return null
  for (let i = 0; i < monate; i++) {
    const vj = m === 1 ? j - 1 : j
    const vm = m === 1 ? 12 : m - 1
    if (gesperrt.has(`${vj}-${zwei(vm)}`)) return `${j}-${zwei(m)}-01`
    j = vj
    m = vm
  }
  return null
}

/** Vortag von JJJJ-MM-TT (Rechnen über UTC-Mitternacht, KAN-255) */
export function vortag(tag: string): string {
  const d = new Date(`${tag.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`
}

/** min-Wert des Datumsfelds: der spätere von Lieferdatum und erstem offenen Tag (undefined = keine Grenze) */
export function fruehestesDatum(lieferdatum: string | null | undefined, offenAb: string | null | undefined): string | undefined {
  const l = lieferdatum ? lieferdatum.slice(0, 10) : ''
  const o = offenAb ?? ''
  return (l > o ? l : o) || undefined
}

/** TT.MM.JJJJ aus JJJJ-MM-TT (ohne Date – kein Zeitzonenversatz) */
export function datumAt(tag: string): string {
  const [j, m, t] = tag.slice(0, 10).split('-')
  return `${t}.${m}.${j}`
}

/**
 * Meldung wie die der Datenbank („Rechnung mit Datum … nicht möglich: <Grund> …“), ergänzt um den ersten offenen Tag
 * und – beim Verkauf mit sofortiger Rechnung – den Weg über „Rechnung später“.
 */
export function rechnungsdatumMeldung(datum: string, grund: string, offenAb: string | null, mitRechnungSpaeter = false): string {
  const g = grund.trim().replace(/([^.!?])$/, '$1.')
  const teile = [`Rechnung mit Datum ${datumAt(datum)} nicht möglich: ${g}`]
  teile.push(offenAb
    ? `Bitte ein Rechnungsdatum ab ${datumAt(offenAb)} wählen (offener Zeitraum).`
    : 'Bitte ein Rechnungsdatum im offenen Zeitraum wählen.')
  if (mitRechnungSpaeter) teile.push('Soll der Lieferschein dieses Datum behalten, „Rechnung später“ wählen und die Rechnung im offenen Zeitraum erstellen.')
  return teile.join(' ')
}
