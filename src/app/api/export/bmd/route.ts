import type { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { hatModul } from '@/lib/auth/modul'
import { alle, bloecke, inBloecken } from '@/lib/supabase/alle'
import { ereignisMelden } from '@/lib/system/ereignis'
import {
  mappingAufloesen, steuerfall, erloesSchluessel, steuercodeFuer,
  bmdDatum, datumPlusTage, bmdCsv, bmdText, bmdRechnungKopf, personenkontenCsv,
  type Mapping, type BmdZeile, type PersonenkontoZeile,
} from '@/lib/buchhaltung/bmd'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperre } from '@/lib/auth/sperren'
import { wienHeute } from '@/lib/csv'
import { csvAntwort, fehlerAntwort } from '@/lib/csv/antwort'
import { alsBeleg, lieferscheineSelect, STORNO_FELDER, zaehltMitBetrag } from '@/lib/verkauf/rechnungen'
import { STORNIERT_ZAEHLT } from '@/lib/verkauf/umsatz'
import { rund } from '@/lib/zahl/runden'
import { AktionsFehler } from '@/lib/fehler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// ── BMD-NTCS-Übergabe (Migration 196, Rückmeldung 3.9.2026) ─────────────────
//
//   GET /api/export/bmd?art=ausgangsrechnungen|eingangsbelege|stammdaten
//                      &von=JJJJ-MM-TT&bis=JJJJ-MM-TT
//                      &nurNeue=1        nur Belege ohne bmd_export_id
//                      &protokollieren=1 Übergabe im Protokoll festhalten und
//                                        Belege als übergeben markieren
//
// Kontierung: src/lib/buchhaltung/bmd.ts (Vorbelegung Einheitskontenrahmen)
// + Abweichungen des Mandanten aus buchhaltung_kontenmapping. Aufwands- und
// Ertragskonten der E&A-Buchungen kommen aus ea_kategorien.konto_nr (vierstellig,
// Kontenklasse 0 wie „Anlagenkauf“ 660 → 0660; AfA-Buchungen laufen über 7010).
//
// Personenkonten (Debitor/Kreditor) werden bei der ersten Übergabe eines
// Kunden/Lieferanten automatisch aus dem Nummernkreis des Mandanten vergeben
// (RPC get_next_personenkonto) und am Kontakt/an der Firma gespeichert - damit
// bleibt die Nummer für alle weiteren Übergaben stabil.
//
// KAN-5 Nur-Lesen-Modus (gesperrtes Abo): Der Export bleibt erlaubt (Übergabe an den
// Steuerberater, Aufbewahrungspflicht), schreibt aber nichts – kein Protokoll, keine
// „übergeben“-Markierung und KEINE neuen Personenkonten (eine vergebene, aber nicht
// gespeicherte Nummer ergäbe beim nächsten Export eine zweite – doppelte Konten in der
// Kanzlei). Kunden ohne Nummer laufen dann über das Sammelkonto (debitor_/kreditor_diverse).
// Die Antwort meldet das in X-BMD-Protokolliert / X-BMD-Nur-Lesen / X-BMD-Sammelkonto.
//
// CSV (KAN-54, 25.09.2026): Der Text kommt unverändert aus bmdCsv()/personenkontenCsv()
// (csvText mit PROFIL_BMD, byte-identisch laut Golden-Files); Download-Kopf (Content-Type CSV,
// attachment mit filename*, no-store, nosniff, X-Dateiname/X-Zeilen) und Fehler-JSON
// kommen aus lib/csv/antwort – die X-BMD-*-Header liest BmdClient wie bisher.

const STANDARD_ZAHLUNGSZIEL = 14

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return fehlerAntwort(401, 'Nicht autorisiert')
  if (!(await hatModul('modul_ea'))) return fehlerAntwort(403, 'Modul E&A-Rechnung nicht freigeschaltet')

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const sp = req.nextUrl.searchParams
  const art = sp.get('art') ?? 'ausgangsrechnungen'
  const von = sp.get('von') ?? ''
  const bis = sp.get('bis') ?? ''
  const nurNeue = sp.get('nurNeue') === '1'
  // KAN-5: Der Export selbst bleibt im Nur-Lesen-Modus erlaubt (Übergabe an den Steuerberater,
  // Aufbewahrungspflicht) – Protokoll und „übergeben“-Markierung werden dann nicht geschrieben.
  const nurLesen = (await schreibSperre(membership)) !== null
  const protokollieren = sp.get('protokollieren') === '1' && canWrite(membership, 'ea') && !nurLesen

  if (!['ausgangsrechnungen', 'eingangsbelege', 'stammdaten'].includes(art)) {
    return fehlerAntwort(400, 'Unbekannte Übergabeart')
  }
  if (art !== 'stammdaten' && (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis))) {
    return fehlerAntwort(400, 'Zeitraum (von/bis) fehlt')
  }

  // Mapping des Mandanten
  const { data: overrides, error: overridesErr } = await (supabase.from('buchhaltung_kontenmapping') as any)
    .select('schluessel, wert').eq('tenant_id', tenantId)
  // KAN-253: sonst exportierte ein Lesefehler still mit den Standardkonten
  if (overridesErr) return fehlerAntwort(500, `Kontenzuordnung konnte nicht geladen werden: ${overridesErr.message}`)
  const mapping = mappingAufloesen(Object.fromEntries(((overrides ?? []) as R[]).map(o => [o.schluessel, o.wert])))

  const konten = new Personenkonten(supabase, tenantId, mapping, nurLesen)

  let csv = ''
  let anzahl = 0
  let csvZeilen = 0
  let summe = 0
  let belegIds: { verkaufsposten: string[]; ea: string[]; rechnungen?: string[] } = { verkaufsposten: [], ea: [] }

  // KAN-253: ein Lesefehler bricht den Export ab – sonst ginge eine unvollständige Datei an die Steuerberatung
  try {
    if (art === 'ausgangsrechnungen') {
      const r = await ausgangsrechnungen(supabase, tenantId, mapping, konten, von, bis, nurNeue)
      csv = bmdCsv(r.zeilen); anzahl = r.anzahl; csvZeilen = r.zeilen.length; summe = r.summe; belegIds = r.ids
    } else if (art === 'eingangsbelege') {
      const r = await eingangsbelege(supabase, tenantId, mapping, konten, von, bis, nurNeue)
      csv = bmdCsv(r.zeilen); anzahl = r.anzahl; csvZeilen = r.zeilen.length; summe = r.summe; belegIds = r.ids
    } else {
      const r = await stammdaten(supabase, tenantId)
      csv = personenkontenCsv(r.zeilen); anzahl = r.zeilen.length; csvZeilen = r.zeilen.length
    }
  } catch (e) {
    return fehlerAntwort(500, e instanceof Error ? e.message : 'Export fehlgeschlagen')
  }

  if (anzahl === 0) {
    return fehlerAntwort(404, art === 'stammdaten'
      ? 'Noch keine Personenkonten vergeben - Nummern entstehen bei der ersten Übergabe von Ausgangsrechnungen bzw. Eingangsbelegen.'
      : (nurNeue ? 'Keine noch nicht übergebenen Belege im Zeitraum.' : 'Keine Belege im Zeitraum.'))
  }

  // Erstelldatum in Wiener Zeit (Vercel läuft in UTC – kurz vor Mitternacht sonst der Vortag)
  const dateiname = art === 'stammdaten'
    ? `BMD_Personenkonten_${wienHeute()}.csv`
    : `BMD_${art === 'ausgangsrechnungen' ? 'AR' : 'ER'}_${von}_${bis}.csv`

  // Protokoll + Markierung "übergeben"
  // KAN-246: Protokoll- und Markierungsfehler kamen nie an – die Seite meldete „übergeben und im Protokoll vermerkt“,
  // die Belege blieben aber „nicht übergeben“ und kamen beim nächsten Export mit „nur neue“ doppelt nach BMD
  let protokolliert = false
  const markierungsFehler: string[] = []
  if (protokollieren) {
    const { data: prot, error: protErr } = await (supabase.from('buchhaltung_export_protokoll') as any)
      .insert({
        tenant_id: tenantId, art,
        zeitraum_von: art === 'stammdaten' ? null : von,
        zeitraum_bis: art === 'stammdaten' ? null : bis,
        anzahl, summe_brutto: art === 'stammdaten' ? null : rund(summe, 2),
        dateiname, nur_neue: nurNeue, erstellt_von: user?.id ?? null,
      })
      .select('id').single()
    if (protErr) {
      markierungsFehler.push(`Protokoll: ${protErr.message}`)
      void ereignisMelden({ art: 'db', quelle: 'bmd/buchhaltung_export_protokoll', meldung: protErr.message })
    }
    protokolliert = !protErr
    const protId = (prot as R | null)?.id
    if (protId) {
      // Admin-Client: ea_transaktionen sind nach Monatsabschluss gesperrt
      // (RLS lässt UPDATE nur bei NOT is_locked zu) - die BMD-Markierung
      // muss trotzdem gesetzt werden, sie ändert den Beleg inhaltlich nicht.
      const admin = createSupabaseAdminClient()
      // bloecke() aus lib/supabase/alle (05.10.2026): vorher 500 IDs je Block (≈ 18 KB URL, Grenze ≈ 350 UUIDs) –
      // ab ≈ 350 Belegen scheiterte die Markierung, „nur neue“ hätte sie beim nächsten Export erneut geliefert
      // KAN-105: die Rechnung trägt die Markierung; ihre Lieferscheine zusätzlich (Zähler „noch nicht übergeben“ lesen dort)
      for (const block of bloecke(belegIds.rechnungen ?? [])) {
        { const { error: e } = await admin.from('rechnungen').update({ bmd_export_id: protId }).eq('tenant_id', tenantId).in('id', block)
          if (e) { markierungsFehler.push(`Rechnungen: ${e.message}`); void ereignisMelden({ art: 'db', quelle: 'bmd/rechnungen', meldung: e.message }) } }
      }
      for (const block of bloecke(belegIds.verkaufsposten)) {
        { const { error: e } = await admin.from('verkaufsposten').update({ bmd_export_id: protId }).eq('tenant_id', tenantId).in('id', block)
          if (e) { markierungsFehler.push(`Lieferscheine: ${e.message}`); void ereignisMelden({ art: 'db', quelle: 'bmd/verkaufsposten', meldung: e.message }) } }
      }
      for (const block of bloecke(belegIds.ea)) {
        { const { error: e } = await admin.from('ea_transaktionen').update({ bmd_export_id: protId }).eq('tenant_id', tenantId).in('id', block)
          if (e) { markierungsFehler.push(`E&A-Buchungen: ${e.message}`); void ereignisMelden({ art: 'db', quelle: 'bmd/ea_transaktionen', meldung: e.message }) } }
      }
    }
  }

  const antwort = csvAntwort(csv, dateiname, csvZeilen)
  antwort.headers.set('X-BMD-Anzahl', String(anzahl))
  antwort.headers.set('X-BMD-Summe', String(rund(summe, 2)))
  antwort.headers.set('X-BMD-Dateiname', dateiname)
  antwort.headers.set('X-BMD-Protokolliert', protokolliert ? '1' : '0')
  if (markierungsFehler.length) antwort.headers.set('X-BMD-Markierung-Fehler', encodeURIComponent(markierungsFehler.join(' · ').slice(0, 1500)))
  antwort.headers.set('X-BMD-Nur-Lesen', nurLesen ? '1' : '0')
  antwort.headers.set('X-BMD-Sammelkonto', String(konten.aufSammelkonto))
  return antwort
}



// ── Personenkonten-Vergabe ──────────────────────────────────────────────────
class Personenkonten {
  private cache = new Map<string, string>()
  /** Kunden/Lieferanten ohne eigene Nummer, die über das Sammelkonto laufen (Nur-Lesen-Modus bzw. Fehler) */
  aufSammelkonto = 0
  // ausgeschrieben statt Parameter-Properties: node:test lädt die Route im Strip-Modus (KAN-246)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private supabase: any
  private tenantId: string
  private mapping: Mapping
  private nurLesen: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(supabase: any, tenantId: string, mapping: Mapping, nurLesen = false) {
    this.supabase = supabase; this.tenantId = tenantId; this.mapping = mapping; this.nurLesen = nurLesen
  }

  /** Debitorenkonto für Firma (bevorzugt) oder Kontakt - vergibt bei Bedarf eine neue Nummer */
  async debitor(firma: R | null, kontakt: R | null): Promise<string> {
    if (firma?.id) return this.hole('firmen', 'debitor_nr', firma, 'debitor', Number(this.mapping.debitor_basis))
    if (kontakt?.id) return this.hole('kontakte', 'debitor_nr', kontakt, 'debitor', Number(this.mapping.debitor_basis))
    return this.mapping.debitor_diverse
  }

  /** Kreditorenkonto für Firma - vergibt bei Bedarf eine neue Nummer */
  async kreditor(firma: R | null): Promise<string> {
    if (firma?.id) return this.hole('firmen', 'kreditor_nr', firma, 'kreditor', Number(this.mapping.kreditor_basis))
    return this.mapping.kreditor_diverse
  }

  private async hole(tabelle: string, spalte: string, zeile: R, artKonto: 'debitor' | 'kreditor', basis: number): Promise<string> {
    const key = `${tabelle}:${zeile.id}:${spalte}`
    const vorhanden = this.cache.get(key) ?? (zeile[spalte] ? String(zeile[spalte]).trim() : '')
    if (vorhanden) { this.cache.set(key, vorhanden); return vorhanden }
    const sammel = artKonto === 'debitor' ? this.mapping.debitor_diverse : this.mapping.kreditor_diverse
    const sammelkonto = () => { this.aufSammelkonto++; this.cache.set(key, sammel); return sammel }
    // KAN-5: im Nur-Lesen-Modus keine neue Nummer vergeben (siehe Kopf)
    if (this.nurLesen) return sammelkonto()
    const { data: nr, error: nrFehler } = await this.supabase.rpc('get_next_personenkonto', { p_tenant_id: this.tenantId, p_art: artKonto, p_basis: basis })
    if (nrFehler || !nr) {
      if (nrFehler) void ereignisMelden({ art: 'db', quelle: 'bmd/get_next_personenkonto', meldung: nrFehler.message })
      return sammelkonto()
    }
    const neu = String(nr)
    // Nummer nur verwenden, wenn sie auch gespeichert ist – sonst gäbe es beim nächsten Export eine zweite
    const { data: gespeichert, error: ue } = await this.supabase.from(tabelle).update({ [spalte]: neu }).eq('id', zeile.id).eq('tenant_id', this.tenantId).select('id')
    if (ue || !((gespeichert ?? []) as R[]).length) {
      void ereignisMelden({ art: 'db', quelle: `bmd/${tabelle}.${spalte}`, meldung: ue?.message ?? 'Personenkonto nicht gespeichert (0 Zeilen)' })
      return sammelkonto()
    }
    this.cache.set(key, neu)
    return neu
  }
}

// ── Ausgangsrechnungen (Verkauf + manuelle Einnahmen) ───────────────────────
async function ausgangsrechnungen(supabase: any, tenantId: string, m: Mapping, konten: Personenkonten, von: string, bis: string, nurNeue: boolean) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const zeilen: BmdZeile[] = []
  const ids = { verkaufsposten: [] as string[], ea: [] as string[], rechnungen: [] as string[] }
  let anzahl = 0, summe = 0

  // KAN-105: Beleg = Rechnung (rechnungen) mit den Positionen aller ihrer Lieferscheine; Belegdatum = Rechnungsdatum
  // KAN-379: auch Stornobelege (Gutschrift, negative Beträge) und Rechnungen mit Stornobeleg (aus der Momentaufnahme –
  // in ihrem Zeitraum weiter wirksam, wie die UVA); vor KAN-379 stornierte Rechnungen ohne Stornobeleg wie bisher nicht
  // storno-sichtbar: KAN-379 – Rechnungen mit Stornobeleg zählen in ihrem Zeitraum, der Stornobeleg bucht gegen
  let q = (supabase.from('rechnungen') as any)
    .select(`id, datum, rechnungsnummer, aktiv, storniert, skonto_pct, skonto_tage, skonto_aktiv, bmd_export_id, storno_positionen,
      ${STORNO_FELDER},
      kontakt:kontakte!kontakt_id(id, vorname, nachname, land, zahlungsziel_tage, debitor_nr),
      firma:firmen!firma_id(id, name, land, zahlungsziel_tage, debitor_nr),
      ${lieferscheineSelect('typ, name, preis_brutto, menge, rabatt_pct, sonderrabatt_pct, ust_satz, traubenverkauf_id')}`)
    .eq('tenant_id', tenantId).eq('aktiv', true).or(STORNIERT_ZAEHLT)
    .gte('datum', von).lte('datum', bis)
  if (nurNeue) q = q.is('bmd_export_id', null)
  const { data: roh, error: rohErr } = await alle<R>(q.order('datum').order('id'))
  if (rohErr) throw new AktionsFehler(`Verkäufe konnten nicht geladen werden: ${rohErr.message}`)
  const posten = roh.filter(zaehltMitBetrag).map(alsBeleg)

  for (const p of posten) {
    const firma = p.firma ?? null, kontakt = p.kontakt ?? null
    const land = firma?.land ?? kontakt?.land ?? 'AT'
    const name = firma?.name ?? [kontakt?.vorname, kontakt?.nachname].filter(Boolean).join(' ') ?? 'Barverkauf'
    const zahlungsziel = Number(firma?.zahlungsziel_tage ?? kontakt?.zahlungsziel_tage ?? STANDARD_ZAHLUNGSZIEL)
    const kopf = bmdRechnungKopf(p, name)
    const belegnr = kopf.belegnr

    // Positionen je Erlöskonto/Steuersatz zusammenfassen -> eine BMD-Zeile je Gruppe
    const gruppen = new Map<string, { schluessel: string; satz: number; fall: ReturnType<typeof steuerfall>; brutto: number }>()
    for (const pos of (p.verkauf_positionen ?? []) as R[]) {
      const brutto = (Number(pos.preis_brutto) || 0) * (Number(pos.menge) || 0)
        * (1 - (Number(pos.rabatt_pct) || 0) / 100) * (1 - (Number(pos.sonderrabatt_pct) || 0) / 100)
      if (!brutto) continue
      const satz = Number(pos.ust_satz) || 0
      const fall = steuerfall(satz, land)
      const schluessel = erloesSchluessel(pos.typ, !!pos.traubenverkauf_id, satz, fall)
      const key = `${schluessel}|${satz}`
      const g = gruppen.get(key) ?? { schluessel, satz, fall, brutto: 0 }
      g.brutto += brutto
      gruppen.set(key, g)
    }
    if (gruppen.size === 0) continue

    const debitor = await konten.debitor(firma, kontakt)
    for (const g of gruppen.values()) {
      const brutto = rund(g.brutto, 2)
      const netto = rund(brutto / (1 + g.satz / 100), 2)
      zeilen.push({
        satzart: '0', konto: debitor, gkonto: m[g.schluessel],
        belegnr, belegdatum: bmdDatum(p.datum), buchdatum: bmdDatum(p.datum),
        buchsymbol: m.buchsymbol_ar, buchcode: '1',
        prozent: g.satz, steuercode: steuercodeFuer(g.fall, m),
        betrag: brutto, steuer: rund((brutto - netto), 2),
        text: kopf.text, kost: '', extbelegnr: kopf.extbelegnr,
        nettodatum: bmdDatum(kopf.gutschrift ? p.datum : datumPlusTage(p.datum, zahlungsziel)),
        skontopz: !kopf.gutschrift && p.skonto_aktiv && Number(p.skonto_pct) > 0 ? Number(p.skonto_pct) : 0,
        dokument: '',
      })
      summe += brutto
    }
    anzahl++
    ids.rechnungen.push(p.id)
    ids.verkaufsposten.push(...p.verkaufsposten_ids)
  }

  // Manuelle Einnahmen aus der E&A-Rechnung (ohne Verkaufsbeleg dahinter)
  // storno-sichtbar: BMD-Übergabe überträgt Stornos und Gegenbuchungen bewusst mit (KAN-149)
  let qe = (supabase.from('ea_transaktionen') as any)
    .select(`id, datum, beschreibung, betrag_brutto, betrag_netto, ust_satz, ust_betrag, bank_ref, bmd_export_id,
      storno_von_id,
      kategorie:ea_kategorien!kategorie_id(name, konto_nr),
      firma:firmen!firma_id(id, name, land, zahlungsziel_tage, debitor_nr),
      ea_belege(dateiname)`)
    .eq('tenant_id', tenantId).eq('typ', 'einnahme').is('verkaufsposten_id', null)
    .gte('datum', von).lte('datum', bis)
  if (nurNeue) qe = qe.is('bmd_export_id', null)
  const { data: einnahmen, error: einnahmenErr } = await alle<R>(qe.order('datum').order('id'))
  if (einnahmenErr) throw new AktionsFehler(`E&A-Einnahmen konnten nicht geladen werden: ${einnahmenErr.message}`)
  const eaBelegnr = await belegnrMitStorno(supabase, tenantId, einnahmen)

  for (const t of einnahmen) {
    const brutto = Number(t.betrag_brutto) || 0
    if (!brutto) continue
    const satz = Number(t.ust_satz) || 0
    const land = t.firma?.land ?? 'AT'
    const fall = steuerfall(satz, land)
    const belegnr = eaBelegnr(t)
    zeilen.push({
      satzart: '0', konto: await konten.debitor(t.firma ?? null, null),
      gkonto: t.kategorie?.konto_nr ? String(t.kategorie.konto_nr).padStart(4, '0') : m.ertrag_fallback,
      belegnr, belegdatum: bmdDatum(t.datum), buchdatum: bmdDatum(t.datum),
      buchsymbol: m.buchsymbol_ar, buchcode: '1',
      prozent: satz, steuercode: steuercodeFuer(fall, m),
      betrag: brutto, steuer: Number(t.ust_betrag) || 0,
      text: bmdText(t.beschreibung || t.kategorie?.name || 'Einnahme'), kost: '', extbelegnr: '',
      nettodatum: bmdDatum(t.datum), skontopz: 0,
      dokument: ((t.ea_belege ?? []) as R[])[0]?.dateiname ?? '',
    })
    summe += brutto
    anzahl++
    ids.ea.push(t.id)
  }

  return { zeilen, anzahl, summe, ids }
}

// KAN-149 D2c: Eine Gegenbuchung (Storno, negativer Betrag) trägt die Belegnummer des stornierten Originals – BMD
// gleicht damit den offenen Posten aus; das Original kann schon übergeben sein.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function belegnrMitStorno(supabase: any, tenantId: string, zeilen: R[]): Promise<(t: R) => string> {
  const ids = [...new Set(zeilen.map(t => t.storno_von_id).filter(Boolean))] as string[]
  const original = new Map<string, R>()
  if (ids.length) {
    // inBloecken: viele Stornos in einem Exportzeitraum sprengten sonst die URL (≈ 350 IDs)
    // storno-sichtbar: Originale der Gegenbuchungen (bank_ref) für die BMD-Stornozeile
    const { data, error } = await inBloecken<R>(ids, b => alle<R>(supabase.from('ea_transaktionen').select('id, bank_ref').eq('tenant_id', tenantId).in('id', b).order('id')))
    if (error) throw new AktionsFehler(`Stornierte Buchungen konnten nicht geladen werden: ${error.message}`)
    for (const o of data) original.set(o.id, o)
  }
  return t => {
    const b = (t.storno_von_id && original.get(t.storno_von_id)) || t
    return b.bank_ref || `EA-${String(b.id).slice(0, 8).toUpperCase()}`
  }
}

// ── Eingangsbelege (Ausgaben der E&A-Rechnung) ──────────────────────────────
async function eingangsbelege(supabase: any, tenantId: string, m: Mapping, konten: Personenkonten, von: string, bis: string, nurNeue: boolean) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const zeilen: BmdZeile[] = []
  const ids = { verkaufsposten: [] as string[], ea: [] as string[] }
  let anzahl = 0, summe = 0

  // storno-sichtbar: BMD-Übergabe überträgt Stornos und Gegenbuchungen bewusst mit (KAN-149)
  let q = (supabase.from('ea_transaktionen') as any)
    .select(`id, datum, beschreibung, betrag_brutto, betrag_netto, ust_satz, ust_betrag, bank_ref, bmd_export_id,
      storno_von_id,
      kategorie:ea_kategorien!kategorie_id(name, konto_nr),
      firma:firmen!firma_id(id, name, land, zahlungsziel_tage, kreditor_nr),
      ea_belege(dateiname)`)
    .eq('tenant_id', tenantId).eq('typ', 'ausgabe')
    .gte('datum', von).lte('datum', bis)
  if (nurNeue) q = q.is('bmd_export_id', null)
  const { data: ausgaben, error: ausgabenErr } = await alle<R>(q.order('datum').order('id'))
  if (ausgabenErr) throw new AktionsFehler(`E&A-Ausgaben konnten nicht geladen werden: ${ausgabenErr.message}`)
  const eaBelegnr = await belegnrMitStorno(supabase, tenantId, ausgaben)

  for (const t of ausgaben) {
    const brutto = Number(t.betrag_brutto) || 0
    if (!brutto) continue
    const satz = Number(t.ust_satz) || 0
    const zahlungsziel = Number(t.firma?.zahlungsziel_tage ?? STANDARD_ZAHLUNGSZIEL)
    const belegnr = eaBelegnr(t)
    const lieferant = t.firma?.name ? `${t.firma.name}: ` : ''
    zeilen.push({
      satzart: '0', konto: await konten.kreditor(t.firma ?? null),
      gkonto: t.kategorie?.konto_nr ? String(t.kategorie.konto_nr).padStart(4, '0') : m.aufwand_fallback,
      belegnr, belegdatum: bmdDatum(t.datum), buchdatum: bmdDatum(t.datum),
      buchsymbol: m.buchsymbol_er, buchcode: '2',
      prozent: satz, steuercode: satz > 0 ? m.steuercode_vst : m.steuercode_frei,
      betrag: brutto, steuer: Number(t.ust_betrag) || 0,
      text: bmdText(`${lieferant}${t.beschreibung || t.kategorie?.name || 'Ausgabe'}`), kost: '', extbelegnr: '',
      nettodatum: bmdDatum(datumPlusTage(t.datum, zahlungsziel)), skontopz: 0,
      dokument: ((t.ea_belege ?? []) as R[])[0]?.dateiname ?? '',
    })
    summe += brutto
    anzahl++
    ids.ea.push(t.id)
  }

  return { zeilen, anzahl, summe, ids }
}

// ── Stammdaten: alle bereits vergebenen Personenkonten ──────────────────────
async function stammdaten(supabase: any, tenantId: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const zeilen: PersonenkontoZeile[] = []
  const tel = (vw: string | null, nr: string | null) => nr ? [vw, nr].filter(Boolean).join(' ') : ''

  const { data: firmen, error: firmenErr } = await alle<R>((supabase.from('firmen') as any)
    .select('id, name, strasse, plz, ort, land, uid_nummer, email, telefon_vorwahl, telefon, zahlungsziel_tage, skonto_pct, skonto_tage, accountnummer, debitor_nr, kreditor_nr')
    .eq('tenant_id', tenantId).or('debitor_nr.not.is.null,kreditor_nr.not.is.null')
    .order('name').order('id'))
  if (firmenErr) throw new AktionsFehler(`Firmen konnten nicht geladen werden: ${firmenErr.message}`)
  for (const f of firmen) {
    const basis = {
      name: f.name ?? '', strasse: f.strasse ?? '', plz: f.plz ?? '', ort: f.ort ?? '', land: f.land ?? 'AT',
      uid: f.uid_nummer ?? '', email: f.email ?? '', telefon: tel(f.telefon_vorwahl, f.telefon),
      zahlungsziel: f.zahlungsziel_tage ?? '', skontopz: f.skonto_pct ?? '', skontotage: f.skonto_tage ?? '',
      extnummer: f.accountnummer ?? '',
    }
    if (f.debitor_nr)  zeilen.push({ kontonummer: String(f.debitor_nr),  kontoart: 'D', ...basis })
    if (f.kreditor_nr) zeilen.push({ kontonummer: String(f.kreditor_nr), kontoart: 'K', ...basis })
  }

  const { data: kontakte, error: kontakteErr } = await alle<R>((supabase.from('kontakte') as any)
    .select('id, vorname, nachname, strasse, plz, ort, land, email, telefon_vorwahl, telefon, zahlungsziel_tage, skonto_pct, skonto_tage, accountnummer, debitor_nr')
    .eq('tenant_id', tenantId).not('debitor_nr', 'is', null)
    .order('nachname').order('id'))
  if (kontakteErr) throw new AktionsFehler(`Kontakte konnten nicht geladen werden: ${kontakteErr.message}`)
  for (const k of kontakte) {
    zeilen.push({
      kontonummer: String(k.debitor_nr), kontoart: 'D',
      name: [k.vorname, k.nachname].filter(Boolean).join(' '), strasse: k.strasse ?? '', plz: k.plz ?? '', ort: k.ort ?? '', land: k.land ?? 'AT',
      uid: '', email: k.email ?? '', telefon: tel(k.telefon_vorwahl, k.telefon),
      zahlungsziel: k.zahlungsziel_tage ?? '', skontopz: k.skonto_pct ?? '', skontotage: k.skonto_tage ?? '',
      extnummer: k.accountnummer ?? '',
    })
  }

  zeilen.sort((a, b) => a.kontonummer.localeCompare(b.kontonummer))
  return { zeilen }
}
