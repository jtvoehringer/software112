// ── Rückverfolgung Weingarten: Maßnahmen je Lese-Grundstück bis zur Ernte mit Wartezeitprüfung (KAN-108) ──
//
// BKI-Anforderung R19 „Rieden Rückverfolgung (Maßnahmen in der Riede bis Ernte …)“ – Rückverfolgung geteilt in
// Weingarten und Weinkeller. Rechtsgrundlagen: Art. 18 VO (EG) 178/2002, Art. 67 VO (EG) 1107/2009.
//
// Einstiege (genau einer; Seite /weingarten/rueckverfolgung und CSV „rueckverfolgung-weingarten“ gleich):
//   ?lese=<lesen.id>        alle Lesezeilen (Pressungszeilen) und Traubenverkäufe dieser Lese
// Lesedaten (ernte_parzellen), die noch nicht gepresst bzw. verkauft sind, zählen bei Lese, Jahrgang, Grundstück und
// Weingarten als eigene Lesezeile (Herkunft „Lese (noch nicht gepresst)“, Rückmeldung 30.09.2026: die Lese vom 29.09.
// fehlte, weil sie noch keine Pressung hatte). Sobald Pressung oder Traubenverkauf zur selben Lese (bzw. zum selben
// Jahrgang) und demselben Grundstück (ohne GST: Weingarten) existieren, zählt nur noch diese.
//   ?jahrgang=2025          alle Lesezeilen und Traubenverkäufe des Jahrgangs, optional ?gst= bzw. ?weingarten=
//   ?gst=<grundstück>       Lesezeilen und Traubenverkäufe eines Grundstücks (mit ?jahrgang eines Jahrgangs)
//   ?charge=<weinausbau>    Lesezeilen der Charge und ihrer Vorgänger (Umzüge, Verschnitte – lib/wein/blendKomposition)
//   ?fuellung=<füllung>     Lesezeilen, die laut Mischungsrechnung (KAN-76) in der Abfüllung stecken
// Die Maßnahmen je Lesezeile hängen nur an der Lesezeile selbst (Zeitfenster „Ernte bis Ernte“, GST-genau –
// rueckverfolgungFenster.ts); jeder Einstieg liefert für dieselbe Lesezeile also dieselben Maßnahmen. Der Kern
// ladeMassnahmenZuLesezeilen ist derselbe wie bei der Kellerbuch-Rückverfolgung (ladeChargeKette).
//
// Alle Maßnahmenarten werden aufgeführt (offene Frage KAN-108, entschieden 29.09.2026), die Wartezeit-Ampel nur
// für Pflanzenschutzmittel:
//   frühester Lesetermin = das spätere von behandlungen.ernte_fruehesteins (bei der Erfassung aus dem Beginn
//   berechnet) und letztem Behandlungstag (datum_bis, sonst datum) + Wartezeit des Mittels in Tagen.
//   verletzt    frühester Lesetermin nach dem Lesetag (bzw. nach dem Pressungsdatum – die Lese war spätestens dann)
//   eingehalten frühester Lesetermin am oder vor dem Lesetag (Lesedatum der Zeile bzw. laut Erntemeldung)
//   prüfen      Fensterende nur das Pressungsdatum – ob die frühere Lese nach dem frühesten Termin lag, ist offen
//   –           keine Wartezeit hinterlegt

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { momentaufnahmeAnwenden } from '../stammdaten/momentaufnahme'
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { ladeHerkunftLesezeilen } from '@/lib/wein/blendKomposition'
import { leseArtText, leseNummer } from '@/lib/wein/lesen'
import { sortenKuerzel } from '@/lib/wein/bki_kuerzel'
import { numOderNull, tag, text, type R } from './kellerbuch-hilfen'
import { mostgewichtCsvSpalten } from './mostgewicht_export'
import {
  BEHANDLUNG_ART_LABEL, ladeMassnahmenZuLesezeilen, massnahmeMittel,
  type LeseMassnahme, type LeseMassnahmen, type LesezeileEingabe,
} from './rueckverfolgung'
import { kalendertag, leseWarnungen, type Zeitfenster } from './rueckverfolgungFenster'
import { AktionsFehler } from '@/lib/fehler'

export type RvEinstieg = {
  lese: string | null
  jahrgang: number | null
  gst: string | null
  weingarten: string | null
  charge: string | null
  fuellung: string | null
}

export type WartezeitAmpel = 'eingehalten' | 'verletzt' | 'pruefen'

export const AMPEL_TEXT: Record<WartezeitAmpel, string> = {
  eingehalten: 'eingehalten',
  verletzt: 'NICHT eingehalten',
  pruefen: 'prüfen (Lesedatum fehlt)',
}

/** Eine Lesezeile der Rieden-Rückverfolgung: Maßnahmen wie in der Kellerbuch-Rückverfolgung plus Herkunft */
export type RvLese = LeseMassnahmen & {
  quelle: 'pressung' | 'traubenverkauf' | 'lese'
  jahrgang: number | null
  /** „2025/1 Hauptlese“ */
  leseText: string | null
  weingarten: string | null
  katastralgemeinde: string | null
  gstNr: string | null
  /** grundstuecke.ama_feldnummer */
  feldstueck: string | null
  rebsorte: string | null
  /** Lesetag der Zeile (Pressungszeile bzw. Lieferdatum des Traubenverkaufs) */
  lesedatum: string | null
  kg: number | null
  /** KAN-131: Mostgewicht wie gespeichert (CSV rundet über mostgewichtCsvSpalten) */
  kmw: number | null
  oechsle: number | null
  mostgewichtEinheit: string | null
  /** nur Traubenverkauf */
  abnehmer: string | null
  liefernummer: string | null
  /** nur Füllung: Anteil dieser Herkunft an der Abfüllung (%) */
  anteilPct: number | null
  /** nur Charge/Füllung: Charge, in die die Pressung floss (bei der gefragten Charge selbst null) */
  ueberCharge: { id: string; name: string | null } | null
  /** nur Pressung: Pressung samt Datum, Most und Bezeichnung (für das Weinbuch) */
  pressung: R | null
}

export type RvErgebnis = {
  lesen: RvLese[]
  warnungen: string[]
  titel: string | null
  /** nur Charge/Füllung: die gefragte(n) Charge(n) und alle Vorgänger (lib/wein/blendKomposition) */
  herkunftChargen: Map<string, R> | null
}

function plusTage(t: string, tage: number): string {
  const [j, m, d] = t.split('-').map(Number)
  return new Date(Date.UTC(j, m - 1, d + tage)).toISOString().slice(0, 10)
}

/** Frühester Lesetermin einer Maßnahme (Regeln im Dateikopf); null = keine Wartezeit hinterlegt */
export function fruehesterLesetermin(b: R): string | null {
  const gespeichert = kalendertag(b.ernte_fruehesteins)
  const tage = numOderNull((b.psm as R | null)?.wartezeit_tage)
  const letzterTag = kalendertag(b.datum_bis) ?? kalendertag(b.datum)
  const gerechnet = tage !== null && tage >= 0 && letzterTag ? plusTage(letzterTag, Math.trunc(tage)) : null
  const kandidaten = [gespeichert, gerechnet].filter((t): t is string => !!t).sort()
  return kandidaten.at(-1) ?? null
}

/** Ampel „frühester Lesetermin ≤ Lesedatum“ (Regeln im Dateikopf); null = keine Wartezeit */
export function wartezeitAmpel(fruehester: string | null, f: Pick<Zeitfenster, 'bis' | 'bisAus'> | null): WartezeitAmpel | null {
  if (!fruehester || !f) return null
  if (fruehester > f.bis) return 'verletzt'
  return f.bisAus === 'pressungsdatum' ? 'pruefen' : 'eingehalten'
}

/** Wartezeitprüfung einer Maßnahme einer Lese – nur Pflanzenschutzmittel */
export function massnahmeWartezeit(m: Pick<LeseMassnahme, 'behandlung'>, f: Pick<Zeitfenster, 'bis' | 'bisAus'> | null): { fruehester: string | null; ampel: WartezeitAmpel | null } {
  if (!(m.behandlung.psm as R | null)) return { fruehester: null, ampel: null }
  const fruehester = fruehesterLesetermin(m.behandlung)
  return { fruehester, ampel: wartezeitAmpel(fruehester, f) }
}

// ── Laden ─────────────────────────────────────────────────────────────────────

const PW_SELECT = `
  id, trauben_kg, rebsorte, ernte_datum, kmw, oechsle, mostgewicht_einheit, weingarten_id, grundstueck_id, zukauf_posten_id,
  weingarten:weingarten_id(id, name),
  grundstueck:grundstueck_id(gst_nr, katastralgemeinde, ama_feldnummer),
  pressung:pressung_id!inner(id, datum, tenant_id, jahrgang_id, lese_id, most_liter_gesamt, weinbezeichnung, storniert_am, jahrgang:jahrgang_id(jahrgang), lese:lesen!pressungen_lese_fkey(lfd_nr, art))
`

const TV_SELECT = `
  id, datum, menge_kg, kmw_grad, oechsle, mostgewicht_einheit, liefernummer, weingarten_id, grundstueck_id, jahrgang_id, lese_id,
  weingarten:weingarten_id(id, name),
  grundstueck:grundstueck_id(gst_nr, katastralgemeinde, ama_feldnummer),
  jahrgang:jahrgang_id(jahrgang),
  lese:lesen!traubenverkauf_lese_fkey(lfd_nr, art),
  partner_daten,
  kontakt:kontakt_id(vorname, nachname),
  firma:firma_id(name)
`

const EP_SELECT = `
  id, ernte_datum, menge_kg, klosterneuburger, oechsle, mostgewicht_einheit, weingarten_id, grundstueck_id, jahrgang_id, lese_id,
  weingarten:weingarten_id(id, name, rebsorte),
  grundstueck:grundstueck_id(gst_nr, katastralgemeinde, ama_feldnummer, rebsorte),
  jahrgang:weinjahrgaenge!ernte_parzellen_jahrgang_id_fkey!inner(jahrgang, tenant_id),
  lese:lesen!ernte_parzellen_lese_fkey(lfd_nr, art)
`

/** Schlüssel „Lese bzw. Jahrgang | Grundstück bzw. Weingarten“ – Lesedaten zählen nur ohne Pressung/Verkauf dazu */
function leseOrtKey(leseId: unknown, jahrgangId: unknown, gstId: unknown, wgId: unknown): string {
  return `${text(leseId) ?? `jg:${text(jahrgangId) ?? '?'}`}|${text(gstId) ?? `wg:${text(wgId) ?? '?'}`}`
}

function pruefen<T>(res: { data: T; error: { message?: string } | null }, was: string): T {
  if (res.error) throw new AktionsFehler(`Rückverfolgung Weingarten: ${was} konnte nicht geladen werden (${res.error.message ?? 'unbekannter Fehler'})`)
  return res.data
}

function leseText(jahrgang: number | null, lese: R | null): string | null {
  if (!lese || jahrgang === null || lese.lfd_nr == null) return null
  return `${leseNummer(jahrgang, Number(lese.lfd_nr))} ${leseArtText(lese.art)}`
}

function abnehmer(tv: R): string | null {
  momentaufnahmeAnwenden(tv, ['kontakt', 'firma'])   // KAN-150 F1c: Abnehmer wie beim Traubenverkauf
  const f = text((tv.firma as R | null)?.name)
  const k = tv.kontakt as R | null
  const kn = k ? [k.vorname, k.nachname].filter(Boolean).join(' ') : ''
  return f ?? (kn || null)
}

/** Einstieg prüfen: genau einer von lese/charge/fuellung oder Jahrgang bzw. Grundstück (Text = Fehler) */
export function einstiegFehler(e: RvEinstieg): string | null {
  const direkt = [e.lese, e.charge, e.fuellung].filter(Boolean).length
  if (direkt > 1) return 'Bitte nur einen Einstieg angeben: Lese, Charge oder Füllung.'
  if (direkt === 1 && (e.jahrgang !== null || e.gst || e.weingarten)) return 'Lese, Charge oder Füllung bitte ohne Jahrgang, Grundstück oder Weingarten angeben.'
  if (direkt === 0 && e.jahrgang === null && !e.gst) return 'Bitte einen Jahrgang oder ein Grundstück wählen.'
  return null
}

/**
 * Rieden-Rückverfolgung zu einem Einstieg (Regeln im Dateikopf). null = Lese, Charge oder Füllung nicht
 * gefunden. Sortierung: Lesedatum, Weingarten, GST.
 */
export async function ladeRvWeingarten(supabase: any, tenantId: string, e: RvEinstieg): Promise<RvErgebnis | null> {
  const warnungen: string[] = []
  let titel: string | null = null
  let pw: R[] = []
  let tv: R[] = []
  let anteilJeKey = new Map<string, number>()
  let keyJePw = new Map<string, string>()
  let chargeJePw = new Map<string, string>()
  let herkunftChargen: Map<string, R> | null = null
  let ep: R[] = []
  // tenant-isolation-ignore: ernte_parzellen ohne tenant_id, Filter über den Jahrgang (!inner)
  const epAbfrage = () => (supabase.from('ernte_parzellen') as any).select(EP_SELECT).eq('jahrgang.tenant_id', tenantId).is('storniert_am', null)

  // tenant-isolation-ignore: pressung_weingaerten ohne tenant_id, Filter über die Pressung (!inner)
  const pwAbfrage = () => (supabase.from('pressung_weingaerten') as any).select(PW_SELECT).eq('pressung.tenant_id', tenantId).is('storniert_am', null)
  const tvAbfrage = () => (supabase.from('traubenverkauf') as any).select(TV_SELECT).eq('tenant_id', tenantId).is('storniert_am', null)

  if (e.charge || e.fuellung) {
    const art = e.charge ? 'charge' : 'fuellung'
    const id = (e.charge ?? e.fuellung) as string
    const h = await ladeHerkunftLesezeilen(supabase, tenantId, art, id)
    if (!h) return null
    warnungen.push(...h.warnungen)
    anteilJeKey = h.anteilJeKey
    keyJePw = new Map(h.lesezeilen.map(l => [String(l.zeile.id), l.key]))
    chargeJePw = new Map(h.lesezeilen.map(l => [String(l.zeile.id), l.weinausbauId]))
    herkunftChargen = h.chargen
    const ids = [...keyJePw.keys()]
    if (ids.length > 0) pw = pruefen(await alle<R>(pwAbfrage().in('id', ids).order('id')), 'Lesezeilen')
    const tabelle = art === 'charge' ? 'weinausbau' : 'fuellungen'
    // abfrage-ohne-fehler: nur der Titel der Ansicht – die Rückverfolgung selbst lädt mit Fehlerprüfung
    const { data } = await (supabase.from(tabelle) as any).select('name').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
    titel = text((data as R | null)?.name)
  } else if (e.lese) {
    const { data: lese, error } = await (supabase.from('lesen') as any)
      .select('id, lfd_nr, art, jahrgang:weinjahrgaenge!lesen_jahrgang_fkey(jahrgang)')
      .eq('tenant_id', tenantId).eq('id', e.lese).maybeSingle()
    if (error) throw new AktionsFehler(`Rückverfolgung Weingarten: Lese konnte nicht geladen werden (${error.message})`)
    if (!lese) return null
    titel = leseText(numOderNull(((lese as R).jahrgang as R | null)?.jahrgang), lese as R)
    const [a, b, c] = await Promise.all([
      alle<R>(pwAbfrage().eq('pressung.lese_id', e.lese).order('id')),
      alle<R>(tvAbfrage().eq('lese_id', e.lese).order('id')),
      alle<R>(epAbfrage().eq('lese_id', e.lese).order('id')),
    ])
    pw = pruefen(a, 'Lesezeilen'); tv = pruefen(b, 'Traubenverkäufe'); ep = pruefen(c, 'Lesedaten')
  } else {
    let jgIds: string[] | null = null
    if (e.jahrgang !== null) {
      const jg = pruefen(await alle<R>((supabase.from('weinjahrgaenge') as any)
        .select('id').eq('tenant_id', tenantId).eq('jahrgang', e.jahrgang).order('id')), 'Jahrgang')
      jgIds = jg.map(j => String(j.id))
      if (jgIds.length === 0) return { lesen: [], warnungen: [`Jahrgang ${e.jahrgang} ist nicht angelegt.`], titel: `Jahrgang ${e.jahrgang}`, herkunftChargen: null }
    }
    let qp = pwAbfrage()
    let qt = tvAbfrage()
    let qe = epAbfrage()
    if (jgIds) { qp = qp.in('pressung.jahrgang_id', jgIds); qt = qt.in('jahrgang_id', jgIds); qe = qe.in('jahrgang_id', jgIds) }
    if (e.gst) { qp = qp.eq('grundstueck_id', e.gst); qt = qt.eq('grundstueck_id', e.gst); qe = qe.eq('grundstueck_id', e.gst) }
    if (e.weingarten) { qp = qp.eq('weingarten_id', e.weingarten); qt = qt.eq('weingarten_id', e.weingarten); qe = qe.eq('weingarten_id', e.weingarten) }
    const [a, b, c] = await Promise.all([alle<R>(qp.order('id')), alle<R>(qt.order('id')), alle<R>(qe.order('id'))])
    pw = pruefen(a, 'Lesezeilen'); tv = pruefen(b, 'Traubenverkäufe'); ep = pruefen(c, 'Lesedaten')
    titel = e.jahrgang !== null ? `Jahrgang ${e.jahrgang}` : null
  }
  pw = pw.filter(z => (z.pressung as R | null)?.tenant_id === tenantId)

  // Lesezeilen für den gemeinsamen Kern (Pressungszeilen „pw:“, Traubenverkäufe „tv:“)
  const zeilen = new Map<string, LesezeileEingabe>()
  const info = new Map<string, Omit<RvLese, keyof LeseMassnahmen>>()
  for (const z of pw) {
    const p = z.pressung as R
    const jahrgang = numOderNull((p.jahrgang as R | null)?.jahrgang)
    const g = z.grundstueck as R | null
    const id = `pw:${z.id}`
    const pressungDatum = tag(p.datum) || null
    zeilen.set(id, {
      lese: { ...z, id },
      pressungDatum,
      eingabe: {
        id, grundstueckId: text(z.grundstueck_id), weingartenId: text((z.weingarten as R | null)?.id ?? z.weingarten_id),
        lesedatum: tag(z.ernte_datum) || null, pressungDatum, jahrgang, jahrgangId: text(p.jahrgang_id), leseId: text(p.lese_id),
      },
    })
    const key = keyJePw.get(String(z.id))
    const ueber = chargeJePw.get(String(z.id)) ?? null
    info.set(id, {
      ueberCharge: ueber && ueber !== e.charge ? { id: ueber, name: text(herkunftChargen?.get(ueber)?.name) } : null,
      pressung: p,
      quelle: 'pressung', jahrgang, leseText: leseText(jahrgang, p.lese as R | null),
      weingarten: text((z.weingarten as R | null)?.name), katastralgemeinde: text(g?.katastralgemeinde), gstNr: text(g?.gst_nr),
      feldstueck: text(g?.ama_feldnummer), rebsorte: text(z.rebsorte), lesedatum: tag(z.ernte_datum) || null,
      kg: numOderNull(z.trauben_kg), kmw: numOderNull(z.kmw), oechsle: numOderNull(z.oechsle), mostgewichtEinheit: text(z.mostgewicht_einheit), abnehmer: null, liefernummer: null,
      anteilPct: key && anteilJeKey.has(key) ? (anteilJeKey.get(key) as number) : null,
    })
  }
  for (const t of tv) {
    const jahrgang = numOderNull((t.jahrgang as R | null)?.jahrgang)
    const g = t.grundstueck as R | null
    const id = `tv:${t.id}`
    const datum = tag(t.datum) || null
    // Lieferdatum des Traubenverkaufs = Lesetag (die Trauben gehen am Lesetag an den Abnehmer)
    zeilen.set(id, {
      lese: { ...t, id, ernte_datum: datum },
      pressungDatum: datum,
      eingabe: {
        id, grundstueckId: text(t.grundstueck_id), weingartenId: text((t.weingarten as R | null)?.id ?? t.weingarten_id),
        lesedatum: datum, pressungDatum: datum, jahrgang, jahrgangId: text(t.jahrgang_id), leseId: text(t.lese_id),
      },
    })
    info.set(id, {
      ueberCharge: null, pressung: null,
      quelle: 'traubenverkauf', jahrgang, leseText: leseText(jahrgang, t.lese as R | null),
      weingarten: text((t.weingarten as R | null)?.name), katastralgemeinde: text(g?.katastralgemeinde), gstNr: text(g?.gst_nr),
      feldstueck: text(g?.ama_feldnummer), rebsorte: null, lesedatum: datum,
      kg: numOderNull(t.menge_kg), kmw: numOderNull(t.kmw_grad), oechsle: numOderNull(t.oechsle), mostgewichtEinheit: text(t.mostgewicht_einheit), abnehmer: abnehmer(t), liefernummer: text(t.liefernummer),
      anteilPct: null,
    })
  }

  // Lesedaten ohne Pressung bzw. Traubenverkauf zur selben Lese und demselben Grundstück (Regeln im Dateikopf)
  const belegt = new Set<string>()
  for (const z of pw) {
    const p = z.pressung as R
    belegt.add(leseOrtKey(p.lese_id, p.jahrgang_id, z.grundstueck_id, z.weingarten_id))
    belegt.add(leseOrtKey(null, p.jahrgang_id, z.grundstueck_id, z.weingarten_id))
  }
  for (const t of tv) {
    belegt.add(leseOrtKey(t.lese_id, t.jahrgang_id, t.grundstueck_id, t.weingarten_id))
    belegt.add(leseOrtKey(null, t.jahrgang_id, t.grundstueck_id, t.weingarten_id))
  }
  for (const p of ep) {
    if ((p.jahrgang as R | null)?.tenant_id !== tenantId) continue
    if (belegt.has(leseOrtKey(p.lese_id, p.jahrgang_id, p.grundstueck_id, p.weingarten_id))) continue
    if (!p.lese_id && belegt.has(leseOrtKey(null, p.jahrgang_id, p.grundstueck_id, p.weingarten_id))) continue
    const jahrgang = numOderNull((p.jahrgang as R | null)?.jahrgang)
    const g = p.grundstueck as R | null
    const w = p.weingarten as R | null
    const id = `ep:${p.id}`
    const datum = tag(p.ernte_datum) || null
    zeilen.set(id, {
      lese: { ...p, id, ernte_datum: datum },
      pressungDatum: datum,
      eingabe: {
        id, grundstueckId: text(p.grundstueck_id), weingartenId: text(w?.id ?? p.weingarten_id),
        lesedatum: datum, pressungDatum: datum, jahrgang, jahrgangId: text(p.jahrgang_id), leseId: text(p.lese_id),
      },
    })
    info.set(id, {
      ueberCharge: null, pressung: null,
      quelle: 'lese', jahrgang, leseText: leseText(jahrgang, p.lese as R | null),
      weingarten: text(w?.name), katastralgemeinde: text(g?.katastralgemeinde), gstNr: text(g?.gst_nr),
      feldstueck: text(g?.ama_feldnummer), rebsorte: text(g?.rebsorte) ?? text(w?.rebsorte), lesedatum: datum,
      kg: numOderNull(p.menge_kg), kmw: numOderNull(p.klosterneuburger), oechsle: numOderNull(p.oechsle), mostgewichtEinheit: text(p.mostgewicht_einheit), abnehmer: null, liefernummer: null,
      anteilPct: null,
    })
  }

  const kern = await ladeMassnahmenZuLesezeilen(supabase, tenantId, zeilen)
  const lesen: RvLese[] = kern.map(l => ({ ...l, ...(info.get(l.leseId) as Omit<RvLese, keyof LeseMassnahmen>) }))
  warnungen.push(...leseWarnungen(lesen))
  const verletzt = lesen.filter(l => l.massnahmen.some(m => massnahmeWartezeit(m, l.fenster).ampel === 'verletzt')).length
  if (verletzt > 0) warnungen.unshift(`Bei ${verletzt} ${verletzt === 1 ? 'Lese liegt' : 'Lesen liegt'} der Lesetag vor dem frühesten Lesetermin eines Pflanzenschutzmittels (Wartezeit nicht eingehalten).`)
  return { lesen, warnungen, titel, herkunftChargen }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Eine CSV-Zeile je Lesezeile × Maßnahme (Lesezeile ohne Maßnahme: eine Zeile ohne Maßnahmen-Spalten) */
export type RvZeile = {
  quelle: string
  lese: string | null
  jahrgang: number | null
  weingarten: string | null
  katastralgemeinde: string | null
  gstNr: string | null
  feldstueck: string | null
  rebsorte: string | null
  lesedatum: string | null
  kg: number | null
  /** KAN-131: Mostgewicht wie gespeichert (CSV rundet über mostgewichtCsvSpalten) */
  kmw: number | null
  oechsle: number | null
  mostgewichtEinheit: string | null
  abnehmer: string | null
  liefernummer: string | null
  anteilPct: number | null
  fensterVon: string | null
  fensterBis: string | null
  massnahmeVon: string | null
  massnahmeBis: string | null
  art: string | null
  mittel: string | null
  registernummer: string | null
  aufwand: number | null
  aufwandEinheit: string | null
  /** KAN-132: Mittel- bzw. Düngermenge anteilig auf die gelesenen GST */
  mengeAnteil: number | null
  mengeEinheit: string | null
  grundstuecke: string | null
  wartezeitTage: number | null
  fruehesterLesetermin: string | null
  wartezeit: string | null
  hinweis: string | null
}

export const QUELLE_TEXT: Record<RvLese['quelle'], string> = {
  pressung: 'Pressung',
  traubenverkauf: 'Traubenverkauf',
  lese: 'Lese (noch nicht gepresst)',
}

export function rvZeilen(lesen: readonly RvLese[]): RvZeile[] {
  const zeilen: RvZeile[] = []
  for (const l of lesen) {
    const basis = {
      quelle: QUELLE_TEXT[l.quelle],
      lese: l.leseText, jahrgang: l.jahrgang, weingarten: l.weingarten, katastralgemeinde: l.katastralgemeinde,
      gstNr: l.gstNr, feldstueck: l.feldstueck, rebsorte: l.rebsorte, lesedatum: l.lesedatum,
      kg: l.kg === null ? null : runden(l.kg, STELLEN.kg), kmw: l.kmw, oechsle: l.oechsle, mostgewichtEinheit: l.mostgewichtEinheit,
      abnehmer: l.abnehmer, liefernummer: l.liefernummer, anteilPct: l.anteilPct,
      fensterVon: l.fenster?.von ?? null, fensterBis: l.fenster?.bis ?? null,
      hinweis: l.hinweise.length > 0 ? l.hinweise.join(' ') : null,
    }
    const leer = {
      massnahmeVon: null, massnahmeBis: null, art: null, mittel: null, registernummer: null, aufwand: null,
      aufwandEinheit: null, mengeAnteil: null, mengeEinheit: null, grundstuecke: null, wartezeitTage: null, fruehesterLesetermin: null, wartezeit: null,
    }
    if (l.massnahmen.length === 0) { zeilen.push({ ...basis, ...leer }); continue }
    for (const m of l.massnahmen) {
      const b = m.behandlung
      const psm = b.psm as R | null
      const w = massnahmeWartezeit(m, l.fenster)
      zeilen.push({
        ...basis,
        massnahmeVon: tag(b.datum) || null,
        massnahmeBis: tag(b.datum_bis) || null,
        art: BEHANDLUNG_ART_LABEL[b.art] ?? text(b.art),
        mittel: psm ? massnahmeMittel(b) : null,
        registernummer: text(psm?.zulassungsnr),
        aufwand: numOderNull(b.aufwandmenge),
        aufwandEinheit: text(b.aufwandmenge_einheit),
        mengeAnteil: m.menge, mengeEinheit: m.mengeEinheit,
        grundstuecke: m.nurWeingarten ? 'am Weingarten erfasst' : m.grundstuecke.join(', ') || null,
        wartezeitTage: numOderNull(psm?.wartezeit_tage),
        fruehesterLesetermin: w.fruehester,
        wartezeit: w.ampel ? AMPEL_TEXT[w.ampel] : null,
      })
    }
  }
  return zeilen
}

export const SPALTEN_RV_WEINGARTEN: CsvSpalte<RvZeile>[] = [
  { kopf: 'Herkunft', typ: 'text', wert: z => z.quelle },
  { kopf: 'Lese', typ: 'text', wert: z => z.lese },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Weingarten / Ried', typ: 'text', wert: z => z.weingarten },
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.katastralgemeinde },
  { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Feldstück (AMA)', typ: 'code', wert: z => z.feldstueck },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  // KAN-89: Vorgabe BKI – neben der Sorte das Sortenkürzel
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => sortenKuerzel(z.rebsorte) },
  { kopf: 'Lesedatum', typ: 'datum', wert: z => z.lesedatum },
  { kopf: 'Trauben (kg)', typ: 'dezimal', stellen: STELLEN.kg, wert: z => z.kg },
  // KAN-131: °KMW (abgerundet, 2 Stellen) vor °Oe, gemessene Einheit
  ...mostgewichtCsvSpalten<RvZeile>(z => ({ kmw: z.kmw, oechsle: z.oechsle, einheit: z.mostgewichtEinheit }), 2),
  { kopf: 'Abnehmer', typ: 'text', wert: z => z.abnehmer },
  { kopf: 'Liefernummer', typ: 'code', wert: z => z.liefernummer },
  { kopf: 'Anteil an der Füllung (%)', typ: 'prozent', stellen: 1, wert: z => z.anteilPct },
  { kopf: 'Maßnahmen ab', typ: 'datum', wert: z => z.fensterVon },
  { kopf: 'Maßnahmen bis', typ: 'datum', wert: z => z.fensterBis },
  { kopf: 'Maßnahme (Datum)', typ: 'datum', wert: z => z.massnahmeVon },
  { kopf: 'Maßnahme bis', typ: 'datum', wert: z => z.massnahmeBis },
  { kopf: 'Art', typ: 'text', wert: z => z.art },
  { kopf: 'Mittel', typ: 'text', wert: z => z.mittel },
  { kopf: 'Registernummer', typ: 'code', wert: z => z.registernummer },
  { kopf: 'Aufwand', typ: 'dezimal', stellen: 3, wert: z => z.aufwand },
  { kopf: 'Einheit Aufwand', typ: 'text', wert: z => z.aufwandEinheit },
  { kopf: 'Menge anteilig (gelesene GST)', typ: 'dezimal', stellen: 3, wert: z => z.mengeAnteil },
  { kopf: 'Einheit Menge', typ: 'text', wert: z => z.mengeEinheit },
  { kopf: 'Grundstücke', typ: 'text', wert: z => z.grundstuecke },
  { kopf: 'Wartezeit (Tage)', typ: 'ganzzahl', wert: z => z.wartezeitTage },
  { kopf: 'Frühester Lesetermin', typ: 'datum', wert: z => z.fruehesterLesetermin },
  { kopf: 'Wartezeit', typ: 'text', wert: z => z.wartezeit },
  { kopf: 'Hinweis', typ: 'text', wert: z => z.hinweis },
]
