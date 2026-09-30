// ── Behördenmeldung „kassabuch“: Kassabuch je Kassa-Konto (24.09.2026) ──────────
//
// Kassaaufzeichnungen nach § 131 BAO (Losungsermittlung, Betriebsprüfung): je Konto vom
// Typ „kassa“ und Zeitraum eine Zeile je Bewegung mit laufendem Kassastand, davor der
// Saldovortrag. Eine Ladefunktion für die Druckseite /buchhaltung/kassabuch UND die CSV
// (/meldungen/kassabuch/csv?konto=&von=&bis=).
// Bewegungen wie in der Kontoabstimmung (/konten/[id]/abstimmung): Zahlungseingänge
// (zahlungen.konto_id), E&A-Buchungen (ea_transaktionen.konto_id, brutto) und Umbuchungen
// (konto_umbuchungen). Bewegungen am oder vor dem Eröffnungsdatum stecken im
// Eröffnungssaldo. Beträge kaufmännisch auf 2 Stellen, der Saldo läuft über die
// gerundeten Beträge (Druck und CSV zeigen dieselben Werte).

import { rundeText, runden, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { betrag, datumText, text } from './buchhaltung-gemeinsam'
import { MeldungsFehler } from './typen'
import { mitStornoGegenzeile } from '@/lib/finanzen/stornoGegenzeile'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type KassabuchParameter = { konto: string; von: string; bis: string }

export type KassaKonto = { id: string; name: string; typ: string; eroeffnungsdatum: string; eroeffnungssaldo: number }

/** Eine Bewegung auf dem Konto – betrag vorzeichenbehaftet (Zugang +, Abgang −) */
export type KassaBewegung = {
  id: string
  datum: string
  /** Sortierung innerhalb eines Tages (Erfassungszeitpunkt) */
  erfasst: string
  beleg: string | null
  text: string
  art: string
  betrag: number
  gegenkonto: string | null
  abgeglichen: boolean
}

export type KassabuchZeile = {
  /** fortlaufende Nummer der Bewegung im Zeitraum; Vortrag ohne Nummer */
  lfdNr: number | null
  datum: string
  beleg: string | null
  text: string
  art: string
  einnahme: number | null
  ausgabe: number | null
  saldo: number
  gegenkonto: string | null
  abgeglichen: boolean | null
  vortrag: boolean
}

export const SPALTEN_KASSABUCH: CsvSpalte<KassabuchZeile>[] = [
  { kopf: 'Lfd. Nr.', typ: 'ganzzahl', wert: z => z.lfdNr },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Beleg', typ: 'code', wert: z => z.beleg },
  { kopf: 'Text', typ: 'text', wert: z => z.text },
  { kopf: 'Art', typ: 'text', wert: z => z.art },
  { kopf: 'Einnahme (€)', typ: 'betrag', wert: z => z.einnahme },
  { kopf: 'Ausgabe (€)', typ: 'betrag', wert: z => z.ausgabe },
  { kopf: 'Saldo (€)', typ: 'betrag', wert: z => z.saldo },
  { kopf: 'Gegenkonto', typ: 'text', wert: z => z.gegenkonto },
  { kopf: 'Abgeglichen', typ: 'janein', wert: z => z.abgeglichen },
]

const euro = (n: number) => `${rundeText(n, 2).replace('.', ',').replace('-', '−')} €`

/**
 * Kassabuch-Zeilen aus Konto und Bewegungen (rein, ohne Datenbank): Vortrag zum Beginn des
 * Zeitraums, danach je Bewegung im Zeitraum eine Zeile mit laufendem Saldo.
 */
export function kassabuchZeilen(konto: KassaKonto, bewegungen: readonly KassaBewegung[], von: string, bis: string): { zeilen: KassabuchZeile[]; warnungen: string[] } {
  const warnungen: string[] = []
  const eroeffnung = konto.eroeffnungsdatum
  if (bis < eroeffnung) {
    warnungen.push(`Das Konto „${konto.name}“ wurde erst am ${datumText(eroeffnung)} eröffnet – im gewählten Zeitraum gibt es keine Bewegungen.`)
    return { zeilen: [], warnungen }
  }

  const sortiert = [...bewegungen].sort((a, b) =>
    a.datum.localeCompare(b.datum) || a.erfasst.localeCompare(b.erfasst) || a.id.localeCompare(b.id))

  const imEroeffnungssaldo = sortiert.filter(b => b.datum <= eroeffnung && b.datum >= von).length
  if (imEroeffnungssaldo > 0) {
    warnungen.push(`${imEroeffnungssaldo} ${imEroeffnungssaldo === 1 ? 'Bewegung liegt' : 'Bewegungen liegen'} am oder vor dem Eröffnungsdatum (${datumText(eroeffnung)}) und ${imEroeffnungssaldo === 1 ? 'steckt' : 'stecken'} im Eröffnungssaldo – nicht einzeln aufgeführt.`)
  }

  const nachEroeffnung = sortiert.filter(b => b.datum > eroeffnung && b.datum <= bis)
  let saldo = runden(konto.eroeffnungssaldo, 2)
  const vortragAb = von > eroeffnung
  for (const b of nachEroeffnung) if (b.datum < von) saldo = runden(saldo + b.betrag, 2)

  const zeilen: KassabuchZeile[] = [{
    lfdNr: null, datum: vortragAb ? von : eroeffnung, beleg: null,
    text: vortragAb ? 'Saldovortrag' : 'Eröffnungssaldo', art: 'Vortrag',
    einnahme: null, ausgabe: null, saldo, gegenkonto: null, abgeglichen: null, vortrag: true,
  }]

  const negativ: string[] = []
  let nr = 0
  for (const b of nachEroeffnung) {
    if (b.datum < von) continue
    const betragGerundet = runden(b.betrag, 2)
    saldo = runden(saldo + betragGerundet, 2)
    zeilen.push({
      lfdNr: ++nr, datum: b.datum, beleg: b.beleg, text: b.text, art: b.art,
      einnahme: betragGerundet >= 0 ? betragGerundet : null,
      ausgabe: betragGerundet < 0 ? runden(-betragGerundet, 2) : null,
      saldo, gegenkonto: b.gegenkonto, abgeglichen: b.abgeglichen, vortrag: false,
    })
    if (saldo < 0) negativ.push(`${datumText(b.datum)} (${euro(saldo)})`)
  }
  if (negativ.length > 0) {
    warnungen.push(`Negativer Kassastand an ${negativ.length} ${negativ.length === 1 ? 'Stelle' : 'Stellen'}: ${negativ.slice(0, 3).join(', ')}${negativ.length > 3 ? ' …' : ''} – eine Kassa kann keinen negativen Bestand haben; bitte Buchungen und Datum prüfen.`)
  }
  return { zeilen, warnungen }
}

/** Kassa-Konten des Betriebs (Auswahl auf der Druckseite) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeKassaKonten(supabase: any, tenantId: string): Promise<{ id: string; name: string; aktiv: boolean }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await alle<R>((supabase.from('konten') as any)
    .select('id, name, aktiv').eq('tenant_id', tenantId).eq('typ', 'kassa').order('sortierung').order('name').order('id'))
  if (error) throw new Error(`Laden fehlgeschlagen (konten): ${error.message}`)
  return data.map(k => ({ id: String(k.id), name: String(k.name ?? ''), aktiv: k.aktiv !== false }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeKassabuch(supabase: any, tenantId: string, p: KassabuchParameter): Promise<{ zeilen: KassabuchZeile[]; warnungen: string[]; konto: KassaKonto }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: kRaw, error: kErr } = await (supabase.from('konten') as any)
    .select('id, name, typ, eroeffnungsdatum, eroeffnungssaldo')
    .eq('tenant_id', tenantId).eq('id', p.konto).maybeSingle()
  if (kErr) throw new Error(`Laden fehlgeschlagen (konten): ${kErr.message}`)
  if (!kRaw) throw new MeldungsFehler(404, 'Dieses Konto gibt es in diesem Betrieb nicht.')
  const k = kRaw as R
  if (k.typ !== 'kassa') throw new MeldungsFehler(422, `„${k.name}“ ist kein Kassa-Konto – das Kassabuch gibt es nur für Konten vom Typ „Kassa“.`)
  const konto: KassaKonto = {
    id: String(k.id), name: String(k.name ?? ''), typ: String(k.typ),
    eroeffnungsdatum: String(k.eroeffnungsdatum).slice(0, 10), eroeffnungssaldo: betrag(k.eroeffnungssaldo) ?? 0,
  }

  const [zRes, tRes, vonRes, nachRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('zahlungen') as any)
      .select('id, betrag, datum, abgeglichen, erstellt_am, storniert_am, storno_grund, verkaufsposten(rechnungsnummer)')
      .eq('tenant_id', tenantId).eq('konto_id', konto.id).lte('datum', p.bis).order('datum').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('ea_transaktionen') as any)
      .select('id, typ, betrag_brutto, datum, beschreibung, bank_ref, abgeglichen, erstellt_am, ea_belege(dateiname)')
      .eq('tenant_id', tenantId).eq('konto_id', konto.id).lte('datum', p.bis).order('datum').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('konto_umbuchungen') as any)
      .select('id, betrag, datum, beschreibung, von_abgeglichen, erstellt_am, storniert_am, storno_grund, nach:konten!nach_konto_id(name)')
      .eq('tenant_id', tenantId).eq('von_konto_id', konto.id).lte('datum', p.bis).order('datum').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('konto_umbuchungen') as any)
      .select('id, betrag, datum, beschreibung, nach_abgeglichen, erstellt_am, storniert_am, storno_grund, von:konten!von_konto_id(name)')
      .eq('tenant_id', tenantId).eq('nach_konto_id', konto.id).lte('datum', p.bis).order('datum').order('id')),
  ])
  for (const [r, tabelle] of [[zRes, 'zahlungen'], [tRes, 'ea_transaktionen'], [vonRes, 'konto_umbuchungen'], [nachRes, 'konto_umbuchungen']] as const) {
    if (r.error) throw new Error(`Laden fehlgeschlagen (${tabelle}): ${r.error.message}`)
  }

  const s = (v: unknown) => String(v ?? '')
  // KAN-149 D2b (Ticket Soll 6): stornierte Zahlung/Umbuchung an ihrem Tag gekennzeichnet, Gegenzeile am Storno-Tag
  const storno = (b: KassaBewegung, z: R) => mitStornoGegenzeile(b, { storniertAm: z.storniert_am, grund: z.storno_grund }, 'text',
    { abgeglichen: false, erfasst: s(z.storniert_am) })
  const bewegungen: KassaBewegung[] = [
    ...zRes.data.flatMap(z => {
      const re = text(z.verkaufsposten?.rechnungsnummer)
      return storno({
        id: s(z.id), datum: s(z.datum).slice(0, 10), erfasst: s(z.erstellt_am), beleg: re,
        text: `Zahlungseingang${re ? ` RE ${re}` : ''}`, art: 'Zahlungseingang',
        betrag: betrag(z.betrag) ?? 0, gegenkonto: null, abgeglichen: !!z.abgeglichen,
      }, z)
    }),
    ...tRes.data.map(t => ({
      id: s(t.id), datum: s(t.datum).slice(0, 10), erfasst: s(t.erstellt_am),
      beleg: text(t.bank_ref) ?? text(((t.ea_belege ?? []) as R[]).map(b => b.dateiname).filter(Boolean).join(', ')),
      text: text(t.beschreibung) ?? '', art: t.typ === 'einnahme' ? 'Einnahme (E&A)' : 'Ausgabe (E&A)',
      betrag: (t.typ === 'einnahme' ? 1 : -1) * (betrag(t.betrag_brutto) ?? 0), gegenkonto: null, abgeglichen: !!t.abgeglichen,
    })),
    ...vonRes.data.flatMap(u => storno({
      id: s(u.id), datum: s(u.datum).slice(0, 10), erfasst: s(u.erstellt_am), beleg: null,
      text: text(u.beschreibung) ?? `Umbuchung an ${text(u.nach?.name) ?? 'anderes Konto'}`, art: 'Umbuchung',
      betrag: -(betrag(u.betrag) ?? 0), gegenkonto: text(u.nach?.name), abgeglichen: !!u.von_abgeglichen,
    }, u)),
    ...nachRes.data.flatMap(u => storno({
      id: s(u.id), datum: s(u.datum).slice(0, 10), erfasst: s(u.erstellt_am), beleg: null,
      text: text(u.beschreibung) ?? `Umbuchung von ${text(u.von?.name) ?? 'anderem Konto'}`, art: 'Umbuchung',
      betrag: betrag(u.betrag) ?? 0, gegenkonto: text(u.von?.name), abgeglichen: !!u.nach_abgeglichen,
    }, u)),
  ]

  const { zeilen, warnungen } = kassabuchZeilen(konto, bewegungen, p.von, p.bis)
  return { zeilen, warnungen, konto }
}
