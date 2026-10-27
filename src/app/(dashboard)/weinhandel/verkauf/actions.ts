'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canWrite, getCurrentMembership, type Membership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { syncEaEinnahmeFuerVerkauf } from '@/app/(dashboard)/buchhaltung/actions'
import { fmtEur, fmtNum, dezimal } from '@/lib/format'
import { AktionsFehler, dbFehlerText, erwarteteDbAblehnung, fehlerText, LESE_WAEHLEN_MELDUNG } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { rechnungPreiseAusFormular } from '@/lib/verkauf/rechnungen'
import { ladeRechnungsKontext } from '@/lib/verkauf/rechnungsKontext'
import { rechnungsdatumFehler } from '@/lib/verkauf/rechnungsdatum'
import { alle } from '@/lib/supabase/alle'
import { sonstigeLagerFehler } from '@/lib/warenwirtschaft/sonstigeProdukte'
import { lieferadresseAus, lieferadresseFehler, lieferadresseMoment, type Lieferadresse, type LieferadresseMoment } from '@/lib/crm/lieferadressen'
import { normalisiereLand } from '@/lib/katalog/laender'
import { traubenverkaufLese } from '@/lib/wein/leseBilanz'
import { qualitaetFehler } from '@/lib/wein/qualitaet'
import { mostgewichtAusWert, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import type { Mostgewicht } from '@/lib/wein/mostgewicht'
import { verkaufKundeFehler, flaschePruefnummerFehler } from '@/lib/handel/partnerPflicht'
import { ladePartner } from '@/lib/handel/partnerLaden'
import {
  bestandBuchenAllesOderNichts,
  bestandsBuchungenZuruecknehmen,
  pruefeVerkaufsRechte,
  verkaufspostenStornieren,
  LITER_TOLERANZ,
  type BestandsBuchung,
} from '@/lib/verkauf/bestand'
import { heuteWien } from '@/lib/datum/wien'
import { rund } from '@/lib/zahl/runden'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getMembership(): Promise<Membership> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership
}

async function getTenantId(): Promise<string> {
  return (await getMembership()).tenantId
}

/** KAN-239: Zahlungen erfassen, als bezahlt markieren, stornieren – wie RLS/RPC (modul_insert auf zahlungen,
 *  s112_zahlung_stornieren): Freigabe Warenwirtschaft oder E&A. Vorab geprüft, damit statt einer technischen
 *  RLS-Meldung eine verständliche kommt und nichts halb geschrieben wird. */
const ZAHLUNG_RECHTE_MELDUNG = 'Keine Berechtigung für Zahlungen – dafür ist die Freigabe Warenwirtschaft oder E&A nötig.'
async function getZahlungsKontext(): Promise<string> {
  const m = await getMembership()
  if (!canWrite(m, 'warenwirtschaft') && !canWrite(m, 'ea')) throw new AktionsFehler(ZAHLUNG_RECHTE_MELDUNG)
  return m.tenantId
}

// KAN-149 Nebenbefund 2: Die Zahlung ist zu diesem Zeitpunkt schon gespeichert bzw. gelöscht.
// Scheitert die abgeleitete E&A-Einnahme, muss das sichtbar sein – bisher wurde das Ergebnis
// ignoriert und die Einnahme fehlte still in der E&A-Rechnung und der UVA. Keine Aufforderung,
// die Zahlung erneut zu speichern: das Formular legte eine zweite Zahlung an, und die nächste
// Synchronisierung buchte den doppelten Zahlungseingang in die E&A.
const EA_VORGANG = {
  gespeichert: 'Die Zahlung ist gespeichert (bitte nicht erneut erfassen)',
  storniert:   'Die Zahlung ist storniert',
  verkauf:     'Der Verkauf ist storniert',
  bezahlt:     'Der Verkauf ist als bezahlt markiert (Zahlung bitte nicht erneut erfassen)',
} as const

function eaErgebnisPruefen(ea: { ok: boolean; error?: string }, vorgang: keyof typeof EA_VORGANG): void {
  if (!ea.ok) {
    const grund = (ea.error ?? 'unbekannter Fehler').replace(/[.\s]+$/, '')
    throw new AktionsFehler(`${EA_VORGANG[vorgang]}, die Einnahme in der E&A-Rechnung wurde aber nicht aktualisiert: ${grund}. Bitte die E&A-Rechnung prüfen (lassen).`)
  }
}

// Positions-Typ aus der Form
const POSITIONS_TYPEN = ['flasche', 'tank', 'sonstiges', 'trauben'] as const
interface PositionInput {
  typ:               typeof POSITIONS_TYPEN[number]
  fuellung_id:       string | null
  weinausbau_id:     string | null
  // KAN-35: Tankverkauf nur noch aus Kellerbuch-Chargen – gesetzte Werte werden abgelehnt
  // (Felder bleiben nur, damit ältere Formulare/Aufrufer eine klare Meldung bekommen)
  zukauf_id?:             string | null
  pressung_behaelter_id?: string | null
  name:                  string
  menge:             number
  einheit:           string
  preis_brutto:      number | null
  rabatt_pct?:       number
  sonderrabatt_pct?: number
  ust_satz?:         number
  // Traubenverkauf-spezifische BKI-Felder
  trauben_weingarten_id?:   string | null
  trauben_jahrgang_id?:     string | null
  /** KAN-129: Lese der Trauben (Auswahl im Formular); ohne Angabe nach Datum wie die Datenbank */
  trauben_lese_id?:         string | null
  trauben_grundstueck_id?:  string | null
  /** Mostgewicht (KAN-128): Messwert wie eingegeben und gemessene Einheit – beide Werte rechnet der Server */
  trauben_mostgewicht_wert?:    string | number | null
  trauben_mostgewicht_einheit?: string | null
  /** älteres Format (vor KAN-128): °KMW als Zahl – gilt als °KMW-Messung */
  trauben_kmw_grad?:        number | null
  trauben_qualitaetsstufe?: string | null
  trauben_herkunft_code?:   string | null
  trauben_gesundheit?:      'G' | 'K'
  /** KAN-115: Sonstiges Produkt der Position (nur Typ sonstiges) */
  sonstige_artikel_id?:     string | null
}

const NUR_CHARGE_HINWEIS =
  'Offener Wein (Tank) kann nur aus einer Kellerbuch-Charge verkauft werden. ' +
  'Zukäufe bitte zuerst über „Zukauf bearbeiten“ einem Gebinde zuordnen – dabei entsteht die Charge –, dann die Charge verkaufen.'

// ── Prüfung aller Positionen VOR dem ersten Schreibzugriff (KAN-35) ───────────
// Bugreport 6.8.2026: eine Kellerbuch-Charge mit bereits 0 L Bestand liess sich
// trotzdem "verkaufen" – der Bestand wurde nachträglich bei 0 gekappt (Math.max(0, …)).
// Seit KAN-35 wird VOR dem Anlegen von Rechnungsnummer, Verkaufsposten und Positionen
// geprüft und abgelehnt: Schreibrechte (Tank braucht zusätzlich Kellerbuch/Rieden),
// Menge > 0, Tank nur aus Charge, Verfügbarkeit je Charge bzw. Füllung – über ALLE
// Positionen summiert (zwei Positionen derselben Charge zählen zusammen). Die Abbuchung
// selbst kappt nicht mehr; die DB-CHECKs sind das Sicherheitsnetz.

/**
 * KAN-115: Positionen „Sonstiges“ mit Produkt prüfen – das Produkt gehört dem Betrieb; führt es Lagerstand, muss die
 * Menge > 0 sein und (über alle Positionen summiert) auf Lager liegen. Ergebnis: ob mindestens ein Produkt mit Lagerstand
 * dabei ist (dann bucht createVerkauf über s112_artikel_verkauf_buchen ab).
 */
/**
 * KAN-176: Lieferadresse aus dem Formular (`lieferadresse_id` bzw. `lieferadresse_json` + `lieferadresse_speichern`).
 * Eine gespeicherte Adresse muss dem gewählten Kunden gehören und aktiv sein; eine neue wird geprüft und – auf Wunsch –
 * beim Kunden gespeichert. Ergebnis: Momentaufnahme für den Verkauf (null = Rechnungsadresse).
 */
async function lieferadresseVorbereiten(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string, formData: FormData, kontaktId: string | null, firmaId: string | null,
): Promise<{ moment: LieferadresseMoment; id: string | null } | null> {
  const lid = String(formData.get('lieferadresse_id') ?? '').trim()
  const roh = String(formData.get('lieferadresse_json') ?? '').trim()
  if (!lid && !roh) return null
  if (!kontaktId && !firmaId) throw new AktionsFehler('Eine abweichende Lieferadresse gibt es nur mit einem Kunden.')
  if (lid) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('lieferadressen') as any)
      .select('id, kontakt_id, firma_id, bezeichnung, empfaenger, strasse, plz, ort, land, aktiv').eq('id', lid).eq('tenant_id', tenantId).maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Lieferadresse konnte nicht geladen werden'))
    const a = data as AR | null
    if (!a || !a.aktiv || (firmaId ? a.firma_id !== firmaId : a.kontakt_id !== kontaktId)) {
      throw new AktionsFehler('Die gewählte Lieferadresse gehört nicht zu diesem Kunden oder ist deaktiviert – bitte neu wählen.')
    }
    return { moment: lieferadresseMoment(a as Lieferadresse), id: String(a.id) }
  }
  let obj: Record<string, unknown>
  try { obj = JSON.parse(roh) } catch { throw new AktionsFehler('Ungültige Lieferadresse.') }
  const landRoh = typeof obj.land === 'string' ? obj.land.trim() : ''
  const land = landRoh ? normalisiereLand(landRoh) : 'AT'
  if (!land) throw new AktionsFehler(`Unbekanntes Land „${landRoh}“ in der Lieferadresse – bitte ein Land aus der Liste wählen.`)
  const a = lieferadresseAus(obj, land)
  const fehler = lieferadresseFehler(a)
  if (fehler) throw new AktionsFehler(fehler)
  let id: string | null = null
  if (formData.get('lieferadresse_speichern') === '1') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('lieferadressen') as any)
      .insert({ tenant_id: tenantId, kontakt_id: firmaId ? null : kontaktId, firma_id: firmaId, ...lieferadresseMoment(a) })
      .select('id').single()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Die Lieferadresse konnte nicht beim Kunden gespeichert werden'))
    id = String((data as AR).id)
  }
  return { moment: lieferadresseMoment(a), id }
}

/** KAN-176: aktive Lieferadressen eines Kunden (Kontakt oder Firma) für die Auswahl im Verkaufsformular */
// schreibsperre-ausnahme: liest nur die Lieferadressen eines Kunden, schreibt nichts
export async function lieferadressenDesKunden(kontaktId: string | null, firmaId: string | null): Promise<(Lieferadresse & { id: string })[]> {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership || (!kontaktId && !firmaId)) return []
  // alle-ausnahme: Lieferadressen eines einzelnen Kunden, wenige
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('lieferadressen') as any).select('id, bezeichnung, empfaenger, strasse, plz, ort, land')
    .eq('tenant_id', membership.tenantId).eq('aktiv', true)
  q = firmaId ? q.eq('firma_id', firmaId) : q.eq('kontakt_id', kontaktId)
  const { data, error } = await q.order('erstellt_am').limit(200)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Lieferadressen konnten nicht geladen werden'))
  return (data ?? []) as (Lieferadresse & { id: string })[]
}

async function pruefeSonstigeProdukte(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  positionen: PositionInput[],
): Promise<boolean> {
  const ids = [...new Set(positionen.filter(p => p?.typ === 'sonstiges' && p.sonstige_artikel_id).map(p => String(p.sonstige_artikel_id)))]
  if (ids.length === 0) return false
  // alle-ausnahme: Produkte eines einzelnen Verkaufs, wenige
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: art, error } = await (supabase.from('sonstige_artikel') as any)
    .select('id, name, einheit, bestand_fuehren').eq('tenant_id', tenantId).in('id', ids)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Sonstige Produkte konnten nicht geladen werden'))
  const jeId = new Map(((art ?? []) as AR[]).map(a => [String(a.id), a]))
  const mitLager = ids.filter(id => jeId.get(id)?.bestand_fuehren)
  for (const id of ids) if (!jeId.has(id)) throw new AktionsFehler('Ein gewähltes Sonstiges Produkt gibt es nicht (mehr) – bitte neu auswählen.')
  if (mitLager.length === 0) return false
  // alle-ausnahme: Bewegungen der Produkte eines einzelnen Verkaufs (Summe je Produkt)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bew, error: bErr } = await alle<AR>((supabase.from('sonstige_artikel_bewegungen') as any)
    .select('artikel_id, menge').eq('tenant_id', tenantId).in('artikel_id', mitLager).order('id'))
  if (bErr) throw new AktionsFehler(dbFehlerText(bErr, 'Lagerstand der Sonstigen Produkte konnte nicht geladen werden'))
  const fehler = sonstigeLagerFehler(positionen, ((art ?? []) as AR[]).map(a => ({ id: String(a.id), name: String(a.name), einheit: String(a.einheit), bestand_fuehren: !!a.bestand_fuehren })), (bew ?? []) as { artikel_id: string; menge: number | string }[])
  if (fehler) throw new AktionsFehler(fehler)
  return true
}

async function pruefePositionen(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  membership: Membership,
  positionen: PositionInput[],
  datum: string,
): Promise<{ literJeCharge: Map<string, number>; stueckJeFuellung: Map<string, number>; mostgewichtJePosition: (Mostgewicht | null)[]; leseJePosition: (string | null)[] }> {
  const tenantId = membership.tenantId
  const literJeCharge   = new Map<string, number>()
  const stueckJeFuellung = new Map<string, number>()
  const mostgewichtJePosition: (Mostgewicht | null)[] = []

  positionen.forEach((p, i) => {
    const nr = `Position ${i + 1}${p?.name ? ` („${String(p.name).trim()}“)` : ''}`
    if (!p || !POSITIONS_TYPEN.includes(p.typ)) throw new AktionsFehler(`${nr}: unbekannter Positionstyp`)
    if (!String(p.name ?? '').trim()) throw new AktionsFehler(`${nr}: Bitte eine Bezeichnung angeben.`)
    const menge = Number(p.menge)
    if (!Number.isFinite(menge)) throw new AktionsFehler(`${nr}: ungültige Menge`)
    if (p.typ !== 'sonstiges' && !(menge > 0)) {
      throw new AktionsFehler(`${nr}: Die Menge muss größer als 0 sein. Rücknahmen bitte als Storno des Verkaufs buchen.`)
    }
    if (p.zukauf_id || p.pressung_behaelter_id) throw new AktionsFehler(`${nr}: ${NUR_CHARGE_HINWEIS}`)

    if (p.typ === 'tank') {
      if (!p.weinausbau_id) throw new AktionsFehler(`${nr}: Bitte eine Kellerbuch-Charge auswählen. ${NUR_CHARGE_HINWEIS}`)
      literJeCharge.set(p.weinausbau_id, (literJeCharge.get(p.weinausbau_id) ?? 0) + menge)
    } else if (p.typ === 'flasche' && p.fuellung_id) {
      if (!Number.isInteger(menge)) throw new AktionsFehler(`${nr}: Flaschen bitte in ganzen Stück angeben.`)
      stueckJeFuellung.set(p.fuellung_id, (stueckJeFuellung.get(p.fuellung_id) ?? 0) + menge)
    } else if (p.typ === 'trauben' && !p.trauben_weingarten_id) {
      throw new AktionsFehler(`${nr}: Bitte den Weingarten (Ried) für den Traubenverkauf auswählen.`)
    }
    if (p.typ === 'trauben') {
      // KAN-73: Trauben-Qualität = Stufen der Lese (traubenverkauf hat keinen CHECK)
      const qualitaetUnzulaessig = qualitaetFehler('lese', p.trauben_qualitaetsstufe ?? null)
      if (qualitaetUnzulaessig) throw new AktionsFehler(`${nr}: ${qualitaetUnzulaessig}`)
      // KAN-128: Mostgewicht aus Messwert und Einheit (älteres Format: trauben_kmw_grad als °KMW) –
      // beide Werte serverseitig gerechnet; die Stufe bleibt, wie gewählt (Rechenregel 6)
      const mg = p.trauben_mostgewicht_wert !== null && p.trauben_mostgewicht_wert !== undefined && p.trauben_mostgewicht_wert !== ''
        ? mostgewichtAusWert(p.trauben_mostgewicht_wert, p.trauben_mostgewicht_einheit, nr)
        : mostgewichtAusWert(p.trauben_kmw_grad ?? null, 'kmw', nr)
      if (!mg.ok) throw new AktionsFehler(mg.fehler)
      mostgewichtJePosition[i] = mg.wert
    } else {
      mostgewichtJePosition[i] = null
    }
  })

  // Rechte wie RLS (Migration 218) – vorab, sonst bliebe ein Beleg ohne Abbuchung zurück
  pruefeVerkaufsRechte(membership, {
    tank: literJeCharge.size > 0,
    flasche: stueckJeFuellung.size > 0,
    vorgang: 'verkauf',
  })

  if (literJeCharge.size > 0) {
    const ids = [...literJeCharge.keys()]
    const { data, error } = await (supabase.from('weinausbau') as any)
      .select('id, name, menge_liter')
      .in('id', ids)
      .eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Bestand der Chargen konnte nicht geprüft werden'))
    const chargen = new Map(((data ?? []) as AR[]).map(w => [w.id as string, w]))
    for (const [id, bedarf] of literJeCharge) {
      const w = chargen.get(id)
      if (!w) throw new AktionsFehler('Eine ausgewählte Kellerbuch-Charge wurde nicht gefunden – bitte Seite neu laden.')
      const verfuegbar = Number(w.menge_liter ?? 0) || 0
      if (bedarf - verfuegbar >= LITER_TOLERANZ) {
        throw new AktionsFehler(
          `„${w.name}“: Menge (${fmtNum(bedarf)} L) überschreitet den verfügbaren Bestand (${fmtNum(verfuegbar)} L).`,
        )
      }
    }
  }

  if (stueckJeFuellung.size > 0) {
    const ids = [...stueckJeFuellung.keys()]
    const { data, error } = await (supabase.from('fuellungen') as any)
      .select('id, name, bestand_flaschen, qualitaet, zusatzbezeichnung, erzeugnis, pruefnummer, dac:dac_antrag_id(status)')
      .in('id', ids)
      .eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Flaschenbestand konnte nicht geprüft werden'))
    // KAN-208: ab Qualitätswein nur mit zugeteilter Prüfnummer (Entscheidung Jörgen 05.10.2026: ablehnen)
    for (const f of (data ?? []) as AR[]) {
      const pn = flaschePruefnummerFehler({ name: f.name ?? null, qualitaet: f.qualitaet ?? null, zusatzbezeichnung: f.zusatzbezeichnung ?? null,
        erzeugnis: f.erzeugnis ?? null, pruefnummer: f.pruefnummer ?? null, antragStatus: (f.dac as AR | null)?.status ?? null })
      if (pn) throw new AktionsFehler(pn)
    }
    const fuellungen = new Map(((data ?? []) as AR[]).map(f => [f.id as string, f]))
    for (const [id, bedarf] of stueckJeFuellung) {
      const f = fuellungen.get(id)
      if (!f) throw new AktionsFehler('Eine ausgewählte Füllung wurde nicht gefunden – bitte Seite neu laden.')
      const verfuegbar = Number(f.bestand_flaschen ?? 0) || 0
      if (bedarf > verfuegbar) {
        throw new AktionsFehler(`„${f.name ?? 'Abfüllung'}“: nur noch ${fmtNum(verfuegbar)} Flaschen verfügbar, ${fmtNum(bedarf)} angefragt.`)
      }
    }
  }

  // KAN-129: Trauben – Jahrgang des Betriebs (N5), Lese und kg-Bilanz je Lese. Positionen desselben Orts,
  // derselben Lese und desselben Jahrgangs werden summiert geprüft (wie Chargen und Füllungen oben).
  const leseJePosition: (string | null)[] = positionen.map(() => null)
  const gruppen = new Map<string, { idx: number[]; menge: number }>()
  positionen.forEach((p, i) => {
    if (p.typ !== 'trauben') return
    const k = [p.trauben_jahrgang_id ?? '', p.trauben_lese_id ?? '', p.trauben_weingarten_id ?? '', p.trauben_grundstueck_id ?? ''].join('|')
    const g = gruppen.get(k) ?? { idx: [], menge: 0 }
    g.idx.push(i); g.menge += Number(p.menge) || 0
    gruppen.set(k, g)
  })
  for (const g of gruppen.values()) {
    const p = positionen[g.idx[0]]
    let erg: { leseId: string | null; fehler: string | null }
    try {
      erg = await traubenverkaufLese(supabase, tenantId, {
        jahrgangId: p.trauben_jahrgang_id ?? null, weingartenId: p.trauben_weingarten_id ?? null,
        grundstueckId: p.trauben_grundstueck_id ?? null, zukaufPostenId: null, datum, mengeKg: g.menge,
        leseIdFormular: p.trauben_lese_id ?? null, leseWaehlenText: LESE_WAEHLEN_MELDUNG,
      })
    } catch (e) {
      throw new AktionsFehler(fehlerText(e, 'Die Lesemenge konnte nicht geprüft werden.'))
    }
    if (erg.fehler) throw new AktionsFehler(`Position ${g.idx[0] + 1}: ${erg.fehler}`)
    for (const i of g.idx) leseJePosition[i] = erg.leseId
  }
  return { literJeCharge, stueckJeFuellung, mostgewichtJePosition, leseJePosition }
}

/** Abgänge als negative Deltas (für bestandBuchenAllesOderNichts) */
function alsAbgang(m: Map<string, number>): Map<string, number> {
  return new Map([...m].map(([k, v]) => [k, -v]))
}

// ── Verkauf anlegen ───────────────────────────────────────────────────────────

// Reihenfolge (KAN-35): prüfen → Bestand abbuchen (alles oder nichts) → Rechnungsnummer →
// Posten → Positionen. Scheitert ein Schritt nach der Abbuchung, wird sie zurückgenommen;
// ein bereits angelegter Posten (Rechnungsnummer vergeben) wird sofort storniert. So bleibt
// weder ein Beleg ohne Abbuchung noch eine Abbuchung ohne Beleg zurück.
export async function createVerkauf(formData: FormData): Promise<{ id: string } | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId = membership.tenantId

  // Kopfdaten
  // KAN-208: Datum Pflicht – kein stilles „heute“
  const datum               = ((formData.get('datum') as string | null) ?? '').trim()
  if (!datum) throw new AktionsFehler('Bitte das Verkaufsdatum angeben.')
  const kontaktId      = (formData.get('kontakt_id') as string) || null
  const firmaId        = (formData.get('firma_id') as string) || null
  const zhKontaktId    = (formData.get('zh_kontakt_id') as string) || null
  const notizen        = (formData.get('notizen') as string) || null
  const skontoPct      = parseFloat(dezimal(formData.get('skonto_pct') as string)) || 0
  const skontoTage     = parseInt(dezimal(formData.get('skonto_tage') as string)) || 0
  const skontoAktiv    = formData.get('skonto_aktiv') === 'true'
  // KAN-103: „Rechnung später“ – nur Lieferschein, keine Rechnungsnummer (fehlt das Feld: sofort, wie bisher)
  const rechnungSpaeter = formData.get('rechnung_sofort') === 'false'

  // KAN-355: Mit „Rechnung sofort“ entsteht die Rechnung mit dem Verkaufsdatum – im abgeschlossenen Monat bzw. per UVA
  // übermittelten Zeitraum lehnt die Datenbank sie ab (a_ea_periodensperre an rechnungen). Vorab prüfen, vor jeder
  // Abbuchung, und als { error } zurückgeben (erwartbar, kein Systemfehler).
  if (!rechnungSpaeter) {
    const sperre = await rechnungsdatumFehler(supabase, tenantId, datum, heuteWien(), true)
    if (sperre) return { error: sperre }
  }

  // Positionen als JSON aus hidden input
  const posJson = formData.get('positionen_json') as string
  let positionen: PositionInput[] = []
  try {
    positionen = JSON.parse(posJson || '[]')
  } catch {
    throw new AktionsFehler('Ungültige Positions-Daten')
  }

  if (!Array.isArray(positionen) || positionen.length === 0) {
    throw new AktionsFehler('Mindestens eine Position erforderlich')
  }

  // KAN-208: Tank- und Traubenverkauf nur mit Kunde samt Betriebsnummer (Empfänger der Transportbescheinigung)
  {
    const typen = positionen.map(p => String(p?.typ ?? ''))
    const partner = typen.some(t => t === 'tank' || t === 'trauben') ? await ladePartner(supabase, tenantId, kontaktId, firmaId) : null
    const f = partner ? verkaufKundeFehler({ typen, kunde: partner.vorhanden, betriebNr: partner.betriebNr, kundeName: partner.name }) : null
    if (f) throw new AktionsFehler(f)
  }

  // ── Prüfung VOR dem ersten Schreibzugriff (auch vor der Rechnungsnummer –
  //    eine Ablehnung hinterlässt so keine Lücke im Nummernkreis)
  const { literJeCharge, stueckJeFuellung, mostgewichtJePosition, leseJePosition } = await pruefePositionen(supabase, membership, positionen, datum)
  // KAN-115: Sonstige Produkte – eigener Betrieb, mit Lagerstand genug auf Lager (Vorprüfung; die RPC prüft unter Sperre erneut)
  const mitLager = await pruefeSonstigeProdukte(supabase, tenantId, positionen)
  // KAN-176: abweichende Lieferadresse – gespeicherte des Kunden oder neu (optional beim Kunden speichern)
  const liefer = await lieferadresseVorbereiten(supabase, tenantId, formData, kontaktId, firmaId)

  // Beleg-ID vorab: die Flaschenzeilen (fuellung_bewegungen, KAN-149 D1) verweisen auf den Verkauf, der erst nach der
  // Abbuchung angelegt wird (keine Lücke im Nummernkreis bei einer Ablehnung, KAN-35)
  const postenId = randomUUID()

  // ── 1. Bestand abbuchen – alles oder nichts (vor Rechnungsnummer und Beleg; eine
  //    gleichzeitige Buchung wird per Vergleichen und Setzen erkannt, dann nichts geändert)
  let abbuchungen: BestandsBuchung[]
  try {
    abbuchungen = await bestandBuchenAllesOderNichts(supabase, tenantId, alsAbgang(literJeCharge), alsAbgang(stueckJeFuellung),
      { postenId, datum })
  } catch (e) {
    throw new AktionsFehler(`Der Verkauf wurde nicht gespeichert: ${fehlerText(e).replace(/[.\s]+$/, '')}.`)
  }

  // KAN-21: Die Rechnungsnummer vergibt die Datenbank beim Insert (Trigger a_rechnungsnummer, lückenlos) – sie steht erst
  // nach dem Anlegen des Belegs fest
  let rechnungsnummer: string | null = null

  /** Abbuchung zurücknehmen und mit Hinweis werfen (Beleg konnte nicht angelegt werden) */
  const abbruch = async (meldung: string, postenStornieren: string | null): Promise<never> => {
    const teile: string[] = [meldung.replace(/[.\s]+$/, '')]
    if (postenStornieren) {
      try {
        await verkaufspostenStornieren(supabase, tenantId, postenStornieren, 'Automatisch storniert: Verkauf konnte nicht vollständig gespeichert werden')
        teile.push(`Der angelegte Beleg${rechnungsnummer ? ` ${rechnungsnummer}` : ''} wurde sofort storniert`)
      } catch (e) {
        teile.push(`Achtung: Der angelegte Beleg${rechnungsnummer ? ` ${rechnungsnummer}` : ''} konnte nicht storniert werden (${fehlerText(e).replace(/[.\s]+$/, '')}) – bitte unter Verkauf stornieren`)
      }
    }
    const rueckFehler = await bestandsBuchungenZuruecknehmen(supabase, tenantId, abbuchungen)
    teile.push(rueckFehler.length
      ? `Achtung: Der bereits abgebuchte Bestand konnte nicht zurückgesetzt werden (${rueckFehler.join(' · ')}) – bitte Bestand prüfen und Support kontaktieren`
      : 'Der Bestand ist unverändert')
    throw new AktionsFehler(`${teile.join('. ')}.`)
  }

  // Transaktionsnummer vergeben
  const { data: txnVk, error: txnErr } = await (supabase.rpc as any)('get_next_transaktionsnr', { p_tenant_id: tenantId, p_typ: 'verkauf' })
  // KAN-253: sonst Beleg ohne Transaktionsnummer – Bestand zurücknehmen wie bei jedem Abbruch nach der Abbuchung
  if (txnErr) await abbruch(dbFehlerText(txnErr, 'Transaktionsnummer konnte nicht vergeben werden'), null)

  // 2. Verkaufsposten anlegen (UUID oben vergeben)
  const { data: postenNeu, error: postenErr } = await (supabase.from('verkaufsposten') as any).insert({
    id:              postenId,
    tenant_id:       tenantId,
    datum,
    transaktions_nr: txnVk ?? null,
    kontakt_id:      kontaktId  || null,
    firma_id:        firmaId    || null,
    zh_kontakt_id:   zhKontaktId || null,
    notizen,
    skonto_pct:      skontoAktiv ? skontoPct : 0,
    skonto_tage:     skontoAktiv ? skontoTage : 0,
    skonto_aktiv:    skontoAktiv,
    lieferadresse:    liefer?.moment ?? null,
    lieferadresse_id: liefer?.id ?? null,
    rechnung_spaeter: rechnungSpaeter,
  }).select('rechnungsnummer').single()

  if (postenErr) await abbruch(dbFehlerText(postenErr, 'Speichern fehlgeschlagen (verkaufsposten)'), null)
  rechnungsnummer = ((postenNeu as AR | null)?.rechnungsnummer as string | null | undefined) ?? null

  // 3. Positionen anlegen (bei Trauben: vorher BKI-Record anlegen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posInserts: any[] = []
  for (const [i, p] of positionen.entries()) {
    let traubenverkaufId: string | null = null

    if (p.typ === 'trauben') {
      // Liefernummer auto-generieren
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: lnData, error: lnErr } = await (supabase.rpc as any)('get_next_liefernummer', { p_tenant_id: tenantId })
      if (lnErr) await abbruch(dbFehlerText(lnErr, 'Liefernummer konnte nicht vergeben werden'), postenId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tv, error: tvErr } = await (supabase.from('traubenverkauf') as any)
        .insert({
          tenant_id:       tenantId,
          weingarten_id:   p.trauben_weingarten_id   ?? null,
          jahrgang_id:     p.trauben_jahrgang_id      ?? null,
          lese_id:         leseJePosition[i],
          grundstueck_id:  p.trauben_grundstueck_id   ?? null,
          kontakt_id:      kontaktId,
          firma_id:        firmaId,
          datum,
          menge_kg:        p.menge,
          preis_per_kg:    p.preis_brutto,
          ...mostgewichtSpalten(mostgewichtJePosition[i] ?? null, 'kmw_grad'),
          qualitaetsstufe: p.trauben_qualitaetsstufe  ?? null,
          herkunft_code:   p.trauben_herkunft_code    ?? null,
          gesundheit:      p.trauben_gesundheit       ?? 'G',
          liefernummer:    (lnData as string | null)  ?? null,
          verkaufsposten_id: postenId,
        })
        .select('id')
        .single()
      if (tvErr || !(tv as AR | null)?.id) {
        await abbruch(dbFehlerText(tvErr, 'Speichern fehlgeschlagen (traubenverkauf)'), postenId)
      }
      traubenverkaufId = (tv as AR).id as string
    }

    // Bezug je Typ: Flasche → Füllung, Tank → Charge. zukauf_id/pressung_behaelter_id
    // werden nicht mehr geschrieben (KAN-35, Tankverkauf nur aus Chargen).
    posInserts.push({
      tenant_id:             tenantId,
      verkaufsposten_id:     postenId,
      typ:                   p.typ,
      fuellung_id:           p.typ === 'flasche' ? (p.fuellung_id   || null) : null,
      weinausbau_id:         p.typ === 'tank'    ? (p.weinausbau_id || null) : null,
      traubenverkauf_id:     traubenverkaufId,
      sonstige_artikel_id:   p.typ === 'sonstiges' ? (p.sonstige_artikel_id || null) : null,
      name:                  p.name,
      menge:                 p.menge,
      einheit:               p.einheit || 'Stk',
      preis_brutto:          p.preis_brutto ?? null,
      rabatt_pct:            p.rabatt_pct ?? 0,
      sonderrabatt_pct:      p.sonderrabatt_pct ?? 0,
      ust_satz:              p.ust_satz ?? 13,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: posErr } = await (supabase.from('verkauf_positionen') as any).insert(posInserts)
  // Insert mehrerer Zeilen ist eine Anweisung: entweder alle Positionen oder keine
  if (posErr) await abbruch(dbFehlerText(posErr, 'Speichern fehlgeschlagen (verkauf_positionen)'), postenId)

  // KAN-115: Sonstige Produkte mit Lagerstand abbuchen – alles oder nichts; scheitert es, wird der Beleg storniert
  if (mitLager) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: lagerErr } = await (supabase.rpc as any)('s112_artikel_verkauf_buchen', { p_tenant_id: tenantId, p_verkaufsposten_id: postenId })
    if (lagerErr) await abbruch(dbFehlerText(lagerErr, 'Lagerstand der Sonstigen Produkte konnte nicht gebucht werden'), postenId)
  }

  // Ab hier ist der Verkauf vollständig gebucht – Folgeschritte (CRM, Lead-Status) dürfen
  // nicht mehr als Fehler zurückkommen, sonst speichert ein erneutes Absenden doppelt.

  // 4. CRM Aktivität auto-loggen (wenn Kontakt oder Firma angegeben)
  if (kontaktId || firmaId) {
    try {
      const gesamtBetrag = positionen.reduce((s, p) => {
        const brutto = (p.preis_brutto ?? 0) * p.menge
        const rabatt = (p.rabatt_pct ?? 0) / 100
        const sonder = (p.sonderrabatt_pct ?? 0) / 100
        return s + brutto * (1 - rabatt) * (1 - sonder)
      }, 0)
      const betreff = [
        rechnungsnummer ? `Verkauf ${rechnungsnummer}` : 'Verkauf',
        gesamtBetrag > 0
          ? fmtEur(gesamtBetrag)
          : null,
      ].filter(Boolean).join(' · ')

      const { data: { user } } = await supabase.auth.getUser()
      { const { error: e } = await (supabase.from('aktivitaeten') as any).insert({
        tenant_id:    tenantId,
        kontakt_id:   kontaktId  || null,
        firma_id:     firmaId    || null,
        art:          'verkauf',
        betreff,
        beschreibung: `Verkaufsposten: ${postenId}`,
        datum:        datum,
        erledigt:     true,
        erstellt_von: user?.id ?? null,
      })
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (aktivitaeten): ${e.message}`) }
    } catch {
      // CRM-Fehler nicht auf Verkauf durchschlagen
    }
  }

  // Lead → Kunde automatisch umstellen nach erstem Verkauf (nicht kritisch: der Verkauf
  // ist gespeichert; ohne CRM-Freigabe filtert RLS das Update ohnehin still)
  if (kontaktId) {
    { const { error: e } = await (supabase.from('kontakte') as any)
      .update({ is_lead: false })   // aenderung-ohne-pruefung: Lead-Status nur, solange noch Lead (is_lead = true) – sonst 0 Zeilen
      .eq('id', kontaktId)
      .eq('tenant_id', tenantId)
      .eq('is_lead', true)  // nur wenn noch Lead
      if (e) console.error('createVerkauf – Lead-Status (kontakte):', dbFehlerText(e)) }
  }
  if (firmaId) {
    { const { error: e } = await (supabase.from('firmen') as any)
      .update({ is_lead: false })   // aenderung-ohne-pruefung: Lead-Status nur, solange noch Lead (is_lead = true) – sonst 0 Zeilen
      .eq('id', firmaId)
      .eq('tenant_id', tenantId)
      .eq('is_lead', true)
      if (e) console.error('createVerkauf – Lead-Status (firmen):', dbFehlerText(e)) }
  }

  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  revalidatePath('/crm/kontakte')
  revalidatePath('/crm/firmen')

  return { id: postenId }
}

// ── Verkauf deaktivieren – abgeschafft (KAN-35) ───────────────────────────────
// „Löschen ohne Bestandskorrektur“ ließ die Ware als abgegangen stehen, während der
// Beleg aus allen Listen, Umsätzen und der E&A verschwand. Verkäufe werden seit
// KAN-35 nur noch storniert (stornoVerkauf: Bestand zurück, Beleg bleibt als storniert
// sichtbar). Die Action bleibt als harte Ablehnung bestehen, damit ältere, noch
// geöffnete Seiten eine verständliche Meldung statt „Server Action not found“ bekommen.

// schreibsperre-ausnahme: lehnt immer ab (Verkäufe werden storniert, nicht gelöscht) – schreibt nichts
export async function deactivateVerkauf(id: string): Promise<never> {
  void id
  throw new AktionsFehler(
    'Verkäufe werden storniert, nicht gelöscht: Bitte „Stornieren“ verwenden – der Bestand wird dabei zurückgebucht und der Beleg bleibt als storniert erhalten.',
  )
}

// ── Verkauf stornieren (mit Bestandsrückbuchung) ──────────────────────────────
// Logik in lib/verkauf/bestand.ts (auch vom Traubenverkauf genutzt): Rechte vorab
// (Tank braucht Kellerbuch/Rieden), zuerst Rückbuchung (alles oder nichts, abgeschlossene
// Chargen werden wieder aktiv), dann Kennzeichen nur bei storniert = false (sonst wird die
// Rückbuchung zurückgenommen). Zukauf-/Pressungsmengen bleiben unverändert.

// KAN-149 D1: Grund Pflicht (mind. 10 Zeichen) – Datum und Benutzer setzt die Datenbank.
// KAN-149 D2b: `erstattetAm` (JJJJ-MM-TT) – bezahlte Beträge erstattet: Zahlungen an diesem Tag stornieren, ihre
// E&A-Einnahmen gegenbuchen. Ohne Erstattung bleiben Zahlungen und Einnahmen stehen (Geld ist eingegangen).
export async function stornoVerkauf(id: string, grund: string, erstattetAm?: string | null): Promise<void | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (erstattetAm && !/^\d{4}-\d{2}-\d{2}$/.test(erstattetAm)) throw new AktionsFehler('Bitte ein gültiges Erstattungsdatum angeben.')

  try {
    await verkaufspostenStornieren(supabase, tenantId, id, grund, { erstattetAm: erstattetAm || null })
    // Alt-Einnahmen ohne Zahlungsbezug und die stornierten Zahlungen abgleichen
    if (erstattetAm) eaErgebnisPruefen(await syncEaEinnahmeFuerVerkauf(id), 'verkauf')
  } finally {
    revalidatePath('/weinhandel/verkauf')
    revalidatePath(`/weinhandel/verkauf/${id}`)
    revalidatePath('/weinhandel')
    revalidatePath('/weinhandel/traubenverkauf')
    revalidatePath('/buchhaltung')
    revalidatePath('/crm')
    revalidatePath('/crm/kontakte/[id]', 'page')
    revalidatePath('/crm/firmen/[id]', 'page')
  }
}

// ── Verkauf als bezahlt markieren ─────────────────────────────────────────────
//
// Erfasst den noch offenen Restbetrag als Zahlung in der zahlungen-Tabelle
// (statt bezahlt direkt zu setzen) – dadurch bleibt die Zahlungsübersicht auf
// der Verkaufs-Detailseite konsistent, der bestehende DB-Trigger
// sync_verkaufsposten_bezahlt() setzt bezahlt/bezahlt_am automatisch, und die
// E&A-Synchronisierung (Punkt 7) greift wie bei jeder anderen Zahlung.

export async function markiereAlsBezahlt(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getZahlungsKontext()   // KAN-239

  // KAN-105 Teil B: Restbetrag der ganzen Rechnung (Sammelrechnung: alle Lieferscheine, alle Zahlungen der Rechnung)
  const kontext = await ladeRechnungsKontext(supabase, tenantId, id, 'preis_brutto, menge, rabatt_pct, sonderrabatt_pct')
  const posten = kontext ? { rechnungsnummer: kontext.rechnungsnummer } : null
  const positionen = (kontext?.positionen ?? []) as AR[]
  const gesamt = positionen.reduce((s: number, p: AR) => {
    if (p.preis_brutto == null) return s
    const brutto = Number(p.preis_brutto) * Number(p.menge)
    const rabatt = Number(p.rabatt_pct ?? 0) / 100
    const sonder = Number(p.sonderrabatt_pct ?? 0) / 100
    return s + brutto * (1 - rabatt) * (1 - sonder)
  }, 0)

  // KAN-149 D2b: stornierte Zahlungen zählen nicht
  const zq = (supabase.from('zahlungen') as any).select('betrag').eq('tenant_id', tenantId).is('storniert_am', null)
  const { data: zahlungenRaw, error: zahlungenErr } = await (kontext?.rechnungId ? zq.eq('rechnung_id', kontext.rechnungId) : zq.eq('verkaufsposten_id', id))
  // KAN-253: sonst „noch nichts bezahlt“ – die volle Zahlung würde ein zweites Mal gebucht
  if (zahlungenErr) throw new AktionsFehler(dbFehlerText(zahlungenErr, 'Bisherige Zahlungen konnten nicht geladen werden'))
  const bereitsBezahlt = ((zahlungenRaw ?? []) as AR[]).reduce((s, z) => s + Number(z.betrag ?? 0), 0)
  const offen = gesamt - bereitsBezahlt

  if (offen > 0.01) {
    const { error } = await (supabase.from('zahlungen') as any).insert({
      tenant_id: tenantId,
      verkaufsposten_id: id,
      betrag: rund(offen, 2),
      art: 'sonstig',
      datum: heuteWien(),
      notizen: 'Als bezahlt markiert',
    })
    if (error) throw new AktionsFehler(dbFehlerText(error))
  }

  // CRM-Aktivität aktualisieren
  try {
    const re = posten?.rechnungsnummer
    { const { error: e } = await (supabase.from('aktivitaeten') as any)
      .update({ betreff: `Verkauf ${re ?? ''} · Bezahlt` })   // aenderung-ohne-pruefung: CRM-Betreff nachziehen, nicht kritisch – ohne Aktivität nichts zu tun
      .eq('beschreibung', `Verkaufsposten: ${id}`)
      .eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (aktivitaeten): ${e.message}`) }
  } catch { /* nicht kritisch */ }

  const ea = await syncEaEinnahmeFuerVerkauf(id)

  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath(`/weinhandel/verkauf/${id}`)
  revalidatePath('/buchhaltung')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
  eaErgebnisPruefen(ea, 'bezahlt')
}

// ── Sonstiges-Artikel speichern ───────────────────────────────────────────────

export interface SonstigesArtikelData {
  id: string
  name: string
  einheit: string
  default_preis: number | null
}

export async function createSonstigesArtikel(
  name: string,
  einheit: string,
  defaultPreis: number | null,
): Promise<SonstigesArtikelData | null> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const { data, error } = await (supabase.from('sonstige_artikel') as any)
    .insert({ tenant_id: tenantId, name: name.trim(), einheit, default_preis: defaultPreis ?? null })
    .select('id, name, einheit, default_preis')
    .single()

  if (error) throw new AktionsFehler(dbFehlerText(error))
  return data as SonstigesArtikelData
}

// ── Zahlungen ─────────────────────────────────────────────────────────────────
// KAN-355 (22.10.2026): Erwartbare Ablehnungen (ungültiger Betrag, Datum in einem abgeschlossenen Monat bzw. per UVA
// übermittelten Zeitraum – Trigger a_ea_periodensperre) kommen als { error } zurück: Die Formulare (ZahlungErfassen,
// Offene Posten) zeigen sie als Meldung, die Eingaben bleiben stehen. Vorher warf die Action – das reine
// <form action> führte auf die Fehlerseite, und das Systemprotokoll zählte die Ablehnung als Systemfehler.
export async function createZahlung(
  verkaufspostenId: string,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  'use server'
  const supabase = await createSupabaseServerClient()
  const tenantId = await getZahlungsKontext()   // KAN-239
  const betrag   = parseFloat(dezimal((formData.get('betrag') as string || '')))
  const art      = formData.get('art') as string
  const datum    = formData.get('datum') as string
  const notizen  = (formData.get('notizen') as string) || null
  const konto_id = (formData.get('konto_id') as string) || null
  if (isNaN(betrag) || betrag <= 0) return { error: 'Ungültiger Betrag – bitte einen Betrag größer als 0 eingeben.' }
  const { error } = await (supabase.from('zahlungen') as any).insert({
    tenant_id: tenantId,
    verkaufsposten_id: verkaufspostenId,
    betrag,
    art,
    datum: datum || heuteWien(),
    notizen, konto_id,
  })
  if (error) {
    // Sperre/Prüfregel der Datenbank: Meldung im Formular, kein Systemfehler; Unerwartetes weiter werfen (protokolliert)
    if (erwarteteDbAblehnung(error)) return { error: dbFehlerText(error, 'Zahlung konnte nicht gespeichert werden') }
    throw new AktionsFehler(dbFehlerText(error))
  }

  const ea = await syncEaEinnahmeFuerVerkauf(verkaufspostenId)

  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}`)
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath('/buchhaltung')
  eaErgebnisPruefen(ea, 'gespeichert')
  return { ok: true }
}

// Zahlung stornieren statt löschen (KAN-149 D2b): Die Zahlung bleibt mit Datum, Benutzer und Grund stehen und zählt
// nirgends mehr (bezahlt, offene Posten, Kassabuch, Kontosaldo). Ihre E&A-Einnahmen bucht die RPC gegen – am Tag der
// Erstattung (`erstattetAm`), sonst am Tag der Einnahme, solange deren Zeitraum offen ist, sonst heute.
// Darf, wer Zahlungen erfassen darf (Warenwirtschaft oder E&A, RPC s112_zahlung_stornieren).
export async function stornoZahlung(
  zahlungId: string,
  verkaufspostenId: string,
  grund: string,
  erstattetAm?: string | null,
): Promise<void> {
  const fehler = stornoGrundFehler(grund)
  if (fehler) throw new AktionsFehler(fehler)
  if (erstattetAm && !/^\d{4}-\d{2}-\d{2}$/.test(erstattetAm)) throw new AktionsFehler('Bitte ein gültiges Erstattungsdatum angeben.')
  const supabase = await createSupabaseServerClient()
  const tenantId = await getZahlungsKontext()   // KAN-239
  // Zahlung muss zu diesem Verkauf gehören (die RPC prüft den Betrieb)
  // storno-sichtbar: Einzelzeile per ID – storniert_am wird geprüft bzw. die Folgeaktion lehnt Stornos ab
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: z, error: zErr } = await (supabase.from('zahlungen') as any)
    .select('id').eq('id', zahlungId).eq('verkaufsposten_id', verkaufspostenId).eq('tenant_id', tenantId).maybeSingle()
  if (zErr) throw new AktionsFehler(dbFehlerText(zErr, 'Zahlung konnte nicht geladen werden'))
  if (!z) throw new AktionsFehler('Zahlung nicht gefunden – bitte die Seite neu laden.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_zahlung_stornieren', {
    p_tenant_id: tenantId, p_zahlung_id: zahlungId, p_grund: grund.trim(), p_datum: erstattetAm || null,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Zahlung konnte nicht storniert werden'))

  // Alt-Einnahmen ohne Zahlungsbezug (vor KAN-149 D2) abgleichen
  const ea = await syncEaEinnahmeFuerVerkauf(verkaufspostenId)

  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}`)
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath('/buchhaltung')
  revalidatePath('/konten')
  eaErgebnisPruefen(ea, 'storniert')
}

/** RPC-Aufruf ohne generierte Typen (KAN-103: Rechnungs-RPCs) */
type RechnungsRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>

// ── KAN-103: Rechnung zu einem Lieferschein erstellen bzw. stornieren ─────────────────────────────────────
// Nummer, Datum und Leistungszeitraum vergibt die RPC s112_rechnung_erstellen (Nummernkreis, Preise je Position – Entscheidung:
// Preise erst bei der Rechnung); bereits erfasste Zahlungen wandern mit. Storno: s112_rechnung_stornieren (Nummer bleibt,
// Lieferschein wieder offen, Bestand bleibt; nur ohne gültige Zahlung und vor der BMD-Übergabe).
// KAN-355: Eingabefehler, Periodensperre (Rechnungsdatum im abgeschlossenen Monat bzw. per UVA übermittelt – vorab geprüft,
// die Datenbank lehnt ebenso ab) und andere erwartbare Ablehnungen der RPC kommen als { error } zurück, nicht als Wurf.

export async function rechnungErstellen(lieferscheinIds: string[], formData: FormData): Promise<{ rechnungId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!lieferscheinIds.length) return { error: 'Bitte mindestens einen Lieferschein wählen.' }
  const datum = String(formData.get('rechnungsdatum') ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { error: 'Bitte ein gültiges Rechnungsdatum angeben.' }
  let preise: ReturnType<typeof rechnungPreiseAusFormular>
  try { preise = rechnungPreiseAusFormular(formData) } catch (e) { return { error: fehlerText(e) } }
  const sperre = await rechnungsdatumFehler(supabase, tenantId, datum, heuteWien())
  if (sperre) return { error: sperre }
  const rpc = supabase.rpc.bind(supabase) as unknown as RechnungsRpc
  const { data, error } = await rpc('s112_rechnung_erstellen', {
    p_tenant_id: tenantId, p_lieferscheine: lieferscheinIds, p_datum: datum, p_preise: preise,
    p_notizen: String(formData.get('rechnung_notizen') ?? '').trim() || null,
  })
  if (error) {
    if (erwarteteDbAblehnung(error)) return { error: dbFehlerText(error, 'Rechnung konnte nicht erstellt werden') }
    throw new AktionsFehler(dbFehlerText(error, 'Rechnung konnte nicht erstellt werden'))
  }
  for (const id of lieferscheinIds) revalidatePath(`/weinhandel/verkauf/${id}`)
  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/weinhandel/offene-posten')
  return { rechnungId: String(data) }
}

// KAN-379: Storno als Stornobeleg im offenen Zeitraum (Datum heute; die Datenbank prüft Zeitraum und Datum). Erwartbare
// Ablehnungen der RPC (Zahlungen, Periodensperre) als { error } am Formular.
export async function rechnungStornieren(rechnungId: string, lieferscheinId: string, grund: string): Promise<void | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = stornoGrundFehler(grund)
  if (f) return { error: f }
  const rpc = supabase.rpc.bind(supabase) as unknown as RechnungsRpc
  const { error } = await rpc('s112_rechnung_stornieren', { p_tenant_id: tenantId, p_rechnung_id: rechnungId, p_grund: grund })
  if (error) {
    if (erwarteteDbAblehnung(error)) return { error: dbFehlerText(error, 'Rechnung konnte nicht storniert werden') }
    throw new AktionsFehler(dbFehlerText(error, 'Rechnung konnte nicht storniert werden'))
  }
  revalidatePath(`/weinhandel/verkauf/${lieferscheinId}`)
  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath('/buchhaltung')
}

// KAN-356: Verkauf samt Rechnung stornieren – eine Transaktion (RPC s112_verkauf_samt_rechnung_stornieren): Rechnung
// storniert (Nummer bleibt), Lieferschein storniert, Bestand zurück, Sonstige Produkte und Traubenverkäufe mit. Nur für eine
// eigene Rechnung mit genau einem Lieferschein, ohne gültige Zahlung und ohne ausgestellte Transportbescheinigung – das
// prüft die Datenbank; erwartbare Ablehnungen kommen als { error } an den Knopf.
export async function verkaufSamtRechnungStornieren(lieferscheinId: string, grund: string): Promise<void | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const m = await getMembership()
  const tenantId = m.tenantId
  if (!canWrite(m, 'warenwirtschaft')) {
    return { error: 'Verkauf und Rechnung können nur Betriebs-Manager und Mitarbeiter mit Freigabe Warenwirtschaft stornieren. Es wurde nichts geändert.' }
  }
  const f = stornoGrundFehler(grund)
  if (f) return { error: f }
  const rpc = supabase.rpc.bind(supabase) as unknown as RechnungsRpc
  const { data, error } = await rpc('s112_verkauf_samt_rechnung_stornieren', {
    p_tenant_id: tenantId, p_verkaufsposten_id: lieferscheinId, p_grund: grund.trim(),
  })
  try {
    if (error) {
      if (erwarteteDbAblehnung(error)) return { error: dbFehlerText(error, 'Verkauf und Rechnung konnten nicht storniert werden') }
      throw new AktionsFehler(dbFehlerText(error, 'Verkauf und Rechnung konnten nicht storniert werden'))
    }
    // CRM-Aktivität kennzeichnen (nicht kritisch, wie beim Verkaufsstorno)
    const nr = (data as AR | null)?.rechnungsnummer ?? ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: crmErr } = await (supabase.from('aktivitaeten') as any)
      .update({ betreff: `Verkauf ${nr} · STORNIERT` })   // aenderung-ohne-pruefung: CRM-Betreff, nicht kritisch – ohne Aktivität nichts zu tun
      .eq('beschreibung', `Verkaufsposten: ${lieferscheinId}`)
      .eq('tenant_id', tenantId)
    if (crmErr) console.error('verkaufSamtRechnungStornieren – CRM-Aktivität:', crmErr.message)
  } finally {
    revalidatePath(`/weinhandel/verkauf/${lieferscheinId}`)
    revalidatePath('/weinhandel/verkauf')
    revalidatePath('/weinhandel/offene-posten')
    revalidatePath('/weinhandel')
    revalidatePath('/weinhandel/traubenverkauf')
    revalidatePath('/buchhaltung')
    revalidatePath('/crm')
  }
}
