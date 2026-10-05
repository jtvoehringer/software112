// ── Lese und Pressung: Pflichtangaben und Sperre (KAN-205, 05.10.2026; Matrix KAN-85) ───────────────────────────────
//
// Lese: Ried/GST, Lesedatum, Menge (> 0 kg) und Mostgewicht sind Pflicht – das Mostgewicht auch bei Lesegut, das
// später als Trauben verkauft wird (Entscheidung Jörgen 05.10.2026: beim Lesen weiß man das oft noch nicht). Die
// Rebsorte kommt aus dem Grundstück. Ist ein Lese-Eintrag verpresst oder als Trauben verkauft, bleiben Ort,
// Lesedatum, Qualität und Herkunft fest (DB-Trigger a_freeze auf ernte_parzellen); die Menge darf nur so geändert
// werden, dass das Verpresste/Verkaufte gedeckt bleibt (pruefeLesemengeGedeckt).
// Pressung: mindestens eine Trauben- und eine Behälterzeile; Rebsorte und Mostgewicht je Traubenzeile (neue bzw.
// geänderte Zeilen; unveränderte Altzeilen blockieren nicht). Hängt an einer Charge der Pressung eine Folgebuchung,
// sind Kopf und Traubenzeilen fest (DB-Trigger a_freeze auf pressungen und pressung_weingaerten) – Korrektur per
// Storno der Folgebuchungen bzw. durch die Betriebsleitung (s112_freeze_korrektur).
// Isomorph, ohne '@/'-Importe (node:test).

/** Gründe der DB-Sperren – dieselben Texte stehen in den Triggern (Migration kan205) */
export const LESE_FREEZE_GRUND = 'Lese verpresst bzw. als Trauben verkauft'
export const PRESSUNG_FREEZE_GRUND = 'Folgebuchung an einer Charge der Pressung'

/** Positivlisten der Trigger */
export const LESE_FREEZE_ERLAUBT = [
  'menge_kg', 'menge_hl', 'klosterneuburger', 'oechsle', 'mostgewicht_einheit', 'lesemethode', 'notizen', 'weinbezeichnung',
  'storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund',
] as const
export const PRESSUNG_FREEZE_ERLAUBT = ['notizen', 'storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund'] as const

/** Fehlende Pflichtangaben eines Lese-Eintrags; null = vollständig */
export function lesePflichtFehler(w: { ort: boolean; datum: string | null; mengeKg: number | null; kmw: number | null }, bezeichnung = ''): string | null {
  const fehlt: string[] = []
  if (!w.ort) fehlt.push('Ried bzw. Grundstück')
  if (!(w.datum ?? '').trim()) fehlt.push('Lesedatum')
  if (w.mengeKg == null || !Number.isFinite(w.mengeKg) || w.mengeKg <= 0) fehlt.push('Menge (kg, größer als 0)')
  if (w.kmw == null || !Number.isFinite(w.kmw)) fehlt.push('Mostgewicht')
  if (fehlt.length === 0) return null
  return `${bezeichnung ? `${bezeichnung}: ` : ''}Bitte noch angeben: ${fehlt.join(', ')}.`
}

/** Fehlende Angaben einer Traubenzeile der Pressung; null = vollständig */
export function traubenzeilePflichtFehler(w: { nr: number; rebsorte: string | null; kmw: number | null }): string | null {
  const fehlt: string[] = []
  if (!(w.rebsorte ?? '').trim()) fehlt.push('Rebsorte (kommt aus dem Grundstück bzw. Trauben-Zukauf – bitte dort pflegen)')
  if (w.kmw == null || !Number.isFinite(w.kmw)) fehlt.push('Mostgewicht')
  return fehlt.length === 0 ? null : `Traubenzeile ${w.nr}: Bitte noch angeben: ${fehlt.join(', ')}.`
}

/** Pressung braucht mindestens eine Trauben- und eine Behälterzeile; null = in Ordnung */
export function pressungZeilenFehler(trauben: number, behaelter: number): string | null {
  if (trauben < 1) return 'Bitte mindestens eine Traubenzeile angeben (Ried/GST aus der Lese oder Trauben-Zukauf).'
  if (behaelter < 1) return 'Bitte mindestens eine Behälterzeile angeben (Behälter und Mostmenge).'
  return null
}

/** Meldung, wenn Ort, Qualität oder Herkunft eines verpressten bzw. verkauften Lese-Eintrags geändert werden sollen */
export const LESE_FEST_MELDUNG = 'Diese Lese ist bereits verpresst bzw. als Trauben verkauft – Ried/GST, Lesedatum, Qualität und Herkunft bleiben fest. '
  + 'Ist eine Angabe falsch, bitte zuerst die Pressung bzw. den Traubenverkauf korrigieren oder stornieren.'
