// ── Finanzübersicht "Wo stehe ich?" (Rückmeldung 8.9.2026) ─────────────────
//
// Eine Datenfunktion für die Seite /buchhaltung/uebersicht und die Kachel auf
// dem Dashboard: laufendes Jahr gegen Vorjahr (gleicher Zeitraum bis zum
// Stichtag), Monatsverlauf, Liquidität aus den Konten, offene Forderungen,
// Stand von UVA und Monatsabschluss, Belege-Rückstand, Top-Kategorien.
//
// Gilt für beide Buchhaltungsarten (Migration 197): bei E&A sind die Zahlen die
// Buchhaltung selbst, bei Doppik beim Steuerberater sind sie die Belegerfassung
// - dann tritt der Übergabestatus (BMD) an die Stelle von UVA-Meldung und
// Monatsabschluss. Alle Beträge netto, außer Liquidität und Forderungen (brutto).
//
// Bewusst frei von React-Imports; nutzt den Dashboard-Kontext (getCtx).

import { alle } from '@/lib/supabase/alle'
import type { Ctx, R } from '@/app/(dashboard)/dashboard/_shared/data'
import { posSum, ZAHLUNGSZIEL_TAGE, toDateStr } from '@/app/(dashboard)/dashboard/_shared/data'

export type Monat = { monat: number; einnahmen: number; ausgaben: number; einnahmenVj: number; ausgabenVj: number }
export type KategorieZeile = { name: string; betrag: number; vj: number }

export type Finanzen = {
  art: 'ea' | 'doppik'
  jahr: number
  stichtag: string
  ytd: { einnahmen: number; ausgaben: number; ergebnis: number; einnahmenVj: number; ausgabenVj: number; ergebnisVj: number }
  gesamtVj: { einnahmen: number; ausgaben: number; ergebnis: number }
  monate: Monat[]
  liquiditaet: { summe: number; konten: { id: string; name: string; typ: string; saldo: number }[] }
  forderungen: { summe: number; anzahl: number; ueberfaellig: number; ueberfaelligSumme: number }
  umsatz: { ytd: number; vj: number }
  uva: { label: string; status: 'uebermittelt' | 'entwurf' | 'fehlt'; zahllast: number | null; faelligAm: string } | null
  monatsabschluss: { letzter: string | null; offeneMonate: number }
  belege: { zuBuchen: number; ohneKategorie: number; buchungenJahr: number }
  kategorien: { einnahmen: KategorieZeile[]; ausgaben: KategorieZeile[] }
  uebergabe: { rechnungenOffen: number; belegeOffen: number; letzte: { art: string; erstelltAm: string; anzahl: number } | null } | null
}

const MONATE_KURZ = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
export const monatLabel = (m: number) => MONATE_KURZ[m - 1] ?? String(m)

/** Netto-Umsatz einer Rechnung: Brutto je Position durch (1 + USt) */
function nettoUmsatz(posten: R[]): number {
  return posten.reduce((s, p) => s + ((p.verkauf_positionen ?? []) as R[]).reduce((ps: number, x: R) => {
    const brutto = (Number(x.preis_brutto) || 0) * (Number(x.menge) || 0)
      * (1 - (Number(x.rabatt_pct) || 0) / 100) * (1 - (Number(x.sonderrabatt_pct) || 0) / 100)
    return ps + brutto / (1 + (Number(x.ust_satz) || 0) / 100)
  }, 0), 0)
}

/** Letzte abgeschlossene UVA-Periode vor dem Stichtag (Fälligkeit 15. des zweitfolgenden Monats) */
function letzteUvaPeriode(zeitraum: 'monatlich' | 'quartalsweise', heute: Date) {
  const y = heute.getFullYear(), m = heute.getMonth()
  if (zeitraum === 'monatlich') {
    const d = new Date(y, m - 1, 1)
    return { jahr: d.getFullYear(), zeitraum: String(d.getMonth() + 1).padStart(2, '0'), label: `${MONATE_KURZ[d.getMonth()]} ${d.getFullYear()}`, faelligAm: toDateStr(new Date(d.getFullYear(), d.getMonth() + 2, 15)) }
  }
  const qStart = new Date(y, Math.floor(m / 3) * 3 - 3, 1)
  const qi = Math.floor(qStart.getMonth() / 3) + 1
  return { jahr: qStart.getFullYear(), zeitraum: `Q${qi}`, label: `Q${qi} ${qStart.getFullYear()}`, faelligAm: toDateStr(new Date(qStart.getFullYear(), qStart.getMonth() + 4, 15)) }
}

export async function ladeFinanzen(ctx: Ctx, opts: { art: 'ea' | 'doppik'; uvaZeitraum: 'monatlich' | 'quartalsweise'; jahr?: number }): Promise<Finanzen> {
  const jahr = opts.jahr ?? ctx.heute.getFullYear()
  const istLaufend = jahr === ctx.heute.getFullYear()
  // Stichtag: heute im laufenden Jahr, sonst 31.12.; Vorjahr bis zum gleichen Tag
  const stichtag = istLaufend ? ctx.heuteStr : `${jahr}-12-31`
  const stichtagVj = `${jahr - 1}${stichtag.slice(4)}`
  const von = `${jahr - 1}-01-01`, bis = `${jahr}-12-31`

  const [{ data: txRaw }, { data: vpRaw }, { data: kontenRaw }, { data: zahlRaw }, { data: umbRaw }, { data: uvaRaw }, { data: maRaw }, { count: belegeErkannt }, prot] = await Promise.all([
    alle<R>(ctx.tf(ctx.q('ea_transaktionen')
      .select('datum, typ, betrag_netto, betrag_brutto, kategorie_id, konto_id, bmd_export_id, kategorie:ea_kategorien!kategorie_id(name)')
      .gte('datum', von).lte('datum', bis).order('datum').order('id'))),
    alle<R>(ctx.tf(ctx.q('verkaufsposten')
      .select('id, datum, bezahlt, bmd_export_id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct, ust_satz)')
      .eq('aktiv', true).eq('storniert', false).gte('datum', von).lte('datum', bis).order('datum').order('id'))),
    ctx.tf(ctx.q('konten').select('id, name, typ, eroeffnungssaldo, sortierung').eq('aktiv', true).order('sortierung')),
    alle<R>(ctx.tf(ctx.q('zahlungen').select('betrag, konto_id').not('konto_id', 'is', null).order('id'))),
    ctx.tf(ctx.q('konto_umbuchungen').select('betrag, von_konto_id, nach_konto_id')),
    ctx.tf(ctx.q('ea_uva').select('jahr, zeitraum, zahllast, gesperrt')),
    ctx.tf(ctx.q('ea_monatsabschluss').select('jahr, monat')),
    ctx.tf(ctx.q('ea_belege').select('id', { count: 'exact', head: true }).eq('status', 'erkannt')),
    opts.art === 'doppik'
      ? ctx.tf(ctx.q('buchhaltung_export_protokoll').select('art, erstellt_am, anzahl').order('erstellt_am', { ascending: false }).limit(1))
      : Promise.resolve({ data: [] }),
  ])

  const tx = (txRaw ?? []) as R[]
  const vp = (vpRaw ?? []) as R[]

  // ── Monate + YTD ──────────────────────────────────────────────────────────
  const monate: Monat[] = Array.from({ length: 12 }, (_, i) => ({ monat: i + 1, einnahmen: 0, ausgaben: 0, einnahmenVj: 0, ausgabenVj: 0 }))
  const ytd = { einnahmen: 0, ausgaben: 0, ergebnis: 0, einnahmenVj: 0, ausgabenVj: 0, ergebnisVj: 0 }
  const gesamtVj = { einnahmen: 0, ausgaben: 0, ergebnis: 0 }
  const katMap = new Map<string, { typ: string; betrag: number; vj: number }>()
  let ohneKategorie = 0, buchungenJahr = 0

  for (const t of tx) {
    const d = String(t.datum).slice(0, 10)
    const j = Number(d.slice(0, 4)), m = Number(d.slice(5, 7))
    const netto = Number(t.betrag_netto ?? 0) || 0
    const istEinnahme = t.typ === 'einnahme'
    const kat = t.kategorie?.name as string | undefined
    if (j === jahr) {
      if (d > stichtag) continue
      buchungenJahr++
      if (!t.kategorie_id) ohneKategorie++
      if (istEinnahme) { monate[m - 1].einnahmen += netto; ytd.einnahmen += netto } else { monate[m - 1].ausgaben += netto; ytd.ausgaben += netto }
      const k = katMap.get(kat ?? '–') ?? { typ: t.typ, betrag: 0, vj: 0 }
      k.betrag += netto; katMap.set(kat ?? '–', k)
    } else if (j === jahr - 1) {
      if (istEinnahme) { monate[m - 1].einnahmenVj += netto; gesamtVj.einnahmen += netto } else { monate[m - 1].ausgabenVj += netto; gesamtVj.ausgaben += netto }
      if (d <= stichtagVj) {
        if (istEinnahme) ytd.einnahmenVj += netto; else ytd.ausgabenVj += netto
        const k = katMap.get(kat ?? '–') ?? { typ: t.typ, betrag: 0, vj: 0 }
        k.vj += netto; katMap.set(kat ?? '–', k)
      }
    }
  }
  ytd.ergebnis = ytd.einnahmen - ytd.ausgaben
  ytd.ergebnisVj = ytd.einnahmenVj - ytd.ausgabenVj
  gesamtVj.ergebnis = gesamtVj.einnahmen - gesamtVj.ausgaben

  const top = (typ: string) => [...katMap.entries()].filter(([, v]) => v.typ === typ && (v.betrag > 0 || v.vj > 0))
    .map(([name, v]) => ({ name, betrag: v.betrag, vj: v.vj })).sort((a, b) => b.betrag - a.betrag).slice(0, 6)

  // ── Umsatz aus Rechnungen (Vorsystem-Sicht, unabhängig von der E&A-Buchung) ─
  const vpJahr = vp.filter(p => String(p.datum).slice(0, 4) === String(jahr) && String(p.datum).slice(0, 10) <= stichtag)
  const vpVj = vp.filter(p => String(p.datum).slice(0, 4) === String(jahr - 1) && String(p.datum).slice(0, 10) <= stichtagVj)

  // ── Forderungen (offene Rechnungen, brutto) ───────────────────────────────
  const offene = vp.filter(p => !p.bezahlt)
  const heuteMs = ctx.heute.getTime()
  const ueberf = offene.filter(p => (heuteMs - new Date(p.datum).getTime()) / 86400000 > ZAHLUNGSZIEL_TAGE)
  const forderungen = {
    summe: posSum(offene), anzahl: offene.length,
    ueberfaellig: ueberf.length, ueberfaelligSumme: posSum(ueberf),
  }

  // ── Liquidität: Kontensalden wie /konten ──────────────────────────────────
  const salden = new Map<string, number>()
  for (const k of (kontenRaw ?? []) as R[]) salden.set(k.id, Number(k.eroeffnungssaldo ?? 0))
  for (const z of (zahlRaw ?? []) as R[]) if (salden.has(z.konto_id)) salden.set(z.konto_id, salden.get(z.konto_id)! + Number(z.betrag ?? 0))
  // Bewegungen über E&A-Buchungen mit Konto: alle Jahre nötig -> eigene Abfrage ohne Datumsfilter
  const { data: txKontoRaw } = await alle<R>(ctx.tf(ctx.q('ea_transaktionen').select('typ, betrag_brutto, konto_id').not('konto_id', 'is', null).order('id')))
  for (const t of (txKontoRaw ?? []) as R[]) if (salden.has(t.konto_id)) salden.set(t.konto_id, salden.get(t.konto_id)! + (t.typ === 'einnahme' ? 1 : -1) * Number(t.betrag_brutto ?? 0))
  for (const u of (umbRaw ?? []) as R[]) {
    if (salden.has(u.von_konto_id)) salden.set(u.von_konto_id, salden.get(u.von_konto_id)! - Number(u.betrag ?? 0))
    if (salden.has(u.nach_konto_id)) salden.set(u.nach_konto_id, salden.get(u.nach_konto_id)! + Number(u.betrag ?? 0))
  }
  const konten = ((kontenRaw ?? []) as R[]).map(k => ({ id: k.id as string, name: k.name as string, typ: (k.typ ?? '') as string, saldo: salden.get(k.id) ?? 0 }))

  // ── UVA-Stand (letzte abgeschlossene Periode) ─────────────────────────────
  const p = letzteUvaPeriode(opts.uvaZeitraum, istLaufend ? ctx.heute : new Date(jahr, 11, 31))
  const uvaRow = ((uvaRaw ?? []) as R[]).find(u => Number(u.jahr) === p.jahr && u.zeitraum === p.zeitraum)
  const uva = { label: p.label, status: (uvaRow ? (uvaRow.gesperrt ? 'uebermittelt' : 'entwurf') : 'fehlt') as 'uebermittelt' | 'entwurf' | 'fehlt', zahllast: uvaRow ? Number(uvaRow.zahllast ?? 0) : null, faelligAm: p.faelligAm }

  // ── Monatsabschluss ───────────────────────────────────────────────────────
  const abschluesse = ((maRaw ?? []) as R[]).map(a => `${a.jahr}-${String(a.monat).padStart(2, '0')}`).sort()
  const letzter = abschluesse.length ? abschluesse[abschluesse.length - 1] : null
  // offene Monate = abgelaufene Monate des Jahres ohne Abschluss
  const abgelaufen = istLaufend ? ctx.heute.getMonth() : 12
  const offeneMonate = Array.from({ length: abgelaufen }, (_, i) => `${jahr}-${String(i + 1).padStart(2, '0')}`).filter(k => !abschluesse.includes(k)).length

  // ── Übergabe (Doppik) ─────────────────────────────────────────────────────
  let uebergabe: Finanzen['uebergabe'] = null
  if (opts.art === 'doppik') {
    const letzteProt = ((prot as R).data ?? [])[0] as R | undefined
    uebergabe = {
      rechnungenOffen: vp.filter(p => !p.bmd_export_id).length,
      belegeOffen: tx.filter(t => t.typ === 'ausgabe' && !t.bmd_export_id).length,
      letzte: letzteProt ? { art: letzteProt.art, erstelltAm: letzteProt.erstellt_am, anzahl: Number(letzteProt.anzahl ?? 0) } : null,
    }
  }

  return {
    art: opts.art, jahr, stichtag, ytd, gesamtVj, monate,
    liquiditaet: { summe: konten.reduce((s, k) => s + k.saldo, 0), konten },
    forderungen,
    umsatz: { ytd: nettoUmsatz(vpJahr), vj: nettoUmsatz(vpVj) },
    uva, monatsabschluss: { letzter, offeneMonate },
    belege: { zuBuchen: belegeErkannt ?? 0, ohneKategorie, buchungenJahr },
    kategorien: { einnahmen: top('einnahme'), ausgaben: top('ausgabe') },
    uebergabe,
  }
}
