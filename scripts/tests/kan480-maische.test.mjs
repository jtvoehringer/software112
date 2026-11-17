// KAN-480 (BKI-Sitzung 16.11.2026, Folge von KAN-477): Maische als eigene Stufe zwischen Ernte und Charge – n Ernten
// werden gemeinsam angesetzt und später in n Chargen abgepresst. Eine Maische ist eine Pressung in zwei Schritten
// (Traubenzeilen sofort, Mostzeilen beim Abpressen). Geprüft: Regeln, Nummer, Stichtag, Verdrahtung, Migration.
// Das Verhalten der Datenbank prüft scripts/db-tests/99_maische.sql (Staging).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  maischeNummer, maischeZeilenFehler, maischeUebergangFehler, maischeOffen, maischeOffenAm, maischeBestandHinweis,
  MAISCHE_OHNE_MOST,
} from '../../src/lib/wein/maische.ts'
import { pressungZeilenFehler } from '../../src/lib/wein/lesePflicht.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-480: Regeln der Maische', () => {
  test('Nummer „M Jahrgang/Nr“; ohne Angabe keine', () => {
    assert.equal(maischeNummer(2027, 1), 'M 2027/1')
    assert.equal(maischeNummer('2027', 12), 'M 2027/12')
    assert.equal(maischeNummer(null, 1), null)
    assert.equal(maischeNummer(2027, null), null)
  })
  test('Zeilen: Maische braucht Trauben, aber weder Behälterzeilen noch Mostausbeute; die Pressung unverändert beides', () => {
    assert.equal(maischeZeilenFehler(true, 2, 0, null), null)
    assert.equal(maischeZeilenFehler(true, 2, 0, NaN), null)
    assert.match(maischeZeilenFehler(true, 0, 0, null), /mindestens eine Traubenzeile/)
    assert.equal(maischeZeilenFehler(true, 2, 1, null), MAISCHE_OHNE_MOST)
    assert.equal(maischeZeilenFehler(true, 2, 0, 500), MAISCHE_OHNE_MOST)
    // ohne Maische dieselbe Regel wie bisher (KAN-205) – auch beim Abpressen
    for (const [t, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [3, 2]]) assert.equal(maischeZeilenFehler(false, t, b, 100), pressungZeilenFehler(t, b))
    assert.match(maischeZeilenFehler(false, 1, 0, 100), /mindestens eine Behälterzeile/)
  })
  test('Übergänge: offen bleiben nur mit festem Beginn; abpressen nie vor dem Beginn; nie zurück zur Maische', () => {
    const offen = { offen: true, beginn: '2027-09-20' }
    assert.equal(maischeUebergangFehler({ ...offen, modus: true, datum: '2027-09-20' }), null)
    assert.match(maischeUebergangFehler({ ...offen, modus: true, datum: '2027-09-21' }), /Beginn der Maische \(20\.09\.2027\) steht fest/)
    assert.equal(maischeUebergangFehler({ ...offen, modus: false, datum: '2027-09-28' }), null)
    assert.equal(maischeUebergangFehler({ ...offen, modus: false, datum: '2027-09-20' }), null, 'am selben Tag abpressen ist erlaubt')
    assert.match(maischeUebergangFehler({ ...offen, modus: false, datum: '2027-09-19' }), /nicht vor dem Beginn der Maische \(20\.09\.2027\)/)
    // Direktpressung bzw. abgepresste Maische
    assert.equal(maischeUebergangFehler({ modus: false, offen: false, beginn: null, datum: '2027-09-20' }), null)
    assert.match(maischeUebergangFehler({ modus: true, offen: false, beginn: null, datum: '2027-09-20' }), /nicht nachträglich zur Maische/)
    assert.match(maischeUebergangFehler({ modus: true, offen: false, beginn: '2027-09-20', datum: '2027-09-28' }), /nicht nachträglich zur Maische/)
  })
  test('offen: nur angesetzt und nicht storniert', () => {
    assert.equal(maischeOffen({ maische_offen: true, storniert_am: null }), true)
    assert.equal(maischeOffen({ maische_offen: true, storniert_am: '2027-09-21T08:00:00Z' }), false)
    assert.equal(maischeOffen({ maische_offen: false }), false)
    assert.equal(maischeOffen(null), false)
  })
  test('Stichtag der Bestandsmeldung: unverpresst am Stichtag = angesetzt bis dahin und offen bzw. erst danach abgepresst', () => {
    const m = (x) => ({ maische_beginn: '2027-07-25', maische_offen: false, datum: '2027-08-03', ...x })
    assert.equal(maischeOffenAm(m({}), '2027-07-31'), true, 'erst am 03.08. abgepresst')
    assert.equal(maischeOffenAm(m({ datum: '2027-07-31' }), '2027-07-31'), false, 'am Stichtag abgepresst')
    assert.equal(maischeOffenAm(m({ maische_offen: true, datum: '2027-07-25' }), '2027-07-31'), true, 'noch offen')
    assert.equal(maischeOffenAm(m({ maische_beginn: '2027-08-01', maische_offen: true }), '2027-07-31'), false, 'erst nach dem Stichtag angesetzt')
    assert.equal(maischeOffenAm(m({ storniert_am: '2027-07-26T08:00:00Z' }), '2027-07-31'), false)
    assert.equal(maischeOffenAm({ maische_beginn: null, datum: '2027-08-03' }, '2027-07-31'), false, 'Direktpressung')
    assert.equal(maischeBestandHinweis(0, '31.07.2027'), null)
    assert.match(maischeBestandHinweis(1, '31.07.2027'), /^Am 31\.07\.2027 lag 1 Maische noch unverpresst im Keller – Maische zählt nicht als Weinbestand\./)
    assert.match(maischeBestandHinweis(3, '31.07.2027'), /lagen 3 Maischen/)
  })
})

describe('KAN-480: Verdrahtung', () => {
  const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
  test('Speichern: Maische ohne Most-/Behälterprüfung, mit Gebinde; Abpressen schließt die Maische vor den Mostzeilen', () => {
    assert.ok(a.includes("const maischeModus      = fd.get('maische') === '1'"))
    assert.ok(a.includes('maischeZeilenFehler(maischeModus, weingaerten.length, behaelter.length, mostLiter)'))
    assert.ok(a.includes("maischeUebergangFehler({ modus: maischeModus, offen: kopfAlt.maische_offen === true"))
    assert.ok(a.includes('} else if (maischeModus && !maischeBehaelter) {\n    throw new AktionsFehler(MAISCHE_GEBINDE_FEHLT)'))
    assert.ok(a.includes('const abpressen = !!existingId && kopfAlt?.maische_offen === true && !maischeModus'))
    assert.ok(a.includes('  if (!maischeModus) {\n    const mengenGeaendert = !existingId'), 'Most muss nur außerhalb der Maische vollständig in Behälter')
    assert.ok(a.includes("...(abpressen ? { maische_offen: false } : {})"))
    assert.ok(a.includes('...(maischeModus ? { maische_beginn: datum, maische_behaelter_id: maischeBehaelter } : {}),'))
    // Reihenfolge beim Bearbeiten: Kopf (Maische schließen) vor den neuen Mostzeilen – sonst lehnt die Datenbank ab
    assert.ok(a.indexOf('// 3. Kopfdaten') < a.indexOf('// 5. Neue Traubenzeilen einer bestehenden Pressung'))
  })
  test('Formular: Ankreuzen „Maische ansetzen“ bzw. „Jetzt abpressen“; im Maische-Modus kein Most, keine Behälterzeilen', () => {
    const p = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    assert.ok(p.includes("const [maische, setMaische] = useState(offeneMaische && !abpressen)"))
    assert.ok(p.includes("fd.append('maische', '1')") && p.includes("fd.append('maische_behaelter_id', maischeBehaelter)"))
    assert.ok(p.includes("fd.append('most_liter_gesamt', maische ? '' : mostLiter)"))
    assert.ok(p.includes('(maische ? [] : behRows).filter('))
    assert.ok(p.includes('{!maische && (<>'))
    assert.ok(p.includes("'Maische ansetzen – erst später abpressen (Rotwein)'") && p.includes("'Jetzt abpressen'"))
    assert.ok(p.includes('>Abpressen</button>'))
    assert.ok(p.includes('disabled={maische && offeneMaische}'), 'der Beginn einer angesetzten Maische ist nicht änderbar')
    const l = quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts')
    assert.ok(l.includes('maische_behaelter:behaelter!pressungen_maische_behaelter_id_fkey(name)'))
    assert.ok(l.includes("offen: p.maische_offen === true && !p.storniert_am"))
  })
  test('Gebinde gilt als belegt: Gebinde-Seite und Übersicht zeigen die Maische; Bestandsmeldungen mit Hinweis', () => {
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/page.tsx').includes('offeneMaischeJeGebinde(await ladeMaischen(supabase, tenantId as string)).get(id)'))
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/page.tsx').includes('maischeJeGebinde.get(b.id) && ('))
    assert.ok(quelle('src/lib/behoerden/bestandsmeldung.ts').includes('maischenOffenAm(await ladeMaischen(supabase, tenantId), stichtag)'))
    assert.ok(quelle('src/lib/behoerden/bsm.ts').includes('maischenOffenAm(await ladeMaischen(supabase, tenantId), z.bis)'))
    const m = quelle('src/lib/kellerbuch/maischen.ts')
    assert.ok(m.includes(".eq('tenant_id', tenantId).not('maische_beginn', 'is', null).is('storniert_am', null)"), 'nur eigene, nicht stornierte Maischen')
    assert.equal((m.match(/\.is\('storniert_am', null\)/g) ?? []).length, 2, 'auch stornierte Traubenzeilen zählen nicht')
    assert.ok(m.includes('const kopf = await alle<R>(') && m.includes('await inBloecken<R>('))
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/ErntenKarte.tsx').includes('Gemeinsam gemaischt: '))
  })
})

describe('KAN-480: Migration', () => {
  const ordner = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(ordner).find(n => /_kan480_maische\.sql$/.test(n))
  const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan480_maische.sql')
  test('vier Spalten an der Pressung, Nummer je Jahrgang eindeutig, Schutz-Trigger nach der Rechteprüfung', () => {
    assert.ok(existsSync(pfad), 'Migration kan480_maische fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.ok(sql.includes('ADD COLUMN maische_behaelter_id uuid REFERENCES public.behaelter(id),'))
    assert.ok(sql.includes('ADD COLUMN maische_offen        boolean NOT NULL DEFAULT false;'))
    assert.ok(sql.includes('CREATE UNIQUE INDEX pressungen_jahrgang_maische_nr ON public.pressungen (jahrgang_id, maische_nr) WHERE maische_nr IS NOT NULL;'))
    assert.ok(sql.includes('CREATE INDEX pressungen_maische_behaelter_id ON public.pressungen (maische_behaelter_id);'), 'Index zum Fremdschlüssel (DB-Test 78)')
    assert.ok(sql.includes("EXECUTE FUNCTION public.s112_fremdverweis_pruefen('maische_behaelter_id', 'behaelter', 'keller', '', '');"), 'Fremdverweis-Schutz (DB-Test 11)')
    assert.ok(sql.includes('CHECK (maische_beginn IS NULL OR maische_beginn <= datum)'))
    assert.ok(sql.includes('CREATE TRIGGER b_maische_nr BEFORE INSERT OR UPDATE OF maische_nr ON public.pressungen'))
    // fachliche Regeln als AFTER-Trigger: erst nach der Rechteprüfung (RLS), wie KAN-475
    assert.ok(sql.includes('CREATE TRIGGER z_maische_pruefen AFTER INSERT OR UPDATE OF maische_beginn, maische_behaelter_id, maische_offen ON public.pressungen'))
    assert.ok(sql.includes('CREATE TRIGGER z_maische_gebinde AFTER INSERT OR UPDATE OF behaelter_id ON public.weinausbau'))
    assert.ok(sql.includes('CREATE TRIGGER z_maische_offen AFTER INSERT ON public.pressung_behaelter'))
    for (const f of ['s112_maische_nummer()', 's112_maische_pruefen()', 's112_maische_gebinde_belegt()', 's112_maische_mostzeile()']) {
      assert.ok(sql.includes(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`), f)
    }
    // s112_pressung_anlegen behält Zugriffs-, Lesebereichs-, Abo- und Schreibrechtsprüfung
    const rpc = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.s112_pressung_anlegen'))
    for (const s of ["pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer'])", "s112_pruefe_lesen(p_tenant_id, 'lese')", 's112_pruefe_abo_schreibsperre(p_tenant_id)', "s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch', 'rieden'])"]) assert.ok(rpc.includes(s), s)
    assert.ok(!new RegExp(['session_replication', '_role|DISABLE', ' TRIGGER'].join(''), 'i').test(sql))
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const c of ['maische_nr', 'maische_beginn', 'maische_behaelter_id', 'maische_offen']) assert.ok(schema.pressungen.includes(c), c)
    assert.ok(quelle('scripts/fremdschluessel.json').includes('"pressungen_maische_behaelter_id_fkey"'))
  })
})
