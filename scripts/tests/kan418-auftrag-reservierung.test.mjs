// KAN-418 Teil 1 (12.11.2026): Aufträge mit Bestandsreservierung – Regeln und Verdrahtung.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUFTRAG_POSITIONEN_MAX, RESERVIERUNG_TAGE, auftragFehler, auftragPositionenAus, fristFehler, reserviertBisVorschlag, reserviertJeFuellung,
  reservierungAbgelaufen, stornoGrundFehlerAuftrag, tagPlus, verfuegbar,
} from '../../src/lib/auftrag/regeln.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'
const HEUTE = '2026-11-12'
const kopf = (mehr = {}) => ({ kunde: `kontakt:${F1}`, datum: HEUTE, reserviert_bis: '2026-11-26', notizen: null, ...mehr })

// Migration: eingecheckt unter supabase/migrations/<version>_<name>.sql, vor dem Einspielen im (nicht eingecheckten) Entwurfsordner
function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}

describe('KAN-418: Positionen aus dem Formular', () => {
  test('leere Zeilen fallen weg, Mengen als Zahl oder Ziffernfolge', () => {
    const p = auftragPositionenAus(JSON.stringify([{ fuellung_id: F1, menge: '12' }, { fuellung_id: '', menge: '' }, { fuellung_id: F2, menge: 6 }]))
    assert.deepEqual(p, [{ fuellung_id: F1, menge: 12 }, { fuellung_id: F2, menge: 6 }])
  })
  test('nicht lesbar: kein Text, kein JSON, kein Feld, keine UUID', () => {
    for (const roh of [null, undefined, 5, '{', '{}', '[1]', JSON.stringify([{ fuellung_id: 'abc', menge: 1 }])]) assert.equal(auftragPositionenAus(roh), null, String(roh))
  })
  test('Komma, Minus und Text als Menge werden nicht still zu einer Zahl', () => {
    for (const menge of ['1,5', '-3', 'zwölf', '1e3', ' ']) {
      const p = auftragPositionenAus(JSON.stringify([{ fuellung_id: F1, menge }]))
      assert.ok(p && Number.isNaN(p[0].menge), menge)
      assert.match(auftragFehler(kopf(), p, HEUTE), /Menge ab 1 Flasche/)
    }
  })
})

describe('KAN-418: Prüfung des Auftrags', () => {
  const pos = [{ fuellung_id: F1, menge: 6 }]
  test('gültiger Auftrag', () => assert.equal(auftragFehler(kopf(), pos, HEUTE), null))
  test('Kunde, Datum und Frist', () => {
    assert.match(auftragFehler(kopf({ kunde: '' }), pos, HEUTE), /Kunden wählen/)
    assert.match(auftragFehler(kopf({ datum: '' }), pos, HEUTE), /Auftragsdatum angeben/)
    assert.match(auftragFehler(kopf({ datum: '2026-11-13' }), pos, HEUTE), /nicht in der Zukunft/)
    assert.match(auftragFehler(kopf({ reserviert_bis: '' }), pos, HEUTE), /reserviert bleiben/)
    assert.match(auftragFehler(kopf({ reserviert_bis: '2026-11-11' }), pos, HEUTE), /mindestens bis heute/)
    assert.equal(auftragFehler(kopf({ reserviert_bis: HEUTE }), pos, HEUTE), null)
    assert.match(auftragFehler(kopf({ notizen: 'x'.repeat(2001) }), pos, HEUTE), /höchstens 2000 Zeichen/)
  })
  test('Positionen: keine, zu viele, ohne Füllung, Menge 0', () => {
    assert.match(auftragFehler(kopf(), null, HEUTE), /nicht gelesen/)
    assert.match(auftragFehler(kopf(), [], HEUTE), /mindestens eine Position/)
    assert.match(auftragFehler(kopf(), Array.from({ length: AUFTRAG_POSITIONEN_MAX + 1 }, () => pos[0]), HEUTE), /Höchstens 100 Positionen/)
    assert.match(auftragFehler(kopf(), [{ fuellung_id: '', menge: 3 }], HEUTE), /Füllung wählen/)
    assert.match(auftragFehler(kopf(), [{ fuellung_id: F1, menge: 0 }], HEUTE), /Menge ab 1 Flasche/)
    assert.match(auftragFehler(kopf(), [{ fuellung_id: F1, menge: 1.5 }], HEUTE), /Menge ab 1 Flasche/)
  })
  test('verfügbarer Bestand: Summe je Füllung über alle Positionen', () => {
    const v = new Map([[F1, { name: 'Zierfandler 2025', verfuegbar: 10 }]])
    assert.equal(auftragFehler(kopf(), [{ fuellung_id: F1, menge: 10 }], HEUTE, v), null)
    assert.match(auftragFehler(kopf(), [{ fuellung_id: F1, menge: 6 }, { fuellung_id: F1, menge: 5 }], HEUTE, v), /„Zierfandler 2025“: nur noch 10 Flaschen verfügbar, 11 angefragt/)
    assert.match(auftragFehler(kopf(), [{ fuellung_id: F2, menge: 1 }], HEUTE, v), /gibt es nicht mehr/)
    // überbuchte Füllung: nie eine negative Zahl in der Meldung
    assert.match(auftragFehler(kopf(), pos, HEUTE, new Map([[F1, { name: 'A', verfuegbar: -4 }]])), /nur noch 0 Flaschen/)
  })
})

describe('KAN-418: Reservierung und verfügbarer Bestand', () => {
  test('reserviert = bestellt − geliefert, je Füllung summiert; ganz gelieferte Positionen zählen nicht', () => {
    const m = reserviertJeFuellung([
      { fuellung_id: F1, menge: 12, geliefert: 0 }, { fuellung_id: F1, menge: 6, geliefert: 2 },
      { fuellung_id: F2, menge: 6, geliefert: 6 }, { fuellung_id: F2, menge: 3, geliefert: null },
    ])
    assert.deepEqual([...m], [[F1, 16], [F2, 3]])
    assert.equal(reserviertJeFuellung([{ fuellung_id: F1, menge: 2, geliefert: 5 }]).size, 0)
  })
  test('verfügbar = Bestand − reserviert, auch ohne Werte', () => {
    assert.equal(verfuegbar(100, 16), 84)
    assert.equal(verfuegbar(null, undefined), 0)
    assert.equal(verfuegbar(5, 8), -3)
  })
  test('Frist: Standard 14 Tage, über Monats- und Jahreswechsel', () => {
    assert.equal(RESERVIERUNG_TAGE, 14)
    assert.equal(reserviertBisVorschlag('2026-11-12'), '2026-11-26')
    assert.equal(tagPlus('2026-12-25', 14), '2027-01-08')
    assert.equal(tagPlus('2028-02-20', 14), '2028-03-05')   // Schaltjahr
  })
  test('abgelaufen ist nur ein Hinweis an reservierenden Aufträgen', () => {
    assert.equal(reservierungAbgelaufen({ status: 'offen', reserviert_bis: '2026-11-11' }, HEUTE), true)
    assert.equal(reservierungAbgelaufen({ status: 'teilgeliefert', reserviert_bis: '2026-11-11' }, HEUTE), true)
    assert.equal(reservierungAbgelaufen({ status: 'offen', reserviert_bis: HEUTE }, HEUTE), false)
    assert.equal(reservierungAbgelaufen({ status: 'storniert', reserviert_bis: '2026-01-01' }, HEUTE), false)
    assert.equal(reservierungAbgelaufen({ status: 'geliefert', reserviert_bis: '2026-01-01' }, HEUTE), false)
    assert.equal(reservierungAbgelaufen({ status: 'offen', reserviert_bis: null }, HEUTE), false)
  })
  test('Frist ändern und Storno-Grund', () => {
    assert.equal(fristFehler('2026-12-01', HEUTE), null)
    assert.match(fristFehler('2026-11-11', HEUTE), /mindestens bis heute/)
    assert.match(fristFehler('01.12.2026', HEUTE), /Datum angeben/)
    assert.equal(stornoGrundFehlerAuftrag('Kunde hat abgesagt'), null)
    assert.match(stornoGrundFehlerAuftrag('  zu kurz '), /mindestens 10 Zeichen/)
    assert.match(stornoGrundFehlerAuftrag(null), /Grund für den Storno/)
  })
})

describe('KAN-418: Verdrahtung', () => {
  const actions = quelle('src/app/(dashboard)/weinhandel/auftraege/actions.ts')
  test('Actions: Betrieb der Seite, Abo-Sperre und Schreibrecht mit der Mitgliedschaft vor dem ersten Zugriff', () => {
    const ctx = actions.slice(actions.indexOf('async function getCtx'), actions.indexOf('function neuLaden'))
    const i = s => { const n = ctx.indexOf(s); assert.ok(n >= 0, s); return n }
    assert.ok(i('getCurrentMembership()') < i('pruefeSeitenBetrieb(membership.tenantId)'))
    assert.ok(i('pruefeSeitenBetrieb(') < i('pruefeSchreibzugriff(membership)'))
    assert.ok(i('pruefeSchreibzugriff(') < i("canWrite(membership, 'warenwirtschaft')"))
    assert.doesNotMatch(actions, /canWrite\(membership\.role/)
  })
  test('Actions: anlegen und stornieren nur über die RPCs, kein direktes Einfügen oder Löschen', () => {
    assert.match(actions, /'s112_auftrag_anlegen'/)
    assert.match(actions, /'s112_auftrag_stornieren'/)
    assert.doesNotMatch(actions, /\.insert\(|\.delete\(|\.upsert\(/)
    // dieselbe Prüfung wie im Formular, vor dem Aufruf der Datenbank
    assert.ok(actions.indexOf('auftragFehler(kopf, positionen, heuteWien())') < actions.indexOf("('s112_auftrag_anlegen'"))
    assert.ok(actions.indexOf('stornoGrundFehlerAuftrag(grund)') < actions.indexOf("('s112_auftrag_stornieren'"))
  })
  test('Frist ändern: nur die Frist, eigener Betrieb, nicht storniert, 0 Zeilen = nicht gespeichert', () => {
    const f = actions.slice(actions.indexOf('export async function setzeReservierungBis'))
    assert.match(f, /\.update\(\{ reserviert_bis: bis \}\)/)
    assert.match(f, /\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.is\('storniert_am', null\)/)
    assert.match(f, /\.select\('id'\)/)
    assert.match(f, /NICHT_GESPEICHERT/)
  })
  test('Lader: nur reservierende, nicht stornierte Aufträge des Betriebs, vollständig und in Blöcken', () => {
    const l = quelle('src/lib/auftrag/laden.ts')
    assert.match(l, /\.eq\('tenant_id', tenantId\)\.eq\('art', 'auftrag'\)\.in\('status', \[\.\.\.RESERVIERT_STATUS\]\)\.is\('storniert_am', null\)\.order\('id'\)/)
    assert.match(l, /inBloecken<R>\(ids, b => alle<R>/)
    assert.equal((l.match(/throw new AktionsFehler/g) ?? []).length, 2)
  })
  test('Verkauf und Weinlager zeigen den verfügbaren Bestand', () => {
    assert.match(quelle('src/app/api/verkauf-stammdaten/route.ts'), /ladeReservierungen\(/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/page.tsx'), /ladeReservierungen\(/)
    assert.match(quelle('src/lib/navigation/index.ts'), /\/weinhandel\/auftraege/)
    const wache = quelle('scripts/check-alle.js')
    for (const t of ['auftraege', 'auftrag_positionen']) assert.match(wache, new RegExp(`'${t}'`), t)
  })
})

describe('KAN-418: Migration', () => {
  const sql = migration('kan418_auftrag_reservierung')
  test('Tabellen mit RLS und Zwei-Faktor-Policy; keine Policy erlaubt direktes Einfügen oder Löschen', () => {
    // beide Tabellen in einer Schleife (format mit %I)
    assert.ok(sql.includes("FOREACH t IN ARRAY ARRAY['auftraege', 'auftrag_positionen'] LOOP"))
    assert.ok(sql.includes('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY'))
    assert.ok(sql.includes('CREATE POLICY zwei_faktor_aal ON public.%I AS RESTRICTIVE FOR ALL TO authenticated'))
    const policies = sql.split('\n').filter(z => z.includes('CREATE POLICY '))
    assert.equal(policies.length, 8)   // sechs je Tabelle in der Schleife, zwei für das Ändern am Auftrag
    for (const p of policies) {
      assert.match(p, / TO authenticated/, p)
      // erlaubend (ohne RESTRICTIVE) sind nur Lesen und – am Auftrag – Ändern
      if (!/AS RESTRICTIVE/.test(p)) assert.match(p, / FOR (SELECT|UPDATE) /, p)
    }
    assert.ok(!policies.some(p => p.includes('ON public.auftrag_positionen')), 'Positionen: nur die Policies der Schleife')
  })
  test('RPCs: search_path, Zugriffsprüfung vor der Abo-Sperre, kein EXECUTE für PUBLIC und anon', () => {
    assert.ok((sql.match(/SET search_path = public/gi) ?? []).length >= 5)
    for (const f of ['s112_auftrag_anlegen', 's112_auftrag_stornieren']) {
      const ab = sql.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${f}\\(`, 'i'))
      assert.ok(ab >= 0, f)
      const k = sql.slice(ab, ab + 12000)
      const zugriff = k.indexOf('pruefe_tenant_zugriff(p_tenant_id')
      const abo = k.indexOf('s112_pruefe_abo_schreibsperre(p_tenant_id)')
      assert.ok(zugriff >= 0 && abo > zugriff, `${f}: Zugriff ${zugriff}, Abo ${abo}`)
      assert.match(sql, new RegExp(`REVOKE (ALL|EXECUTE) ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon`, 'i'), f)
    }
  })
  test('Fremdverweise geprüft, Verkauf sperrt reservierte Flaschen', () => {
    for (const sp of ['kontakt_id', 'firma_id', 'auftrag_id', 'fuellung_id']) assert.match(sql, new RegExp(`z_fremdverweis_${sp}`), sp)
    assert.match(sql, /s112_fuellung_verkauf_buchen/)
    assert.match(sql, /reserviert/)
  })
  test('Nachtrag: Spaltenrechte für den Nummernkreis', () => {
    assert.match(migration('kan418b_auftrag_spaltenrechte'), /GRANT SELECT \(auftrag_prefix, auftrag_stellen, auftrag_zaehler\) ON public\.tenant_einstellungen TO authenticated, anon;/)
  })
})
