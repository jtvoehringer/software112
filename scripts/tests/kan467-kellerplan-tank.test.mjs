// KAN-467 (16.11.2026): Tank mit Kammern – Stufe 2: Tank-Symbol im Kellerplan.
// Geprüft wird: Segmente eines Tanks (Höhe nach Fassung, Mindesthöhe, Reihenfolge), Größe und Lage im Plan,
// Treffererkennung für Kreise und Segmente (auch zwischen gewöhnlichen Gebinden wie bisher), Editor, Seite, Aktionen,
// Druckregel der Gebindeliste (Nebenbefund), Migration und Register.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'
import {
  SEGMENT_MIN_ANTEIL, TANK_BREITE_MAX, TANK_BREITE_MIN, planHoehe, segmentRechtecke, tankGroesseAendern, tankImPlan, tankSegmente,
  tankStandardGroesse, zielUnterZeiger,
} from '../../src/lib/keller/kellerplanTank.ts'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const fast = (a, b, eps = 1e-9) => Math.abs(a - b) < eps
const K3 = [{ id: 'k1', nr: 1, volumen_liter: 3000 }, { id: 'k2', nr: 2, volumen_liter: 2000 }, { id: 'k3', nr: 3, volumen_liter: 2000 }]

describe('KAN-467: Segmente eines Tanks', () => {
  test('oberste Kammer zuerst, Höhe nach Fassung, zusammen 100 %', () => {
    const s = tankSegmente(K3)
    assert.deepEqual(s.map(x => x.id), ['k3', 'k2', 'k1'])
    assert.ok(fast(s.reduce((a, x) => a + x.hoehe, 0), 100))
    assert.ok(s[2].hoehe > s[1].hoehe, 'Kammer 1 (3.000 l) ist höher als Kammer 2 (2.000 l)')
    assert.ok(fast(s[0].hoehe, s[1].hoehe), 'gleiche Fassung = gleiche Höhe')
    assert.deepEqual([s[0].oben, fast(s[1].oben, s[0].hoehe), fast(s[2].oben, s[0].hoehe + s[1].hoehe)], [0, true, true])
    // Mindestanteil 18 % je Kammer, der Rest (46 %) nach dem Volumen: 18 + 46 · 3/7 bzw. 18 + 46 · 2/7
    assert.ok(fast(s[2].hoehe, 18 + 46 * 3 / 7))
    assert.ok(fast(s[1].hoehe, 18 + 46 * 2 / 7))
  })
  test('Reihenfolge der Eingabe ist egal; eine sehr kleine Kammer bleibt lesbar', () => {
    assert.deepEqual(tankSegmente([K3[1], K3[2], K3[0]]).map(x => x.id), ['k3', 'k2', 'k1'])
    const s = tankSegmente([{ id: 'a', nr: 1, volumen_liter: 10000 }, { id: 'b', nr: 2, volumen_liter: 100 }])
    assert.ok(s[0].hoehe >= SEGMENT_MIN_ANTEIL * 100, `kleine Kammer ${s[0].hoehe}`)
    assert.ok(fast(s[0].hoehe + s[1].hoehe, 100))
  })
  test('fehlendes Fassungsvermögen zählt wie der Durchschnitt; ohne jede Angabe alle gleich; viele Kammern', () => {
    const s = tankSegmente([{ id: 'a', nr: 1, volumen_liter: 2000 }, { id: 'b', nr: 2, volumen_liter: null }, { id: 'c', nr: 3, volumen_liter: 2000 }])
    assert.ok(fast(s[0].hoehe, s[1].hoehe) && fast(s[1].hoehe, s[2].hoehe))
    const g = tankSegmente([{ id: 'a', nr: 1, volumen_liter: null }, { id: 'b', nr: 2, volumen_liter: 0 }])
    assert.ok(fast(g[0].hoehe, 50) && fast(g[1].hoehe, 50))
    const viele = tankSegmente(Array.from({ length: 12 }, (_, i) => ({ id: `k${i + 1}`, nr: i + 1, volumen_liter: 500 })))
    assert.equal(viele.length, 12)
    assert.ok(fast(viele.reduce((a, x) => a + x.hoehe, 0), 100))
    assert.ok(viele.every(x => x.hoehe > 0))
    assert.deepEqual(tankSegmente([]), [])
  })
})

describe('KAN-467: Größe und Lage', () => {
  test('Startgröße nach der Zahl der Kammern, in Grenzen', () => {
    assert.deepEqual(tankStandardGroesse(3), { breite_pct: 12, hoehe_pct: 26 })
    assert.deepEqual(tankStandardGroesse(2), { breite_pct: 12, hoehe_pct: 18 })
    assert.deepEqual(tankStandardGroesse(12), { breite_pct: 12, hoehe_pct: 44 })
  })
  test('der Tank bleibt im Plan (Höhe im Maß der Breite, A4-Hochformat)', () => {
    assert.ok(fast(planHoehe(29.7), 21))
    const p = tankImPlan({ pos_x_pct: 95, pos_y_pct: 99, breite_pct: 12, hoehe_pct: 26 })
    assert.equal(p.pos_x_pct, 88)
    assert.ok(fast(p.pos_y_pct, 100 - planHoehe(26)))
    assert.deepEqual(tankImPlan({ pos_x_pct: -5, pos_y_pct: -1, breite_pct: 12, hoehe_pct: 26 }).pos_x_pct, 0)
    assert.equal(tankImPlan({ pos_x_pct: -5, pos_y_pct: -1, breite_pct: 12, hoehe_pct: 26 }).pos_y_pct, 0)
  })
  test('größer/kleiner hält das Seitenverhältnis und die Grenzen', () => {
    const p = { pos_x_pct: 10, pos_y_pct: 10, breite_pct: 12, hoehe_pct: 26 }
    const g = tankGroesseAendern(p, 3)
    assert.equal(g.breite_pct, 15)
    assert.ok(fast(g.hoehe_pct / g.breite_pct, 26 / 12))
    assert.equal(tankGroesseAendern(p, -30).breite_pct, TANK_BREITE_MIN)
    assert.equal(tankGroesseAendern(p, 300).breite_pct, TANK_BREITE_MAX)
    const rand = tankGroesseAendern({ pos_x_pct: 88, pos_y_pct: 80, breite_pct: 12, hoehe_pct: 26 }, 3)
    assert.ok(rand.pos_x_pct + rand.breite_pct <= 100 + 1e-9 && rand.pos_y_pct + planHoehe(rand.hoehe_pct) <= 100 + 1e-9, 'bleibt im Plan')
  })
})

describe('KAN-467: Gebinde unter dem Zeiger', () => {
  const flaeche = { breite: 1000, hoehe: 1414 }
  const platz = { pos_x_pct: 50, pos_y_pct: 10, breite_pct: 10, hoehe_pct: 30 }   // x 500–600, y 141,4–441,4 (Höhe 300)
  const seg = segmentRechtecke(platz, tankSegmente(K3), flaeche)
  const kreise = [{ id: 'A', cx: 100, cy: 100, r: 40 }, { id: 'B', cx: 170, cy: 100, r: 40 }]
  test('Segmente als Rechtecke: volle Tankbreite, lückenlos von oben nach unten', () => {
    assert.deepEqual(seg.map(r => r.id), ['k3', 'k2', 'k1'])
    assert.ok(seg.every(r => fast(r.x, 500) && fast(r.b, 100)))
    assert.ok(fast(seg[0].y, 141.4) && fast(seg[1].y, seg[0].y + seg[0].h) && fast(seg[2].y + seg[2].h, 141.4 + planHoehe(30) / 100 * 1414))
  })
  test('Zeiger im Segment trifft genau diese Kammer; Grenze gehört zur unteren Kammer', () => {
    assert.equal(zielUnterZeiger({ x: 550, y: 150 }, kreise, seg, null), 'k3')
    assert.equal(zielUnterZeiger({ x: 550, y: seg[1].y + 1 }, kreise, seg, null), 'k2')
    assert.equal(zielUnterZeiger({ x: 550, y: seg[2].y + seg[2].h - 1 }, kreise, seg, null), 'k1')
    assert.equal(zielUnterZeiger({ x: 550, y: seg[1].y }, kreise, seg, null), 'k2')
    assert.equal(zielUnterZeiger({ x: 499, y: 200 }, kreise, seg, null), null, 'links neben dem Tank')
    assert.equal(zielUnterZeiger({ x: 550, y: 500 }, kreise, seg, null), null, 'unter dem Tank')
  })
  test('die gezogene Kammer selbst ist kein Ziel – die Nachbarkammer schon', () => {
    assert.equal(zielUnterZeiger({ x: 550, y: 150 }, kreise, seg, 'k3'), null)
    assert.equal(zielUnterZeiger({ x: 550, y: seg[1].y + 1 }, kreise, seg, 'k3'), 'k2')
  })
  test('gewöhnliche Gebinde wie bisher: nächster Mittelpunkt, das gezogene ausgenommen, freie Fläche = null', () => {
    assert.equal(zielUnterZeiger({ x: 140, y: 100 }, kreise, seg, null), 'B')
    assert.equal(zielUnterZeiger({ x: 130, y: 100 }, kreise, seg, null), 'A')
    assert.equal(zielUnterZeiger({ x: 100, y: 100 }, kreise, seg, 'A'), null)
    assert.equal(zielUnterZeiger({ x: 300, y: 900 }, kreise, seg, null), null)
    assert.equal(zielUnterZeiger({ x: 100, y: 100 }, kreise, [], null), 'A', 'Plan ohne Tanks')
  })
  test('liegt ein Kreis über einem Tank, gewinnt der Kreis', () => {
    const ueber = [{ id: 'C', cx: 550, cy: 200, r: 30 }]
    assert.equal(zielUnterZeiger({ x: 550, y: 200 }, ueber, seg, null), 'C')
    assert.equal(zielUnterZeiger({ x: 550, y: 200 }, ueber, seg, 'C'), 'k3', 'beim Ziehen des Kreises ist die Kammer darunter das Ziel')
  })
})

describe('KAN-469: Teilumzug beim Ziehen', nurMitHooks, () => {
  const charge = (menge, o = {}) => ({ id: 'c1', name: 'GV 2026', menge_liter: menge, jahrgang: 2026, rebsorte: 'Grüner Veltliner', weinart: 'weiss',
    qualitaetsstufe: null, zusatzbezeichnung: null, erzeugnis: null, herkunft_code: null, ...o })
  const gebinde = (id, name, vol, fuellung = 0, o = {}) => ({ id, name, volumen_liter: vol, gesperrt: false, fremd_betrieb: null, fuellung, ...o })
  test('passt der ganze Inhalt, bleibt es beim ganzen Inhalt (wie KAN-114)', async () => {
    const { vorschlagsMenge } = await laden('lib/keller/kellerplanZiehen.ts')
    assert.deepEqual(vorschlagsMenge(charge(1840), gebinde('z', 'A10/2', 2000)), { menge: 1840, teil: false })
    assert.deepEqual(vorschlagsMenge(charge(2000.4), gebinde('z', 'A10/2', 2000)), { menge: 2000.4, teil: false }, 'Toleranz 0,5 l wie beim Buchen')
    assert.deepEqual(vorschlagsMenge(charge(500), gebinde('z', 'Fass', null, 9999)), { menge: 500, teil: false }, 'Fassungsvermögen unbekannt')
    assert.deepEqual(vorschlagsMenge(null, gebinde('z', 'A10/2', 2000)), { menge: 0, teil: false })
  })
  test('passt er nicht, ist es die freie Menge des Ziels – abgerundet, nie mehr als frei', async () => {
    const { vorschlagsMenge } = await laden('lib/keller/kellerplanZiehen.ts')
    assert.deepEqual(vorschlagsMenge(charge(1840), gebinde('z', 'A10/1', 3000, 2745)), { menge: 255, teil: true })
    assert.deepEqual(vorschlagsMenge(charge(1840), gebinde('z', 'A10/1', 3000, 2745.337)), { menge: 254.66, teil: true })
    assert.deepEqual(vorschlagsMenge(charge(5000), gebinde('z', 'A10/2', 2000)), { menge: 2000, teil: true })
  })
  test('volles Ziel: kein Teilumzug – es bleibt gesperrt', async () => {
    const { vorschlagsMenge, bewerteZiel } = await laden('lib/keller/kellerplanZiehen.ts')
    const voll = gebinde('z', 'A10/1', 3000, 3000)
    assert.deepEqual(vorschlagsMenge(charge(1840), voll), { menge: 1840, teil: false })
    const b = bewerteZiel({ quelle: charge(1840), quellGebinde: gebinde('q', 'Stahltank 05', 5000, 1840), ziel: voll, zielChargen: [], menge: 1840 })
    assert.equal(b.art, 'gesperrt')
  })
  test('Bewertung mit der Vorschlagsmenge: Umzug bzw. Verschnitt statt gesperrt; fremd belegt und selbes Gebinde bleiben gesperrt', async () => {
    const { vorschlagsMenge, bewerteZiel, teilumzugText } = await laden('lib/keller/kellerplanZiehen.ts')
    const q = charge(1840), qg = gebinde('q', 'Stahltank 05', 5000, 1840)
    const leer = gebinde('z', 'Barrique', 225)
    assert.equal(bewerteZiel({ quelle: q, quellGebinde: qg, ziel: leer, zielChargen: [], menge: q.menge_liter }).art, 'gesperrt', 'bisher: rot')
    assert.equal(bewerteZiel({ quelle: q, quellGebinde: qg, ziel: leer, zielChargen: [], menge: vorschlagsMenge(q, leer).menge }).art, 'umzug')
    const belegt = gebinde('z', 'A10/1', 3000, 2745)
    const rot = charge(2745, { id: 'c2', name: 'ZW 2026', rebsorte: 'Zweigelt', weinart: 'rot' })
    assert.equal(bewerteZiel({ quelle: q, quellGebinde: qg, ziel: belegt, zielChargen: [rot], menge: vorschlagsMenge(q, belegt).menge }).art, 'verschnitt')
    const fremd = gebinde('z', 'a1', 3000, 2745, { gesperrt: true, fremd_betrieb: 'Weingut X' })
    assert.equal(bewerteZiel({ quelle: q, quellGebinde: qg, ziel: fremd, zielChargen: [], menge: vorschlagsMenge(q, fremd).menge }).art, 'gesperrt')
    assert.equal(bewerteZiel({ quelle: q, quellGebinde: qg, ziel: qg, zielChargen: [q], menge: vorschlagsMenge(q, qg).menge }).art, 'gesperrt')
    assert.equal(teilumzugText(255, 1840, 'A10/1'), 'Teilumzug: 255 l von 1.840 l – mehr passt nicht in „A10/1“.')
  })
  test('Editor und Dialog verwenden dieselbe Vorschlagsmenge; der Hinweis steht im Dialog', () => {
    const e = quelle('src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx')
    assert.ok(e.includes('const v = vorschlagsMenge(q, ziel)'))
    assert.ok(e.includes('menge: v.menge })'))
    assert.ok(e.includes("' (Teilmenge)'"))
    const b = quelle('src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanBuchen.tsx')
    assert.ok(b.includes("useState(quelle ? String(vorschlag(quelle).menge).replace('.', ',') : '')"))
    assert.ok(b.includes('{quelle && vorschlag(quelle).teil && ('))
    assert.ok(b.includes("disabled={pending || bewertung.art === 'gesperrt'}"), 'die Prüfung beim Buchen bleibt')
  })
})

describe('KAN-467: Editor, Seite und Aktionen', () => {
  const D = 'src/app/(dashboard)/kellerbuch/kellerplan'
  test('Editor: Kammern sind Ziele und Quellen; im Planmodus wird der ganze Tank bewegt; Tastatur', () => {
    const e = quelle(`${D}/[id]/KellerplanEditor.tsx`)
    assert.match(e, /zielId: zielUnterZeiger\(\{ x: px, y: py \}, kreise, segmente, zr\.id\)/)
    assert.match(e, /const segmente = tanks\.flatMap\(t => tankPositions\[t\.id\] \? segmentRechtecke\(tankPositions\[t\.id\], segmenteVon\(t\), flaeche\) : \[\]\)/)
    assert.match(e, /onPointerDown=\{e => handleKammerPointerDown\(e, t\.id, k\.id\)\}/)
    assert.match(e, /if \(gebindeOhnePlanModus\(e, kammerId\)\) return/)
    assert.match(e, /id: tankId, art: 'tank', klickId: kammerId,/)
    assert.match(e, /setDialogBehaelterId\(ds\.klickId\)/)
    assert.match(e, /if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); setDialogBehaelterId\(k\.id\) \}/)
    assert.match(e, /const unplaced     = behaelter\.filter\(b => !placedIds\.has\(b\.id\) && !kammerIds\.has\(b\.id\)\)/)
    assert.match(e, /onDragStart=\{e => handleSidebarDragStart\(e, t\.id, 'tank_id'\)\}/)
    // KAN-468: Bezeichnung „Geteilter Tank“
    for (const text of ['Geteilten Tank ${t.name} vom Plan entfernen', 'Geteilter Tank ${t.name} kleiner', 'Geteilter Tank ${t.name} größer']) {
      assert.ok(e.includes('aria-label={`' + text + '`}'), text)
    }
    assert.match(e, /setSaveError\(fehlerText\(err, 'Der geteilte Tank konnte nicht vom Plan entfernt werden'\)\)/)
  })
  test('Abnahme 16.11.2026: Knöpfe der runden Gebinde liegen außerhalb des beschnittenen Kreises; der Speicherstand ist sichtbar', () => {
    const e = quelle(`${D}/[id]/KellerplanEditor.tsx`)
    // äußerer Rahmen (group, ohne overflow) → Kreis (overflow hidden) → danach die Knöpfe als Geschwister des Kreises
    const rahmen = e.indexOf('className="absolute group"\n                  style={{ left: `${pos.pos_x_pct}%`')
    const kreis = e.indexOf('className="absolute inset-0 overflow-hidden flex flex-col items-center justify-center focus:outline-hidden', rahmen)
    const inhalt = e.indexOf('{/* Inhalt: Name, Füllstand, Wein – über der Fill-Fläche */}', kreis)
    const knopf = e.indexOf('{/* Entfernen-Button */}', kreis)
    assert.ok(rahmen > 0 && kreis > rahmen && inhalt > kreis, 'Rahmen und Kreis')
    assert.ok(knopf > inhalt, 'die Knöpfe stehen nach dem Inhalt des Kreises – also außerhalb der beschnittenen Fläche')
    for (const name of ['vom Plan entfernen', 'kleiner', 'größer']) {
      assert.ok(e.includes('aria-label={`${b.name} ' + name + '`}'), `Knopf „${name}“ mit Namen`)
    }
    assert.ok(!e.includes('absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-s112-grey hover:bg-s112-err text-white text-[10px] flex items-center justify-center z-20 leading-none opacity-0 group-hover:opacity-100 transition-opacity"\n                      onClick={e => { e.stopPropagation(); handleRemove('), 'kein Knopf mehr im Kreis')
    assert.ok(e.includes('✓ Plan gespeichert – jede Änderung wird sofort übernommen.'))
    assert.equal(e.split('setPlanGespeichert(true)').length - 1, 4, 'Gebinde und Tank: speichern und entfernen')
    assert.ok(e.includes("setSaveError(fehlerText(err, 'Das Gebinde konnte nicht vom Plan entfernt werden'))"))
    assert.ok(!e.includes("console.error('Löschen fehlgeschlagen"), 'Fehler beim Entfernen wird gemeldet, nicht nur protokolliert')
  })
  test('Seite: eigene Tanks als Symbol, fremde Kammern bleiben Gebinde; Position je Gebinde oder Tank', () => {
    const p = quelle(`${D}/[id]/page.tsx`)
    assert.match(p, /nachTank\(behaelterRows\.filter\(b => b\.tank_id && !b\.fremd && !tankAnderswo\.has\(b\.tank_id\)\)\)\.tanks/)
    assert.match(p, /if \(p\.tank_id\) tankPosMap\[p\.tank_id\] = platz\n\s+else if \(p\.behaelter_id\) posMap\[p\.behaelter_id\] = platz/)
    assert.match(p, /\.select\('behaelter_id, tank_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct'\)/)
    assert.match(p, /tanks=\{tanks\}\n\s+initialTankPositions=\{tankPosMap\}/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/gebinde/qr-etiketten/page.tsx'), /eigene\.filter\(g => g\.tank_id === p\.tank_id\)/)
  })
  test('Aktionen: Kontext-Helfer zuerst, Betriebsfilter, gelöschte Zeile geprüft, Lage plausibel', () => {
    const a = quelle(`${D}/actions.ts`)
    const up = a.slice(a.indexOf('export async function upsertKellerplanTankPosition'), a.indexOf('export async function deleteKellerplanTankPosition'))
    assert.ok(up.indexOf('await getTenantId()') > 0 && up.indexOf('await getTenantId()') < up.indexOf(".from('kellerplan_positionen')"))
    assert.match(up, /v >= 0 && v <= 100/)
    assert.match(up, /\{ onConflict: 'tank_id' \}/)
    assert.match(up, /if \(existingErr\) throw new AktionsFehler/)
    const del = a.slice(a.indexOf('export async function deleteKellerplanTankPosition'), a.indexOf('// ── Kellerplan löschen'))
    assert.match(del, /\.eq\('tank_id', tankId\)\n\s+\.eq\('tenant_id', tenantId\)\n\s+\.select\('id'\)/)
    assert.match(del, /\.length === 0\) throw new AktionsFehler/)
  })
  test('Nebenbefund Druck der Gebindeliste: eine Karte mit Tabelle darf umbrechen (sonst bleibt Seite 1 leer)', () => {
    const css = quelle('src/app/globals.css')
    const druck = css.slice(css.indexOf('@media print {'))
    assert.ok(druck.indexOf('.card:has(table) {\n    break-inside: auto;') > druck.indexOf('break-inside: avoid;'), 'Ausnahme steht nach der allgemeinen Regel für Karten')
    assert.match(druck, /thead \{ display: table-header-group; \}\n\s+tr    \{ break-inside: avoid; \}/)
  })
})

describe('KAN-467: Migration und Register', () => {
  const ordner = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(ordner).find(n => /_kan467_kellerplan_tank\.sql$/.test(n))
  const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan467_kellerplan_tank.sql')
  test('Spalte, genau eines von Gebinde und Tank, je Tank eine Position, Fremdverweis, Kammer-Schutz, Umstellung', () => {
    assert.ok(existsSync(pfad), 'Migration kan467_kellerplan_tank fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN tank_id uuid REFERENCES public\.gebinde_tanks\(id\) ON DELETE CASCADE,/)
    assert.match(sql, /ADD CONSTRAINT kellerplan_positionen_tank_unique UNIQUE \(tank_id\);/)
    assert.match(sql, /CHECK \(\(behaelter_id IS NULL\) <> \(tank_id IS NULL\)\)/)
    assert.match(sql, /CREATE TRIGGER z_fremdverweis_tank_id BEFORE INSERT OR UPDATE OF tank_id, tenant_id ON public\.kellerplan_positionen\n\s+FOR EACH ROW EXECUTE FUNCTION public\.s112_fremdverweis_pruefen\('tank_id', 'gebinde_tanks', '', '', ''\);/)
    assert.match(sql, /CREATE FUNCTION public\.s112_kellerplan_kammer_schutz\(\) RETURNS trigger\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_kellerplan_kammer_schutz\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(sql, /b\.tank_id IS NOT NULL AND b\.tenant_id = NEW\.tenant_id/, 'nur Kammern eigener Tanks – der Partner platziert freigegebene Kammern einzeln')
    assert.ok(sql.indexOf('INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id, tank_id') < sql.indexOf('ADD CONSTRAINT kellerplan_positionen_ziel_chk'), 'erst umstellen, dann die Regel')
    assert.match(sql, /values \(c_t, demo_musterhof_id\(17,1\), demo_musterhof_id\(68, 1\), 60, 72, 12, 26\);/)
  })
  test('Register: Schema, Fremdschlüssel, DB-Test-Sollwerte', () => {
    assert.equal(JSON.parse(quelle('scripts/schema.json')).kellerplan_positionen.at(-1), 'tank_id')
    const fk = JSON.parse(quelle('scripts/fremdschluessel.json'))
    assert.ok(fk.some(x => x.t === 'kellerplan_positionen' && x.s.join(',') === 'tank_id' && x.z === 'gebinde_tanks'))
    assert.ok(quelle('scripts/db-tests/_helfer.sql').includes("'s112_kellerplan_kammer_schutz()')"))
    assert.ok(existsSync(path.join(WURZEL, 'scripts/db-tests/99_kellerplan_tank.sql')))
  })
})
