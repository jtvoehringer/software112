// KAN-108: Rückverfolgung Weingarten – Maßnahmen je Lese-Grundstück bis zur Ernte, Wartezeit-Ampel, Einstiege
// über Lese, Jahrgang/GST, Charge und Füllung (src/lib/behoerden/rv-weingarten.ts) gegen die Supabase-Attrappe.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()

const T = 't1'
const JG = 'jg25', LESE = 'lese-25-1', GA = 'gst-a', GB = 'gst-b', W1 = 'wg-1'
const PRESSUNG = { id: 'p1', datum: '2025-09-22', tenant_id: T, jahrgang_id: JG, lese_id: LESE, jahrgang: { jahrgang: 2025 }, lese: { lfd_nr: 1, art: 'hauptlese' } }

function pwZeile(id, gst, extra = {}) {
  return {
    id, trauben_kg: 1000, rebsorte: 'Grüner Veltliner', ernte_datum: '2025-09-20', kmw: 18.5, weingarten_id: W1, grundstueck_id: gst, zukauf_posten_id: null,
    weingarten: { id: W1, name: 'Sandgrube' }, grundstueck: { gst_nr: gst === GA ? '1305/1' : '1305/2', katastralgemeinde: '12119', ama_feldnummer: '7' },
    pressung: PRESSUNG, ...extra,
  }
}

function behandlung(id, datum, gst, psm, extra = {}) {
  return {
    id, tenant_id: T, datum, datum_bis: null, art: psm ? 'spritzung' : 'laubarbeit', weingarten_id: W1, aufwandmenge: psm ? 2 : null, aufwandmenge_einheit: psm ? 'kg/ha' : null,
    schaderreger: null, witterung: null, notizen: null, ernte_fruehesteins: null, wartezeit_eingehalten: null,
    psm, behandlung_grundstuecke: gst ? [{ grundstueck_id: gst, flaeche_ha: 1 }] : [], ...extra,
  }
}
const CUPROZIN = { name: 'Cuprozin progress', handelsname: null, zulassungsnr: '3106-0', wartezeit_tage: 21 }
const FOLPAN = { name: 'Folpan 80 WDG', handelsname: null, zulassungsnr: '2863', wartezeit_tage: 28 }

function db() {
  return datenbank({
    weinjahrgaenge: [{ id: JG, tenant_id: T, jahrgang: 2025 }, { id: 'jg24', tenant_id: T, jahrgang: 2024 }],
    lesen: [{ id: LESE, tenant_id: T, lfd_nr: 1, art: 'hauptlese', jahrgang: { jahrgang: 2025 } }],
    pressung_weingaerten: [
      pwZeile('pw-a', GA),
      pwZeile('pw-b', GB),
      // Vorjahres-Lese an GST A (Fensterbeginn „Ernte bis Ernte“)
      { ...pwZeile('pw-24', GA, { ernte_datum: '2024-09-25' }), pressung: { ...PRESSUNG, id: 'p24', jahrgang_id: 'jg24', lese_id: 'lese-24', jahrgang: { jahrgang: 2024 } } },
      // fremder Betrieb – darf nicht erscheinen
      { ...pwZeile('pw-fremd', GA), pressung: { ...PRESSUNG, tenant_id: 'fremd' } },
    ],
    traubenverkauf: [{
      id: 'tv1', tenant_id: T, datum: '2025-09-18', menge_kg: 800, kmw_grad: 17.2, liefernummer: 'L-2025-004', weingarten_id: W1, grundstueck_id: GB,
      jahrgang_id: JG, lese_id: LESE, zukauf_posten_id: null, weingarten: { id: W1, name: 'Sandgrube' },
      grundstueck: { gst_nr: '1305/2', katastralgemeinde: '12119', ama_feldnummer: '8' }, jahrgang: { jahrgang: 2025 },
      lese: { lfd_nr: 1, art: 'hauptlese' }, kontakt: null, firma: { name: 'Winzerkeller Wagram' },
    }],
    ernte_parzellen: [],
    grundstuecke: [
      { id: GA, tenant_id: T, weingarten_id: W1, gst_nr: '1305/1' },
      { id: GB, tenant_id: T, weingarten_id: W1, gst_nr: '1305/2' },
    ],
    behandlungen: [
      behandlung('dez-schnitt', '2024-12-05', GA, null),                 // nach der Vorjahres-Lese → dabei (GST A)
      behandlung('cu-juli', '2025-07-10', GA, CUPROZIN),                  // 10.07. + 21 = 31.07. → eingehalten
      behandlung('folpan-spaet', '2025-09-01', GA, FOLPAN),               // 01.09. + 28 = 29.09. > Lese 20.09. → verletzt
      behandlung('cu-gst-b', '2025-08-01', GB, CUPROZIN, { ernte_fruehesteins: '2025-09-25' }),  // gespeichert 25.09. > Lese 20.09. (B) bzw. 18.09. (Verkauf)
      behandlung('nach-lese', '2025-10-01', GA, CUPROZIN),               // nach der Lese → nicht dabei
    ],
  })
}

describe('KAN-108 Wartezeit-Ampel (rein)', nurMitHooks, () => {
  test('frühester Lesetermin: gespeichert oder letzter Behandlungstag + Wartezeit, das spätere gilt', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    assert.equal(rv.fruehesterLesetermin({ datum: '2025-07-10', psm: { wartezeit_tage: 21 } }), '2025-07-31')
    assert.equal(rv.fruehesterLesetermin({ datum: '2025-07-10', datum_bis: '2025-07-12', ernte_fruehesteins: '2025-07-31', psm: { wartezeit_tage: 21 } }), '2025-08-02')
    assert.equal(rv.fruehesterLesetermin({ datum: '2025-07-10', ernte_fruehesteins: '2025-08-15', psm: { wartezeit_tage: null } }), '2025-08-15')
    assert.equal(rv.fruehesterLesetermin({ datum: '2025-07-10', psm: { wartezeit_tage: null } }), null)
  })

  test('Ampel: Lese vor dem frühesten Lesetermin rot, sonst grün; nur Pressungsdatum → prüfen', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    assert.equal(rv.wartezeitAmpel('2025-09-29', { bis: '2025-09-20', bisAus: 'lesedatum' }), 'verletzt')
    assert.equal(rv.wartezeitAmpel('2025-09-20', { bis: '2025-09-20', bisAus: 'lesedatum' }), 'eingehalten')
    assert.equal(rv.wartezeitAmpel('2025-09-10', { bis: '2025-09-20', bisAus: 'erntemeldung' }), 'eingehalten')
    assert.equal(rv.wartezeitAmpel('2025-09-10', { bis: '2025-09-20', bisAus: 'pressungsdatum' }), 'pruefen')
    assert.equal(rv.wartezeitAmpel('2025-09-29', { bis: '2025-09-20', bisAus: 'pressungsdatum' }), 'verletzt')
    assert.equal(rv.wartezeitAmpel(null, { bis: '2025-09-20', bisAus: 'lesedatum' }), null)
    assert.deepEqual(rv.massnahmeWartezeit({ behandlung: { datum: '2025-07-10', psm: null } }, { bis: '2025-09-20', bisAus: 'lesedatum' }), { fruehester: null, ampel: null })
  })

  test('Einstieg: genau einer', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    const leer = { lese: null, jahrgang: null, gst: null, weingarten: null, charge: null, fuellung: null }
    assert.match(rv.einstiegFehler(leer), /Jahrgang oder ein Grundstück/)
    assert.equal(rv.einstiegFehler({ ...leer, jahrgang: 2025 }), null)
    assert.equal(rv.einstiegFehler({ ...leer, gst: GA }), null)
    assert.equal(rv.einstiegFehler({ ...leer, lese: LESE }), null)
    assert.match(rv.einstiegFehler({ ...leer, lese: LESE, charge: 'c' }), /nur einen Einstieg/)
    assert.match(rv.einstiegFehler({ ...leer, lese: LESE, jahrgang: 2025 }), /ohne Jahrgang/)
  })
})

describe('KAN-108 Lader', nurMitHooks, () => {
  const leer = { lese: null, jahrgang: null, gst: null, weingarten: null, charge: null, fuellung: null }

  test('Einstieg Lese: Pressungszeilen und Traubenverkauf mit Abnehmer und Liefernummer, fremder Betrieb außen vor', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    const r = await rv.ladeRvWeingarten(db(), T, { ...leer, lese: LESE })
    assert.equal(r.titel, '2025/1 Hauptlese')
    assert.deepEqual(r.lesen.map(l => [l.quelle, l.gstNr, l.lesedatum]).sort(), [
      ['pressung', '1305/1', '2025-09-20'], ['pressung', '1305/2', '2025-09-20'], ['traubenverkauf', '1305/2', '2025-09-18'],
    ])
    const tv = r.lesen.find(l => l.quelle === 'traubenverkauf')
    assert.equal(tv.abnehmer, 'Winzerkeller Wagram')
    assert.equal(tv.liefernummer, 'L-2025-004')
    assert.equal(tv.feldstueck, '8')
    assert.deepEqual(tv.massnahmen.map(m => m.behandlung.id), ['cu-gst-b'])
    assert.equal(rv.massnahmeWartezeit(tv.massnahmen[0], tv.fenster).ampel, 'verletzt')
  })

  test('GST A: Ernte bis Ernte (Dezember-Schnitt dabei), rote Ampel für Folpan, grüne für Kupfer, Warnung oben', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    const r = await rv.ladeRvWeingarten(db(), T, { ...leer, jahrgang: 2025, gst: GA })
    assert.equal(r.lesen.length, 1)
    const [a] = r.lesen
    assert.deepEqual(a.fenster, { von: '2024-09-26', bis: '2025-09-20', jahrgang: 2025, bisAus: 'lesedatum', vonAus: 'vorjahreslese', vorjahresLese: '2024-09-25' })
    assert.deepEqual(a.massnahmen.map(m => m.behandlung.id), ['dez-schnitt', 'cu-juli', 'folpan-spaet'])
    assert.deepEqual(a.massnahmen.map(m => rv.massnahmeWartezeit(m, a.fenster).ampel), [null, 'eingehalten', 'verletzt'])
    assert.match(r.warnungen[0], /Bei 1 Lese liegt der Lesetag vor dem frühesten Lesetermin/)
  })

  test('Einstiege Lese und Jahrgang/GST ergeben für dieselbe Lesezeile dieselben Maßnahmen', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    const ueberLese = await rv.ladeRvWeingarten(db(), T, { ...leer, lese: LESE })
    const ueberJahrgang = await rv.ladeRvWeingarten(db(), T, { ...leer, jahrgang: 2025 })
    const ueberGst = await rv.ladeRvWeingarten(db(), T, { ...leer, gst: GB })
    const je = r => Object.fromEntries(r.lesen.map(l => [l.leseId, l.massnahmen.map(m => m.behandlung.id)]))
    assert.deepEqual(je(ueberJahrgang), je(ueberLese))
    for (const [id, ms] of Object.entries(je(ueberGst))) if (id !== 'pw:pw-24' && je(ueberLese)[id]) assert.deepEqual(ms, je(ueberLese)[id])
  })

  test('Einstieg Charge: Lesezeilen der Charge und ihrer Verschnitt-Vorgänger – dieselben Maßnahmen wie über die Lese', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    const basis = db()
    const vs = { id: 'vs1', tenant_id: T, datum: '2025-11-02', created_at: '2025-11-02T10:00:00Z', ziel_weinausbau_id: 'ch-cuvee', quellen: [{ id: 'vq1', quell_weinausbau_id: 'ch-b', menge_liter: 200 }] }
    const pb = (id, charge, pwId) => {
      const z = basis.tabellen.pressung_weingaerten.find(p => p.id === pwId)
      return { id, menge_liter: 700, weinausbau_id: charge, pressung: { ...PRESSUNG, erstellt_am: '2025-09-22T10:00:00Z', pressung_weingaerten: [z] } }
    }
    const d = datenbank({
      ...basis.tabellen,
      weinausbau: [
        { id: 'ch-cuvee', tenant_id: T, name: 'Cuvée Sandgrube', menge_liter: 900, ist_eroeffnungsbestand: false, created_at: '2025-09-22T10:00:00Z' },
        { id: 'ch-b', tenant_id: T, name: 'GV 1305/2', menge_liter: 500, ist_eroeffnungsbestand: false, created_at: '2025-09-22T10:00:00Z' },
      ],
      pressung_behaelter: [pb('pb-a', 'ch-cuvee', 'pw-a'), pb('pb-b', 'ch-b', 'pw-b')],
      zukauf_posten: [], keller_umzuege: [], verschneidungen: [vs],
      verschneidung_quellen: [{ id: 'vq1', quell_weinausbau_id: 'ch-b', menge_liter: 200, verschneidung: vs }],
      fuellung_chargen: [], fuellungen: [], verkauf_positionen: [],
    })
    const r = await rv.ladeRvWeingarten(d, T, { ...leer, charge: 'ch-cuvee' })
    assert.equal(r.titel, 'Cuvée Sandgrube')
    assert.deepEqual(r.lesen.map(l => l.leseId).sort(), ['pw:pw-a', 'pw:pw-b'])
    const ueberLese = await rv.ladeRvWeingarten(d, T, { ...leer, lese: LESE })
    const je = x => Object.fromEntries(x.lesen.map(l => [l.leseId, l.massnahmen.map(m => m.behandlung.id)]))
    for (const [id, ms] of Object.entries(je(r))) assert.deepEqual(ms, je(ueberLese)[id])
    assert.equal(await rv.ladeRvWeingarten(d, T, { ...leer, charge: 'gibt-es-nicht' }), null)
  })

  test('CSV: eine Zeile je Lesezeile × Maßnahme, Leermeldung bei 0 Lesen, Lese/Charge nicht gefunden → null', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    const csv = await laden('lib/csv/index.ts')
    const r = await rv.ladeRvWeingarten(db(), T, { ...leer, jahrgang: 2025, gst: GA })
    const zeilen = rv.rvZeilen(r.lesen)
    assert.equal(zeilen.length, 3)
    const folpan = zeilen.find(z => z.mittel === 'Folpan 80 WDG')
    assert.equal(folpan.registernummer, '2863')
    assert.equal(folpan.fruehesterLesetermin, '2025-09-29')
    assert.equal(folpan.wartezeit, 'NICHT eingehalten')
    const text = csv.csvText(zeilen, rv.SPALTEN_RV_WEINGARTEN)
    assert.match(text, /29\.09\.2025;NICHT eingehalten/)
    const leerErgebnis = await rv.ladeRvWeingarten(datenbank({ weinjahrgaenge: [{ id: 'x', tenant_id: T, jahrgang: 2030 }], pressung_weingaerten: [], traubenverkauf: [] }), T, { ...leer, jahrgang: 2030 })
    assert.deepEqual(leerErgebnis.lesen, [])
    assert.equal(csv.csvText(rv.rvZeilen(leerErgebnis.lesen), rv.SPALTEN_RV_WEINGARTEN).split('\r\n').filter(Boolean).length, 1)
    assert.equal(await rv.ladeRvWeingarten(db(), T, { ...leer, lese: '00000000-0000-4000-8000-000000000000' }), null)
  })
})

describe('KAN-132 Menge anteilig in der Rückverfolgung', nurMitHooks, () => {
  test('Maßnahme auf zwei GST: je gelesenem GST nur der Flächenanteil der Mittelmenge (nicht die Gesamtmenge)', async () => {
    const rv = await laden('lib/behoerden/rv-weingarten.ts')
    const d = db()
    d.tabellen.behandlungen.push(behandlung('beide-mai', '2025-05-10', null, CUPROZIN, {
      aufwandmenge: 2, aufwandmenge_einheit: 'kg_ha',
      behandlung_grundstuecke: [{ grundstueck_id: GA, flaeche_ha: 1.5, grundstueck: { id: GA, gst_nr: '1305/1', katastralgemeinde: '12119', flaeche_ha: 1.5 } },
        { grundstueck_id: GB, flaeche_ha: 0.5, grundstueck: { id: GB, gst_nr: '1305/2', katastralgemeinde: '12119', flaeche_ha: 0.5 } }],
    }))
    const r = await rv.ladeRvWeingarten(d, T, { lese: null, jahrgang: 2025, gst: GA, weingarten: null, charge: null, fuellung: null })
    const m = r.lesen[0].massnahmen.find(x => x.behandlung.id === 'beide-mai')
    assert.deepEqual([m.menge, m.mengeEinheit], [3, 'kg'])            // 2 kg/ha × 2 ha = 4 kg, davon 1,5/2 auf GST A
    const zeile = rv.rvZeilen(r.lesen).find(z => z.massnahmeVon === '2025-05-10')
    assert.deepEqual([zeile.mengeAnteil, zeile.mengeEinheit], [3, 'kg'])
  })
})
