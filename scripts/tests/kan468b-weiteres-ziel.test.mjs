// KAN-468 Nebenbefund (UAT 19.11.2026): Aus dem Kellerplan sollten 1.000 l in einem Schritt auf zwei Kammern verteilt
// werden (je 500 l). Das Ziehen kennt nur ein Ziel; mehrere Ziele in einer Buchung gibt es unter Kellerbuch › Umziehen.
// „Weiteres Ziel …“ im Buchungsdialog des Kellerplans öffnet das Umzugsformular mit Charge, erstem Ziel und Menge.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { umzugVorgabeAus, vorgabeZeilen, weiteresZielPfad } from '../../src/lib/keller/umzugVorgabe.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

const G1 = '33333333-3333-4333-8333-000a00000011', G2 = '33333333-3333-4333-8333-000a00000018', G3 = '33333333-3333-4333-8333-000a00000019'
const C1 = '33333333-3333-4333-8333-000b00000015', C2 = '33333333-3333-4333-8333-000b00000016'
const quellen = [{ charge_id: C1, behaelter_id: G1, menge_liter: 1000 }, { charge_id: C2, behaelter_id: G1, menge_liter: 300 }]

describe('KAN-468 Nebenbefund: Adresse des Umzugsformulars', () => {
  test('Pfad mit Charge, erstem Ziel und Menge; ohne gültige Menge ohne sie', () => {
    assert.equal(weiteresZielPfad({ vonBehaelter: G1, chargeId: C1, zielId: G2, menge: 500 }), `/kellerbuch/umziehen?neu=1&von=${G1}&charge=${C1}&nach=${G2}&menge=500`)
    assert.equal(weiteresZielPfad({ vonBehaelter: G1, chargeId: C1, zielId: G2, menge: 499.99951 }), `/kellerbuch/umziehen?neu=1&von=${G1}&charge=${C1}&nach=${G2}&menge=500`)
    for (const menge of [null, NaN, 0, -5]) assert.ok(!weiteresZielPfad({ vonBehaelter: G1, chargeId: C1, zielId: G2, menge }).includes('menge='), String(menge))
  })
  test('Lesen der Adresse: nur gültige UUIDs und eine positive Zahl, alles andere entfällt', () => {
    assert.deepEqual(umzugVorgabeAus({ neu: '1', von: G1, charge: C1, nach: G2, menge: '500.5' }), { vonBehaelter: G1, chargeId: C1, zielId: G2, menge: 500.5 })
    assert.deepEqual(umzugVorgabeAus({ von: 'x', charge: `${C1}'`, nach: ['a', 'b'], menge: '1e9' }), { vonBehaelter: null, chargeId: null, zielId: null, menge: null })
    assert.deepEqual(umzugVorgabeAus({ von: G1, menge: '0' }), { vonBehaelter: G1, chargeId: null, zielId: null, menge: null })
    assert.deepEqual(umzugVorgabeAus(null), { vonBehaelter: null, chargeId: null, zielId: null, menge: null })
  })
  test('Hin und zurück: was der Dialog schickt, liest die Seite', () => {
    const u = new URL(weiteresZielPfad({ vonBehaelter: G1, chargeId: C2, zielId: G2, menge: 123.456 }), 'https://x.test')
    assert.deepEqual(umzugVorgabeAus(Object.fromEntries(u.searchParams)), { vonBehaelter: G1, chargeId: C2, zielId: G2, menge: 123.456 })
  })
})

describe('KAN-468 Nebenbefund: Startzustand des Formulars', () => {
  test('Fall aus dem UAT: 1.000 l, 500 l ins erste Ziel → Quelle 1.000, Ziel 1 mit 500, Ziel 2 ohne Gebinde mit 500', () => {
    assert.deepEqual(vorgabeZeilen({ vonBehaelter: G1, chargeId: C1, zielId: G2, menge: 500 }, quellen), {
      quelle: { chargeId: C1, menge: '1000' },
      ziele: [{ behId: G2, menge: '500' }, { behId: '', menge: '500' }],
    })
  })
  test('ganzer Inhalt im Dialog: zweite Zeile ohne Vorschlag; mehr als der Inhalt wird auf den Inhalt begrenzt', () => {
    assert.deepEqual(vorgabeZeilen({ vonBehaelter: G1, chargeId: C1, zielId: G2, menge: 1000 }, quellen).ziele, [{ behId: G2, menge: '1000' }, { behId: '', menge: '' }])
    assert.deepEqual(vorgabeZeilen({ vonBehaelter: G1, chargeId: C1, zielId: G2, menge: 5000 }, quellen).ziele, [{ behId: G2, menge: '1000' }, { behId: '', menge: '' }])
  })
  test('die gewählte Charge des Gebindes (nicht einfach die erste); ohne Menge bleibt Ziel 1 ohne Menge', () => {
    assert.deepEqual(vorgabeZeilen({ vonBehaelter: G1, chargeId: C2, zielId: G3, menge: 100 }, quellen), {
      quelle: { chargeId: C2, menge: '300' }, ziele: [{ behId: G3, menge: '100' }, { behId: '', menge: '200' }],
    })
    assert.deepEqual(vorgabeZeilen({ vonBehaelter: G1, chargeId: C1, zielId: G2, menge: null }, quellen).ziele, [{ behId: G2, menge: '' }, { behId: '', menge: '' }])
  })
  test('wie bisher (KAN-174 B): nur das Gebinde → erste Charge als Quelle, eine leere Ziel-Zeile', () => {
    assert.deepEqual(vorgabeZeilen({ vonBehaelter: G1, chargeId: null, zielId: null, menge: null }, quellen), { quelle: { chargeId: C1, menge: '' }, ziele: [{ behId: '', menge: '' }] })
    assert.deepEqual(vorgabeZeilen(null, quellen), { quelle: { chargeId: '', menge: '' }, ziele: [{ behId: '', menge: '' }] })
  })
  test('Charge nicht (mehr) im Gebinde bzw. Ziel = Quell-Gebinde: keine falsche Vorbelegung', () => {
    assert.deepEqual(vorgabeZeilen({ vonBehaelter: G2, chargeId: C1, zielId: G3, menge: 10 }, quellen), { quelle: { chargeId: '', menge: '' }, ziele: [{ behId: '', menge: '' }] })
    assert.deepEqual(vorgabeZeilen({ vonBehaelter: G1, chargeId: C1, zielId: G1, menge: 10 }, quellen), { quelle: { chargeId: C1, menge: '' }, ziele: [{ behId: '', menge: '' }] })
  })
})

describe('KAN-468 Nebenbefund: Einbau', () => {
  test('Kellerplan-Dialog: Link „Weiteres Ziel …“ mit Charge, Ziel und Menge des Dialogs', () => {
    const k = quelle('src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanBuchen.tsx')
    assert.ok(k.includes('<Link href={weiteresZielPfad({ vonBehaelter: quellGebinde.id, chargeId: quelle.id, zielId: ziel.id, menge: Number.isFinite(menge) ? menge : null })}'))
    assert.ok(k.includes('Weiteres Ziel …') && k.includes('alles in einer Buchung speichern'))
  })
  test('Umzugsformular: Seite liest die Vorgabe, das Formular startet mit vorgabeZeilen', () => {
    const p = quelle('src/app/(dashboard)/kellerbuch/umziehen/page.tsx')
    assert.ok(p.includes('const vorgabe = umzugVorgabeAus(sp)') && p.includes('vorgabe={vorgabe}'))
    const c = quelle('src/app/(dashboard)/kellerbuch/umziehen/UmziehenClient.tsx')
    assert.ok(c.includes('const [start] = useState(() => vorgabeZeilen(vorgabe ?? { vonBehaelter, chargeId: null, zielId: null, menge: null }, quellen))'))
    assert.ok(c.includes('start.ziele.map(z => ({ id: crypto.randomUUID(), behId: z.behId, menge: z.menge }))'))
    assert.ok(c.includes('<UmziehenForm quellen={behaelterMitChargen} behaelter={behaelter} vonBehaelter={vonBehaelter} vorgabe={vorgabe} />'))
  })
  test('Handbuch beschreibt den Weg', () => {
    assert.ok(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx').includes('„Weiteres Ziel …“'))
  })
})
