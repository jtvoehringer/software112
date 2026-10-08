// Tests der Meldungsgruppe „Buchhaltung & Steuer“ (Behördenmeldungen als CSV, 24.09.2026)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/buchhaltung.test.mjs
//          (Node ≥ 22.6, keine zusätzliche Abhängigkeit; ohne Datenbank)
//
// Geprüft werden die echten Module unter src/lib/behoerden (Ladefunktionen mit einem
// Supabase-Doppel inkl. Mandantenfilter, Spalten/Formatierung, Register-Parameter) für
// uva, ea-journal, kassabuch, rechnungsausgangsjournal, belegverzeichnis,
// anlagenverzeichnis und svs-einheitswerte. Die BMD-Umstellung (lib/buchhaltung/bmd.ts)
// prüft scripts/tests/csv.test.mjs byte-genau gegen die Golden-Files.
// Auflösung von '@/…' und endungslosen Importen: scripts/tests/buchhaltung.aufloesung.mjs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

register('./buchhaltung.aufloesung.mjs', import.meta.url)

const csv = await import('../../src/lib/csv/index.ts')
const gemeinsam = await import('../../src/lib/behoerden/buchhaltung-gemeinsam.ts')
const uva = await import('../../src/lib/behoerden/uva.ts')
const ea = await import('../../src/lib/behoerden/ea-journal.ts')
const kasse = await import('../../src/lib/behoerden/kassabuch.ts')
const rj = await import('../../src/lib/behoerden/rechnungsausgang.ts')
const belege = await import('../../src/lib/behoerden/belege.ts')
const anlagen = await import('../../src/lib/behoerden/anlagen.ts')
const svs = await import('../../src/lib/behoerden/svs.ts')
const { KATALOG_BUCHHALTUNG } = await import('../../src/lib/behoerden/katalog/buchhaltung.ts')
const { MELDUNGEN_BUCHHALTUNG } = await import('../../src/lib/behoerden/register/buchhaltung.ts')
const { istParameterFehler, MeldungsFehler } = await import('../../src/lib/behoerden/typen.ts')

const { csvText, csvDatei, csvDateiname } = csv
const BOM = String.fromCharCode(0xfeff)
const T = 'tenant-1'
const FREMD = 'tenant-2'
const HIER = path.dirname(fileURLToPath(import.meta.url))

/** Datenzeilen einer CSV (ohne BOM/Kopf), CRLF-getrennt */
function zeilen(text) {
  assert.ok(text.startsWith(BOM), 'BOM fehlt')
  assert.ok(text.endsWith('\r\n'), 'abschließendes CRLF fehlt')
  return text.slice(1, -2).split('\r\n')
}

// ── Supabase-Doppel: from(tabelle).select().eq()… filtert flache Felder ─────────

function doppel(tabellen) {
  const aufrufe = []
  function abfrage(tabelle) {
    const filter = []
    const sortierung = []
    const protokoll = { tabelle, filter: [] }
    aufrufe.push(protokoll)
    const passt = r => filter.every(f => f(r))
    const vergleich = (a, b) => {
      for (const [k, auf] of sortierung) {
        const x = a[k] ?? '', y = b[k] ?? ''
        if (x < y) return auf ? -1 : 1
        if (x > y) return auf ? 1 : -1
      }
      return 0
    }
    const ergebnis = () => (tabellen[tabelle] ?? []).filter(passt).sort(vergleich)
    const q = {
      select() { return q },
      order(k, o) { sortierung.push([k, o?.ascending !== false]); return q },
      eq(k, v) { protokoll.filter.push(['eq', k, v]); filter.push(r => r[k] === v); return q },
      neq(k, v) { filter.push(r => r[k] !== v); return q },
      gt(k, v) { filter.push(r => r[k] > v); return q },
      gte(k, v) { filter.push(r => r[k] >= v); return q },
      lt(k, v) { filter.push(r => r[k] < v); return q },
      lte(k, v) { filter.push(r => r[k] <= v); return q },
      is(k, v) { filter.push(r => (r[k] ?? null) === v); return q },
      ilike(k, muster) {
        const re = new RegExp('^' + muster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
        filter.push(r => re.test(String(r[k] ?? '')))
        return q
      },
      range(von, bis) { return Promise.resolve({ data: ergebnis().slice(von, bis + 1), error: null }) },
      maybeSingle() { return Promise.resolve({ data: ergebnis()[0] ?? null, error: null }) },
      then(ok, fehler) { return Promise.resolve({ data: ergebnis(), error: null }).then(ok, fehler) },
    }
    return q
  }
  return { from: abfrage, aufrufe }
}

/** Jede Abfrage auf eine Mandantentabelle muss .eq('tenant_id', T) tragen */
function mandantGefiltert(db) {
  for (const a of db.aufrufe) {
    assert.ok(a.filter.some(([art, k, v]) => art === 'eq' && k === 'tenant_id' && v === T), `Abfrage auf ${a.tabelle} ohne Mandantenfilter`)
  }
}

// ── UVA ────────────────────────────────────────────────────────────────────────

describe('uva – Kennzahlen U30', () => {
  const Q1 = {
    id: 'u1', tenant_id: T, jahr: 2026, zeitraum: 'Q1', gesperrt: true, gesperrt_am: '2026-04-14T22:30:00+00:00',
    bmgl_ust_0: 1000, bmgl_ust_10: 0, bmgl_ust_13: 12000.5, bmgl_ust_20: 2500.25,
    ust_10: 0, ust_13: 1560.07, ust_20: 500.05, vst_10: 0, vst_13: 12.5, vst_20: 800.1, vst_gesamt: 812.6, zahllast: 1247.52,
  }
  const Q2 = { ...Q1, id: 'u2', zeitraum: 'Q2', gesperrt: false, gesperrt_am: null, ust_13: 100, ust_20: 0, vst_20: 900, vst_13: 0, vst_gesamt: 900, zahllast: -800 }

  test('eine Zeile je Kennzahl, Reihenfolge wie U30, Kz 095 mit Vorzeichen', () => {
    const k = uva.uvaKennzahlen(Q1, false)
    assert.deepEqual(k.map(z => z.kz), ['000', '022', '029', '006', null, null, null, null, '060', '095'])
    assert.equal(k[0].bemessungsgrundlage, 15500.75)
    const t = csvText(k, uva.SPALTEN_UVA)
    const z = zeilen(t)
    assert.equal(z[0], 'Jahr;Zeitraum;Kennzahl;Bezeichnung;Bemessungsgrundlage (€);Steuer (€);Status;Übermittelt am')
    assert.equal(z[1], '2026;Q1 2026;000;Gesamtbetrag der Bemessungsgrundlagen für Lieferungen und sonstige Leistungen;15500,75;;Übermittelt;15.04.2026 00:30')
    assert.equal(z[2], '2026;Q1 2026;022;20 % Normalsteuersatz;2500,25;500,05;Übermittelt;15.04.2026 00:30')
    assert.equal(z[6], '2026;Q1 2026;;Vorsteuer 20 %;;800,10;Übermittelt;15.04.2026 00:30')
    assert.equal(z[10], '2026;Q1 2026;095;Vorauszahlung (Zahllast);;1247,52;Übermittelt;15.04.2026 00:30')
    const neg = uva.uvaKennzahlen(Q2, false).at(-1)
    assert.equal(neg.bezeichnung, 'Überschuss (Gutschrift)')
    assert.equal(csv.csvZelle(neg.steuer, 'betrag'), '-800,00')
    assert.equal(uva.uvaKennzahlen(Q2, true)[0].status, 'Kontroll-Vorschau')
  })

  test('Monatszeitraum und Parameter', () => {
    assert.equal(uva.uvaZeitraumLabel('03', 2026), 'Mär 2026')
    assert.equal(uva.uvaZeitraumLabel('Q4', 2025), 'Q4 2025')
    const p = MELDUNGEN_BUCHHALTUNG.uva.parameter
    assert.deepEqual(p(new URLSearchParams('jahr=2026')), { jahr: 2026, zeitraum: null })
    assert.deepEqual(p(new URLSearchParams('jahr=2026&zeitraum=Q2')), { jahr: 2026, zeitraum: 'Q2' })
    assert.deepEqual(p(new URLSearchParams('jahr=2026&zeitraum=11')), { jahr: 2026, zeitraum: '11' })
    for (const q of ['', 'jahr=abc', 'jahr=1999', 'jahr=2026&zeitraum=Q5', 'jahr=2026&zeitraum=13', 'jahr=2026&zeitraum=1']) {
      assert.ok(istParameterFehler(p(new URLSearchParams(q))), `kein Fehler für „${q}“`)
    }
    assert.deepEqual(MELDUNGEN_BUCHHALTUNG.uva.dateiteile({ jahr: 2026, zeitraum: 'Q1' }, { name: null, betriebsnummer: '1234567' }), ['UVA', '1234567', '2026-Q1'])
  })

  test('ladeUva: Mandantenfilter, Jahr/Zeitraum, Hinweise (Entwurf, Doppik, Leermeldung)', async () => {
    const db = doppel({
      tenant_einstellungen: [{ tenant_id: T, buchhaltungsart: 'ea' }],
      ea_uva: [Q1, Q2, { ...Q1, id: 'x', tenant_id: FREMD }, { ...Q1, id: 'alt', jahr: 2025 }],
    })
    const r = await uva.ladeUva(db, T, { jahr: 2026, zeitraum: null })
    mandantGefiltert(db)
    assert.equal(r.meldungen.length, 2)
    assert.equal(r.zeilen.length, 20)
    assert.equal(r.doppik, false)
    assert.deepEqual(r.warnungen, [
      'Steuerfreie Umsätze (0 %) in Q1 2026, Q2 2026: ohne Kennzahl ausgegeben – vor der Übermittlung auf Kz 011 (Ausfuhr), 017 (innergemeinschaftliche Lieferung) bzw. 016/020 (steuerfreie Inlandsumsätze) aufteilen; die ig. Lieferungen gehören zusätzlich in die Zusammenfassende Meldung.',
      'Noch nicht als übermittelt markiert (Entwurf): Q2 2026 – die Werte können sich bis zur Übermittlung ändern.',
    ])
    // 0-%-Zeile ohne Kennzahl (enthält Ausfuhr Kz 011, ig. Lieferung Kz 017, steuerfrei Kz 016/020)
    const null0 = r.zeilen.find(z => z.schluessel === 'ust0')
    assert.equal(null0.kz, null)
    assert.match(null0.bezeichnung, /bitte auf Kz 011\/017\/016\/020 aufteilen/)
    const nurQ1 = await uva.ladeUva(db, T, { jahr: 2026, zeitraum: 'Q1' }, { doppik: true })
    assert.equal(nurQ1.zeilen.length, 10)
    assert.match(nurQ1.warnungen[0], /Kontroll-Vorschau/)
    const leer = await uva.ladeUva(db, T, { jahr: 2026, zeitraum: 'Q3' }, { doppik: false })
    assert.equal(leer.zeilen.length, 0)
    assert.match(leer.warnungen[0], /Q3 2026 ist noch keine UVA berechnet/)
    assert.equal(csvText(leer.zeilen, uva.SPALTEN_UVA), `${BOM}Jahr;Zeitraum;Kennzahl;Bezeichnung;Bemessungsgrundlage (€);Steuer (€);Status;Übermittelt am\r\n`)
  })
})

// ── E&A-Journal ────────────────────────────────────────────────────────────────

describe('ea-journal – Einnahmen-Ausgaben-Journal', () => {
  const buchung = {
    id: 'b1', tenant_id: T, typ: 'ausgabe', datum: '2026-03-05', beschreibung: '=SUMME(A1) Bewirtung', betrag_netto: 100, ust_satz: null, ust_betrag: 0,
    betrag_brutto: 100, abzugsfaehig_pct: 50, betrag_abzugsfaehig: 50, is_locked: true, import_quelle: 'manuell', bank_ref: null, notizen: 'Zeile 1\nZeile 2',
    verkaufsposten_id: null, anlage_id: null, dauerauftrag_id: null, erstellt_am: '2026-03-05T10:00:00Z',
    kategorie: { name: 'Anlagenkauf', konto_nr: 660 }, konto: { name: 'Handkassa', typ: 'kassa' }, firma: { name: 'Gasthaus "Zur Linde"' },
    verkaufsposten: null, ea_belege: [{ dateiname: 'bon_2.jpg', hochgeladen_am: '2026-03-06T08:00:00Z' }, { dateiname: 'bon_1.jpg', hochgeladen_am: '2026-03-05T22:30:00Z' }],
  }
  const einnahme = {
    ...buchung, id: 'b2', typ: 'einnahme', datum: '2026-01-10', beschreibung: 'Zahlungseingang RE 2026-0001', betrag_netto: 88.5, ust_satz: 13, ust_betrag: 11.51,
    betrag_brutto: 100.01, abzugsfaehig_pct: 100, betrag_abzugsfaehig: 88.5, is_locked: false, import_quelle: 'verkauf', notizen: null,
    verkaufsposten_id: 'vp1', kategorie: null, konto: null, firma: null, ea_belege: [],
    verkaufsposten: { rechnungsnummer: '2026-0001', kontakt: { vorname: 'Anna', nachname: 'Huber', accountnummer: 'K-0042' }, firma: null },
  }

  test('Spalten: Datum mit Nullen, fehlender USt-Satz leer, Formelschutz, Konto, Beleg', () => {
    const z = ea.eaJournalZeile(buchung)
    assert.equal(z.sachkonto, '0660')
    assert.equal(z.nichtAbzugsfaehig, 50)
    assert.equal(z.belegdatei, 'bon_1.jpg, bon_2.jpg')
    const t = zeilen(csvText([z, ea.eaJournalZeile(einnahme)], ea.SPALTEN_EA_JOURNAL))
    assert.equal(t[0], 'Datum;Typ;Bezeichnung;Kategorie;Sachkonto;USt-Satz (%);Netto (€);USt (€);Brutto (€);Abzugsfähig (%);Zahlungskonto;Kontoart;Rechnungsnr. (Verkauf);Bankreferenz;Geschäftspartner;DebitorNr.;Belegdatei;Beleg erfasst am;Quelle;Gesperrt;Notizen;Storno;Storno-Grund;Storniert am;Storniert von')
    assert.equal(t[1], `05.03.2026;Ausgabe;'=SUMME(A1) Bewirtung;Anlagenkauf;0660;;100,00;0,00;100,00;50,00;Handkassa;Kassa;;;"Gasthaus ""Zur Linde""";;bon_1.jpg, bon_2.jpg;05.03.2026;manuell;Ja;Zeile 1 Zeile 2;;;;`)
    assert.equal(t[2], '10.01.2026;Einnahme;Zahlungseingang RE 2026-0001;;;13,00;88,50;11,51;100,01;100,00;;;2026-0001;;Anna Huber;K-0042;;;Automatisch (Verkauf);Nein;;;;;')
  })

  // KAN-149 D2c: Original und Gegenbuchung bleiben im Journal, gekennzeichnet; Summen (auch der nicht abzugsfähige
  // Anteil) heben sich auf
  test('Storno: Original gekennzeichnet, Gegenbuchung negativ mit Grund, nicht abzugsfähiger Anteil mit Vorzeichen', () => {
    const orig = ea.eaJournalZeile({ ...buchung, storniert_am: '2026-03-31T22:30:00Z', storniert_von_name: 'Karin', storno_grund: 'doppelt erfasst' })
    const gegen = ea.eaJournalZeile({ ...buchung, id: 'g1', datum: '2026-04-01', beschreibung: 'Storno: Bewirtung', betrag_netto: -100, betrag_brutto: -100,
      betrag_abzugsfaehig: -50, is_locked: false, storno_von_id: 'b1', notizen: 'doppelt erfasst', ea_belege: [] })
    assert.equal(orig.stornoStatus, 'storniert')
    assert.equal(gegen.stornoStatus, 'gegenbuchung')
    assert.equal(gegen.stornoVonId, 'b1')
    assert.equal(gegen.stornoGrund, 'doppelt erfasst')
    assert.equal(orig.nichtAbzugsfaehig + gegen.nichtAbzugsfaehig, 0)
    assert.equal(orig.brutto + gegen.brutto, 0)
    const t = zeilen(csvText([orig, gegen], ea.SPALTEN_EA_JOURNAL))
    assert.ok(t[1].endsWith(';storniert;doppelt erfasst;01.04.2026;Karin'), t[1])   // 31.03. 22:30 UTC = 01.04. in Wien
    assert.ok(t[2].startsWith('01.04.2026;Ausgabe;Storno: Bewirtung;'), t[2])
    assert.ok(t[2].endsWith(';Gegenbuchung;doppelt erfasst;;'), t[2])
    assert.match(t[2], /;-100,00;0,00;-100,00;/)
  })

  test('Quelle: AfA, Dauerauftrag, Bankimport', () => {
    assert.equal(ea.eaQuelle({ anlage_id: 'a', import_quelle: 'manuell' }), 'AfA (Anlagenverzeichnis)')
    assert.equal(ea.eaQuelle({ dauerauftrag_id: 'd', import_quelle: 'manuell' }), 'Dauerauftrag')
    assert.equal(ea.eaQuelle({ import_quelle: 'camt053' }), 'Bankimport (camt.053)')
    assert.equal(ea.eaQuelle({ import_quelle: null }), 'manuell')
  })

  test('ladeEaJournal: Jahr, Typ, Suche, Mandant, chronologisch', async () => {
    const db = doppel({ ea_transaktionen: [buchung, einnahme, { ...buchung, id: 'f', tenant_id: FREMD }, { ...buchung, id: 'vj', datum: '2025-12-31' }] })
    const alle = await ea.ladeEaJournal(db, T, { jahr: 2026, typ: null, q: null })
    mandantGefiltert(db)
    assert.deepEqual(alle.zeilen.map(z => z.id), ['b2', 'b1'])   // chronologisch aufsteigend
    const nurAus = await ea.ladeEaJournal(db, T, { jahr: 2026, typ: 'ausgabe', q: 'bewirtung' })
    assert.deepEqual(nurAus.zeilen.map(z => z.id), ['b1'])
    assert.match(nurAus.warnungen[0], /Gefilterter Auszug \(nur Ausgaben, Suche „bewirtung“\)/)
    assert.ok(alle.warnungen.some(w => /1 Buchung ist keinem Zahlungskonto/.test(w)))
  })

  test('Parameter: Typ und Suche wie die Seite', () => {
    const p = MELDUNGEN_BUCHHALTUNG['ea-journal'].parameter
    assert.deepEqual(p(new URLSearchParams('jahr=2026')), { jahr: 2026, typ: null, q: null })
    assert.deepEqual(p(new URLSearchParams('jahr=2026&typ=einnahme&q=%20Wein%20')), { jahr: 2026, typ: 'einnahme', q: 'Wein' })
    assert.ok(istParameterFehler(p(new URLSearchParams('jahr=2026&typ=alles'))))
    assert.ok(istParameterFehler(p(new URLSearchParams(`jahr=2026&q=${'x'.repeat(201)}`))))
    const teile = MELDUNGEN_BUCHHALTUNG['ea-journal'].dateiteile({ jahr: 2026, typ: 'ausgabe', q: 'x' }, { name: null, betriebsnummer: null })
    assert.equal(csvDateiname(teile, '2026-09-24').ascii, 'EA-Journal_2026_Ausgaben_Auszug_2026-09-24.csv')
  })
})

// ── Kassabuch ──────────────────────────────────────────────────────────────────

describe('kassabuch – Saldovortrag und laufender Kassastand', () => {
  const konto = { id: 'k1', name: 'Handkassa', typ: 'kassa', eroeffnungsdatum: '2026-01-10', eroeffnungssaldo: 100 }
  const b = (id, datum, betrag, extra = {}) => ({ id, datum, erfasst: `${datum}T10:00:00Z`, beleg: null, text: `Bewegung ${id}`, art: 'Einnahme (E&A)', betrag, gegenkonto: null, abgeglichen: false, ...extra })

  test('Vortrag, Nummerierung, Einnahme/Ausgabe, negativer Bestand', () => {
    const bew = [b('a', '2026-01-05', 999), b('b', '2026-02-01', 50), b('d', '2026-03-01', -200.004), b('c', '2026-03-01', 0.1), b('e', '2026-04-01', 30.2)]
    const { zeilen: z, warnungen } = kasse.kassabuchZeilen(konto, bew, '2026-02-15', '2026-12-31')
    assert.equal(z[0].text, 'Saldovortrag')
    assert.equal(z[0].saldo, 150)
    assert.deepEqual(z.slice(1).map(x => [x.lfdNr, x.einnahme, x.ausgabe, x.saldo]), [[1, 0.1, null, 150.1], [2, null, 200, -49.9], [3, 30.2, null, -19.7]])
    assert.match(warnungen.at(-1), /Negativer Kassastand an 2 Stellen: 01\.03\.2026 \(−49,90 €\), 01\.04\.2026 \(−19,70 €\)/)
    const t = zeilen(csvText(z, kasse.SPALTEN_KASSABUCH))
    assert.equal(t[0], 'Lfd. Nr.;Datum;Beleg;Text;Art;Einnahme (€);Ausgabe (€);Saldo (€);Gegenkonto;Abgeglichen')
    assert.equal(t[1], ';15.02.2026;;Saldovortrag;Vortrag;;;150,00;;')
    assert.equal(t[3], '2;01.03.2026;;Bewegung d;Einnahme (E&A);;200,00;-49,90;;Nein')
  })

  test('Zeitraum ab Eröffnung, Bewegungen im Eröffnungssaldo, Zeitraum vor Eröffnung', () => {
    const { zeilen: z, warnungen } = kasse.kassabuchZeilen(konto, [b('a', '2026-01-05', 999), b('b', '2026-01-10', 5), b('c', '2026-01-11', 5)], '2026-01-01', '2026-01-31')
    assert.equal(z[0].text, 'Eröffnungssaldo')
    assert.equal(z[0].datum, '2026-01-10')
    assert.equal(z.at(-1).saldo, 105)
    assert.match(warnungen[0], /2 Bewegungen liegen am oder vor dem Eröffnungsdatum \(10\.01\.2026\)/)
    const vorher = kasse.kassabuchZeilen(konto, [], '2025-01-01', '2025-12-31')
    assert.equal(vorher.zeilen.length, 0)
    assert.match(vorher.warnungen[0], /erst am 10\.01\.2026 eröffnet/)
  })

  test('ladeKassabuch: nur eigenes Kassa-Konto, alle Bewegungsarten, 404/422', async () => {
    const db = doppel({
      konten: [{ ...konto, tenant_id: T }, { id: 'g1', name: 'Giro', typ: 'giro', tenant_id: T, eroeffnungsdatum: '2026-01-01', eroeffnungssaldo: 0 }, { id: 'k9', name: 'Fremd', typ: 'kassa', tenant_id: FREMD }],
      zahlungen: [{ id: 'z1', tenant_id: T, konto_id: 'k1', betrag: 40, datum: '2026-02-01', abgeglichen: true, erstellt_am: '2026-02-01T09:00:00Z', verkaufsposten: { rechnungsnummer: 'RE-7' } },
        { id: 'z9', tenant_id: FREMD, konto_id: 'k1', betrag: 1000, datum: '2026-02-01' }],
      ea_transaktionen: [{ id: 't1', tenant_id: T, konto_id: 'k1', typ: 'ausgabe', betrag_brutto: 12.5, datum: '2026-02-02', beschreibung: 'Porto', bank_ref: null, abgeglichen: false, erstellt_am: '2026-02-02T09:00:00Z', ea_belege: [{ dateiname: 'porto.pdf' }] }],
      konto_umbuchungen: [{ id: 'u1', tenant_id: T, von_konto_id: 'k1', nach_konto_id: 'g1', betrag: 50, datum: '2026-02-03', beschreibung: null, von_abgeglichen: false, erstellt_am: '2026-02-03T09:00:00Z', nach: { name: 'Giro' } },
        { id: 'u2', tenant_id: T, von_konto_id: 'g1', nach_konto_id: 'k1', betrag: 20, datum: '2026-02-04', beschreibung: 'Wechselgeld', nach_abgeglichen: true, erstellt_am: '2026-02-04T09:00:00Z', von: { name: 'Giro' } }],
    })
    const r = await kasse.ladeKassabuch(db, T, { konto: 'k1', von: '2026-02-01', bis: '2026-02-28' })
    mandantGefiltert(db)
    assert.deepEqual(r.zeilen.map(z => [z.art, z.beleg, z.text, z.saldo]), [
      ['Vortrag', null, 'Saldovortrag', 100],
      ['Zahlungseingang', 'RE-7', 'Zahlungseingang RE RE-7', 140],
      ['Ausgabe (E&A)', 'porto.pdf', 'Porto', 127.5],
      ['Umbuchung', null, 'Umbuchung an Giro', 77.5],
      ['Umbuchung', null, 'Wechselgeld', 97.5],
    ])
    await assert.rejects(kasse.ladeKassabuch(db, T, { konto: 'g1', von: '2026-02-01', bis: '2026-02-28' }), e => e instanceof MeldungsFehler && e.status === 422)
    await assert.rejects(kasse.ladeKassabuch(db, T, { konto: 'k9', von: '2026-02-01', bis: '2026-02-28' }), e => e instanceof MeldungsFehler && e.status === 404)
  })

  test('Parameter: Konto (UUID) und Zeitraum', () => {
    const p = MELDUNGEN_BUCHHALTUNG.kassabuch.parameter
    const id = '3f2a9c1b-0000-4000-8000-000000000001'
    assert.deepEqual(p(new URLSearchParams(`konto=${id}&von=2026-01-01&bis=2026-06-30`)), { konto: id, von: '2026-01-01', bis: '2026-06-30' })
    for (const q of [`von=2026-01-01&bis=2026-06-30`, `konto=abc&von=2026-01-01&bis=2026-06-30`, `konto=${id}&von=2026-02-30&bis=2026-06-30`, `konto=${id}&von=2026-07-01&bis=2026-06-30`, `konto=${id}`]) {
      assert.ok(istParameterFehler(p(new URLSearchParams(q))), `kein Fehler für „${q}“`)
    }
  })
})

// ── Rechnungsausgangsjournal ───────────────────────────────────────────────────

describe('rechnungsausgangsjournal – Netto/USt je Satz, Storno, Lücken', () => {
  const posten = {
    id: 'vp1', tenant_id: T, datum: '2026-03-02', rechnungsnummer: 'RE-2026-0002', aktiv: true, storniert: true, storniert_am: '2026-03-31T22:15:00Z', storniert_von_name: 'Karin K.', storno_grund: 'Kunde hat die Bestellung storniert', bezahlt: false, bezahlt_am: null,
    kontakt: null, firma: { name: 'Weinhandel Huber; Wien', uid_nummer: 'ATU12345678', accountnummer: 'K-0107', debitor_nr: '200002', land: 'AT' },
    verkauf_positionen: [
      { preis_brutto: 12, menge: 6, rabatt_pct: 10, sonderrabatt_pct: 0, ust_satz: 20 },
      { preis_brutto: 9.9, menge: 3, rabatt_pct: null, sonderrabatt_pct: 5, ust_satz: 13 },
      { preis_brutto: null, menge: 1, ust_satz: 20 },
      { preis_brutto: 50, menge: 1, ust_satz: 0 },
      { preis_brutto: 10.5, menge: 2, ust_satz: 5 },
    ],
  }

  test('Berechnung wie die Rechnung, sonstige Sätze, Storno in Wiener Zeit', () => {
    const { zeile: z, sonstigeSaetze } = rj.rechnungsjournalZeile(posten)
    assert.equal(z.netto20, 54)          // 12·6·0,9 = 64,80 brutto → 54,00 netto
    assert.equal(z.ust20, 10.8)
    assert.equal(z.netto13, 24.97)       // 9,9·3·0,95 = 28,215 → 24,969…
    assert.equal(z.ust13, 3.25)
    assert.equal(z.netto0, 50)
    assert.deepEqual(sonstigeSaetze, [5])
    assert.equal(z.nettoSonstige, 20)
    assert.equal(z.brutto, 164.02)       // 64,8 + 28,215 + 50 + 21
    assert.equal(z.nettoGesamt, 148.97)
    assert.equal(z.ustGesamt, 15.05)
    const t = zeilen(csvText([z], rj.SPALTEN_RECHNUNGSJOURNAL))
    assert.equal(t[1], 'RE-2026-0002;02.03.2026;"Weinhandel Huber; Wien";K-0107;ATU12345678;AT;54,00;10,80;24,97;3,25;;;50,00;148,97;15,05;164,02;Ja;01.04.2026;Karin K.;Kunde hat die Bestellung storniert;Nein;')   // KAN-149 D1: Storniert von, Storno-Grund
  })

  test('Rechnungsnummern: Lücken und Doppelte je Muster', () => {
    assert.deepEqual(rj.rechnungsnummernPruefen(['RE-2026-0001', 'RE-2026-0002', 'RE-2026-0005', 'RE-2026-0005', null, 'GS-9', 'GS-11']), [
      'Rechnungsnummer RE-2026-0005 kommt 2-mal vor.',
      'Lücke in den Rechnungsnummern: RE-2026-0003 bis RE-2026-0004 fehlen im Zeitraum (2 Nummern).',
      'Lücke in den Rechnungsnummern: GS-10 fehlt im Zeitraum.',
    ])
    assert.deepEqual(rj.rechnungsnummernPruefen(['2026-0099', '2026-0100', '2026-0101']), [])
  })

  // KAN-105: Quelle ist die Rechnung (rechnungen) mit den Positionen ihrer Lieferscheine
  const alsRechnung = (b, lieferscheine = [{ id: `ls-${b.id}`, datum: b.datum, lieferscheinnummer: `LS-${b.id}`, verkauf_positionen: b.verkauf_positionen }]) => {
    const { verkauf_positionen: _p, ...kopf } = b
    return { ...kopf, lieferscheine }
  }

  test('ladeRechnungsjournal: Zeitraum, Mandant, Stornos und Hinweise', async () => {
    const eins = { ...posten, id: 'vp0', rechnungsnummer: 'RE-2026-0001', storniert: false, storniert_am: null, datum: '2026-03-01', verkauf_positionen: [{ preis_brutto: 11.3, menge: 1, ust_satz: 13 }] }
    const vier = { ...eins, id: 'vp4', rechnungsnummer: 'RE-2026-0004', datum: '2026-03-02', aktiv: false }
    const db = doppel({ rechnungen: [vier, posten, eins, { ...eins, id: 'f', tenant_id: FREMD }, { ...eins, id: 'apr', datum: '2026-04-01' }].map(b => alsRechnung(b)) })
    const r = await rj.ladeRechnungsjournal(db, T, { von: '2026-03-01', bis: '2026-03-31' })
    mandantGefiltert(db)
    assert.deepEqual(r.zeilen.map(z => z.rechnungsnummer), ['RE-2026-0001', 'RE-2026-0002', 'RE-2026-0004'])
    assert.deepEqual(r.warnungen, [
      'Lücke in den Rechnungsnummern: RE-2026-0003 fehlt im Zeitraum.',
      'Steuersätze ohne eigene Spalte (5 %) – nur in „Netto gesamt“ und „USt gesamt“ enthalten.',
      '1 deaktivierte Verkaufsbeleg ist der Vollständigkeit halber enthalten.',
      '1 Rechnung ist storniert und mit ihren ursprünglichen Beträgen aufgeführt (Spalte „Storniert“) – für Summen herausfiltern.',
    ])
  })

  test('KAN-105: Rechnung über zwei Lieferscheine = eine Zeile mit den Positionen beider', async () => {
    const sammel = alsRechnung({ ...posten, id: 're9', rechnungsnummer: 'RE-2026-0009', storniert: false, storniert_am: null, datum: '2026-03-10' }, [
      { id: 'ls2', datum: '2026-03-05', lieferscheinnummer: 'LS-2026-0002', verkauf_positionen: [{ preis_brutto: 12, menge: 10, ust_satz: 20 }] },
      { id: 'ls1', datum: '2026-03-01', lieferscheinnummer: 'LS-2026-0001', verkauf_positionen: [{ preis_brutto: 11.3, menge: 2, ust_satz: 13 }] },
    ])
    const r = await rj.ladeRechnungsjournal(doppel({ rechnungen: [sammel] }), T, { von: '2026-03-01', bis: '2026-03-31' })
    assert.equal(r.zeilen.length, 1)
    assert.equal(r.zeilen[0].brutto, 142.6)     // 120 + 22,60
    assert.equal(r.zeilen[0].netto20, 100)
    assert.equal(r.zeilen[0].netto13, 20)
  })
})

// ── Belegverzeichnis ───────────────────────────────────────────────────────────

describe('belegverzeichnis – Belege mit Buchung', () => {
  const verbucht = {
    id: 'bl1', tenant_id: T, dateiname: 'rechnung.pdf', dateityp: 'application/pdf', status: 'verbucht', hochgeladen_am: '2027-01-03T08:00:00Z', verbucht_am: '2027-01-03T09:15:00Z',
    erkannte_daten: { datum: '2026-12-28', betrag_brutto: '120.5', lieferant_name: 'Lagerhaus' },
    buchung: { datum: '2026-12-28', typ: 'ausgabe', beschreibung: 'Spritzmittel', betrag_brutto: 120.5, kategorie: { name: 'Betriebsmittel' } },
  }
  const offen = { ...verbucht, id: 'bl2', dateiname: 'bon.jpg', dateityp: 'image/jpeg', status: 'fehler', hochgeladen_am: '2026-12-31T23:30:00Z', verbucht_am: null, erkannte_daten: { datum: '28.12.2026' }, buchung: null }

  test('Jahr: Buchungsdatum bzw. Upload-Tag in Wien; erkannte Werte geprüft', async () => {
    assert.equal(belege.belegJahr(verbucht), 2026)
    assert.equal(belege.belegJahr(offen), 2027)     // 31.12. 23:30 UTC = 1.1.2027 in Wien
    const db = doppel({ ea_belege: [verbucht, offen, { ...verbucht, id: 'f', tenant_id: FREMD }] })
    const r26 = await belege.ladeBelegverzeichnis(db, T, { jahr: 2026 })
    mandantGefiltert(db)
    assert.deepEqual(r26.zeilen.map(z => [z.lfdNr, z.dateiname, z.status]), [[1, 'rechnung.pdf', 'Verbucht']])
    const t = zeilen(csvText(r26.zeilen, belege.SPALTEN_BELEGVERZEICHNIS))
    assert.equal(t[1], '1;rechnung.pdf;application/pdf;Verbucht;03.01.2027 09:00;03.01.2027 10:15;28.12.2026;Ausgabe;Spritzmittel;Betriebsmittel;120,50;28.12.2026;120,50;Lagerhaus')
    const r27 = await belege.ladeBelegverzeichnis(db, T, { jahr: 2027 })
    assert.equal(r27.zeilen[0].erkanntDatum, null)   // „28.12.2026“ ist kein gültiges Datum der Erkennung
    assert.match(r27.warnungen[0], /1 Beleg ist noch nicht verbucht/)
  })
})

// ── Anlagenverzeichnis ─────────────────────────────────────────────────────────

describe('anlagenverzeichnis – Zeilen und Summen aus lib/ea/anlagen', () => {
  const roh = [
    { id: 'a1', tenant_id: T, name: 'Traktor', gruppe: 'Fahrzeuge', konto_nr: 400, anschaffung_am: '2024-08-15', ak_netto: 30000, nutzungsdauer_jahre: 8, methode: 'linear', degressiv_satz: null, restwert: 0, abgang_am: null, veraeusserungserloes: null },
    { id: 'a2', tenant_id: T, name: 'Laptop', gruppe: null, konto_nr: null, anschaffung_am: '2026-02-01', ak_netto: 899.99, nutzungsdauer_jahre: 1, methode: 'gwg', degressiv_satz: null, restwert: 0, abgang_am: null, veraeusserungserloes: null },
    { id: 'a3', tenant_id: T, name: 'Presse alt', gruppe: 'Kellertechnik', konto_nr: 500, anschaffung_am: '2020-03-01', ak_netto: 10000, nutzungsdauer_jahre: 10, methode: 'linear', degressiv_satz: null, restwert: 0, abgang_am: '2026-05-10', veraeusserungserloes: 2500 },
  ]

  test('Zeilen je Anlage mit GWG, Halbjahres-AfA, Abgang; Summen = Summe der Zeilen', async () => {
    const db = doppel({ ea_anlagen: [...roh, { ...roh[0], id: 'f', tenant_id: FREMD }] })
    const r = await anlagen.ladeAnlagenverzeichnis(db, T, { jahr: 2026 })
    mandantGefiltert(db)
    assert.equal(r.anlagen.length, 3)
    const nach = Object.fromEntries(r.zeilen.map(z => [z.anlage.id, z]))
    assert.equal(nach.a1.afa, 3750)
    assert.equal(nach.a1.buchwertAnfang, 24375)      // 2024 halbe AfA, 2025 volle
    assert.equal(nach.a2.gwg, true)
    assert.equal(nach.a2.nutzungsdauer, null)
    assert.equal(nach.a3.abgegangen, true)
    assert.equal(nach.a3.afa, 500)                    // Abgang im 1. Halbjahr: halbe AfA
    assert.equal(r.summen.afa, anlagen.anlagenSummen(r.zeilen).afa)
    assert.equal(r.summen.afa, 3750 + 899.99 + 500)
    assert.equal(r.summen.anzahlAktiv, 2)
    assert.match(r.warnungen[0], /1 Anlage hat kein Anlagenkonto/)
    const t = zeilen(csvText(r.zeilen, anlagen.SPALTEN_ANLAGENVERZEICHNIS))
    assert.equal(t[0], 'Gruppe;Anlage;Konto;Anschaffung;AK netto (€);Nutzungsdauer (Jahre);Methode;AfA-Satz (%);Buchwert 1.1. (€);Zugang (€);Abgang (€);AfA (€);Halbjahres-AfA;kum. AfA (€);Buchwert 31.12. (€);Abgang am;Restbuchwert Abgang (€);Veräußerungserlös netto (€);GWG')
    assert.ok(t.includes('Fahrzeuge;Traktor;0400;15.08.2024;30000,00;8;linear;12,50;24375,00;0,00;0,00;3750,00;Nein;9375,00;20625,00;;;;Nein'))
    assert.ok(t.includes('Ohne Gruppe;Laptop;;01.02.2026;899,99;;GWG;100,00;0,00;899,99;0,00;899,99;Nein;899,99;0,00;;;;Ja'))
  })

  test('Parameter und Dateiname', () => {
    const m = MELDUNGEN_BUCHHALTUNG.anlagenverzeichnis
    assert.deepEqual(m.parameter(new URLSearchParams('jahr=2026')), { jahr: 2026 })
    assert.ok(istParameterFehler(m.parameter(new URLSearchParams(''))))
    assert.equal(csvDateiname(m.dateiteile({ jahr: 2026 }, { name: 'Weingut Muster', betriebsnummer: '1234567' }), '2026-09-24').utf8, 'Anlagenverzeichnis_1234567_2026_2026-09-24.csv')
  })
})

// ── SVS-Einheitswerte ──────────────────────────────────────────────────────────

describe('svs-einheitswerte – Format wie der Einheitswert-Import', () => {
  const gst = [
    { id: 'g1', tenant_id: T, gst_nr: '1234/2', katastralgemeinde: '04023', kg_bezeichnung: 'Straß', einlagezahl: '17', flaeche_ha: 0.5, flaeche_ha_kataster: 0.4321, nutzart: 'WEIN', rechtsverhaeltnis: 'Eigentum', einheitswert: 3450, einheitswert_bescheid: '2024-01-01', einheitswert_quelle: 'import', svs_zurechnung: 'eigen', weingarten: { name: 'WG 1', ried: 'Gaisberg' } },
    { id: 'g2', tenant_id: T, gst_nr: '88', katastralgemeinde: '12003', kg_bezeichnung: '', einlagezahl: null, flaeche_ha: 1.2, flaeche_ha_kataster: null, nutzart: null, rechtsverhaeltnis: 'Pacht', einheitswert: null, einheitswert_bescheid: null, einheitswert_quelle: null, svs_zurechnung: 'pacht_fremd', weingarten: null },
  ]

  test('Zeilen, Hinweis ohne Einheitswert, Mandant', async () => {
    const db = doppel({ grundstuecke: [...gst, { ...gst[0], id: 'f', tenant_id: FREMD }] })
    const r = await svs.ladeSvsEinheitswerte(db, T)
    mandantGefiltert(db)
    assert.equal(r.zeilen.length, 2)
    assert.deepEqual(r.warnungen, ['1 Grundstück hat noch keinen Einheitswert – die Beitragsgrundlage ist unvollständig.'])
    const t = zeilen(csvText(r.zeilen, svs.SPALTEN_SVS_EINHEITSWERTE))
    assert.equal(t[1], '04023;1234/2;3450,00;01.01.2024;eigen;Eigentum (voll);Straß;17;Gaisberg;0,4321;WEIN;Eigentum;Import')
    assert.equal(t[2], '12003;88;;;pacht_fremd;Zupachtung von Fremden (2/3);;;;1,2000;;Pacht;')
  })

  test('Rundreise: der Import auf /buchhaltung/svs erkennt Kopf und Werte', () => {
    // Nachbau der Spaltenerkennung und Wertumwandlung aus buchhaltung/svs/actions.ts (importiereEinheitswerte)
    const text = csvText(gst.map(svs.svsEinheitswertZeile), svs.SPALTEN_SVS_EINHEITSWERTE)
    const quelle = readFileSync(path.join(HIER, '../../src/app/(dashboard)/buchhaltung/svs/actions.ts'), 'utf8')
    assert.ok(quelle.includes("idx(['kg', 'katastralgemeinde', 'kg-nr', 'kg_nr'])") && quelle.includes("idx(['zurechnung', 'pacht'])"), 'Importlogik geändert – Test anpassen')
    const zeilenImport = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const kopf = zeilenImport[0].split(';').map(h => h.trim().toLowerCase().replace(/"/g, ''))
    const idx = namen => kopf.findIndex(h => namen.some(n => h === n || h.startsWith(n)))
    assert.deepEqual([idx(['kg', 'katastralgemeinde', 'kg-nr', 'kg_nr']), idx(['gst', 'gst_nr', 'gst-nr', 'grundst', 'parzelle']), idx(['einheitswert', 'ew']), idx(['bescheid', 'datum']), idx(['zurechnung', 'pacht'])], [0, 1, 2, 3, 4])
    const felder = zeilenImport[1].split(';')
    const dezimal = s => (s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
    assert.equal(parseFloat(dezimal(felder[2].replace(/[€\s.]/g, ''))), 3450)
    assert.match(felder[3], /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
    assert.equal(felder[4], 'eigen')
  })
})

// ── Register, Katalog, Leermeldungen ───────────────────────────────────────────

describe('Register und Katalog der Gruppe', () => {
  test('Register = Katalog, Zugriff wie die Seiten (Mitglied + Modul E&A), Druckpfade', () => {
    assert.deepEqual(Object.keys(MELDUNGEN_BUCHHALTUNG).sort(), Object.keys(KATALOG_BUCHHALTUNG).sort())
    assert.deepEqual(Object.keys(KATALOG_BUCHHALTUNG).sort(), ['anlagenverzeichnis', 'belegverzeichnis', 'ea-journal', 'kassabuch', 'rechnungsausgangsjournal', 'svs-einheitswerte', 'uva'])
    for (const [id, m] of Object.entries(MELDUNGEN_BUCHHALTUNG)) {
      assert.equal(m.id, id)
      assert.equal(m.gruppe, 'buchhaltung')
      assert.equal(m.zugriff, 'mitglied')
      assert.equal(m.modul, 'modul_ea')
      assert.ok(m.druckPfad?.startsWith('/buchhaltung'), `${id}: Druckpfad`)
      // Marker in der ersten Zeile der Druckseite
      const seite = path.join(HIER, '../../src/app/(dashboard)', m.druckPfad, 'page.tsx')
      const ersteZeile = readFileSync(seite, 'utf8').split(/\r?\n/)[0]
      assert.equal(ersteZeile, `// behoerdenmeldung: ${id}`, `${id}: Marker fehlt in ${m.druckPfad}/page.tsx`)
    }
  })

  test('Leermeldung je Meldung: nur Kopfzeile, gültige Datei', () => {
    for (const [id, m] of Object.entries(MELDUNGEN_BUCHHALTUNG)) {
      const d = csvDatei([], m.spalten)
      assert.equal(d.zeilen, 0)
      assert.equal(d.warnungen.length, 0)
      assert.ok(d.text.startsWith(BOM) && d.text.endsWith('\r\n') && d.text.split('\r\n').length === 2, id)
      for (const s of m.spalten) {
        if (s.typ === 'betrag') assert.match(s.kopf, /\(€\)$/, `${id}: Betragsspalte „${s.kopf}“ ohne Einheit`)
        assert.ok(!/flaeche|faehig|geschaeft|uebermittel|verhaeltnis|veraeusser|erloes|abgaeng|zugaeng|kaeufer|qualitaet|gruen|strasse|groesse/i.test(s.kopf), `${id}: „${s.kopf}“ mit Ersatzschreibung statt Umlaut`)
      }
    }
  })

  test('Hilfsfunktionen: Datum, Zeitraum, Summen', () => {
    assert.equal(gemeinsam.istIsoDatum('2026-02-29'), false)
    assert.equal(gemeinsam.istIsoDatum('2028-02-29'), true)
    assert.deepEqual(gemeinsam.standardZeitraum('2026-09-24'), { von: '2026-01-01', bis: '2026-09-24' })
    assert.equal(gemeinsam.summe([0.1, 0.2, null, undefined]), 0.3)
    assert.equal(gemeinsam.sachkonto('660'), '0660')
    assert.equal(gemeinsam.betrag('1.005'), 1.01)
    assert.equal(gemeinsam.datumText('2026-03-05'), '05.03.2026')
  })

  test('bmd.ts: BOM nur über den Baustein (kein unsichtbares Zeichen im Quelltext)', () => {
    const quelle = readFileSync(path.join(HIER, '../../src/lib/buchhaltung/bmd.ts'), 'utf8')
    assert.ok(!quelle.includes(BOM), 'unsichtbarer BOM in bmd.ts')
    assert.match(quelle, /csvText\(zeilen, BMD_CSV_SPALTEN, PROFIL_BMD\)/)
  })
})
