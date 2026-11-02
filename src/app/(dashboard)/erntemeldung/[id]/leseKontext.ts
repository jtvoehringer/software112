import 'server-only'
// Daten der Lese eines Jahrgangs (Pilot 30.09.2026): gemeinsam für die Lese-Seite (/erntemeldung/[id]) und die
// Pressungen im Kellerbuch (/kellerbuch/pressungen) – Lesedaten, Pressungen, Traubenverkäufe, verfügbare kg je
// Ried/Grundstück/Zukauf und die Auswahllisten rechnen so an beiden Stellen gleich.
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Pressung, PressungWG, PressungBeh, WGOption, BehOption, WAOption, ZukaufTraubenOpt, LeseParzelle } from './PressungSection'
import type { LeseEintrag } from '@/lib/wein/pressungLesedatum'
import { gstImJahr } from '@/lib/wein/grundstueckAktiv'
import type { Traubenverkauf, TVWGOption, TVQuelleOption } from './TraubenverkaufSection'
import type { AMAMeldung, AMAVersion, ErnteParzelle, GSTOpt, WeingartenOpt } from './page'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { aggregiereJeRebsorte, berechneHektarhoechstertrag, ladeLesedaten, ohneStornierteLese, parzelleFuerMeldung, stichtagHinweis, teileNachStichtag, weinbauflaecheHa, type HektarhoechstertragStatus, type LeseZeile } from '@/lib/behoerden/erntemeldung'
import { KATALOG_ERNTE } from '@/lib/behoerden/katalog/ernte'
import { betriebUndModuleLaden, zugriffsFehler } from '@/lib/behoerden/zugriff'
import { istErntebar } from '@/lib/wein/leseErfassung'
import { gewaehlteLese, leseLoeschsperre, type Lese } from '@/lib/wein/lesen'
import type { LeseMitSperre } from './LeseReiter'
import { amaAbweichungen, neuesteAmaVersion } from '@/lib/behoerden/amaMeldung'
import { geladen } from '@/lib/supabase/geladen'
import { riedLeseVerteilen } from '@/lib/wein/leseBilanz'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

/** Lesezeile (gemeinsame Ladefunktion) → Zeile der Lesedaten-Tabelle bzw. des Bearbeiten-Formulars */
function zuErnteParzelle(z: LeseZeile): ErnteParzelle {
  return {
    id: z.id, weingarten_id: z.weingartenId ?? '',
    weingarten_name: z.ried ?? '–', weingarten_rebsorte: z.weingartenRebsorte,
    grundstueck_id: z.grundstueckId, grundstueck_nr: z.gstNr, grundstueck_rebsorte: z.grundstueckRebsorte,
    ernte_datum: z.datum, menge_kg: z.mengeKg, menge_hl: z.mengeHl,
    oechsle: z.oechsle, klosterneuburger: z.kmw, mostgewicht_einheit: z.mostgewichtEinheit,
    qualitaetsstufe: z.qualitaetsstufe, lesemethode: z.lesemethode, notizen: z.notizen,
    herkunft_code: z.herkunftCode, lese_art: z.leseArt,
    lese_titel: z.lese, lese_nr: z.leseNr,
    storno: z.storniertAm ? { am: z.storniertAm, von: z.storniertVon, grund: z.stornoGrund } : null,
  }
}

/** Alles, was Lese-Seite und Pressungen-Seite für einen Jahrgang (und die gewählte Lese) brauchen */
export async function ladeLeseKontext(id: string, leseParam: string | string[] | undefined) {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role, 'rieden')
  const adminOk = canAdmin(role)
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!membership || !tenantId) notFound()
  // KAN-353: Käufer im Traubenverkauf direkt aus der Partner-Suche anlegen – nur mit Schreibrecht CRM
  const crmSchreiben = canWrite(membership, 'crm')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => query.eq('tenant_id', tenantId)

  const [
    jgRes,
    lese,
    wRes,
    aRes,
    pressungenRes,
    behRows,
    waRes,
    gstRes,
    gstAlleRes,
    tvRes,
    { betrieb, module },
    lesenRes,
    abgeschlossenRes,
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weinjahrgaenge') as any).select('*').eq('id', id).maybeSingle()),

    // Lesedaten: dieselbe Ladefunktion wie die CSV „Lesedaten“ (/meldungen/lesedaten/csv).
    // ernte_parzellen hat keine tenant_id – der Jahrgang wird oben mandantengefiltert
    // geladen, ohne ihn endet die Seite unten mit notFound(). KAN-148: stornierte gekennzeichnet in der Tabelle.
    ladeLesedaten(supabase, id, { mitStornierten: true }),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weingarten') as any)
      .select('id, name, rebsorte, flaeche_ha, ama_feldnummer, trauben_verkauf, trauben_herkunft_code, lagen:lage_id(name)').eq('aktiv', true).order('name')),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('ama_erntemeldungen') as any)
      .select('id, version, status, gesamtmenge_kg, gesamtmenge_hl, n8n_status, n8n_fehler, eingereicht_am, bestaetigt_am, ama_referenznr, stichtag, abgabefrist')
      .eq('jahrgang_id', id).order('version', { ascending: false })),

    // Pressungen mit Sub-Tabellen
    // storno-sichtbar: Liste zeigt stornierte Pressungen gekennzeichnet (KAN-148 C1c); verfügbare kg ohne sie
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('pressungen') as any)
      .select(`id, lese_id, datum, most_liter_gesamt, weinbezeichnung, notizen, kmw_grad, oechsle, mostgewicht_einheit, storniert_am, storno_grund, storniert_von_name,
        weingaerten:pressung_weingaerten(id, weingarten_id, grundstueck_id, zukauf_posten_id, trauben_kg, rebsorte, notizen, ernte_datum, kmw, oechsle, mostgewicht_einheit, storniert_am, weingarten:weingarten_id(name)),
        behaelter:pressung_behaelter(id, behaelter_id, weinausbau_id, menge_liter, notizen, storniert_am, behaelter:behaelter_id(name), weinausbau:weinausbau_id(name, jahrgang, qualitaetsstufe))`)
      .eq('jahrgang_id', id).order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).order('id', { ascending: false })),

    // Gebinde für die Pressung: eigene + freigegebene, fremd belegte ausgenommen (Migration 203)
    ladeBehaelter(supabase, tenantId, { alsZiel: true }),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle(tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, behaelter_id, rebsorte, menge_liter, qualitaetsstufe, herkunft_code').eq('aktiv', true).neq('status', 'abgeschlossen').order('name').order('id'))),

    // Weingartenfläche (GST, Nutzart WI) – auch Bezugsfläche des Hektarhöchstertrags; alle() statt 1.000er-Deckel
    alle<AR>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tf((supabase.from('grundstuecke') as any)
        .select('id, weingarten_id, gst_nr, rebsorte, flaeche_ha, trauben_herkunft_code, aktiv, deaktiviert_am').eq('nutzart', 'WI').order('gst_nr').order('id')),
    ),
    // Alle Grundstücke (jede Nutzart) – ein Weingarten nur mit Acker/Grünland/Brache ist nicht erntebar (KAN-160)
    alle<AR>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tf((supabase.from('grundstuecke') as any).select('id, weingarten_id, aktiv, deaktiviert_am').order('id')),
    ),

    // Traubenverkäufe dieses Jahrgangs (mit Rechnung: Stornieren storniert sie mit, KAN-35/KAN-148)
    // storno-sichtbar: Liste zeigt stornierte gekennzeichnet; verfügbare kg rechnen unten ohne sie (tvGueltig)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('traubenverkauf') as any)
      .select('id, lese_id, storniert_am, storno_grund, storniert_von_name, weingarten_id, grundstueck_id, zukauf_posten_id, kontakt_id, firma_id, datum, menge_kg, preis_per_kg, kmw_grad, oechsle, mostgewicht_einheit, qualitaetsstufe, gesundheit, herkunft_code, notizen, liefernummer, verkaufsposten_id, weingarten:weingarten_id(name), grundstueck:grundstueck_id(gst_nr), kontakt:kontakt_id(vorname, nachname), firma:firma_id(name), verkaufsposten:verkaufsposten_id(rechnungsnummer, storniert)')
      .eq('jahrgang_id', id).order('datum', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })),

    // Kontakte + Firmen für den Abnehmer lädt das Formular seit 05.10.2026 per Suche (PartnerSuche, /api/crm/suche) –
    // vorher alle 8.290 Kontakte und 4.652 Firmen (Gebeshuber) als Auswahlliste bei jedem Aufruf der Jahrgangsseite

    // Betriebsname (Druckkopf) und Modul-Schalter (CSV-Knöpfe nach derselben Regel wie die CSV-Route)
    betriebUndModuleLaden(supabase, tenantId),

    // KAN-129: Lesen des Jahrgangs (Reiter)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('lesen') as any)
      .select('id, lfd_nr, art, bezeichnung, beginn, ende, notizen').eq('jahrgang_id', id).order('lfd_nr')),

    // KAN-392: Grundstücke mit abgeschlossener Ernte im Jahrgang – das Lese-Formular schlägt sie nicht mehr vor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<AR>(tf((supabase.from('ernte_gst_abgeschlossen') as any).select('id, grundstueck_id').eq('jahrgang_id', id).order('id'))),
  ])

  // Sweep 86 (KAN-278): ein Lesefehler wirft (Fehlergrenze) statt still leerer Lesedaten, Pressungen, AMA-Versionen
  const jg = geladen(jgRes, 'Jahrgang') as AR | null
  if (!jg) notFound()
  const rawW = geladen(wRes, 'Rieden') as AR[] | null
  const rawA = geladen(aRes, 'AMA-Erntemeldungen') as AR[] | null
  const rawPressungen = geladen(pressungenRes, 'Pressungen') as AR[] | null
  const rawWA = geladen(waRes, 'Chargen') as AR[]
  const rawGST = geladen(gstRes, 'Grundstücke') as AR[]
  const rawGstAlle = geladen(gstAlleRes, 'Grundstücke') as AR[]
  const rawTV = geladen(tvRes, 'Traubenverkäufe') as AR[] | null
  const rawLesen = geladen(lesenRes, 'Lesen') as AR[] | null
  const abgeschlosseneGst = [...new Set((geladen(abgeschlossenRes, 'Abgeschlossene Ernte') as AR[]).map(z => z.grundstueck_id as string))]

  // ── KAN-129: gewählte Lese (?lese=<Nr.>, sonst die höchste) ─────────────────
  // Lesedaten, Pressungen, Traubenverkäufe aus eigener Ernte und die verfügbaren kg gelten für diese Lese;
  // Hektarhöchstertrag und AMA-Erntemeldung bleiben beim ganzen Jahrgang. Trauben-Zukäufe gehören keiner Lese.
  const lesen = ((rawLesen ?? []) as Lese[])
  const aktiveLese = gewaehlteLese(lesen, leseParam)
  const inLese = (leseId: string | null | undefined) => !aktiveLese || lesen.length <= 1 || leseId === aktiveLese.id
  const rawPressungenAlle = (rawPressungen ?? []) as AR[]
  const rawTVAlle = (rawTV ?? []) as AR[]
  const rawTVLese = rawTVAlle.filter(v => v.zukauf_posten_id || inLese(v.lese_id))
  // KAN-148: stornierte Traubenverkäufe und Lesedaten zählen in keiner Menge (Liste zeigt sie gekennzeichnet)
  const tvGueltig = (v: AR) => !v.storniert_am
  const leseGueltig = ohneStornierteLese(lese.zeilen)
  const lesenMitSperre: LeseMitSperre[] = lesen.map(l => ({
    ...l,
    loeschsperre: leseLoeschsperre(l, lesen.map(x => x.lfd_nr), {
      eintraege: lese.zeilen.filter(z => z.leseId === l.id).length,
      pressungen: rawPressungenAlle.filter(p => p.lese_id === l.id).length,
      traubenverkaeufe: rawTVAlle.filter(v => v.lese_id === l.id).length,
    }),
  }))
  const aktiveLeseMitSperre = aktiveLese ? lesenMitSperre.find(l => l.id === aktiveLese.id) ?? null : null
  // Pflichtmeldungen (Lesedaten, Erntemeldung, BKI-Datenblatt): Betriebsleiter immer, Leser nur mit Controlling
  const csvErlaubt = zugriffsFehler(KATALOG_ERNTE.lesedaten, membership, module) === null
  const bkiErlaubt = zugriffsFehler(KATALOG_ERNTE['bki-traubenverkauf'], membership, module) === null

  // Zugekaufte Trauben dieses Jahrgangs (art='trauben') - stehen als zusätzliche
  // Quelle für Pressungs-Vorschlag und Traubenverkauf zur Verfügung.
  // KAN-41: auch zugekaufte Maische (art='maische') – nur Quelle der Pressung, nicht des Traubenverkaufs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawZukaufTrauben = geladen(await alle(tf((supabase.from('zukauf_posten') as any)
    .select(`
      id, art, datum, menge, rebsorte, herkunft, qualitaetsstufe, kmw, oechsle, mostgewicht_einheit,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(name)
    `)
    .in('art', ['trauben', 'maische'])
    .eq('aktiv', true)
    .eq('jahrgang', (jg as AR).jahrgang)
    .order('datum', { ascending: false }).order('id'))), 'Trauben-Zukäufe')

  // Anzeige wie bisher: neueste Lese zuerst (Postgres-DESC: ohne Datum ganz oben); bei mehreren Lesen je Lese
  // gruppiert (höchste Nummer oben). Die Tabelle und der Druck zeigen immer den ganzen Jahrgang (Ticket Soll 4),
  // Pressungen und verfügbare kg nur die gewählte Lese.
  const nachDatum = (a: ErnteParzelle, b: ErnteParzelle) =>
    (a.ernte_datum === b.ernte_datum ? 0 : a.ernte_datum === null ? -1 : b.ernte_datum === null ? 1 : b.ernte_datum.localeCompare(a.ernte_datum))
  const alleParzellen: ErnteParzelle[] = lese.zeilen.map(zuErnteParzelle)
    .sort((a, b) => (lesen.length > 1 ? (b.lese_nr ?? 0) - (a.lese_nr ?? 0) : 0) || nachDatum(a, b))
  const parzellen: ErnteParzelle[] = alleParzellen.filter(p => !p.storno && inLese(lese.zeilen.find(z => z.id === p.id)?.leseId))
  // KAN-129 Frage 7: Lesegut nach dem 30.11. zählt nicht in die Erntemeldung
  const nachStichtag = stichtagHinweis(teileNachStichtag(leseGueltig, Number((jg as AR).jahrgang)).danach, Number((jg as AR).jahrgang))

  // KAN-150 F1: nur Grundstücke, die im Jahrgang (Stichtag 1.1.) bewirtschaftet wurden – Auswahl und Bezugsfläche
  const jgJahr = Number((jg as AR).jahrgang)
  const gstWi = (rawGST as AR[]).filter(g => gstImJahr(g, jgJahr))
  const gstAlle = (rawGstAlle as AR[]).filter(g => gstImJahr(g, jgJahr))
  const gstByWeingarten: Record<string, GSTOpt[]> = {}
  for (const g of gstWi) {
    if (!gstByWeingarten[g.weingarten_id]) gstByWeingarten[g.weingarten_id] = []
    gstByWeingarten[g.weingarten_id].push({ id: g.id, gst_nr: g.gst_nr, rebsorte: g.rebsorte ?? null, flaeche_ha: g.flaeche_ha ?? null, herkunft_code: g.trauben_herkunft_code ?? null })
  }
  const gstAnzahlJeWeingarten = new Map<string, number>()
  for (const g of gstAlle) gstAnzahlJeWeingarten.set(g.weingarten_id, (gstAnzahlJeWeingarten.get(g.weingarten_id) ?? 0) + 1)

  const weingaerten: WeingartenOpt[] = ((rawW ?? []) as AR[]).map(w => ({
    id: w.id, name: w.name, rebsorte: w.rebsorte ?? null, lage_name: w.lagen?.name ?? null,
    ama_feldnummer: w.ama_feldnummer ?? null, flaeche_ha: w.flaeche_ha ?? null,
    erntebar: istErntebar(gstAnzahlJeWeingarten.get(w.id) ?? 0, gstByWeingarten[w.id]?.length ?? 0),
  }))

  // ── Hektarhöchstertrag-Prüfung (Qualitätswein, betriebsweit) ────────────────
  // Hinweis vom BKI (18.07.2026): die hl-Höchstmenge für Qualitätswein wird gegen
  // die GST-Fläche lt. AMA berechnet (= flaeche_ha, laut Betrieb keine Abweichung),
  // Erntebetrag darf 10.000 kg/ha nicht überschreiten, betriebsweit gerechnet.
  // Reine Info-/Warnfunktion – ersetzt keine rechtliche Prüfung. Dieselbe Berechnung
  // steht in der Erntemeldung (Druck /reports/ama und CSV).
  const hektarhoechstertrag: HektarhoechstertragStatus = berechneHektarhoechstertrag(leseGueltig, weinbauflaecheHa(gstWi))

  let amaMeldung: AMAMeldung | null = null
  // KAN-37 B: gespeicherte Abgaben (Snapshot der eingereichten CSV) je Version
  const amaIds = ((rawA ?? []) as AR[]).map(v => v.id as string)
  const abgabeJe = new Map<string, { id: string; csv_sha256: string }>()
  if (amaIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawAbg = geladen(await (supabase.from('meldung_abgaben') as any)
      .select('id, ama_meldung_id, csv_sha256').eq('tenant_id', tenantId).in('ama_meldung_id', amaIds), 'Abgaben der Erntemeldung')
    for (const a of (rawAbg ?? []) as AR[]) abgabeJe.set(a.ama_meldung_id, { id: a.id, csv_sha256: a.csv_sha256 })
  }
  const amaVersionen: AMAVersion[] = ((rawA ?? []) as AR[])
    .map(v => ({ ...v, version: (v.version as number | null) ?? 1, abgabe: abgabeJe.get(v.id) ?? null }) as AMAVersion)
  const amaNeueste = neuesteAmaVersion(amaVersionen)
  if (amaNeueste) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPos = geladen(await (supabase.from('ama_meldepositionen') as any)
      .select('rebsorte_name, flaeche_ha, menge_kg').eq('meldung_id', amaNeueste.id).order('rebsorte_name'), 'Positionen der Erntemeldung')
    amaMeldung = {
      ...amaNeueste,
      positionen: (rawPos ?? []) as AMAMeldung['positionen'],
      versionen: amaVersionen,
      // gleiche Grundlage wie „Neu berechnen“: gültige Lesedaten bis zum Stichtag, je Rebsorte
      abweichungen: amaAbweichungen((rawPos ?? []) as AMAMeldung['positionen'],
        aggregiereJeRebsorte(teileNachStichtag(leseGueltig, Number((jg as AR).jahrgang)).bis.map(parzelleFuerMeldung))),
    } as AMAMeldung
  }

  // KAN-148 C1c: stornierte Pressung mit allen Zeilen (gekennzeichnet); sonst nur nicht stornierte Zeilen
  const zeileZeigen = (p: AR) => (z: AR) => !!p.storniert_am || !z.storniert_am
  const allePressungen: (Pressung & { lese_id: string | null })[] = rawPressungenAlle.map(p => ({
    lese_id: p.lese_id ?? null,
    id: p.id, datum: p.datum, most_liter_gesamt: p.most_liter_gesamt ?? null,
    weinbezeichnung: p.weinbezeichnung ?? null, notizen: p.notizen ?? null, kmw_grad: p.kmw_grad ?? null,
    oechsle: p.oechsle ?? null, mostgewicht_einheit: p.mostgewicht_einheit ?? null,   // KAN-131
    storno: p.storniert_am ? { am: p.storniert_am as string, von: (p.storniert_von_name as string | null) ?? null, grund: (p.storno_grund as string | null) ?? null } : null,
    weingaerten: ((p.weingaerten ?? []) as AR[]).filter(zeileZeigen(p)).map((w: AR): PressungWG => ({
      id: w.id, weingarten_id: w.weingarten_id,
      grundstueck_id: w.grundstueck_id ?? null,
      zukauf_posten_id: w.zukauf_posten_id ?? null,
      weingarten_name: w.weingarten?.name ?? (w.zukauf_posten_id ? 'Zukauf' : '–'),
      trauben_kg: w.trauben_kg, rebsorte: w.rebsorte ?? null, notizen: w.notizen ?? null,
      // KAN-126: Lesetag und Mostgewicht der Traubenzeile
      ernte_datum: w.ernte_datum ?? null, kmw: w.kmw ?? null, oechsle: w.oechsle ?? null, mostgewicht_einheit: w.mostgewicht_einheit ?? null,
    })),
    behaelter: ((p.behaelter ?? []) as AR[]).filter(zeileZeigen(p)).map((b: AR): PressungBeh => ({
      id: b.id, behaelter_id: b.behaelter_id ?? null,
      behaelter_name: b.behaelter?.name ?? null,
      weinausbau_id: b.weinausbau_id ?? null,
      weinausbau_name: b.weinausbau?.name ?? null,
      weinausbau_qualitaet: b.weinausbau?.qualitaetsstufe ?? null,
      menge_liter: b.menge_liter ?? null, notizen: b.notizen ?? null,
    })),
  }))

  const pressungen: Pressung[] = allePressungen.filter(p => inLese(p.lese_id))
  // KAN-148 C1c: stornierte Pressungen zählen in keiner Menge (verpresst, verfügbar)
  const gueltigePressungen = pressungen.filter(p => !p.storno)
  const wgOptions: WGOption[]  = weingaerten.map(w => ({ id: w.id, name: w.name, rebsorte: w.rebsorte }))

  // Verfügbare kg pro WG: geerntet − verpresst (für alle Pressungen dieses Jahrgangs)
  const harvestedKgByWG: Record<string, number> = {}
  for (const p of parzellen) {
    if (p.menge_kg) harvestedKgByWG[p.weingarten_id] = (harvestedKgByWG[p.weingarten_id] ?? 0) + p.menge_kg
  }
  const pressedKgByWG: Record<string, number> = {}
  for (const p of gueltigePressungen) {
    for (const w of p.weingaerten) {
      if (w.weingarten_id) pressedKgByWG[w.weingarten_id] = (pressedKgByWG[w.weingarten_id] ?? 0) + w.trauben_kg
    }
  }
  // Verkaufte kg pro WG aus Traubenverkauf (dieses Jahrgangs) abziehen
  const soldKgByWG: Record<string, number> = {}
  for (const v of rawTVLese.filter(tvGueltig)) {
    if (v.weingarten_id) soldKgByWG[v.weingarten_id] = (soldKgByWG[v.weingarten_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }
  const verfuegbareKg: Record<string, number> = {}
  for (const wgId of Object.keys(harvestedKgByWG)) {
    verfuegbareKg[wgId] = Math.max(0, (harvestedKgByWG[wgId] ?? 0) - (pressedKgByWG[wgId] ?? 0) - (soldKgByWG[wgId] ?? 0))
  }
  // Verfügbare kg pro GST. KAN-394 (Entscheidung Jörgen 02.11.2026): Lesemengen ohne GST sind anteilig (Fläche) auf die
  // GST der Ried verteilt – dieselbe Verteilung wie die Sperre beim Speichern (riedLeseVerteilen, leseDeckungFehler)
  const harvestedKgByGST: Record<string, number> = {}
  const gelesenVerteilt = riedLeseVerteilen(
    parzellen.map(p => ({ weingarten_id: p.weingarten_id, grundstueck_id: p.grundstueck_id ?? null, kg: p.menge_kg ?? null })),
    z => gstByWeingarten[z.weingarten_id ?? ''] ?? [])
  for (const p of gelesenVerteilt) {
    if (p.grundstueck_id && p.kg)
      harvestedKgByGST[p.grundstueck_id] = (harvestedKgByGST[p.grundstueck_id] ?? 0) + p.kg
  }
  const pressedKgByGST: Record<string, number> = {}
  for (const p of gueltigePressungen) {
    for (const w of p.weingaerten) {
      if (w.grundstueck_id)
        pressedKgByGST[w.grundstueck_id] = (pressedKgByGST[w.grundstueck_id] ?? 0) + w.trauben_kg
    }
  }
  const soldKgByGST: Record<string, number> = {}
  for (const v of rawTVLese.filter(tvGueltig)) {
    if (v.grundstueck_id)
      soldKgByGST[v.grundstueck_id] = (soldKgByGST[v.grundstueck_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }
  const verfuegbareKgByGST: Record<string, number> = {}
  for (const gstId of Object.keys(harvestedKgByGST)) {
    verfuegbareKgByGST[gstId] = Math.max(0, (harvestedKgByGST[gstId] ?? 0) - (pressedKgByGST[gstId] ?? 0) - (soldKgByGST[gstId] ?? 0))
  }
  // KAN-394: ein GST nie mehr als seine Ried – Verbrauch ohne GST („ganzer Weingarten“) mindert nur die Ried
  for (const z of gelesenVerteilt) {
    if (z.grundstueck_id && z.weingarten_id && verfuegbareKgByGST[z.grundstueck_id] !== undefined)
      verfuegbareKgByGST[z.grundstueck_id] = Math.min(verfuegbareKgByGST[z.grundstueck_id], verfuegbareKg[z.weingarten_id] ?? 0)
  }

  // Verfügbare kg pro Trauben-Zukauf: zugekaufte Menge − bereits verpresst − bereits verkauft
  const pressedKgByZukauf: Record<string, number> = {}
  for (const p of allePressungen.filter(x => !x.storno)) {
    for (const w of p.weingaerten) {
      if (w.zukauf_posten_id) pressedKgByZukauf[w.zukauf_posten_id] = (pressedKgByZukauf[w.zukauf_posten_id] ?? 0) + w.trauben_kg
    }
  }
  const soldKgByZukauf: Record<string, number> = {}
  for (const v of rawTVAlle.filter(tvGueltig)) {
    if (v.zukauf_posten_id) soldKgByZukauf[v.zukauf_posten_id] = (soldKgByZukauf[v.zukauf_posten_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }
  const zukaufTrauben: ZukaufTraubenOpt[] = ((rawZukaufTrauben ?? []) as AR[]).map(z => {
    const mengeKg = parseFloat(z.menge) || 0
    const lieferant = z.lieferant_kontakt
      ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
      : (z.lieferant_firma?.name ?? '–')
    return {
      id: z.id,
      art: z.art === 'maische' ? 'maische' : 'trauben',
      datum: z.datum,
      lieferant,
      rebsorte: z.rebsorte ?? null,
      herkunft: z.herkunft ?? null,
      // KAN-80 Nachtrag (02.10.2026): Stufe der Zukauf-Trauben – Obergrenze der Abstufung in der Pressungs-Vorschau
      qualitaetsstufe: z.qualitaetsstufe ?? null,
      menge_kg: mengeKg,
      verfuegbar_kg: Math.max(0, mengeKg - (pressedKgByZukauf[z.id] ?? 0) - (soldKgByZukauf[z.id] ?? 0)),
      kmw_grad: z.kmw != null ? parseFloat(z.kmw) : null,
      // KAN-128: Messwert und Einheit des Zukaufs – Vorbelegung beim Traubenverkauf aus dem Zukauf
      oechsle: z.oechsle != null ? parseFloat(z.oechsle) : null,
      mostgewicht_einheit: z.mostgewicht_einheit ?? null,
    }
  })
  // Welche Behälter haben bereits eine Kellerbuch-Charge (für Verschnitt-Warnung)
  // Direkt aus weinausbau abfragen — unabhängig von pressung_behaelter Rückverknüpfung
  const behaelterMitCharge: Record<string, { weinausbau_id: string; name: string; rebsorte?: string | null; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }[]> = {}
  for (const wa of ((rawWA ?? []) as AR[])) {
    if (wa.behaelter_id && wa.id && wa.name) {
      if (!behaelterMitCharge[wa.behaelter_id]) behaelterMitCharge[wa.behaelter_id] = []
      behaelterMitCharge[wa.behaelter_id].push({
        weinausbau_id: wa.id, name: wa.name, rebsorte: wa.rebsorte ?? null, menge_liter: wa.menge_liter ?? null,
        qualitaetsstufe: wa.qualitaetsstufe ?? null, herkunft_code: wa.herkunft_code ?? null,
      })
    }
  }
  const behOptions: BehOption[] = behRows.map(b => ({ id: b.id, name: b.anzeigeName, volumen_liter: b.volumen_liter ?? null }))
  const waOptions: WAOption[]  = ((rawWA ?? []) as AR[]).map(w => ({ id: w.id, name: w.name, jahrgang: w.jahrgang ?? null }))

  // Traubenverkauf
  const zukaufById = new Map(zukaufTrauben.map(z => [z.id, z]))
  const verkauefe: Traubenverkauf[] = rawTVLese.map((v: AR) => {
    const zukaufQuelle = v.zukauf_posten_id ? zukaufById.get(v.zukauf_posten_id) : undefined
    return {
    id: v.id,
    weingarten_id: v.weingarten_id ?? null,
    grundstueck_id: v.grundstueck_id ?? null,
    grundstueck_nr: (v.grundstueck as AR | null)?.gst_nr ?? null,
    zukauf_posten_id: v.zukauf_posten_id ?? null,
    weingarten_name: (v.weingarten as AR | null)?.name
      ?? (zukaufQuelle
            ? `Zukauf – ${zukaufQuelle.rebsorte ? formatRebsorteMitKuerzel(zukaufQuelle.rebsorte) : '–'}${zukaufQuelle.lieferant ? ' (' + zukaufQuelle.lieferant + ')' : ''}`
            : (v.zukauf_posten_id ? 'Zukauf' : '–')),
    kontakt_id: v.kontakt_id ?? null,
    kontakt_name: v.kontakt ? `${(v.kontakt as AR).vorname ?? ''} ${(v.kontakt as AR).nachname ?? ''}`.trim() : null,
    firma_id: v.firma_id ?? null,
    firma_name: (v.firma as AR | null)?.name ?? null,
    datum: v.datum,
    menge_kg: parseFloat(v.menge_kg) || 0,
    preis_per_kg: v.preis_per_kg != null ? parseFloat(v.preis_per_kg) : null,
    kmw_grad: v.kmw_grad != null ? parseFloat(v.kmw_grad) : null,
    oechsle: v.oechsle != null ? parseFloat(v.oechsle) : null,
    mostgewicht_einheit: v.mostgewicht_einheit ?? null,
    qualitaetsstufe: v.qualitaetsstufe ?? null,
    gesundheit: v.gesundheit ?? 'G',
    herkunft_code: v.herkunft_code ?? null,
    notizen: v.notizen ?? null,
    liefernummer: v.liefernummer ?? null,
    rechnungsnummer: (v.verkaufsposten as AR | null)?.rechnungsnummer ?? null,
    rechnung_storniert: !!(v.verkaufsposten as AR | null)?.storniert,
    storno: v.storniert_am ? { am: v.storniert_am as string, von: (v.storniert_von_name as string | null) ?? null, grund: (v.storno_grund as string | null) ?? null } : null,
    }
  })
  // WG-Optionen für Traubenverkauf: alle WGs die in diesem Jahrgang geerntet wurden
  // (jede Lese qualifiziert automatisch für Traubenverkauf)
  const harvestedWGIds = new Set(Object.keys(harvestedKgByWG))
  const tvWGOptions: TVWGOption[] = ((rawW ?? []) as AR[])
    .filter((w: AR) => harvestedWGIds.has(w.id))
    .map((w: AR) => ({ id: w.id, name: w.name, herkunft_code: w.trauben_herkunft_code ?? null }))

  // ── Quellen-Optionen "eigene Ernte" für Traubenverkauf ───────────────────────
  // Bugfix: der Verkauf muss dieselbe Granularität (Ried/GST) wie der
  // Pressungs-Vorschlag verwenden, sonst wird eine verkaufte Menge nirgends
  // korrekt abgezogen. Für WGs mit GST-zugeordneten Lesedaten wird pro GST
  // eine Option angeboten (verfuegbareKgByGST, exakt wie im Pressungs-
  // Vorschlag); für WGs ganz ohne GST-Zuordnung fällt die Option auf WG-Ebene
  // zurück (verfuegbareKg). Beim Speichern wird passend weingarten_id UND
  // (falls vorhanden) grundstueck_id mitgeschickt.
  const tvHerkunftByWG = new Map(tvWGOptions.map(w => [w.id, w.herkunft_code]))
  const gstRowsMap = new Map<string, {
    weingarten_id: string; weingarten_name: string; grundstueck_nr: string | null
    klosterneuburger: number | null; oechsle: number | null; mostgewicht_einheit: string | null
    qualitaetsstufe: string | null
  }>()
  for (const p of parzellen) {
    if (p.grundstueck_id && !gstRowsMap.has(p.grundstueck_id)) {
      gstRowsMap.set(p.grundstueck_id, {
        weingarten_id: p.weingarten_id, weingarten_name: p.weingarten_name,
        grundstueck_nr: p.grundstueck_nr,
        // Mostgewicht mit gemessener Einheit (KAN-128) – Vorbelegung des Traubenverkaufs
        klosterneuburger: p.klosterneuburger, oechsle: p.oechsle, mostgewicht_einheit: p.mostgewicht_einheit,
        qualitaetsstufe: p.qualitaetsstufe,
      })
    }
  }
  const wgIdsMitGST = new Set([...gstRowsMap.values()].map(g => g.weingarten_id))
  const tvQuelleOptions: TVQuelleOption[] = [
    ...[...gstRowsMap.entries()].map(([gstId, g]) => ({
      compositeId: `gst:${gstId}`,
      weingarten_id: g.weingarten_id,
      grundstueck_id: gstId,
      label: g.grundstueck_nr ? `GST ${g.grundstueck_nr} · ${g.weingarten_name}` : g.weingarten_name,
      herkunft_code: tvHerkunftByWG.get(g.weingarten_id) ?? null,
      klosterneuburger: g.klosterneuburger,
      oechsle: g.oechsle,
      mostgewicht_einheit: g.mostgewicht_einheit,
      qualitaetsstufe: g.qualitaetsstufe,
      verfuegbar_kg: verfuegbareKgByGST[gstId] ?? 0,
    })),
    ...tvWGOptions
      .filter(w => !wgIdsMitGST.has(w.id))
      .map(w => {
        const p = parzellen.find(pp => pp.weingarten_id === w.id)
        return {
          compositeId: `wg:${w.id}`,
          weingarten_id: w.id,
          grundstueck_id: null,
          label: w.name,
          herkunft_code: w.herkunft_code,
          klosterneuburger: p?.klosterneuburger ?? null,
          oechsle: p?.oechsle ?? null,
          mostgewicht_einheit: p?.mostgewicht_einheit ?? null,
          qualitaetsstufe: p?.qualitaetsstufe ?? null,
          verfuegbar_kg: verfuegbareKg[w.id] ?? 0,
        }
      }),
  ]

  // Lese-Orte für das Pressungs-Formular: eine Zeile je (Ried, Grundstück). Ein GST kann mehrere Lese-Einträge haben
  // (z. B. Kabinett + Spätlese) – dann der Eintrag, dessen Menge der verfügbaren Restmenge am nächsten liegt.
  const bestByKey = new Map<string, ErnteParzelle>()
  for (const p of parzellen) {
    const key = `${p.weingarten_id}|${p.grundstueck_id ?? ''}`
    const verfuegbar = p.grundstueck_id ? (verfuegbareKgByGST[p.grundstueck_id] ?? 0) : (verfuegbareKg[p.weingarten_id] ?? 0)
    const existing = bestByKey.get(key)
    if (!existing || Math.abs((p.menge_kg ?? 0) - verfuegbar) < Math.abs((existing.menge_kg ?? 0) - verfuegbar)) bestByKey.set(key, p)
  }
  const leseParzellen: LeseParzelle[] = Array.from(bestByKey.values()).map(p => ({
    weingarten_id: p.weingarten_id,
    weingarten_name: p.weingarten_name,
    grundstueck_id: p.grundstueck_id,
    grundstueck_nr: p.grundstueck_nr,
    grundstueck_rebsorte: p.grundstueck_rebsorte,
    menge_kg: p.menge_kg,
    rebsorte: p.weingarten_rebsorte,
    klosterneuburger: p.klosterneuburger,
  }))
  // KAN-126: alle Lese-Einträge – Lesetage und Mostgewicht je Ort für die Pressung
  const leseEintraege: LeseEintrag[] = parzellen.map(p => ({
    weingarten_id: p.weingarten_id, grundstueck_id: p.grundstueck_id, ernte_datum: p.ernte_datum,
    kmw: p.klosterneuburger, oechsle: p.oechsle, mostgewicht_einheit: p.mostgewicht_einheit,
    qualitaetsstufe: p.qualitaetsstufe,   // KAN-81: Obergrenze der Pressung
  }))

  return {
    jg: jg as AR, writeOk, adminOk, crmSchreiben, betrieb, csvErlaubt, bkiErlaubt,
    lesen, lesenMitSperre, aktiveLese, aktiveLeseMitSperre,
    alleParzellen, parzellen, nachStichtag, weingaerten, gstByWeingarten, amaMeldung, hektarhoechstertrag,
    pressungen, wgOptions, behOptions, waOptions, verfuegbareKg, verfuegbareKgByGST, zukaufTrauben, behaelterMitCharge,
    leseParzellen, leseEintraege,
    verkauefe, tvQuelleOptions, abgeschlosseneGst,
  }
}

export type LeseKontext = Awaited<ReturnType<typeof ladeLeseKontext>>
