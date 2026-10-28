// KAN-385 Stufe 2 (28.10.2026): die Abfragen des Weinbuchs, die nur an der Charge hängen, für VIELE Chargen auf
// einmal (je Quelle eine Abfrage je 100 Chargen statt einer je Charge). buildWeinbuch() nimmt die Daten einer Charge
// aus diesem Lader – auch das Einzel-Weinbuch (ids = [id]), damit es nur einen Abfrageweg gibt. Was vom Ergebnis
// einer Charge abhängt (Ried über ladeRvWeingarten, Ziel-Gebinde der Umzüge, Quellgebinde der Verschnitte, Zukäufe
// der Vorgänger, Kellerbehandlungen ohne Charge), lädt buildWeinbuch weiterhin selbst.
//
// Reihenfolge: inBloecken sortiert je Block; eine Charge liegt immer in genau einem Block, die Zeilen einer Charge
// stehen daher in derselben Reihenfolge wie bei der Einzelabfrage.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle, inBloecken } from '@/lib/supabase/alle'
import { ladePnVerlauf, type PnVerlauf } from '@/lib/kellerbuch/pruefnummerVerlauf'
import { WB_JOURNAL_SPALTEN, type WbJournalZeile } from '@/lib/wein/weinbuchBestand'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'

type R = Record<string, any>

/** Rohdaten einer Charge; *Fehler = Meldung für die Hinweise des Weinbuchs (die Quelle fehlt dann, wie bisher) */
export type WeinbuchDaten = {
  wa: R
  pressungen: R[]
  umzuege: R[]
  kellerBeh: R[]
  analysen: R[]
  dacAntraege: R[]
  fuellChargen: R[]
  fuellDirekt: R[]
  weingaerten: R[]
  verschnEin: R[]
  verschnAus: R[]
  umstufungen: R[]
  umstufungenFehler: string | null
  /** dac_antrag_id → erstellt_am des letzten Status-Ereignisses */
  dacZeit: Map<string, string>
  dacZeitFehler: string | null
  journal: WbJournalZeile[]
  journalFehler: string | null
  zukaeufe: R[]
  fassverkaeufe: R[]
  zkFvFehler: boolean
  pnVerlauf: PnVerlauf[]
  pnFehler: string | null
}

function gruppiere(zeilen: R[], schluessel: (z: R) => unknown): Map<string, R[]> {
  const out = new Map<string, R[]>()
  for (const z of zeilen) {
    const k = schluessel(z)
    if (typeof k !== 'string') continue
    const l = out.get(k)
    if (l) l.push(z); else out.set(k, [z])
  }
  return out
}

/** Rohdaten der Weinbücher je Charge – nur Chargen, die im Betrieb existieren; Lesefehler der Kernquellen werfen */
export async function ladeWeinbuchDaten(supabase: any, tenantId: string | null, ids: readonly string[]): Promise<Map<string, WeinbuchDaten>> {
  // Explizite Tenant-Filterung zusätzlich zu RLS (Mehrfach-Mitgliedschaft), wie bisher in buildWeinbuch
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query
  const kern = (name: string, res: { error: R | null }) => {
    // KAN-254: sonst fehlten im Weinbuch (Aufzeichnung für die Behörde) still Buchungen
    if (res.error) throw new AktionsFehler(`${name} konnten nicht geladen werden: ${res.error.message}`)
  }

  const [waRes, prRes, umRes, kbRes, anRes, dacRes, fcRes, fdRes, wawRes, veRes, vaRes, umstRes] = await Promise.all([
    inBloecken<R>(ids, b => alle(tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, qualitaetsstufe, status, menge_liter, behaelter_id, ist_eroeffnungsbestand, anfangsbestand_liter, created_at, kmw, oechsle, mostgewicht_einheit, behaelter:behaelter_id(name)')
      .in('id', b))
      .order('id'))),

    // tenant-isolation-ignore: pressung_behaelter ohne tenant_id, Filter über die Pressung (!inner)
    inBloecken<R>(ids, b => alle((tenantId ? (q: any) => q.eq('pressung.tenant_id', tenantId) : (q: any) => q)((supabase.from('pressung_behaelter') as any)
      // storno-sichtbar: das Weinbuch zeigt eine stornierte Pressung gekennzeichnet und den Storno (KAN-148 C1c)
      .select(`
        id, weinausbau_id, menge_liter, storniert_am, storno_grund, storniert_von_name,
        pressung:pressung_id!inner(
          id, datum, erstellt_am, most_liter_gesamt, weinbezeichnung, lese_id, tenant_id, storniert_am, kmw_grad, oechsle, mostgewicht_einheit,
          pressung_weingaerten(
            trauben_kg, rebsorte, ernte_datum, kmw, oechsle, mostgewicht_einheit, weingarten_id, storniert_am,
            weingarten:weingarten_id(id, name, flaeche_ha),
            grundstueck:grundstueck_id(gst_nr)
          )
        )
      `)
      .in('weinausbau_id', b))
      .order('id'))),

    inBloecken<R>(ids, b => alle(tf((supabase.from('keller_umzuege') as any)
      .select(`
        id, von_weinausbau_id, datum, erstellt_am, menge_liter, brutto_liter, schwund_liter, zeilen_typ, umzug_batch_id, umzug_typ, notizen,
        storniert_am, storno_grund, storniert_von_name,
        von_behaelter:von_behaelter_id(name),
        nach_behaelter:nach_behaelter_id(name)
      `)
      // storno-sichtbar: das Weinbuch zeigt die Buchung (gekennzeichnet) und den Storno (KAN-145 B2b)
      .in('von_weinausbau_id', b))
      .order('datum', { ascending: true }).order('erstellt_am', { ascending: true }).order('id'))),

    inBloecken<R>(ids, b => alle(tf((supabase.from('keller_behandlungen') as any)
      .select('id, weinausbau_id, datum, created_at, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name), storniert_am, storno_grund, storniert_von_name')
      // storno-sichtbar: das Weinbuch zeigt stornierte Kellerbehandlungen gekennzeichnet (KAN-145 B3)
      .in('weinausbau_id', b))
      .order('datum', { ascending: true }).order('created_at', { ascending: true }).order('id'))),

    // storno-sichtbar: das Weinbuch zeigt stornierte Analysen gekennzeichnet (KAN-150 F2)
    inBloecken<R>(ids, b => alle(tf((supabase.from('weinanalysen') as any)
      .select('id, weinausbau_id, analyse_datum, created_at, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl, bewertung, notizen, storniert_am, storno_grund, storniert_von_name')
      .in('weinausbau_id', b))
      .order('analyse_datum', { ascending: true }).order('created_at', { ascending: true }).order('id'))),

    // storno-sichtbar: das Weinbuch zeigt stornierte DAC-Anträge gekennzeichnet (KAN-150 F2)
    inBloecken<R>(ids, b => alle(tf((supabase.from('dac_antrag') as any)
      .select('id, weinausbau_id, bezeichnung, dac_region, status, pruefnummer, eingereicht_am, bescheid_am, created_at, storniert_am, storno_grund, storniert_von_name')
      .in('weinausbau_id', b))
      .order('created_at', { ascending: true }).order('id'))),

    inBloecken<R>(ids, b => alle(tf((supabase.from('fuellung_chargen') as any)
      .select(`
        id, weinausbau_id, anteil_liter,
        fuellung:fuellung_id(
          id, datum, erstellt_am, chargennummer, pruefnummer, name,
          anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt, aktiv, storniert_am, storno_grund, storniert_von_name
        )
      `)
      .in('weinausbau_id', b))
      .order('id'))),

    inBloecken<R>(ids, b => alle(tf((supabase.from('fuellungen') as any)
      .select('id, weinausbau_id, datum, erstellt_am, chargennummer, pruefnummer, name, anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt, aktiv, storniert_am, storno_grund, storniert_von_name')
      .in('weinausbau_id', b))
      .order('id'))),

    inBloecken<R>(ids, b => alle(tf((supabase.from('weinausbau_weingaerten') as any)
      .select('id, weinausbau_id, weingarten_id, weingarten:weingarten_id(id, name)')
      .in('weinausbau_id', b))
      .order('id'))),

    inBloecken<R>(ids, b => alle(tf((supabase.from('verschneidungen') as any)
      .select(`id, datum, created_at, notizen, ziel_weinausbau_id, storniert_am, storno_grund, storniert_von_name,
        quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter, anteil_pct, quell_behaelter_id, gebinde_rekonstruiert,
          quelle:quell_weinausbau_id(id, name, rebsorte))`)
      // storno-sichtbar: das Weinbuch zeigt die Buchung (gekennzeichnet) und den Storno (KAN-145 B2b)
      .in('ziel_weinausbau_id', b))
      .order('datum', { ascending: true }).order('created_at', { ascending: true }).order('id'))),

    // tenant-isolation-ignore: verschneidung_quellen ohne tenant_id, Betrieb über die Verschneidung (RLS) und die Quell-Charge
    // storno-sichtbar: das Weinbuch kennzeichnet abgegebene stornierte Verschnitte (merkeStorno in buildWeinbuch, KAN-145 B2b)
    inBloecken<R>(ids, b => alle((supabase.from('verschneidung_quellen') as any)
      .select(`id, quell_weinausbau_id, menge_liter, anteil_pct,
        verschneidung:verschneidung_id(id, datum, created_at, notizen, storniert_am, storno_grund, storniert_von_name,
          ziel:ziel_weinausbau_id(id, name))`)
      .in('quell_weinausbau_id', b)
      .order('id'))),

    // KAN-82: Abstufungen der Charge
    inBloecken<R>(ids, b => alle(tf((supabase.from('charge_umstufungen') as any)
      .select('id, weinausbau_id, datum, erstellt_am, menge_liter, alt_qualitaetsstufe, alt_zusatzbezeichnung, alt_erzeugnis, alt_herkunft_code, neu_qualitaetsstufe, neu_zusatzbezeichnung, neu_erzeugnis, neu_herkunft_code, grund, erstellt_von_name, quelle:quelle_weinausbau_id(name)')
      .in('weinausbau_id', b))
      .order('datum', { ascending: true }).order('erstellt_am', { ascending: true }).order('id'))),
  ])
  kern('Chargen', waRes)
  kern('Pressungen', prRes)
  kern('Umzüge', umRes)
  kern('Kellerbehandlungen', kbRes)
  kern('Analysen', anRes)
  kern('Prüfnummernanträge', dacRes)
  kern('Füllungen', fcRes)
  kern('Füllungen', fdRes)
  kern('Weingärten der Chargen', wawRes)
  kern('Verschneidungen', veRes)
  kern('Verschnitt-Quellen', vaRes)

  // Zweite Runde: hängt an den Anträgen bzw. nur am Betrieb (wie bisher nur mit tenantId)
  const dacIds = dacRes.data.map(d => d.id as string)
  const [peRes, jRes, zkRes, fvRes, pn] = await Promise.all([
    dacIds.length > 0
      ? inBloecken<R>(dacIds, b => alle(tf((supabase.from('pruefnummer_ereignisse') as any)
        .select('id, dac_antrag_id, erstellt_am')
        .in('dac_antrag_id', b))
        .order('erstellt_am').order('id')))
      : Promise.resolve({ data: [] as R[], error: null }),
    tenantId
      ? inBloecken<WbJournalZeile & R>(ids, b => alle(supabase.from('kellerbuch_buchungen')
        .select(`weinausbau_id, ${WB_JOURNAL_SPALTEN}`)
        .eq('tenant_id', tenantId)
        .in('weinausbau_id', b)
        .eq('bestand', 'offen')
        .order('datum').order('beleg_nr').order('pos').order('id')))
      : Promise.resolve({ data: [] as (WbJournalZeile & R)[], error: null }),
    tenantId
      // storno-sichtbar: das Weinbuch zeigt stornierte Zukäufe gekennzeichnet (KAN-44)
      ? inBloecken<R>(ids, b => alle(supabase.from('zukauf_posten')
        .select('id, ziel_weinausbau_id, datum, erstellt_am, art, menge, einheit, rebsorte, jahrgang, aktiv, storniert_am, storno_grund, storniert_von_name, partner_daten, lieferant_firma:firmen!lieferant_firma_id(name), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)')
        .eq('tenant_id', tenantId).in('ziel_weinausbau_id', b).order('datum').order('erstellt_am').order('id')))
      : Promise.resolve({ data: [] as R[], error: null }),
    tenantId
      // storno-sichtbar: das Weinbuch zeigt stornierte Fassverkäufe gekennzeichnet (KAN-44)
      ? inBloecken<R>(ids, b => alle(supabase.from('verkauf_positionen')
        .select('id, weinausbau_id, menge, verkaufsposten:verkaufsposten_id(datum, erstellt_am, rechnungsnummer, aktiv, storniert, storniert_am, storno_grund, storniert_von_name, partner_daten, firma:firma_id(name), kontakt:kontakt_id(vorname, nachname))')
        .eq('tenant_id', tenantId).in('weinausbau_id', b).eq('typ', 'tank').order('id')))
      : Promise.resolve({ data: [] as R[], error: null }),
    // KAN-200: Prüfnummer je Charge
    tenantId
      ? ladePnVerlauf(supabase, tenantId, ids).then(m => ({ m, fehler: null as string | null }), (e: unknown) => ({ m: new Map<string, PnVerlauf[]>(), fehler: e instanceof Error ? e.message : 'Prüfnummer je Charge konnte nicht geladen werden.' }))
      : Promise.resolve({ m: new Map<string, PnVerlauf[]>(), fehler: null as string | null }),
  ])

  const dacZeitFehler = peRes.error ? `Ereignisse der Prüfnummernanträge konnten nicht geladen werden (${peRes.error.message}) – Reihenfolge am Tag nach Anlage des Antrags.` : null
  const dacZeit = new Map<string, string>()
  for (const e of peRes.error ? [] : peRes.data) dacZeit.set(e.dac_antrag_id, e.erstellt_am)   // aufsteigend: das letzte gewinnt
  const journalFehler = jRes.error ? `Bewegungsjournal der Charge konnte nicht geladen werden (${jRes.error.message}) – Zukauf, Verkauf und Korrekturen fehlen.` : null
  const umstufungenFehler = umstRes.error ? `Abstufungen konnten nicht geladen werden: ${umstRes.error.message}` : null
  const zkFvFehler = !!(zkRes.error || fvRes.error)

  const je = {
    pr: gruppiere(prRes.data, z => z.weinausbau_id),
    um: gruppiere(umRes.data, z => z.von_weinausbau_id),
    kb: gruppiere(kbRes.data, z => z.weinausbau_id),
    an: gruppiere(anRes.data, z => z.weinausbau_id),
    dac: gruppiere(dacRes.data, z => z.weinausbau_id),
    fc: gruppiere(fcRes.data, z => z.weinausbau_id),
    fd: gruppiere(fdRes.data, z => z.weinausbau_id),
    waw: gruppiere(wawRes.data, z => z.weinausbau_id),
    ve: gruppiere(veRes.data, z => z.ziel_weinausbau_id),
    va: gruppiere(vaRes.data, z => z.quell_weinausbau_id),
    umst: gruppiere(umstRes.error ? [] : umstRes.data, z => z.weinausbau_id),
    j: gruppiere(jRes.error ? [] : jRes.data, z => z.weinausbau_id),
    zk: gruppiere(zkRes.error ? [] : zkRes.data, z => z.ziel_weinausbau_id),
    fv: gruppiere(fvRes.error ? [] : fvRes.data, z => z.weinausbau_id),
  }

  const out = new Map<string, WeinbuchDaten>()
  for (const wa of waRes.data) {
    const id = wa.id as string
    const dacAntraege = je.dac.get(id) ?? []
    out.set(id, {
      wa,
      pressungen: je.pr.get(id) ?? [],
      umzuege: je.um.get(id) ?? [],
      kellerBeh: je.kb.get(id) ?? [],
      analysen: je.an.get(id) ?? [],
      dacAntraege,
      fuellChargen: je.fc.get(id) ?? [],
      fuellDirekt: je.fd.get(id) ?? [],
      weingaerten: je.waw.get(id) ?? [],
      verschnEin: je.ve.get(id) ?? [],
      verschnAus: je.va.get(id) ?? [],
      umstufungen: je.umst.get(id) ?? [],
      umstufungenFehler,
      dacZeit: new Map(dacAntraege.filter(d => dacZeit.has(d.id)).map(d => [d.id as string, dacZeit.get(d.id)!])),
      dacZeitFehler: dacAntraege.length > 0 ? dacZeitFehler : null,
      journal: (je.j.get(id) ?? []) as WbJournalZeile[],
      journalFehler,
      zukaeufe: je.zk.get(id) ?? [],
      fassverkaeufe: je.fv.get(id) ?? [],
      zkFvFehler,
      pnVerlauf: pn.m.get(id) ?? [],
      pnFehler: pn.fehler,
    })
  }
  return out
}
