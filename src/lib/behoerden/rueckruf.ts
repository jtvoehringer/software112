// ── Rückverfolgung Weinkeller vorwärts: Rückruf-Liste je Los (KAN-109, 07.10.2026) ─────────────────────────
// R19 „Wein Rückverfolgung … Lebensmittelsicherheit“, Art. 18 VO (EG) 178/2002: je Stufe die Abnehmer (Endverbraucher
// ausgenommen). Von einer Füllung (Los), einer Charge oder einer Pressung aus vorwärts über Umzüge und Verschnitte (nicht
// stornierte) zu allen Chargen und Füllungen, die Wein daraus enthalten, und weiter zu den Abgängen: Verkäufe (Flasche,
// Tank), Export. Barverkäufe ohne Kunde werden als „Endverbraucher“ je Füllung summiert. Abgleich je Füllung:
// abgefüllt = verkauft + exportiert + Bestand (+ sonstige Abgänge = Rest), sonst Differenz.
// Entscheidung Jörgen 06.10.2026 (DSGVO): die Rückruf-Liste mit Kundendaten sehen alle Mitglieder des Betriebs.
// Seite /kellerbuch/rueckverfolgung/vorwaerts und CSV „rueckverfolgung-vorwaerts“ nutzen dieselbe Ladefunktion.
// KAN-115: Verarbeitungen der Chargen (Traubensaft, Essig, Destillat) erscheinen als Zeile „Verarbeitung“; ist dabei ein
// Sonstiges Produkt mit Lagerstand entstanden, folgen dessen Verkäufe ab dem Tag der Verarbeitung (das Produkt hat kein Los).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle, inBloecken } from '@/lib/supabase/alle'
import { momentaufnahmenAnwenden } from '@/lib/stammdaten/momentaufnahme'
import type { CsvSpalte } from '@/lib/csv'

type R = Record<string, any>

export type RueckrufStart = { art: 'fuellung' | 'charge' | 'pressung'; id: string }

/** Höchstzahl der Chargen im Vorwärtsgraphen – Schutz gegen entartete Daten */
const MAX_CHARGEN = 500

export type Kante = { von: string; nach: string }

/** Alle Chargen, die von den Startchargen aus über die Kanten erreichbar sind (inkl. Start) */
export function folgeChargen(start: readonly string[], kanten: readonly Kante[]): Set<string> {
  const erreicht = new Set(start)
  const offen = [...start]
  while (offen.length) {
    const c = offen.pop() as string
    for (const k of kanten) if (k.von === c && !erreicht.has(k.nach)) { erreicht.add(k.nach); offen.push(k.nach) }
  }
  return erreicht
}

export type Abnehmer = { name: string; adresse: string | null; betriebNr: string | null }

/** Abnehmer aus den Einbettungen kontakt/firma (Momentaufnahme schon angewendet); null = Barverkauf ohne Kunde */
export function abnehmerAus(z: { kontakt?: R | null; firma?: R | null }): Abnehmer | null {
  const f = z.firma, k = z.kontakt
  const quelle = f?.name ? f : k
  if (!quelle) return null
  const name = f?.name ? String(f.name) : [k?.vorname, k?.nachname].filter(Boolean).join(' ').trim()
  if (!name) return null
  const adresse = [quelle.strasse, [quelle.plz, quelle.ort].filter(Boolean).join(' '), quelle.land && quelle.land !== 'AT' && quelle.land !== 'Österreich' ? quelle.land : null]
    .filter(x => x && String(x).trim()).join(', ') || null
  return { name, adresse, betriebNr: (f?.betrieb_nr ?? k?.betrieb_nr ?? null) || null }
}

export type RueckrufZeile = {
  /** Los (Chargennummer) bzw. Charge beim Tankverkauf */
  los: string | null
  produkt: string
  art: 'Verkauf' | 'Tankverkauf' | 'Export' | 'Endverbraucher (summiert)' | 'Verarbeitung' | 'Verkauf Produkt'
  datum: string | null
  beleg: string | null
  abnehmer: string
  adresse: string | null
  betriebNr: string | null
  menge: number
  einheit: string
}

/** KAN-115: Verarbeitung einer Charge, optional mit erzeugtem Sonstigem Produkt */
export type ProduktVerarbeitung = {
  id: string; weinausbauId: string; datum: string; liter: number; zweck: string
  artikel: { id: string; name: string; einheit: string; menge: number } | null
}
/** KAN-115: Verkauf eines Sonstigen Produkts (Position mit sonstige_artikel_id) */
export type ProduktVerkauf = { artikelId: string; menge: number; einheit: string | null; posten: R }

const ZWECK_TEXT: Record<string, string> = { traubensaft: 'Traubensaft', essig: 'Essig', brennerei: 'Brennerei / Destillation', sonstiges: 'Sonstiges' }

/**
 * KAN-115: Zeilen für Verarbeitungen und – je erzeugtem Produkt – dessen Verkäufe ab dem frühesten Verarbeitungstag
 * (Produkte führen kein Los; Endverbraucher je Produkt summiert). Reine Funktion (Test kan115-traubensaft).
 */
export function produktZeilen(verarbeitungen: ProduktVerarbeitung[], chargenMap: Map<string, R>, verkaeufe: ProduktVerkauf[]): RueckrufZeile[] {
  const zeilen: RueckrufZeile[] = []
  const ab = new Map<string, { datum: string; name: string; einheit: string }>()
  for (const v of verarbeitungen) {
    const c = chargenMap.get(v.weinausbauId)
    zeilen.push({
      los: c?.chargennummer ?? null,
      produkt: v.artikel ? `${v.artikel.name} (aus ${c?.name ?? 'Charge'})` : `${ZWECK_TEXT[v.zweck] ?? v.zweck} (aus ${c?.name ?? 'Charge'})`,
      art: 'Verarbeitung', datum: v.datum, beleg: null, abnehmer: 'Eigener Betrieb', adresse: null, betriebNr: null,
      menge: v.artikel ? v.artikel.menge : v.liter, einheit: v.artikel ? v.artikel.einheit : 'L',
    })
    if (v.artikel) {
      const alt = ab.get(v.artikel.id)
      if (!alt || v.datum < alt.datum) ab.set(v.artikel.id, { datum: v.datum, name: v.artikel.name, einheit: v.artikel.einheit })
    }
  }
  const endverbraucher = new Map<string, number>()
  for (const k of verkaeufe) {
    const a = ab.get(k.artikelId)
    const datum = k.posten?.datum ? String(k.posten.datum) : null
    if (!a || !datum || datum < a.datum) continue
    const abn = abnehmerAus(k.posten)
    if (!abn) { endverbraucher.set(k.artikelId, (endverbraucher.get(k.artikelId) ?? 0) + k.menge); continue }
    zeilen.push({ los: null, produkt: a.name, art: 'Verkauf Produkt', datum, beleg: k.posten?.rechnungsnummer ?? null, abnehmer: abn.name, adresse: abn.adresse, betriebNr: abn.betriebNr, menge: k.menge, einheit: k.einheit ?? a.einheit })
  }
  for (const [id, menge] of endverbraucher) {
    const a = ab.get(id)!
    zeilen.push({ los: null, produkt: a.name, art: 'Endverbraucher (summiert)', datum: null, beleg: null, abnehmer: 'Endverbraucher', adresse: null, betriebNr: null, menge, einheit: a.einheit })
  }
  return zeilen
}

export type Abgleich = {
  fuellungId: string
  los: string | null
  produkt: string
  abgefuellt: number
  verkauft: number
  exportiert: number
  bestand: number
  /** abgefüllt − verkauft − exportiert − Bestand (Bruch, Eigenverbrauch, Proben …); 0 = stimmig */
  differenz: number
}

export type Rueckruf = {
  start: { art: RueckrufStart['art']; name: string }
  chargen: { id: string; name: string }[]
  zeilen: RueckrufZeile[]
  abgleich: Abgleich[]
  warnungen: string[]
}

type Verkauf = { fuellungId: string | null; weinausbauId: string | null; menge: number; einheit: string | null; posten: R }
type Export = { fuellungId: string; menge: number; einheit: string | null; auftrag: R }

/**
 * Rückruf-Liste aus geladenen Daten (rein, testbar): eine Zeile je Abgang mit Abnehmer, Barverkäufe ohne Kunde je
 * Füllung summiert; Abgleich je Füllung. Reihenfolge: Los, Datum, Abnehmer.
 */
export function rueckrufZeilen(
  fuellungen: readonly R[], chargen: ReadonlyMap<string, R>, verkaeufe: readonly Verkauf[], exporte: readonly Export[],
): { zeilen: RueckrufZeile[]; abgleich: Abgleich[] } {
  const fl = new Map(fuellungen.map(f => [String(f.id), f]))
  const zeilen: RueckrufZeile[] = []
  const endverbraucher = new Map<string, { menge: number; einheit: string; erstes: string | null; letztes: string | null }>()
  const verkauftJe = new Map<string, number>()
  const exportJe = new Map<string, number>()
  for (const v of verkaeufe) {
    const ab = abnehmerAus(v.posten)
    const f = v.fuellungId ? fl.get(v.fuellungId) : undefined
    const c = !f && v.weinausbauId ? chargen.get(v.weinausbauId) : undefined
    if (!f && !c) continue
    const datum = v.posten.datum ? String(v.posten.datum).slice(0, 10) : null
    if (f) verkauftJe.set(String(f.id), (verkauftJe.get(String(f.id)) ?? 0) + v.menge)
    if (f && !ab) {
      const e = endverbraucher.get(String(f.id)) ?? { menge: 0, einheit: v.einheit ?? 'Fl', erstes: datum, letztes: datum }
      e.menge += v.menge
      if (datum && (!e.erstes || datum < e.erstes)) e.erstes = datum
      if (datum && (!e.letztes || datum > e.letztes)) e.letztes = datum
      endverbraucher.set(String(f.id), e)
      continue
    }
    zeilen.push({
      los: f ? (f.chargennummer ?? null) : (c?.chargennummer ?? null),
      produkt: f ? String(f.name ?? 'Füllung') : String(c?.name ?? 'Charge'),
      art: f ? 'Verkauf' : 'Tankverkauf',
      datum, beleg: v.posten.rechnungsnummer ?? null,
      abnehmer: ab?.name ?? 'Barverkauf (ohne Kunde)', adresse: ab?.adresse ?? null, betriebNr: ab?.betriebNr ?? null,
      menge: v.menge, einheit: v.einheit ?? (f ? 'Fl' : 'L'),
    })
  }
  for (const x of exporte) {
    const f = fl.get(x.fuellungId)
    if (!f) continue
    exportJe.set(x.fuellungId, (exportJe.get(x.fuellungId) ?? 0) + x.menge)
    const ab = abnehmerAus(x.auftrag)
    zeilen.push({
      los: f.chargennummer ?? null, produkt: String(f.name ?? 'Füllung'), art: 'Export',
      datum: x.auftrag.datum ? String(x.auftrag.datum).slice(0, 10) : null, beleg: x.auftrag.referenz ?? null,
      abnehmer: ab?.name ?? 'Empfänger unbekannt', adresse: ab?.adresse ?? null, betriebNr: ab?.betriebNr ?? null,
      menge: x.menge, einheit: x.einheit ?? 'Fl',
    })
  }
  for (const [fid, e] of endverbraucher) {
    const f = fl.get(fid) as R
    zeilen.push({
      los: f.chargennummer ?? null, produkt: String(f.name ?? 'Füllung'), art: 'Endverbraucher (summiert)',
      datum: e.erstes && e.letztes && e.erstes !== e.letztes ? `${e.erstes} – ${e.letztes}` : e.erstes, beleg: null,
      abnehmer: 'Endverbraucher', adresse: null, betriebNr: null, menge: e.menge, einheit: e.einheit,
    })
  }
  zeilen.sort((a, b) => (a.los ?? '').localeCompare(b.los ?? '', 'de', { numeric: true })
    || (a.datum ?? '').localeCompare(b.datum ?? '') || a.abnehmer.localeCompare(b.abnehmer, 'de'))
  const abgleich = fuellungen.map(f => {
    const abgefuellt = Number(f.anzahl_flaschen) || 0
    const verkauft = verkauftJe.get(String(f.id)) ?? 0
    const exportiert = exportJe.get(String(f.id)) ?? 0
    const bestand = Number(f.bestand_flaschen) || 0
    return {
      fuellungId: String(f.id), los: f.chargennummer ?? null, produkt: String(f.name ?? 'Füllung'),
      abgefuellt, verkauft, exportiert, bestand, differenz: abgefuellt - verkauft - exportiert - bestand,
    }
  }).sort((a, b) => (a.los ?? '').localeCompare(b.los ?? '', 'de', { numeric: true }))
  return { zeilen, abgleich }
}

const q = (supabase: any, t: string) => (supabase.from(t) as any)
const fehler = (was: string, e: R) => new Error(`Rückruf-Liste: ${was} konnte nicht geladen werden (${e.message ?? 'unbekannter Fehler'})`)

/** Rückruf-Liste ab einer Füllung, Charge oder Pressung – null, wenn der Start im aktiven Betrieb nicht existiert */
export async function ladeRueckruf(supabase: any, tenantId: string, start: RueckrufStart): Promise<Rueckruf | null> {
  const warnungen: string[] = []
  let startChargen: string[] = []
  let startName = ''
  const startFuellungen = new Set<string>()
  if (start.art === 'fuellung') {
    const { data: f, error: fErr } = await q(supabase, 'fuellungen').select('id, name, chargennummer, weinausbau_id').eq('id', start.id).eq('tenant_id', tenantId).maybeSingle()
    if (fErr) throw fehler('Füllung', fErr)   // nicht als „nicht gefunden“ melden
    if (!f) return null
    startName = `${f.name}${f.chargennummer ? ` (Los ${f.chargennummer})` : ''}`
    startFuellungen.add(String(f.id))
    const { data: fc, error } = await alle<R>(q(supabase, 'fuellung_chargen').select('id, weinausbau_id').eq('fuellung_id', f.id).eq('tenant_id', tenantId).order('id'))
    if (error) throw fehler('Chargen der Füllung', error)
    startChargen = [...new Set([...(f.weinausbau_id ? [String(f.weinausbau_id)] : []), ...fc.map(x => String(x.weinausbau_id)).filter(Boolean)])]
  } else if (start.art === 'charge') {
    const { data: c, error: cErr } = await q(supabase, 'weinausbau').select('id, name').eq('id', start.id).eq('tenant_id', tenantId).maybeSingle()
    if (cErr) throw fehler('Charge', cErr)
    if (!c) return null
    startName = String(c.name)
    startChargen = [String(c.id)]
  } else {
    const { data: p, error: pErr } = await q(supabase, 'pressungen').select('id, datum, weinbezeichnung').eq('id', start.id).eq('tenant_id', tenantId).maybeSingle()
    if (pErr) throw fehler('Pressung', pErr)
    if (!p) return null
    startName = `Pressung ${p.weinbezeichnung ?? ''} ${p.datum ? String(p.datum).split('-').reverse().join('.') : ''}`.replace(/\s+/g, ' ').trim()
    const { data: pb, error } = await alle<R>(q(supabase, 'pressung_behaelter').select('id, weinausbau_id')
      .eq('pressung_id', p.id).is('storniert_am', null).order('id'))
    if (error) throw fehler('Mostzeilen der Pressung', error)
    startChargen = [...new Set(pb.map(x => String(x.weinausbau_id)).filter(Boolean))]
  }

  // Vorwärts über Umzüge und Verschnitte (nicht storniert), schrittweise bis keine neue Charge dazukommt
  const kanten: Kante[] = []
  let chargen = new Set(startChargen)
  let front = [...startChargen]
  while (front.length && chargen.size < MAX_CHARGEN) {
    const um = await inBloecken<R>(front, b => alle(q(supabase, 'keller_umzuege').select('id, von_weinausbau_id, nach_weinausbau_id')
      .eq('tenant_id', tenantId).is('storniert_am', null).in('von_weinausbau_id', b).order('id')))
    if (um.error) throw fehler('Umzüge', um.error)
    // tenant-isolation-ignore: verschneidung_quellen ohne tenant_id, Filter über den Verschnitt (!inner)
    const vs = await inBloecken<R>(front, b => alle(q(supabase, 'verschneidung_quellen')
      .select('id, quell_weinausbau_id, verschneidung:verschneidung_id!inner(tenant_id, ziel_weinausbau_id, storniert_am)')
      .eq('verschneidung.tenant_id', tenantId).is('verschneidung.storniert_am', null).in('quell_weinausbau_id', b).order('id')))
    if (vs.error) throw fehler('Verschnitte', vs.error)
    const neu: Kante[] = [
      ...um.data.filter(u => u.nach_weinausbau_id && u.nach_weinausbau_id !== u.von_weinausbau_id).map(u => ({ von: String(u.von_weinausbau_id), nach: String(u.nach_weinausbau_id) })),
      ...vs.data.filter(v => v.verschneidung?.ziel_weinausbau_id).map(v => ({ von: String(v.quell_weinausbau_id), nach: String(v.verschneidung.ziel_weinausbau_id) })),
    ]
    kanten.push(...neu)
    const vorher = chargen
    chargen = folgeChargen([...vorher], kanten)
    front = [...chargen].filter(c => !vorher.has(c))
  }
  if (chargen.size >= MAX_CHARGEN) warnungen.push(`Mehr als ${MAX_CHARGEN} Chargen im Vorwärtsgraphen – Liste unvollständig.`)
  const chargenIds = [...chargen]

  // Chargen (Namen, Los) und Füllungen, die Wein daraus enthalten
  const ch = await inBloecken<R>(chargenIds, b => alle(q(supabase, 'weinausbau').select('id, name, chargennummer').eq('tenant_id', tenantId).in('id', b).order('id')))
  if (ch.error) throw fehler('Chargen', ch.error)
  const chargenMap = new Map(ch.data.map(c => [String(c.id), c]))
  const fc = await inBloecken<R>(chargenIds, b => alle(q(supabase, 'fuellung_chargen').select('id, fuellung_id').eq('tenant_id', tenantId).in('weinausbau_id', b).order('id')))
  if (fc.error) throw fehler('Füllungen der Chargen', fc.error)
  const fd = await inBloecken<R>(chargenIds, b => alle(q(supabase, 'fuellungen').select('id').eq('tenant_id', tenantId).in('weinausbau_id', b).order('id')))
  if (fd.error) throw fehler('Füllungen', fd.error)
  const fuellungIds = [...new Set([...startFuellungen, ...fc.data.map(x => String(x.fuellung_id)), ...fd.data.map(x => String(x.id))])]
  const fl = await inBloecken<R>(fuellungIds, b => alle(q(supabase, 'fuellungen')
    .select('id, name, chargennummer, datum, anzahl_flaschen, bestand_flaschen, flaschengroesse_ml')
    .eq('tenant_id', tenantId).is('storniert_am', null).in('id', b).order('id')))
  if (fl.error) throw fehler('Füllungen', fl.error)

  // Abgänge: Verkäufe (Flasche je Füllung, Tank je Charge), Export
  const POSTEN = 'verkaufsposten:verkaufsposten_id!inner(datum, rechnungsnummer, storniert, partner_daten, kontakt:kontakt_id(vorname, nachname, strasse, plz, ort, land, betrieb_nr), firma:firma_id(name, strasse, plz, ort, land, betrieb_nr))'
  const vpF = await inBloecken<R>(fl.data.map(f => String(f.id)), b => alle(q(supabase, 'verkauf_positionen')
    .select(`id, fuellung_id, weinausbau_id, menge, einheit, ${POSTEN}`)
    .eq('tenant_id', tenantId).eq('verkaufsposten.storniert', false).in('fuellung_id', b).order('id')))
  if (vpF.error) throw fehler('Verkäufe', vpF.error)
  const vpT = await inBloecken<R>(chargenIds, b => alle(q(supabase, 'verkauf_positionen')
    .select(`id, fuellung_id, weinausbau_id, menge, einheit, ${POSTEN}`)
    .eq('tenant_id', tenantId).eq('verkaufsposten.storniert', false).in('weinausbau_id', b).order('id')))
  if (vpT.error) throw fehler('Tankverkäufe', vpT.error)
  // tenant-isolation-ignore: exportauftrag_positionen ohne tenant_id, Filter über den Auftrag (!inner)
  const ex = await inBloecken<R>(fl.data.map(f => String(f.id)), b => alle(q(supabase, 'exportauftrag_positionen')
    .select('id, fullung_id, menge, einheit, auftrag:exportauftrag_id!inner(tenant_id, datum, referenz, storniert_am, partner_daten, kontakt:kontakt_id(vorname, nachname, strasse, plz, ort, land, betrieb_nr), firma:firma_id(name, strasse, plz, ort, land, betrieb_nr))')
    .eq('auftrag.tenant_id', tenantId).is('auftrag.storniert_am', null)
    .is('auftrag.verkaufsposten_id', null)   // KAN-436 E1: mit Rechnung stehen die Flaschen schon als Verkauf in der Liste
    .in('fullung_id', b).order('id')))
  if (ex.error) throw fehler('Export', ex.error)

  const posten = [...vpF.data, ...vpT.data.filter(v => !v.fuellung_id)]
  momentaufnahmenAnwenden(posten.map(v => v.verkaufsposten), ['kontakt', 'firma'])
  momentaufnahmenAnwenden(ex.data.map(x => x.auftrag), ['kontakt', 'firma'])
  const verkaeufe: Verkauf[] = posten.map(v => ({
    fuellungId: v.fuellung_id ? String(v.fuellung_id) : null, weinausbauId: v.weinausbau_id ? String(v.weinausbau_id) : null,
    menge: Number(v.menge) || 0, einheit: v.einheit ?? null, posten: v.verkaufsposten,
  }))
  const exporte: Export[] = ex.data.map(x => ({ fuellungId: String(x.fullung_id), menge: Number(x.menge) || 0, einheit: x.einheit ?? null, auftrag: x.auftrag }))
  const { zeilen, abgleich } = rueckrufZeilen(fl.data, chargenMap, verkaeufe, exporte)

  // KAN-115: Verarbeitungen der Chargen (nicht storniert) und daraus entstandene Sonstige Produkte samt deren Verkäufen
  const kv = await inBloecken<R>(chargenIds, b => alle(q(supabase, 'keller_verarbeitungen').select('id, weinausbau_id, datum, menge_liter, zweck')
    .eq('tenant_id', tenantId).is('storniert_am', null).in('weinausbau_id', b).order('id')))
  if (kv.error) throw fehler('Verarbeitungen', kv.error)
  const zu = await inBloecken<R>(kv.data.map(v => String(v.id)), b => alle(q(supabase, 'sonstige_artikel_bewegungen')
    .select('id, keller_verarbeitung_id, art, menge, storno_von_id, artikel:artikel_id(id, name, einheit)')
    .eq('tenant_id', tenantId).in('keller_verarbeitung_id', b).order('id')))
  if (zu.error) throw fehler('Lagerzugänge der Verarbeitungen', zu.error)
  const storniert = new Set(zu.data.map(z => z.storno_von_id).filter(Boolean).map(String))
  const zugangJeVerarbeitung = new Map(zu.data.filter(z => z.art === 'verarbeitung' && !storniert.has(String(z.id))).map(z => [String(z.keller_verarbeitung_id), z]))
  const verarbeitungen: ProduktVerarbeitung[] = kv.data.map(v => {
    const z = zugangJeVerarbeitung.get(String(v.id))
    return {
      id: String(v.id), weinausbauId: String(v.weinausbau_id), datum: String(v.datum), liter: Number(v.menge_liter) || 0, zweck: String(v.zweck),
      artikel: z?.artikel ? { id: String(z.artikel.id), name: String(z.artikel.name), einheit: String(z.artikel.einheit), menge: Number(z.menge) || 0 } : null,
    }
  })
  const artikelIds = [...new Set(verarbeitungen.map(v => v.artikel?.id).filter(Boolean) as string[])]
  const vpA = await inBloecken<R>(artikelIds, b => alle(q(supabase, 'verkauf_positionen')
    .select(`id, sonstige_artikel_id, menge, einheit, ${POSTEN}`)
    .eq('tenant_id', tenantId).eq('verkaufsposten.storniert', false).in('sonstige_artikel_id', b).order('id')))
  if (vpA.error) throw fehler('Verkäufe der Sonstigen Produkte', vpA.error)
  momentaufnahmenAnwenden(vpA.data.map(v => v.verkaufsposten), ['kontakt', 'firma'])
  zeilen.push(...produktZeilen(verarbeitungen, chargenMap,
    vpA.data.map(v => ({ artikelId: String(v.sonstige_artikel_id), menge: Number(v.menge) || 0, einheit: v.einheit ?? null, posten: v.verkaufsposten }))))
  if (artikelIds.length) warnungen.push('Sonstige Produkte (Traubensaft, Essig, Destillat …) führen kein Los: gezeigt sind alle Verkäufe des Produkts ab dem Tag der Verarbeitung.')
  for (const a of abgleich) {
    if (Math.abs(a.differenz) > 0.001) {
      warnungen.push(`${a.produkt}${a.los ? ` (Los ${a.los})` : ''}: abgefüllt ${a.abgefuellt}, verkauft ${a.verkauft}, exportiert ${a.exportiert}, Bestand ${a.bestand} – Differenz ${a.differenz} (sonstige Abgänge oder fehlende Buchungen prüfen).`)
    }
  }
  return {
    start: { art: start.art, name: startName },
    chargen: chargenIds.map(id => ({ id, name: String(chargenMap.get(id)?.name ?? id) })).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    zeilen, abgleich, warnungen,
  }
}

export const SPALTEN_RUECKRUF: CsvSpalte<RueckrufZeile>[] = [
  { kopf: 'Los', typ: 'code', wert: z => z.los },
  { kopf: 'Produkt', typ: 'text', wert: z => z.produkt },
  { kopf: 'Art', typ: 'text', wert: z => z.art },
  { kopf: 'Datum', typ: 'text', wert: z => (z.datum ? z.datum.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3.$2.$1') : null) },
  { kopf: 'Beleg', typ: 'code', wert: z => z.beleg },
  { kopf: 'Abnehmer', typ: 'text', wert: z => z.abnehmer },
  { kopf: 'Adresse', typ: 'text', wert: z => z.adresse },
  { kopf: 'Betriebsnummer', typ: 'code', wert: z => z.betriebNr },
  { kopf: 'Menge', typ: 'dezimal', stellen: 2, wert: z => z.menge },
  { kopf: 'Einheit', typ: 'text', wert: z => z.einheit },
]
