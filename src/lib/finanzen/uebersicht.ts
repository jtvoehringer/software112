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
import { toDateStr, ladeOffenePosten } from '@/app/(dashboard)/dashboard/_shared/data'
import { anlagenspiegel, buchwertAm, type Anlage } from '@/lib/ea/anlagen'

export type Monat = { monat: number; einnahmen: number; ausgaben: number; einnahmenVj: number; ausgabenVj: number }
export type KategorieZeile = { name: string; betrag: number; vj: number }

// KAN-157: Buchungen ohne Kategorie je Typ in einer eigenen Zeile (vorher EIN Topf „–“ für Einnahmen UND Ausgaben,
// Typ vom ersten Treffer). Automatische Verkaufs-Einnahmen (import_quelle 'verkauf', ersetzeVerkaufsEinnahmen) haben nie
// eine Kategorie und lassen sich nicht zuordnen – sie stehen als „Verkauf (Rechnungen)“ und zählen nicht als „ohne Kategorie“.
export const OHNE_KATEGORIE = 'ohne Kategorie'
export const VERKAUF_KATEGORIE = 'Verkauf (Rechnungen)'

export type Finanzen = {
  art: 'ea' | 'doppik'
  jahr: number
  stichtag: string
  ytd: { einnahmen: number; ausgaben: number; ergebnis: number; einnahmenVj: number; ausgabenVj: number; ergebnisVj: number }
  gesamtVj: { einnahmen: number; ausgaben: number; ergebnis: number }
  monate: Monat[]
  liquiditaet: { summe: number; konten: { id: string; name: string; typ: string; saldo: number }[] }
  /** KAN-157: wie „Offene Posten“ (ladeOffenePosten) – immer der heutige Stand, auch in der Vorjahresansicht */
  forderungen: { summe: number; anzahl: number; ueberfaellig: number; ueberfaelligSumme: number }
  umsatz: { ytd: number; vj: number }
  uva: { label: string; status: 'uebermittelt' | 'entwurf' | 'fehlt'; zahllast: number | null; faelligAm: string } | null
  monatsabschluss: { letzter: string | null; offeneMonate: number }
  belege: { zuBuchen: number; ohneKategorie: number; buchungenJahr: number }
  kategorien: { einnahmen: KategorieZeile[]; ausgaben: KategorieZeile[] }
  uebergabe: { rechnungenOffen: number; belegeOffen: number; letzte: { art: string; erstelltAm: string; anzahl: number } | null } | null
  /** Anlagevermögen (Migration 200): Buchwert lt. Verzeichnis, AfA des Jahres, Anlagenkäufe (Kontenklasse 0) und steuerliches Ergebnis */
  anlagen: {
    imVerzeichnis: number; anzahlAktiv: number; buchwert: number; anschaffungskosten: number; kumulierteAfa: number
    afaJahr: number; afaGebuchtJahr: number; afaVj: number
    anlagenkaeufeJahr: number; anlagenkaeufeVj: number
    /** Ergebnis + Anlagenkäufe − AfA (steuerlich, vereinfacht) – laufendes Jahr bzw. Vorjahr bis zum gleichen Stichtag */
    ergebnisNachAfa: number; ergebnisNachAfaVj: number
    /** Vorjahr gesamt (für SVS-Einkünfte-Vorschlag) */
    ergebnisNachAfaVjGesamt: number
    offeneKaeufe: number
  }
  /** KAN-158: Bereiche, deren Abfrage mit einem Datenbankfehler endete – die Zahlen dazu sind unvollständig
   *  (vorher still 0 bzw. eine plausibel falsche Liquidität) */
  unvollstaendig: string[]
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

  const [{ data: txRaw, error: txErr }, { data: vpRaw, error: vpErr }, { data: kontenRaw, error: kontenErr }, { data: zahlRaw, error: zahlErr },
    { data: umbRaw, error: umbErr }, { data: uvaRaw, error: uvaErr }, { data: maRaw, error: maErr }, { count: belegeErkannt, error: belegeErr }, prot, offenePosten] = await Promise.all([
    alle<R>(ctx.tf(ctx.q('ea_transaktionen')
      .select('id, datum, typ, betrag_netto, betrag_brutto, kategorie_id, konto_id, bmd_export_id, anlage_id, import_quelle, kategorie:ea_kategorien!kategorie_id(name, konto_nr)')
      .gte('datum', von).lte('datum', bis).order('datum').order('id'))),
    alle<R>(ctx.tf(ctx.q('verkaufsposten')
      .select('id, datum, bezahlt, bmd_export_id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct, ust_satz)')
      .eq('aktiv', true).eq('storniert', false).gte('datum', von).lte('datum', bis).order('datum').order('id'))),
    ctx.tf(ctx.q('konten').select('id, name, typ, eroeffnungssaldo, sortierung').eq('aktiv', true).order('sortierung')),
    // KAN-149 D2b: stornierte Zahlungen/Umbuchungen zählen nicht
    alle<R>(ctx.tf(ctx.q('zahlungen').select('betrag, konto_id').not('konto_id', 'is', null).is('storniert_am', null).order('id'))),
    ctx.tf(ctx.q('konto_umbuchungen').select('betrag, von_konto_id, nach_konto_id').is('storniert_am', null)),
    ctx.tf(ctx.q('ea_uva').select('jahr, zeitraum, zahllast, gesperrt')),
    ctx.tf(ctx.q('ea_monatsabschluss').select('jahr, monat')),
    ctx.tf(ctx.q('ea_belege').select('id', { count: 'exact', head: true }).eq('status', 'erkannt')),
    opts.art === 'doppik'
      ? ctx.tf(ctx.q('buchhaltung_export_protokoll').select('art, erstellt_am, anzahl').order('erstellt_am', { ascending: false }).limit(1))
      : Promise.resolve({ data: [] }),
    ladeOffenePosten(ctx),
  ])
  // Anlagenverzeichnis (Migration 200) – alle Jahre, für Buchwert und AfA
  const { data: anlagenRaw, error: anlagenErr } = await ctx.tf(ctx.q('ea_anlagen').select('id, name, gruppe, konto_nr, anschaffung_am, ak_netto, nutzungsdauer_jahre, methode, degressiv_satz, restwert, abgang_am, veraeusserungserloes, transaktion_id'))

  const tx = (txRaw ?? []) as R[]
  const vp = (vpRaw ?? []) as R[]

  // ── Monate + YTD ──────────────────────────────────────────────────────────
  const monate: Monat[] = Array.from({ length: 12 }, (_, i) => ({ monat: i + 1, einnahmen: 0, ausgaben: 0, einnahmenVj: 0, ausgabenVj: 0 }))
  const ytd = { einnahmen: 0, ausgaben: 0, ergebnis: 0, einnahmenVj: 0, ausgabenVj: 0, ergebnisVj: 0 }
  const gesamtVj = { einnahmen: 0, ausgaben: 0, ergebnis: 0 }
  // Schlüssel „typ|name“ – Einnahmen und Ausgaben gleichen Namens (auch ohne Kategorie) bleiben getrennt
  const katMap = new Map<string, { typ: string; name: string; betrag: number; vj: number }>()
  const katZeile = (typ: string, name: string) => {
    const k = `${typ}|${name}`
    const z = katMap.get(k) ?? { typ, name, betrag: 0, vj: 0 }
    katMap.set(k, z)
    return z
  }
  let ohneKategorie = 0, buchungenJahr = 0
  // Migration 200: AfA-Buchungen (anlage_id) sind nicht zahlungswirksam und
  // werden getrennt gerechnet; Anlagenkäufe (Kategorie Kontenklasse 0) sind
  // steuerlich keine Betriebsausgabe, sondern werden über die AfA abgesetzt.
  let afaGebuchtJahr = 0, afaGebuchtVj = 0, anlagenkaeufeJahr = 0, anlagenkaeufeVj = 0, anlagenkaeufeVjGesamt = 0
  const anlagenkaufIds = new Set<string>()

  for (const t of tx) {
    const d = String(t.datum).slice(0, 10)
    const j = Number(d.slice(0, 4)), m = Number(d.slice(5, 7))
    const netto = Number(t.betrag_netto ?? 0) || 0
    const istEinnahme = t.typ === 'einnahme'
    const kat = (t.kategorie?.name as string | undefined) ?? (t.import_quelle === 'verkauf' ? VERKAUF_KATEGORIE : OHNE_KATEGORIE)
    if (t.anlage_id) {
      if (j === jahr && d <= stichtag) afaGebuchtJahr += netto
      else if (j === jahr - 1 && d <= stichtagVj) afaGebuchtVj += netto
      continue
    }
    const istAnlagenkauf = !istEinnahme && t.kategorie?.konto_nr !== null && t.kategorie?.konto_nr !== undefined && Number(t.kategorie.konto_nr) < 1000
    if (istAnlagenkauf) {
      if (j === jahr && d <= stichtag) { anlagenkaeufeJahr += netto; anlagenkaufIds.add(t.id) }
      else if (j === jahr - 1) { anlagenkaeufeVjGesamt += netto; if (d <= stichtagVj) anlagenkaeufeVj += netto }
    }
    if (j === jahr) {
      if (d > stichtag) continue
      buchungenJahr++
      if (!t.kategorie_id && t.import_quelle !== 'verkauf') ohneKategorie++
      if (istEinnahme) { monate[m - 1].einnahmen += netto; ytd.einnahmen += netto } else { monate[m - 1].ausgaben += netto; ytd.ausgaben += netto }
      katZeile(t.typ, kat).betrag += netto
    } else if (j === jahr - 1) {
      if (istEinnahme) { monate[m - 1].einnahmenVj += netto; gesamtVj.einnahmen += netto } else { monate[m - 1].ausgabenVj += netto; gesamtVj.ausgaben += netto }
      if (d <= stichtagVj) {
        if (istEinnahme) ytd.einnahmenVj += netto; else ytd.ausgabenVj += netto
        katZeile(t.typ, kat).vj += netto
      }
    }
  }
  ytd.ergebnis = ytd.einnahmen - ytd.ausgaben
  ytd.ergebnisVj = ytd.einnahmenVj - ytd.ausgabenVj
  gesamtVj.ergebnis = gesamtVj.einnahmen - gesamtVj.ausgaben

  const top = (typ: string) => [...katMap.values()].filter(v => v.typ === typ && (v.betrag > 0 || v.vj > 0))
    .map(v => ({ name: v.name, betrag: v.betrag, vj: v.vj })).sort((a, b) => b.betrag - a.betrag).slice(0, 6)

  // ── Umsatz aus Rechnungen (Vorsystem-Sicht, unabhängig von der E&A-Buchung) ─
  const vpJahr = vp.filter(p => String(p.datum).slice(0, 4) === String(jahr) && String(p.datum).slice(0, 10) <= stichtag)
  const vpVj = vp.filter(p => String(p.datum).slice(0, 4) === String(jahr - 1) && String(p.datum).slice(0, 10) <= stichtagVj)

  // ── Forderungen (offene Rechnungen, brutto) ───────────────────────────────
  // KAN-157: dieselbe Quelle wie „Offene Posten“ – ohne Datumsgrenze (vorher nur ab 1.1. des Vorjahres) und mit
  // derselben Überfälligkeit (volle Tage > Zahlungsziel)
  const forderungen = {
    summe: offenePosten.summe, anzahl: offenePosten.anzahl,
    ueberfaellig: offenePosten.ueberfaellig, ueberfaelligSumme: offenePosten.ueberfaelligSumme,
  }

  // ── Liquidität: Kontensalden wie /konten ──────────────────────────────────
  const salden = new Map<string, number>()
  for (const k of (kontenRaw ?? []) as R[]) salden.set(k.id, Number(k.eroeffnungssaldo ?? 0))
  for (const z of (zahlRaw ?? []) as R[]) if (salden.has(z.konto_id)) salden.set(z.konto_id, salden.get(z.konto_id)! + Number(z.betrag ?? 0))
  // Bewegungen über E&A-Buchungen mit Konto: alle Jahre nötig -> eigene Abfrage ohne Datumsfilter
  const { data: txKontoRaw, error: txKontoErr } = await alle<R>(ctx.tf(ctx.q('ea_transaktionen').select('typ, betrag_brutto, konto_id').not('konto_id', 'is', null).order('id')))
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

  // ── Anlagevermögen (Migration 200) ────────────────────────────────────────
  const anlagenListe: (Anlage & { transaktion_id: string | null })[] = ((anlagenRaw ?? []) as R[]).map(a => ({
    id: a.id, name: a.name, gruppe: a.gruppe ?? null, konto_nr: a.konto_nr === null || a.konto_nr === undefined ? null : Number(a.konto_nr),
    anschaffung_am: String(a.anschaffung_am).slice(0, 10), ak_netto: Number(a.ak_netto), nutzungsdauer_jahre: Number(a.nutzungsdauer_jahre),
    methode: a.methode, degressiv_satz: a.degressiv_satz === null || a.degressiv_satz === undefined ? null : Number(a.degressiv_satz),
    restwert: Number(a.restwert ?? 0), abgang_am: a.abgang_am ? String(a.abgang_am).slice(0, 10) : null,
    veraeusserungserloes: a.veraeusserungserloes === null || a.veraeusserungserloes === undefined ? null : Number(a.veraeusserungserloes),
    transaktion_id: a.transaktion_id ?? null,
  }))
  const spiegel = anlagenspiegel(anlagenListe, jahr)
  const spiegelVj = anlagenspiegel(anlagenListe, jahr - 1)
  const verknuepft = new Set(anlagenListe.map(a => a.transaktion_id).filter(Boolean) as string[])
  const anlagen: Finanzen['anlagen'] = {
    imVerzeichnis: anlagenListe.length, anzahlAktiv: spiegel.anzahlAktiv,
    buchwert: anlagenListe.reduce((s, a) => s + buchwertAm(a, stichtag), 0),
    anschaffungskosten: spiegel.anschaffungskosten, kumulierteAfa: spiegel.kumulierteAfa,
    afaJahr: spiegel.afaJahr, afaGebuchtJahr, afaVj: spiegelVj.afaJahr,
    anlagenkaeufeJahr, anlagenkaeufeVj,
    ergebnisNachAfa: ytd.ergebnis + anlagenkaeufeJahr - spiegel.afaJahr,
    ergebnisNachAfaVj: ytd.ergebnisVj + anlagenkaeufeVj - spiegelVj.afaJahr,
    ergebnisNachAfaVjGesamt: gesamtVj.ergebnis + anlagenkaeufeVjGesamt - spiegelVj.afaJahr,
    offeneKaeufe: [...anlagenkaufIds].filter(id => !verknuepft.has(id)).length,
  }
  void afaGebuchtVj

  // ── KAN-158: Datenbankfehler sichtbar machen statt 0 anzuzeigen ───────────
  const unvollstaendig = ([
    [txErr, 'Buchungen (E&A)'], [vpErr, 'Rechnungen'], [kontenErr, 'Konten'], [zahlErr, 'Zahlungen'], [umbErr, 'Umbuchungen'],
    [txKontoErr, 'Kontobewegungen'], [uvaErr, 'UVA'], [maErr, 'Monatsabschluss'], [belegeErr, 'Belege'],
    [(prot as R).error, 'BMD-Übergabe'], [anlagenErr, 'Anlagenverzeichnis'], [offenePosten.fehler, 'Offene Posten'],
  ] as [unknown, string][]).filter(([e]) => !!e).map(([, name]) => name)

  return {
    art: opts.art, jahr, stichtag, ytd, gesamtVj, monate, anlagen,
    liquiditaet: { summe: konten.reduce((s, k) => s + k.saldo, 0), konten },
    forderungen,
    umsatz: { ytd: nettoUmsatz(vpJahr), vj: nettoUmsatz(vpVj) },
    uva, monatsabschluss: { letzter, offeneMonate },
    belege: { zuBuchen: belegeErkannt ?? 0, ohneKategorie, buchungenJahr },
    kategorien: { einnahmen: top('einnahme'), ausgaben: top('ausgabe') },
    uebergabe,
    unvollstaendig,
  }
}
