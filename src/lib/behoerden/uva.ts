// ── Behördenmeldung „uva“: Umsatzsteuervoranmeldung – Kennzahlen U30 (24.09.2026) ──
//
// Eine Ladefunktion für die Druckseite /buchhaltung/uva UND die CSV (/meldungen/uva/csv):
// je gespeicherter UVA (ea_uva, befüllt über „Berechnen & Speichern“ bzw. RPC
// berechne_ea_uva) eine Zeile je Kennzahl des Formulars U30. Beträge kaufmännisch auf
// 2 Stellen; die Druckseite zeigt genau diese Werte.
// Kz 095: positiv = Vorauszahlung (Zahllast), negativ = Überschuss (Gutschrift) – im
// Formular U30 wird ein Überschuss mit Minus eingetragen.
// Keine elektronische Übermittlung: die CSV dient der Kontrolle bzw. dem Steuerberater.

import { STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { betrag, summe, text } from './buchhaltung-gemeinsam'
import { parameterFehler, type ParameterFehler } from './typen'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const UVA_MONATE = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const ZEITRAUM_RE = /^(Q[1-4]|0[1-9]|1[0-2])$/

/** 'Q1' → 'Q1 2026', '03' → 'Mär 2026' (wie die Überschriften der Druckseite) */
export function uvaZeitraumLabel(zeitraum: string, jahr: number): string {
  if (zeitraum.startsWith('Q')) return `${zeitraum} ${jahr}`
  const m = Number(zeitraum)
  return `${UVA_MONATE[m - 1] ?? zeitraum} ${jahr}`
}

export type UvaSchluessel = 'kz000' | 'kz022' | 'kz029' | 'kz006' | 'ust0' | 'vst20' | 'vst10' | 'vst13' | 'kz060' | 'kz095'

export type UvaKennzahl = {
  schluessel: UvaSchluessel
  jahr: number
  zeitraum: string
  zeitraumLabel: string
  /** Kennzahl des Formulars U30 ('000', '022' …); Vorsteuer-Aufteilung ohne eigene Kennzahl → null */
  kz: string | null
  bezeichnung: string
  bemessungsgrundlage: number | null
  steuer: number | null
  status: string
  /** ea_uva.gesperrt_am (timestamptz) */
  uebermitteltAm: string | null
}

export type UvaMeldung = {
  id: string
  jahr: number
  zeitraum: string
  label: string
  gesperrt: boolean
  gesperrtAm: string | null
  kennzahlen: UvaKennzahl[]
}

/** Status-Text einer UVA (Druck und CSV) */
export function uvaStatus(gesperrt: boolean, doppik: boolean): string {
  if (doppik) return 'Kontroll-Vorschau'
  return gesperrt ? 'Übermittelt' : 'Entwurf'
}

/** Kennzahlen einer gespeicherten UVA (ea_uva-Zeile) – Reihenfolge wie im Formular U30 */
export function uvaKennzahlen(uva: R, doppik: boolean): UvaKennzahl[] {
  const jahr = Number(uva.jahr)
  const zeitraum = String(uva.zeitraum)
  const basis = {
    jahr, zeitraum, zeitraumLabel: uvaZeitraumLabel(zeitraum, jahr),
    status: uvaStatus(!!uva.gesperrt, doppik), uebermitteltAm: text(uva.gesperrt_am),
  }
  const b = (k: string) => betrag(uva[k]) ?? 0
  const kz000 = summe([b('bmgl_ust_0'), b('bmgl_ust_10'), b('bmgl_ust_13'), b('bmgl_ust_20')])
  const zahllast = b('zahllast')
  const z = (schluessel: UvaSchluessel, kz: string | null, bezeichnung: string, bemessungsgrundlage: number | null, steuer: number | null): UvaKennzahl =>
    ({ schluessel, kz, bezeichnung, bemessungsgrundlage, steuer, ...basis })
  return [
    z('kz000', '000', 'Gesamtbetrag der Bemessungsgrundlagen für Lieferungen und sonstige Leistungen', kz000, null),
    z('kz022', '022', '20 % Normalsteuersatz', b('bmgl_ust_20'), b('ust_20')),
    z('kz029', '029', '10 % ermäßigter Steuersatz', b('bmgl_ust_10'), b('ust_10')),
    z('kz006', '006', '13 % ermäßigter Steuersatz', b('bmgl_ust_13'), b('ust_13')),
    // ea_uva kennt nur die Summe zu 0 % – sie enthält Ausfuhren (Kz 011), innergemeinschaftliche
    // Lieferungen (Kz 017) und steuerfreie Inlandsumsätze (Kz 016/020). Ohne Aufteilung nach
    // Steuerfall darf die maschinenlesbare Spalte „Kennzahl“ keine davon behaupten (Review 25.09.2026).
    z('ust0', null, UVA_0_PROZENT_BEZEICHNUNG, b('bmgl_ust_0'), null),
    z('vst20', null, 'Vorsteuer 20 %', null, b('vst_20')),
    z('vst10', null, 'Vorsteuer 10 %', null, b('vst_10')),
    z('vst13', null, 'Vorsteuer 13 %', null, b('vst_13')),
    z('kz060', '060', 'Gesamtbetrag der abziehbaren Vorsteuer', null, b('vst_gesamt')),
    z('kz095', '095', zahllast >= 0 ? 'Vorauszahlung (Zahllast)' : 'Überschuss (Gutschrift)', null, zahllast),
  ]
}

/** Bezeichnung der 0-%-Zeile – ohne Kennzahl, bis ea_uva nach Steuerfall getrennt ist */
export const UVA_0_PROZENT_BEZEICHNUNG = 'Steuerfreie Umsätze (0 %) – Ausfuhr, ig. Lieferung oder steuerfrei; bitte auf Kz 011/017/016/020 aufteilen'

export const SPALTEN_UVA: CsvSpalte<UvaKennzahl>[] = [
  { kopf: 'Jahr', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.jahr },
  { kopf: 'Zeitraum', typ: 'text', wert: z => z.zeitraumLabel },
  { kopf: 'Kennzahl', typ: 'code', wert: z => z.kz },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Bemessungsgrundlage (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.bemessungsgrundlage },
  { kopf: 'Steuer (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.steuer },
  { kopf: 'Status', typ: 'text', wert: z => z.status },
  { kopf: 'Übermittelt am', typ: 'zeitpunkt', wert: z => z.uebermitteltAm },
]

export type UvaParameter = { jahr: number; zeitraum: string | null }

/** ?zeitraum= (optional): Q1–Q4 oder Monat 01–12 */
export function uvaZeitraumAus(sp: URLSearchParams): string | null | ParameterFehler {
  const z = (sp.get('zeitraum') ?? '').trim()
  if (!z) return null
  return ZEITRAUM_RE.test(z) ? z : parameterFehler(`Ungültiger UVA-Zeitraum „${z.slice(0, 10)}“ – erwartet Q1–Q4 oder 01–12.`)
}

/**
 * UVA-Kennzahlen eines Jahres (optional nur ein Zeitraum). `doppik` aus der Druckseite
 * übernehmen, sonst aus tenant_einstellungen.buchhaltungsart lesen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeUva(supabase: any, tenantId: string, p: UvaParameter, opts: { doppik?: boolean } = {}): Promise<{ zeilen: UvaKennzahl[]; warnungen: string[]; meldungen: UvaMeldung[]; doppik: boolean }> {
  let doppik = opts.doppik
  if (doppik === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: e, error: eErr } = await (supabase.from('tenant_einstellungen') as any)
      .select('buchhaltungsart').eq('tenant_id', tenantId).maybeSingle()
    if (eErr) throw new AktionsFehler(`Laden fehlgeschlagen (tenant_einstellungen): ${eErr.message}`)
    doppik = (e as R | null)?.buchhaltungsart === 'doppik'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('ea_uva') as any)
    .select('id, jahr, zeitraum, bmgl_ust_0, bmgl_ust_10, bmgl_ust_13, bmgl_ust_20, ust_10, ust_13, ust_20, vst_10, vst_13, vst_20, vst_gesamt, zahllast, gesperrt, gesperrt_am')
    .eq('tenant_id', tenantId)
    .eq('jahr', p.jahr)
  if (p.zeitraum) q = q.eq('zeitraum', p.zeitraum)
  const { data, error } = await alle<R>(q.order('zeitraum').order('id'))
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (ea_uva): ${error.message}`)

  const meldungen: UvaMeldung[] = data.map(u => ({
    id: String(u.id), jahr: Number(u.jahr), zeitraum: String(u.zeitraum),
    label: uvaZeitraumLabel(String(u.zeitraum), Number(u.jahr)),
    gesperrt: !!u.gesperrt, gesperrtAm: text(u.gesperrt_am),
    kennzahlen: uvaKennzahlen(u, !!doppik),
  }))

  const warnungen: string[] = []
  // KAN-105: Doppik-Vorschau rechnet die Umsätze nach Rechnungsdatum (berechne_ea_uva), E&A nach Zahlung
  if (doppik) warnungen.push('Doppelte Buchhaltung beim Steuerberater: Die Zahlen sind eine Kontroll-Vorschau – Umsätze aus den Rechnungen nach Rechnungsdatum, Vorsteuer aus den erfassten Belegen; die UVA meldet die Kanzlei aus BMD.')
  if (meldungen.length === 0) {
    warnungen.push(`Für ${p.zeitraum ? uvaZeitraumLabel(p.zeitraum, p.jahr) : p.jahr} ist noch keine UVA berechnet – bitte zuerst auf der UVA-Seite „Berechnen & Speichern“.`)
  }
  const mitNull = meldungen.filter(m => (m.kennzahlen.find(k => k.schluessel === 'ust0')?.bemessungsgrundlage ?? 0) !== 0).map(m => m.label)
  if (mitNull.length > 0) {
    warnungen.push(`Steuerfreie Umsätze (0 %) in ${mitNull.join(', ')}: ohne Kennzahl ausgegeben – vor der Übermittlung auf Kz 011 (Ausfuhr), 017 (innergemeinschaftliche Lieferung) bzw. 016/020 (steuerfreie Inlandsumsätze) aufteilen; die ig. Lieferungen gehören zusätzlich in die Zusammenfassende Meldung.`)
  }
  const entwuerfe = doppik ? [] : meldungen.filter(m => !m.gesperrt).map(m => m.label)
  if (entwuerfe.length > 0) {
    warnungen.push(`Noch nicht als übermittelt markiert (Entwurf): ${entwuerfe.join(', ')} – die Werte können sich bis zur Übermittlung ändern.`)
  }

  return { zeilen: meldungen.flatMap(m => m.kennzahlen), warnungen, meldungen, doppik: !!doppik }
}
