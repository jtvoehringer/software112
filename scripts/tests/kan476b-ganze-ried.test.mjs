// KAN-476 Nebenbefund (19.11.2026): die ganze Ried in einem Vorgang als Trauben verkaufen.
//
// An einer Ried mit Grundstücken wird je GST verkauft (KAN-394). War die Ried als Ganzes gelesen (Lesemenge anteilig
// auf die GST verteilt), bot das Formular nur „gesamt (alle GST)“ an – und der Server lehnte genau das ab („Bitte das
// Grundstück wählen“). Jetzt: „ganze Ried“ = je Grundstück eine Zeile mit den verfügbaren kg, EIN Verkauf mit einer
// Rechnung, je Grundstück ein Traubenverkauf mit eigener Liefernummer (RPC s112_traubenverkauf_anlegen_zeilen).
// Das Verhalten der Datenbank prüft scripts/db-tests/99_traubenverkauf_transaktion.sql (Staging).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'
import {
  MAX_VERKAUF_ZEILEN, ganzeRiedVorschlag, leseOrtSchluessel, riedLeseVerteilen, traubenverkaufLeseZeilen, verfuegbarJeLese, verkaufZeilenAus,
} from '../../src/lib/wein/leseBilanz.ts'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const lib = hooksMoeglich ? await laden('lib/verkauf/traubenverkaufAnlegen.ts') : null
const zahl = x => Number(String(x).replace(/\./g, '').replace(',', '.'))

describe('KAN-476 Nebenbefund: Zeilen „ganze Ried“ lesen und prüfen (Formular und Server)', () => {
  test('JSON-Text bzw. Liste; 0 und leer lassen ein Grundstück aus; Dezimalkomma', () => {
    const roh = JSON.stringify([{ grundstueck_id: 'g1', menge_kg: '531' }, { grundstueck_id: 'g2', menge_kg: '' }, { grundstueck_id: 'g3', menge_kg: '0' }, { grundstueck_id: 'g4', menge_kg: '319,5' }])
    assert.deepEqual(verkaufZeilenAus(roh, zahl), { zeilen: [{ grundstueckId: 'g1', mengeKg: 531 }, { grundstueckId: 'g4', mengeKg: 319.5 }], fehler: null })
    assert.deepEqual(verkaufZeilenAus([{ grundstueck_id: 'g1', menge_kg: 10 }], zahl).zeilen, [{ grundstueckId: 'g1', mengeKg: 10 }])
  })
  test('abgelehnt: nichts zu verkaufen, negative oder unlesbare Menge, doppeltes GST, ohne GST, zu viele Zeilen, kaputter Text', () => {
    const f = roh => verkaufZeilenAus(roh, zahl).fehler ?? ''
    assert.match(f([{ grundstueck_id: 'g1', menge_kg: '' }, { grundstueck_id: 'g2', menge_kg: '0' }]), /mindestens einem Grundstück/)
    assert.match(f([{ grundstueck_id: 'g1', menge_kg: '-5' }]), /Menge in kg/)
    assert.match(f([{ grundstueck_id: 'g1', menge_kg: 'abc' }]), /Menge in kg/)
    assert.match(f([{ grundstueck_id: 'g1', menge_kg: '5' }, { grundstueck_id: 'g1', menge_kg: '6' }]), /nur einmal/)
    assert.match(f([{ menge_kg: '5' }]), /Grundstück \(GST\)/)
    assert.match(f(Array.from({ length: MAX_VERKAUF_ZEILEN + 1 }, (_, i) => ({ grundstueck_id: `g${i}`, menge_kg: 1 }))), /höchstens 20 Grundstücke/)
    assert.equal(f(Array.from({ length: MAX_VERKAUF_ZEILEN }, (_, i) => ({ grundstueck_id: `g${i}`, menge_kg: 1 }))), '')
    assert.match(f('{kaputt'), /nicht gelesen werden/)
    assert.match(f('{"a":1}'), /nicht gelesen werden/)
    assert.match(f(null), /nicht gelesen werden/)
  })
})

describe('KAN-476 Nebenbefund: Vorschlag je Grundstück', () => {
  // Fall aus dem Ticket (Musterhof): Ried als Ganzes gelesen, 850 kg, GST 1305/1 mit 1,5 ha und 1305/2 mit 0,9 ha
  const gst = [{ id: 'g1', gst_nr: '1305/1', flaeche_ha: 1.5 }, { id: 'g2', gst_nr: '1305/2', flaeche_ha: 0.9 }]
  const gelesen = riedLeseVerteilen([{ lese_id: 'l1', weingarten_id: 'w1', grundstueck_id: null, kg: 850 }], () => gst)
  test('Lese der ganzen Ried: je GST der Anteil nach Fläche, Summe = Lesemenge', () => {
    const v = ganzeRiedVorschlag('l1', gst, verfuegbarJeLese(gelesen, []).gst)
    assert.deepEqual(v.map(g => [g.gst_nr, g.verfuegbarKg]), [['1305/1', 531], ['1305/2', 319]])
    assert.equal(v.reduce((s, g) => s + g.verfuegbarKg, 0), 850)
  })
  test('Verpresstes und Verkauftes je GST ist abgezogen; ausverkauftes GST bleibt mit 0 kg sichtbar; GST ohne Lesemenge fehlt', () => {
    const verbraucht = [{ lese_id: 'l1', weingarten_id: 'w1', grundstueck_id: 'g1', kg: 131 }, { lese_id: 'l1', weingarten_id: 'w1', grundstueck_id: 'g2', kg: 319 }]
    const v = ganzeRiedVorschlag('l1', [...gst, { id: 'g9', gst_nr: '9', flaeche_ha: 1 }], verfuegbarJeLese(gelesen, verbraucht).gst)
    assert.deepEqual(v.map(g => [g.id, g.verfuegbarKg]), [['g1', 400], ['g2', 0]])
    assert.deepEqual(ganzeRiedVorschlag('l2', gst, verfuegbarJeLese(gelesen, []).gst), [])
    assert.equal(leseOrtSchluessel('l1', 'g1'), 'l1|g1')
  })
})

// Supabase-Attrappe: je Tabelle feste Zeilen, jede Kette ist erlaubt (Filter wertet die Attrappe nicht aus)
function attrappe(tabellen) {
  return {
    from(t) {
      const zeilen = tabellen[t] ?? []
      const b = new Proxy({}, {
        get(_, k) {
          if (k === 'then') return (ok, nein) => Promise.resolve({ data: zeilen, error: null }).then(ok, nein)
          if (k === 'maybeSingle' || k === 'single') return async () => ({ data: zeilen[0] ?? null, error: null })
          return () => b
        },
      })
      return b
    },
  }
}

describe('KAN-476 Nebenbefund: Server-Prüfung über alle Zeilen gemeinsam (traubenverkaufLeseZeilen)', () => {
  const db = () => attrappe({
    weinjahrgaenge: [{ id: 'j1', jahrgang: 2026 }],
    lesen: [{ id: 'l1', lfd_nr: 2, beginn: null, art: null }],
    grundstuecke: [
      { id: 'g1', weingarten_id: 'w1', gst_nr: '1305/1', flaeche_ha: 1.5, aktiv: true, deaktiviert_am: null, trauben_herkunft_code: null },
      { id: 'g2', weingarten_id: 'w1', gst_nr: '1305/2', flaeche_ha: 0.9, aktiv: true, deaktiviert_am: null, trauben_herkunft_code: null },
    ],
    ernte_parzellen: [{ weingarten_id: 'w1', grundstueck_id: null, menge_kg: 850, weingarten: { name: 'Sandgrube' }, grundstueck: null }],
    pressungen: [], traubenverkauf: [],
  })
  const p = zeilen => ({ jahrgangId: 'j1', weingartenId: 'w1', zeilen, datum: '2026-10-05', leseIdFormular: 'l1', leseWaehlenText: 'Lese wählen' })
  test('die ganze Ried (531 + 319 kg) ist gedeckt – Lese und GST-Nummern für die Rechnungspositionen', async () => {
    const r = await traubenverkaufLeseZeilen(db(), 'T', p([{ grundstueckId: 'g1', mengeKg: 531 }, { grundstueckId: 'g2', mengeKg: 319 }]))
    assert.equal(r.fehler, null)
    assert.equal(r.leseId, 'l1')
    assert.deepEqual([...r.gst].map(([id, g]) => [id, g.gstNr]), [['g1', '1305/1'], ['g2', '1305/2']])
  })
  test('ein Grundstück über seiner Lesemenge → Meldung mit GST und Lese, nichts wird angelegt', async () => {
    const r = await traubenverkaufLeseZeilen(db(), 'T', p([{ grundstueckId: 'g1', mengeKg: 531 }, { grundstueckId: 'g2', mengeKg: 320 }]))
    assert.match(r.fehler ?? '', /GST 1305\/2 \(Sandgrube\) sind in der Lese 2026\/2 nur 319 kg gelesen/)
  })
  test('Grundstück einer anderen Ried bzw. eines anderen Betriebs → abgelehnt', async () => {
    const r = await traubenverkaufLeseZeilen(db(), 'T', p([{ grundstueckId: 'g1', mengeKg: 10 }, { grundstueckId: 'fremd', mengeKg: 10 }]))
    assert.match(r.fehler ?? '', /gehört nicht zu dieser Ried/)
  })
  test('ohne Lese bzw. Ried → abgelehnt', async () => {
    const r = await traubenverkaufLeseZeilen(db(), 'T', { ...p([{ grundstueckId: 'g1', mengeKg: 10 }]), weingartenId: null })
    assert.match(r.fehler ?? '', /Lese und Ried wählen/)
  })
})

describe('KAN-476 Nebenbefund: traubenverkaufZeilenAnlegen (eine Transaktion in der Datenbank)', nurMitHooks, () => {
  const kopf = { tenant_id: 'T', jahrgang_id: 'j1', lese_id: 'l1', weingarten_id: 'w1', firma_id: 'f1', datum: '2026-10-05', preis_per_kg: 1.2, grundstueck_id: 'x', menge_kg: 99, liefernummer: 'FREMD' }
  const zeilen = [{ grundstueck_id: 'g1', menge_kg: 531, bezeichnung: 'Sandgrube, GST 1305/1' }, { grundstueck_id: 'g2', menge_kg: 319, bezeichnung: 'Sandgrube, GST 1305/2' }]
  test('ein RPC-Aufruf mit Kopf (ohne Grundstück, Menge, Liefernummer) und Zeilen', async () => {
    const aufrufe = []
    const supabase = { rpc: async (name, args) => { aufrufe.push([name, args]); return { data: { verkaufsposten_id: 'vp1', zeilen: [{ id: 't1', liefernummer: 'LN-1' }, { id: 't2', liefernummer: 'LN-2' }] }, error: null } } }
    assert.deepEqual(await lib.traubenverkaufZeilenAnlegen(supabase, 'T', kopf, zeilen, 'Sandgrube'),
      { verkaufspostenId: 'vp1', zeilen: [{ id: 't1', liefernummer: 'LN-1' }, { id: 't2', liefernummer: 'LN-2' }] })
    assert.equal(aufrufe.length, 1)
    assert.equal(aufrufe[0][0], 's112_traubenverkauf_anlegen_zeilen')
    assert.deepEqual(aufrufe[0][1], {
      p_tenant_id: 'T', p_kopf: { jahrgang_id: 'j1', lese_id: 'l1', weingarten_id: 'w1', firma_id: 'f1', datum: '2026-10-05', preis_per_kg: 1.2 },
      p_zeilen: zeilen, p_quelle: 'Sandgrube',
    })
  })
  test('Fehler der Datenbank bzw. unvollständige Antwort → Meldung „nichts angelegt“', async () => {
    const meldung = async supabase => { try { await lib.traubenverkaufZeilenAnlegen(supabase, 'T', kopf, zeilen, 'Sandgrube'); return '' } catch (e) { return e.message } }
    assert.match(await meldung({ rpc: async () => ({ data: null, error: { code: '22023', message: 'Bitte je Grundstück eine Menge in kg größer als 0 angeben.' } }) }), /nichts angelegt|Menge in kg/)
    assert.match(await meldung({ rpc: async () => ({ data: { verkaufsposten_id: 'vp1', zeilen: [{ id: 't1' }] }, error: null }) }), /nichts angelegt/)
  })
})

describe('KAN-476 Nebenbefund: beide Erfassungswege, Formulare, Migration', () => {
  test('Server Actions: ganze Ried vor dem einzelnen Weg, nach Betrieb der Seite und Schreibsperre', () => {
    const w = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts')
    const wu = w.slice(w.indexOf('export async function upsertTraubenverkauf'))
    const stellen = ['await pruefeSeitenBetrieb(', 'await pruefeSchreibzugriff(', 'if (istGanzeRied(formData))', 'await ganzeRiedVerkaufen(supabase, membership, formData)', 'const mengeKg'].map(s => wu.indexOf(s))
    assert.ok(stellen.every((s, i) => s > 0 && (i === 0 || s > stellen[i - 1])), String(stellen))
    const e = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const ec = e.slice(e.indexOf('export async function createTraubenverkauf'), e.indexOf('// Traubenverkauf bearbeiten (KAN-35)'))
    const es = ['await getMembership(TRAUBENVERKAUF_MODULE)', 'if (istGanzeRied(fd))', 'await ganzeRiedVerkaufen(supabase, membership, fd)', 'traubenverkaufLese('].map(s => ec.indexOf(s))
    assert.ok(es.every((s, i) => s > 0 && (i === 0 || s > es[i - 1])), String(es))
  })
  test('gemeinsamer Baustein: alle Prüfungen vor dem einen RPC-Aufruf, kein direktes Schreiben', () => {
    const g = quelle('src/lib/verkauf/traubenverkaufGanzeRied.ts')
    const stellen = ["canWrite(membership, 'warenwirtschaft')", 'verkaufZeilenAus(', "qualitaetFehler('lese'", 'mostgewichtAusFormular(', 'verkaufKundeFehler(', 'traubenverkaufLeseZeilen(', 'rechnungsdatumFehler(', 'await traubenverkaufZeilenAnlegen('].map(s => g.indexOf(s))
    assert.ok(stellen.every((s, i) => s > 0 && (i === 0 || s > stellen[i - 1])), String(stellen))
    assert.ok(!/\.insert\(|\.update\(|\.delete\(|get_next_liefernummer/.test(g))
    // nur neue Verkäufe aus eigener Ernte
    assert.ok(g.includes("!fd.get('existing_id') && !fd.get('zukauf_posten_id')"))
  })
  test('Formulare: „ganze Ried (alle GST)“ mit einer Mengenzeile je Grundstück, Prüfung wie am Server, Feld zeilen', () => {
    const w = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/TraubenverkaufClient.tsx')
    assert.ok(w.includes('– ganze Ried (alle GST) –'))
    assert.ok(w.includes('ganzeRiedVorschlag(lId,') && w.includes('verkaufZeilenAus(zeilen,') && w.includes("fd.set('zeilen', JSON.stringify(zeilen))"))
    assert.ok(w.includes("const ganzeRied = !editRow && quelle === 'ernte' && !!wgId && !gstId && riedZeilen.length > 0"))
    // auch anteilig verteilte Grundstücke sind einzeln wählbar (vorher: an einer als Ganzes gelesenen Ried kein GST wählbar)
    assert.ok(w.includes('verfuegbar.gst.has(leseOrtSchluessel(leseId, g.id))'))
    const l = quelle('src/app/(dashboard)/erntemeldung/[id]/TraubenverkaufSection.tsx')
    assert.ok(l.includes('· ganze Ried (alle GST)') && l.includes("fd.append('zeilen', JSON.stringify(zeilen))") && l.includes('verkaufZeilenAus(zeilen,'))
    assert.ok(l.includes("if (!ganzeRiedId) fd.append('menge_kg', mengeKg)"))
    for (const f of [w, l]) assert.ok(f.includes('ein Verkauf mit einer Rechnung, je Grundstück eine eigene Liefernummer'))
  })
  test('Storno eines Verkaufs mit mehreren Grundstücken nur als Ganzes (unverändert)', () => {
    const s = quelle('src/lib/verkauf/traubenverkaufStorno.ts')
    assert.ok(s.includes('const nurDieserVerkauf = positionen.length <= 1 && positionen.every(p =>'))
    assert.ok(s.includes('Bitte den Verkauf unter Warenwirtschaft › Verkauf stornieren.'))
  })
  test('Migration: RPC als INVOKER, nicht für anon; je Zeile Liefernummer, Traubenverkauf, Position mit Verweis', () => {
    const ordner = path.join(WURZEL, 'supabase', 'migrations')
    const datei = readdirSync(ordner).find(n => /_kan476b_traubenverkauf_zeilen\.sql$/.test(n))
    const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan476b_traubenverkauf_zeilen.sql')
    assert.ok(existsSync(pfad), 'Migration kan476b_traubenverkauf_zeilen fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.ok(sql.includes('CREATE FUNCTION public.s112_traubenverkauf_anlegen_zeilen(p_tenant_id uuid, p_kopf jsonb, p_zeilen jsonb, p_quelle text)\nRETURNS jsonb\nLANGUAGE plpgsql SECURITY INVOKER SET search_path = public'))
    assert.ok(sql.includes("PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);"))
    assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;'))
    const fn = sql.slice(sql.indexOf('CREATE FUNCTION'), sql.indexOf('REVOKE EXECUTE'))
    const stellen = ['INSERT INTO public.verkaufsposten', 'FOR v_z IN', 'get_next_liefernummer(p_tenant_id)', 'INSERT INTO public.traubenverkauf', 'INSERT INTO public.verkauf_positionen'].map(s => fn.indexOf(s))
    assert.ok(stellen.every((s, i) => s > 0 && (i === 0 || s > stellen[i - 1])), String(stellen))
    assert.ok(fn.includes("'trauben', v_id,"))
    assert.equal(fn.split('INSERT INTO public.verkaufsposten').length, 2)   // ein Verkauf für alle Zeilen
  })
  test('DB-Test deckt mehrere Grundstücke, alles-oder-nichts und Rechte ab', () => {
    const t = quelle('scripts/db-tests/99_traubenverkauf_transaktion.sql')
    for (const n of ['zeilen_je_gst_ein_traubenverkauf', 'zeilen_eigene_liefernummern', 'zeilen_ein_verkauf_eine_rechnung', 'zeilen_positionen_mit_verweis',
      'zeilen_menge_null_in_zeile_2_abgelehnt', 'zeilen_fremdes_gst_in_zeile_2_abgelehnt', 'zeilen_fehler_nichts_gespeichert', 'zeilen_leser_darf_nicht', 'zeilen_anon_ohne_rechte']) {
      assert.ok(t.includes(`'${n}'`), n)
    }
  })
  test('Handbuch erklärt die ganze Ried', () => {
    assert.ok(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx').includes('„ganze Ried (alle GST)“'))
  })
})

// Nachtrag 19.11.2026 (UAT): Im Verkaufsformular (Warenwirtschaft › Verkauf › Neuer Verkauf, Positionstyp Weintrauben)
// stand weiter „– gesamte Ried –“ und der Server lehnte ab („Bitte das Grundstück wählen“). Dort gibt es schon mehrere
// Trauben-Positionen je Rechnung – „ganze Ried“ teilt die Position in je eine pro Grundstück auf.
describe('KAN-476 Nebenbefund: Verkaufsformular teilt „ganze Ried“ in Positionen je Grundstück', () => {
  const v = quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx')
  test('Auswahl „ganze Ried – je GST eine Position“ nur an Rieden mit Grundstücken; „gesamte Ried“ nur ohne', () => {
    assert.ok(v.includes("<option value=\"\">{gstDerPosition(pos).length > 0 ? '– bitte wählen –' : '– gesamte Ried –'}</option>"))
    assert.ok(v.includes('<option value={GANZE_RIED}>ganze Ried – je GST eine Position ({gstDerPosition(pos).length})</option>'))
    assert.ok(v.includes('if (e.target.value === GANZE_RIED) { ganzeRiedAufteilen(idx); return }'))
  })
  test('je Grundstück mit verfügbaren kg in der gewählten Lese eine Position: GST, Menge = verfügbar, Bezeichnung mit GST-Nr.', () => {
    const f = v.slice(v.indexOf('function ganzeRiedAufteilen(idx: number)'), v.indexOf('function updatePos('))
    assert.ok(v.includes('&& (g.je_lese.find(x => x.lese_id === pos.trauben_lese_id)?.verfuegbar_kg ?? 0) > 0)'))
    for (const s of ['const gst = gstDerPosition(pos)', 'id: crypto.randomUUID()', 'trauben_grundstueck_id: g.id', "menge: String(w?.verfuegbar_kg ?? '')", "einheit: 'kg'", ', GST $' + '{g.gst_nr}',
      'return [...prev.slice(0, idx), ...neu, ...prev.slice(idx + 1)]']) assert.ok(f.includes(s), s)
  })
  test('der Wert „ganze Ried“ gelangt nie als Grundstück an den Server', () => {
    assert.ok(!/trauben_grundstueck_id:\s*GANZE_RIED/.test(v))
    assert.equal(v.split('GANZE_RIED').length - 1, 3)   // Konstante, Auswahl, Abzweig im onChange
  })
})
