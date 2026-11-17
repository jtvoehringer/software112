// KAN-481 (BKI-Sitzung 16.11.2026, Folge von KAN-480): Maßnahmen an der Maische werden in die Chargen mitgenommen –
// anteilig nach Litern, wenn aus der Maische n Chargen entstehen. Eine Maßnahme an der Maische ist eine
// Kellerbehandlung mit pressung_id statt Charge; die Anteile werden gerechnet, nicht gespeichert.
// Das Verhalten der Datenbank prüft scripts/db-tests/99_massnahmen_maische.sql (Staging).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { maischeAnteil, maischeAnteilZeilen, maischeVermerk, maischeMassnahmeFehler } from '../../src/lib/wein/maischeAnteile.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const beh = (id, pressungId, datum, menge, einheit = 'g', extra = {}) => ({ id, pressungId, datum, zeitpunkt: `${datum}T08:00:00Z`, behandlung: 'Schwefelung', menge, einheit, notizen: null, ...extra })

describe('KAN-481: Anteil der Charge an der Maische', () => {
  const most = [{ pressungId: 'm1', chargeId: 'A', liter: 600 }, { pressungId: 'm1', chargeId: 'B', liter: 400 }]
  test('Abnahme: Maische in zwei Chargen (60 % / 40 % der Liter) – jede führt die Maßnahme mit ihrem Anteil der Menge', () => {
    const b = [beh('k1', 'm1', '2027-09-22', 50)]
    const nr = new Map([['m1', 'M 2027/1']])
    const a = maischeAnteilZeilen('A', most, b, nr)
    assert.deepEqual(a.map(z => [z.chargeId, z.maische, z.anteilPct, z.mengeAnteil, z.menge, z.einheit]), [['A', 'M 2027/1', 60, 30, 50, 'g']])
    const bb = maischeAnteilZeilen('B', most, b, nr)
    assert.deepEqual(bb.map(z => [z.anteilPct, z.mengeAnteil]), [[40, 20]])
    // die Anteile der Chargen ergeben zusammen die Menge an der Maische
    assert.equal(a[0].mengeAnteil + bb[0].mengeAnteil, 50)
    assert.equal(maischeVermerk('M 2027/1', 40), 'an der Maische M 2027/1, Anteil 40 %')
    assert.equal(maischeVermerk('M 2027/1', 33.3), 'an der Maische M 2027/1, Anteil 33,3 %')
    assert.equal(maischeVermerk(null, 100), 'an der Maische, Anteil 100 %')
  })
  test('Anteil: Liter der Charge ÷ Liter aller Mostzeilen der Pressung; mehrere Mostzeilen einer Charge zählen zusammen', () => {
    assert.equal(maischeAnteil('A', 'm1', most), 0.6)
    assert.equal(maischeAnteil('A', 'm1', [...most, { pressungId: 'm1', chargeId: 'A', liter: 1000 }]), 0.8)
    assert.equal(maischeAnteil('X', 'm1', most), null, 'fremde Charge')
    assert.equal(maischeAnteil('A', 'm2', most), null, 'andere Pressung')
    assert.equal(maischeAnteil('A', 'm1', [{ pressungId: 'm1', chargeId: 'A', liter: 0 }]), null, 'ohne Most kein Anteil')
  })
  test('eine Mostzeile storniert (nicht hereingereicht): die übrige Charge trägt alles – ohne gespeicherte Anteile', () => {
    const nur = [{ pressungId: 'm1', chargeId: 'A', liter: 600 }]
    assert.deepEqual(maischeAnteilZeilen('A', nur, [beh('k1', 'm1', '2027-09-22', 50)]).map(z => [z.anteilPct, z.mengeAnteil]), [[100, 50]])
    assert.deepEqual(maischeAnteilZeilen('B', nur, [beh('k1', 'm1', '2027-09-22', 50)]), [], 'stornierte Charge übernimmt nichts mehr')
    assert.deepEqual(maischeAnteilZeilen('A', [], [beh('k1', 'm1', '2027-09-22', 50)]), [], 'Pressung storniert: Anteile verschwinden')
  })
  test('ohne Mengenangabe bleibt die Menge leer; Rundung auf 3 Stellen bzw. 1 Stelle; chronologisch', () => {
    const drei = [{ pressungId: 'm1', chargeId: 'A', liter: 1 }, { pressungId: 'm1', chargeId: 'B', liter: 2 }]
    const z = maischeAnteilZeilen('A', drei, [
      beh('k2', 'm1', '2027-09-23', 10), beh('k1', 'm1', '2027-09-22', null, null), beh('k3', 'm1', '2027-09-22', 1, 'kg', { zeitpunkt: '2027-09-22T07:00:00Z' }),
    ])
    assert.deepEqual(z.map(x => x.id), ['k3', 'k1', 'k2'])
    assert.deepEqual(z.map(x => [x.anteilPct, x.mengeAnteil]), [[33.3, 0.333], [33.3, null], [33.3, 3.333]])
  })
  test('Charge mit Most aus zwei Maischen: je Maische der eigene Anteil', () => {
    const m = [{ pressungId: 'm1', chargeId: 'A', liter: 500 }, { pressungId: 'm1', chargeId: 'B', liter: 500 }, { pressungId: 'm2', chargeId: 'A', liter: 300 }]
    const z = maischeAnteilZeilen('A', m, [beh('k1', 'm1', '2027-09-22', 40), beh('k2', 'm2', '2027-09-25', 40)], new Map([['m1', 'M 2027/1'], ['m2', 'M 2027/2']]))
    assert.deepEqual(z.map(x => [x.maische, x.anteilPct, x.mengeAnteil]), [['M 2027/1', 50, 20], ['M 2027/2', 100, 40]])
  })
})

describe('KAN-481: Datum der Maßnahme', () => {
  const offen = { beginn: '2027-09-20', offen: true, pressdatum: '2027-09-20', storniert: false }
  test('offene Maische: ab dem Beginn; abgepresst: bis zum Pressdatum; storniert bzw. keine Maische: nie', () => {
    assert.equal(maischeMassnahmeFehler({ ...offen, datum: '2027-09-20' }), null)
    assert.equal(maischeMassnahmeFehler({ ...offen, datum: '2027-09-27' }), null)
    assert.match(maischeMassnahmeFehler({ ...offen, datum: '2027-09-19' }), /außerhalb der Maischezeit \(20\.09\.2027 bis heute\)/)
    const zu = { beginn: '2027-09-20', offen: false, pressdatum: '2027-09-28', storniert: false }
    assert.equal(maischeMassnahmeFehler({ ...zu, datum: '2027-09-28' }), null, 'am Pressdatum noch möglich (Nachtrag)')
    assert.match(maischeMassnahmeFehler({ ...zu, datum: '2027-09-29' }), /außerhalb der Maischezeit \(20\.09\.2027 bis 28\.09\.2027\)/)
    assert.match(maischeMassnahmeFehler({ ...offen, storniert: true, datum: '2027-09-21' }), /Maische ist storniert/)
    assert.match(maischeMassnahmeFehler({ beginn: null, offen: false, pressdatum: '2027-09-28', storniert: false, datum: '2027-09-28' }), /keine Maische/)
  })
})

describe('KAN-481: Verdrahtung', () => {
  test('Speichern: Maische statt Charge, Gebinde von der Maische, Datum geprüft, pressung_id im Datensatz, Stoffkonto wie bisher', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    assert.ok(a.includes("const maischeId = ((formData.get('pressung_id') as string) || '').trim() || null"))
    assert.ok(a.includes(".eq('id', maischeId).eq('tenant_id', tenantId).maybeSingle()"), 'nur eine Maische des eigenen Betriebs')
    assert.ok(a.includes('behaelterId = (maische.maische_behaelter_id as string | null) ?? null'))
    assert.ok(a.includes('const mf = maischeMassnahmeFehler({'))
    assert.ok(a.includes('const ohneCharge = maische ? null : behandlungOhneChargeFehler(weinausbauId, typ.gebindepflege === true)'))
    assert.ok(a.includes('...(maische ? { pressung_id: maischeId } : {}),'))
    assert.ok(a.includes("keller_behandlung_id: neueId, weinausbau_id: weinausbauId, behaelter_id: behaelterId, zweck: typ.name as string,"), 'Verwendung im Stoffkonto unverändert')
    assert.ok(a.indexOf('const tenantId = await kellerbuchSchreibrecht()') < a.indexOf('const maischeId ='), 'Schreibrecht vor dem ersten Zugriff')
  })
  test('Erfassen bei der Maische (Lese › Pressungen); die Charge zeigt den Abschnitt „An der Maische“', () => {
    const p = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    assert.ok(p.includes('{p.maische && !p.storno && (\n                      <MaischeMassnahmen pressungId={p.id}'))
    const m = quelle('src/app/(dashboard)/erntemeldung/[id]/MaischeMassnahmen.tsx')
    assert.ok(m.includes("fd.set('pressung_id', pressungId)") && m.includes('await createKellerbehandlung(fd)'))
    assert.ok(m.includes("if (stoffId) { fd.set('kellermittel_id', stoffId); fd.set('kellermittel_menge', stoffMenge) }"))
    assert.ok(m.includes('deleteKellerbehandlung(b.id, grund)'), 'Storno statt Löschen')
    assert.ok(m.includes('} finally {\n      setSpeichert(false)'))
    assert.ok(m.includes('filter(x => x.gebindepflege !== true)'))
    const k = quelle('src/app/(dashboard)/kellerbuch/_behandlungen/Kellerbehandlungen.tsx')
    assert.ok(k.includes('const an = await ladeMaischeAnteile(supabase, activeTenantId, [chargeId])'))
    assert.ok(k.includes('<h2 className="text-sm font-semibold text-s112-text">An der Maische</h2>'))
    assert.ok(k.includes('{maischeVermerk(z.maische, z.anteilPct)}'))
  })
  test('Weinbuch und Meldung „Kellerbehandlungen“ führen die anteiligen Maßnahmen mit Vermerk', () => {
    const w = quelle('src/lib/wein/weinbuch.ts')
    assert.ok(w.includes("const anteile = await ladeMaischeAnteile(supabase, tenantId, [String(wa.id)])"))
    assert.ok(w.includes('_vermerk: `${maischeVermerk(z.maische, z.anteilPct)}'))
    assert.ok(quelle('src/lib/wein/weinbuchDaten.ts').includes('mostgewicht_einheit, maische_beginn,'))
    const m = quelle('src/lib/behoerden/keller-behandlungen.ts')
    assert.ok(m.includes('const anteile = await ladeMaischeAnteile(supabase, tenantId, chargen.map(c => c.id))'))
    assert.ok(m.includes("notizen: [maischeVermerk(z.maische, z.anteilPct), z.notizen].filter(Boolean).join(' – '),"))
    assert.ok(m.includes('if ((p.von && z.datum < p.von) || (p.bis && z.datum > p.bis)) continue'), 'Zeitraum gilt auch für die anteiligen Zeilen')
    assert.ok(m.includes('ohneChargeHinweis(data.filter(b => !b.weinausbau_id && !b.pressung_id).length)'), 'Maßnahmen an der Maische sind keine Gebindepflege')
  })
  test('„ohne Charge“ = Gebindepflege: Maßnahmen an der Maische erscheinen dort nirgends', () => {
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/_behandlungen/Kellerbehandlungen.tsx').includes(".is('weinausbau_id', null).is('pressung_id', null)"))
    assert.equal((quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/page.tsx').match(/and\(weinausbau_id\.is\.null,pressung_id\.is\.null,behaelter_id\.eq\.\$\{id\}\)/g) ?? []).length, 2)
    assert.ok(quelle('src/lib/wein/weinbuch.ts').includes(".is('weinausbau_id', null)\n      .is('pressung_id', null)"))
    assert.ok(quelle('scripts/daten-abgleich.sql').includes('k.weinausbau_id is null and k.pressung_id is null and coalesce(t.gebindepflege, false) = false'))
  })
  test('Laden: nur eigene, nicht stornierte Maischen, Mostzeilen und Behandlungen – vollständig und in Blöcken', () => {
    const l = quelle('src/lib/kellerbuch/maischeMassnahmen.ts')
    const anteile = l.slice(l.indexOf('export async function ladeMaischeAnteile'), l.indexOf('/** Maßnahmen einer Maische'))
    assert.equal((anteile.match(/\.is\('storniert_am', null\)/g) ?? []).length, 4)
    assert.equal((anteile.match(/inBloecken<R>\(/g) ?? []).length, 4)
    assert.ok(anteile.includes(".eq('tenant_id', tenantId).not('maische_beginn', 'is', null).is('storniert_am', null)"))
    assert.ok(anteile.includes(".in('pressung_id', bl).eq('tenant_id', tenantId).is('storniert_am', null).order('datum').order('created_at').order('id')"))
    assert.ok(!l.includes('alle-ausnahme'))
  })
})

describe('KAN-481: Migration', () => {
  const ordner = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(ordner).find(n => /_kan481_massnahmen_maische\.sql$/.test(n))
  const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan481_massnahmen_maische.sql')
  test('Verweis auf die Maische mit Index und Fremdverweis-Schutz; entweder Charge oder Maische; Regel nach der Rechteprüfung', () => {
    assert.ok(existsSync(pfad), 'Migration kan481_massnahmen_maische fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.ok(sql.includes('ADD COLUMN pressung_id uuid REFERENCES public.pressungen(id) ON DELETE SET NULL;'))
    assert.ok(sql.includes('CHECK (pressung_id IS NULL OR weinausbau_id IS NULL)'))
    assert.ok(sql.includes('CREATE INDEX keller_behandlungen_pressung_id ON public.keller_behandlungen (pressung_id);'), 'Index zum Fremdschlüssel (DB-Test 78)')
    assert.ok(sql.includes("EXECUTE FUNCTION public.s112_fremdverweis_pruefen('pressung_id', 'pressungen', '', '', '');"), 'Fremdverweis-Schutz (DB-Test 11)')
    assert.ok(sql.includes('CREATE TRIGGER z_charge_pflicht AFTER INSERT OR UPDATE OF weinausbau_id, behaelter_id, typ_id, pressung_id, datum ON public.keller_behandlungen'))
    assert.ok(sql.includes('SELECT p.maische_behaelter_id INTO NEW.behaelter_id FROM public.pressungen p WHERE p.id = NEW.pressung_id;'))
    // die Regel aus KAN-475 bleibt wörtlich erhalten
    assert.ok(sql.includes("RAISE EXCEPTION 'Kellerbehandlungen werden an der Charge erfasst. Ohne Charge ist am Gebinde nur Gebindepflege möglich (Reinigen, Konservieren, Umbenennung, Notiz).'"))
    for (const f of ['s112_behandlung_an_charge()', 's112_behandlung_gebinde_von_charge()']) {
      assert.ok(sql.includes(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`), f)
    }
    assert.ok(sql.includes("'weinausbau_id', 'behaelter_id', 'pressung_id', 'tenant_id', 'storniert_am'"), 'Protokoll schreibt die Maische-Zuordnung mit')
    assert.ok(!new RegExp(['session_replication', '_role|DISABLE', ' TRIGGER'].join(''), 'i').test(sql))
    const schema = JSON.parse(quelle('scripts/schema.json'))
    assert.ok(schema.keller_behandlungen.includes('pressung_id'))
    assert.ok(quelle('scripts/fremdschluessel.json').includes('"keller_behandlungen_pressung_id_fkey"'))
  })
})
