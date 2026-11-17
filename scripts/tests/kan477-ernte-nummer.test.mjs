// KAN-477 S1 (BKI-Sitzung 16.11.2026, Rückverfolgung): Jede Ernte (Lesedaten-Zeile) hat eine sichtbare Nummer je Lese
// („2026/2-03“); die Traubenzeilen einer Pressung kennen ihre Ernte; die Charge zeigt ihre Ernten mit kg-Anteil.
// Geprüft wird: Nummernformat, Anteilsrechnung (n Ernten → 1 Pressung → n Chargen), Lesedaten-CSV, Verdrahtung, Migration.
// Das Verhalten der Datenbank prüft scripts/db-tests/99_ernte_nummer.sql (Staging).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ernteAnteile, ernteNummer } from '../../src/lib/kellerbuch/chargeErnten.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-477: Nummer der Ernte', () => {
  test('Jahrgang/Lese-Ernte, Ernte zweistellig; ohne eine der Angaben keine Nummer', () => {
    assert.equal(ernteNummer(2026, 2, 3), '2026/2-03')
    assert.equal(ernteNummer('2027', 1, 12), '2027/1-12')
    assert.equal(ernteNummer(2027, 1, 105), '2027/1-105')
    assert.equal(ernteNummer(null, 1, 3), null)
    assert.equal(ernteNummer(2027, null, 3), null)
    assert.equal(ernteNummer(2027, 1, null), null)
  })
})

describe('KAN-477: Ernten der Charge mit kg-Anteil', () => {
  test('zwei Ernten gemeinsam verpresst, Most in zwei Chargen (60 % / 40 %): jede Charge trägt beide Ernten anteilig', () => {
    const most = [{ pressungId: 'p1', chargeId: 'A', liter: 1500 }, { pressungId: 'p1', chargeId: 'B', liter: 1000 }]
    const trauben = [{ pressungId: 'p1', ernteId: 'e1', kg: 2000 }, { pressungId: 'p1', ernteId: 'e2', kg: 1000 }]
    const a = ernteAnteile('A', most, trauben)
    assert.deepEqual(a, { anteile: [{ ernteId: 'e1', kg: 1200, prozent: 66.7 }, { ernteId: 'e2', kg: 600, prozent: 33.3 }], gesamtKg: 1800, ohneErnteKg: 0 })
    const b = ernteAnteile('B', most, trauben)
    assert.deepEqual(b.anteile.map(x => x.kg), [800, 400])
    // die Anteile der Chargen ergeben zusammen die verpressten kg
    assert.equal(a.gesamtKg + b.gesamtKg, 3000)
  })
  test('eine Charge aus zwei Pressungen: dieselbe Ernte wird summiert', () => {
    const most = [{ pressungId: 'p1', chargeId: 'A', liter: 500 }, { pressungId: 'p2', chargeId: 'A', liter: 300 }, { pressungId: 'p2', chargeId: 'B', liter: 300 }]
    const trauben = [{ pressungId: 'p1', ernteId: 'e1', kg: 700 }, { pressungId: 'p2', ernteId: 'e1', kg: 400 }, { pressungId: 'p2', ernteId: 'e3', kg: 600 }]
    assert.deepEqual(ernteAnteile('A', most, trauben).anteile, [{ ernteId: 'e1', kg: 900, prozent: 75 }, { ernteId: 'e3', kg: 300, prozent: 25 }])
  })
  test('Traubenzeilen ohne Ernte (Zukauf, alte Pressung) zählen im Gesamt, aber nicht als Ernte', () => {
    const most = [{ pressungId: 'p1', chargeId: 'A', liter: 1000 }]
    const r = ernteAnteile('A', most, [{ pressungId: 'p1', ernteId: 'e1', kg: 750 }, { pressungId: 'p1', ernteId: null, kg: 250 }])
    assert.deepEqual(r, { anteile: [{ ernteId: 'e1', kg: 750, prozent: 75 }], gesamtKg: 1000, ohneErnteKg: 250 })
  })
  test('fremde Charge, Pressung ohne Liter und leere Eingaben ergeben nichts', () => {
    assert.deepEqual(ernteAnteile('X', [{ pressungId: 'p1', chargeId: 'A', liter: 100 }], [{ pressungId: 'p1', ernteId: 'e1', kg: 100 }]), { anteile: [], gesamtKg: 0, ohneErnteKg: 0 })
    assert.deepEqual(ernteAnteile('A', [{ pressungId: 'p1', chargeId: 'A', liter: 0 }], [{ pressungId: 'p1', ernteId: 'e1', kg: 100 }]).anteile, [])
    assert.deepEqual(ernteAnteile('A', [], []).anteile, [])
  })
})

describe('KAN-477: Verdrahtung', () => {
  test('Lesedaten: Nummer geladen, in der Liste gezeigt und als letzte CSV-Spalte (bisherige Positionen bleiben)', () => {
    const e = quelle('src/lib/behoerden/erntemeldung.ts')
    assert.ok(e.includes(".select('id, lfd_nr, lese_id, lese:lesen!ernte_parzellen_lese_fkey("))
    assert.ok(e.includes('ernteNr: ernteNummer(jahr, nr, ernteLfdNr)'))
    const spalten = e.slice(e.indexOf('export const SPALTEN_LESEDATEN'), e.indexOf('export function ohneStornierteLese'))
    const koepfe = [...spalten.matchAll(/kopf: '([^']+)'/g)].map(m => m[1])
    assert.equal(koepfe[0], 'Lesedatum')
    assert.equal(koepfe.at(-1), 'Ernte-Nr.')
    assert.equal(koepfe.at(-2), 'Weinbaugebiet')
    assert.ok(quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts').includes('ernte_nr: z.ernteNr'))
    assert.ok(quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx').includes('Ernte {p.ernte_nr}'))
  })
  test('Chargen-Seite: Karte „Ernten dieser Charge“ – nur eigene, nicht stornierte Pressungen, Mostzeilen und Traubenzeilen', () => {
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx').includes('<ErntenKarte supabase={supabase} tenantId={tenantId} chargeId={weinausbau.id} />'))
    const k = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/ErntenKarte.tsx')
    assert.ok(k.includes(".select('id, datum, maische_nr, maische_beginn, jahrgang:jahrgang_id(jahrgang)').in('id', bl).eq('tenant_id', tenantId).is('storniert_am', null).order('id'))"))   // KAN-480: Maische der Pressung
    // vollständig und in Blöcken – ein Teilergebnis ergäbe falsche Anteile
    assert.equal((k.match(/inBloecken<R>\(/g) ?? []).length, 3)
    assert.ok(k.includes('const eigene = await alle<R>('))
    assert.ok(!k.includes('alle-ausnahme'))
    assert.equal((k.match(/\.is\('storniert_am', null\)/g) ?? []).length, 4)
    assert.ok(k.includes('(id, lfd_nr, ernte_datum, storniert_am, lese:'), 'Storno der Ernte wird mitgeladen')
    assert.ok(k.includes('ernte:ernte_parzellen!pressung_weingaerten_ernte_parzelle_id_fkey('))
    assert.ok(k.includes('if (ergebnis.anteile.length === 0) return null'), 'ältere Pressungen ohne Zuordnung: keine Karte')
    assert.ok(quelle('scripts/fremdschluessel.json').includes('"pressung_weingaerten_ernte_parzelle_id_fkey"'))
  })
})

describe('KAN-477: Ernte-Nummer in der Rückverfolgung einer Füllung', () => {
  const r = quelle('src/lib/behoerden/rueckverfolgung.ts')
  test('Traubenzeile lädt ihre Ernte samt Storno; die Nummer steht in der Zeile, am Bildschirm und als letzte CSV-Spalte', () => {
    assert.ok(r.includes('ernte:ernte_parzellen!pressung_weingaerten_ernte_parzelle_id_fkey(lfd_nr, storniert_am, lese:lesen!ernte_parzellen_lese_fkey(lfd_nr, jahrgang:weinjahrgaenge!lesen_jahrgang_fkey(jahrgang)))'))
    assert.ok(r.includes('ernteNr: ernteNrDerTraubenzeile(wg),'))
    const spalten = r.slice(r.indexOf('export const SPALTEN_RUECKVERFOLGUNG:'), r.indexOf('export const SPALTEN_RUECKVERFOLGUNG_TREFFER'))
    const koepfe = [...spalten.matchAll(/kopf: '([^']+)'/g)].map(m => m[1])
    assert.deepEqual(koepfe.slice(-2), ['Prüfnummer (Tank)', 'Ernte-Nr.'])
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/rueckverfolgung/page.tsx').includes('<span>Ernte {ernteNrDerTraubenzeile(wg)}</span>'))
  })
  test('Nummer aus Jahrgang, Lese und Ernte; ohne Zuordnung oder bei stornierter Ernte leer', () => {
    // die Werte selbst prüft kellerbuch.test.mjs („Füllung × Ursprung“: 2024/1-03, stornierte Ernte leer)
    const f = r.slice(r.indexOf('export function ernteNrDerTraubenzeile'), r.indexOf('export function ernteNrDerTraubenzeile') + 600)
    assert.ok(f.includes('if (!e || e.storniert_am) return null'))
    assert.ok(f.includes('return ernteNummer('))
    assert.equal(ernteNummer(2027, 1, 3), '2027/1-03')
  })
})

describe('KAN-477: Migration', () => {
  const ordner = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(ordner).find(n => /_kan477_ernte_nummer\.sql$/.test(n))
  const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan477_ernte_nummer.sql')
  test('Nummer je Lese eindeutig, vom Trigger vergeben; Zuordnung der Traubenzeile setzt die Datenbank selbst', () => {
    assert.ok(existsSync(pfad), 'Migration kan477_ernte_nummer fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.ok(sql.includes('CREATE UNIQUE INDEX ernte_parzellen_lese_lfd_nr ON public.ernte_parzellen (lese_id, lfd_nr);'))
    assert.ok(sql.includes('CREATE TRIGGER b_ernte_nummer BEFORE INSERT OR UPDATE OF lfd_nr, lese_id ON public.ernte_parzellen'), 'b_… läuft nach a_lese_zuordnen')
    assert.ok(sql.includes('ALTER TABLE public.pressung_weingaerten ADD COLUMN ernte_parzelle_id uuid REFERENCES public.ernte_parzellen(id);'))
    assert.ok(sql.includes('CREATE INDEX pressung_weingaerten_ernte_parzelle_id ON public.pressung_weingaerten (ernte_parzelle_id);'), 'Index zum Fremdschlüssel (DB-Test 78)')
    assert.ok(sql.includes('CREATE TRIGGER z_fremdverweis_ernte_parzelle_id BEFORE INSERT OR UPDATE OF ernte_parzelle_id, weingarten_id, grundstueck_id, ernte_datum, pressung_id'))
    assert.ok(sql.includes('NEW.ernte_parzelle_id := NULL;'), 'eine Angabe des Aufrufers zählt nie')
    assert.ok(sql.includes('WHERE e.lese_id = v_lese AND e.storniert_am IS NULL AND e.weingarten_id = NEW.weingarten_id'))
    for (const f of ['s112_ernte_nummer()', 's112_pressung_ernte_zuordnen()']) {
      assert.ok(sql.includes(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`), f)
    }
    // keine verbotenen Abkürzungen beim Durchnummerieren des Bestands
    assert.ok(!new RegExp(['session_replication', '_role|DISABLE', ' TRIGGER'].join(''), 'i').test(sql))
    const schema = JSON.parse(quelle('scripts/schema.json'))
    assert.ok(schema.ernte_parzellen.includes('lfd_nr') && schema.pressung_weingaerten.includes('ernte_parzelle_id'))
  })
})
