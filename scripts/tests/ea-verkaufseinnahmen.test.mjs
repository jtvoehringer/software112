// Tests zu KAN-149 Nebenbefund 2 (26.09.2026) und D2b (30.09.2026): abgeleitete E&A-Einnahmen je Zahlung
// (src/lib/ea/verkaufEinnahmenPlan.ts, src/lib/ea/verkaufEinnahmen.ts, Service-Role) und das Löschen alter AfA-Buchungen
// (src/app/(dashboard)/buchhaltung/anlagen/actions.ts) – ohne Datenbank.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/ea-verkaufseinnahmen.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks)
//
// Ein Resolve-Hook löst '@/'-Aliase und endungslose Importe auf src/…/*.ts auf und ersetzt die
// Server-Module durch Doppel: 'server-only' (leer), '@/lib/supabase/admin' und
// '@/lib/supabase/server' (liefern globalThis.__adminFake bzw. __serverFake), 'next/cache'
// (protokolliert revalidatePath), '@/lib/auth/roles' (Mitgliedschaft aus globalThis.__membership),
// Betriebs- und Schreibsperren-Prüfung (ohne Wirkung – eigene Tests in betriebswaechter/abo-nurlesen).

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HIER, '../../src')

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
const DOPPEL = {
  'server-only': modul('export {}'),
  '@/lib/supabase/admin': modul('export const createSupabaseAdminClient = () => globalThis.__adminFake'),
  '@/lib/supabase/server': modul('export const createSupabaseServerClient = async () => globalThis.__serverFake'),
  'next/cache': modul('export const revalidatePath = (...a) => { globalThis.__revalidiert.push(a[0]) }'),
  '@/lib/auth/seitenBetrieb': modul('export const pruefeSeitenBetrieb = async () => {}'),
  '@/lib/auth/sperren': modul('export const pruefeSchreibzugriff = async () => {}'),
  '@/lib/auth/roles': modul(`
    const rolleVon = r => (r && typeof r === 'object') ? r.role : r
    export const getCurrentMembership = async () => globalThis.__membership
    export const canAdmin = r => r === 'system_admin' || r === 'tenant_admin'
    export const canWrite = (r, m) => {
      const rolle = rolleVon(r)
      if (rolle === 'system_admin' || rolle === 'tenant_admin') return true
      if (rolle !== 'winzer') return false
      const mods = (r && typeof r === 'object') ? r.schreibmodule : globalThis.__membership?.schreibmodule
      return m ? mods.includes(m) : mods.length > 0
    }
  `),
}

const hooksMoeglich = typeof nodeModule.registerHooks === 'function'
if (hooksMoeglich) {
  nodeModule.registerHooks({
    resolve(spezifizierer, kontext, weiter) {
      if (DOPPEL[spezifizierer]) return { url: DOPPEL[spezifizierer], shortCircuit: true }
      let basis = null
      if (spezifizierer.startsWith('@/')) basis = path.join(SRC, spezifizierer.slice(2))
      else if (/^\.\.?\//.test(spezifizierer) && !path.extname(spezifizierer) && kontext.parentURL?.startsWith('file:')) {
        basis = path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), spezifizierer)
      }
      if (basis) {
        for (const kandidat of [basis + '.ts', basis + '.tsx', path.join(basis, 'index.ts')]) {
          if (existsSync(kandidat)) return weiter(pathToFileURL(kandidat).href, kontext)
        }
      }
      return weiter(spezifizierer, kontext)
    },
  })
}

const laden = async rel => import(pathToFileURL(path.join(SRC, rel)).href)
const [ve, plan, afa] = hooksMoeglich
  ? await Promise.all([laden('lib/ea/verkaufEinnahmen.ts'), laden('lib/ea/verkaufEinnahmenPlan.ts'), laden('app/(dashboard)/buchhaltung/anlagen/actions.ts')])
  : []
const nurMitHooks = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node ≥ 22.15 nötig)' }

const T = 'tenant-1'
const VP = 'vp-1'

// ── Supabase-Doppel: from().select/delete/insert mit eq/in/is/not, protokolliert jeden Aufruf ──
// `darfLoeschen` bildet RLS nach (filtert still), `vorher` greift unmittelbar vor der Ausführung
// ein (paralleler Vorgang, Datenbankfehler).
function datenbank(tabellen, { darfLoeschen = () => true, vorher = () => null } = {}) {
  const aufrufe = []
  let zaehler = 0
  function from(tabelle) {
    const bedingungen = []
    const eintrag = { tabelle, art: 'select', filter: [], zeilen: null }
    aufrufe.push(eintrag)
    const passt = r => bedingungen.every(b => b(r))
    const ausfuehren = () => {
      const eingriff = vorher(eintrag, tabellen)
      if (eingriff?.error) return Promise.resolve({ data: null, error: eingriff.error })
      const zeilen = tabellen[tabelle] ?? (tabellen[tabelle] = [])
      if (eintrag.art === 'insert') {
        const neu = eintrag.zeilen.map(z => ({ id: `neu-${++zaehler}`, is_locked: false, ...z }))
        zeilen.push(...neu)
        return Promise.resolve({ data: neu.map(r => ({ id: r.id })), error: null })
      }
      const treffer = zeilen.filter(passt)
      if (eintrag.art === 'delete') {
        const weg = treffer.filter(darfLoeschen)
        tabellen[tabelle] = zeilen.filter(r => !weg.includes(r))
        return Promise.resolve({ data: weg.map(r => ({ id: r.id })), error: null })
      }
      return Promise.resolve({ data: treffer.map(r => ({ ...r })), error: null })
    }
    const q = {
      select() { return q },
      delete() { eintrag.art = 'delete'; return q },
      insert(z) { eintrag.art = 'insert'; eintrag.zeilen = Array.isArray(z) ? z : [z]; return q },
      eq(k, v) { eintrag.filter.push(['eq', k, v]); bedingungen.push(r => r[k] === v); return q },
      in(k, v) { eintrag.filter.push(['in', k, v]); bedingungen.push(r => v.includes(r[k])); return q },
      is(k, v) { eintrag.filter.push(['is', k, v]); bedingungen.push(r => (r[k] ?? null) === v); return q },
      not(k, op, v) { eintrag.filter.push(['not', k, v]); bedingungen.push(r => (r[k] ?? null) !== v); return q },
      order() { return q },
      limit() { return q },
      maybeSingle() { return ausfuehren().then(r => ({ data: r.data?.[0] ?? null, error: r.error })) },
      then(ok, fehler) { return ausfuehren().then(ok, fehler) },
    }
    return q
  }
  const rpc = async name => (name === 'pruefe_ea_zeitraum_offen' ? { data: [{ offen: true }], error: null } : { data: null, error: { message: `rpc ${name}` } })
  return { from, rpc, aufrufe, tabellen }
}

const ea = (id, teil) => ({ id, tenant_id: T, typ: 'einnahme', is_locked: false, import_quelle: 'verkauf', verkaufsposten_id: VP, betrag_netto: 10, ...teil })
const idsIn = (db, tabelle = 'ea_transaktionen') => (db.tabellen[tabelle] ?? []).map(r => r.id).sort()
const arten = db => db.aufrufe.filter(a => a.tabelle === 'ea_transaktionen').map(a => a.art)

/** Jeder Aufruf auf ea_transaktionen trägt tenant_id T (Filter bzw. Zeile), lesend/löschend auch den Posten */
function mandantUndPosten(db) {
  for (const a of db.aufrufe.filter(x => x.tabelle === 'ea_transaktionen')) {
    if (a.art === 'insert') {
      for (const z of a.zeilen) {
        assert.equal(z.tenant_id, T)
        assert.equal(z.verkaufsposten_id, VP)
        assert.equal(z.import_quelle, 'verkauf')
        assert.equal(z.typ, 'einnahme')
      }
      continue
    }
    assert.ok(a.filter.some(([art, k, v]) => art === 'eq' && k === 'tenant_id' && v === T), `${a.art} ohne Mandantenfilter`)
    assert.ok(a.filter.some(([art, k, v]) => art === 'eq' && k === 'verkaufsposten_id' && v === VP), `${a.art} ohne Postenfilter`)
  }
}

// ── KAN-149 D2b: Einnahmen je Zahlung ────────────────────────────────────────────────────────────────────────

const POS_13 = [{ preis_brutto: 100, menge: 1, ust_satz: 13 }]
const zahlung = (id, betrag, datum = '2026-09-20', teil = {}) => ({ id, betrag, datum, erstelltAm: `${datum}T10:00:00Z`, ...teil })

describe('verkaufEinnahmenPlan – Soll je Zahlung und Abgleich (rein)', nurMitHooks, () => {
  test('Teilzahlungen: je Zahlung am Zahlungstag, Rundungsrest auf der letzten, Summe = Gesamtquote', () => {
    const soll = plan.sollJeZahlung(POS_13, [zahlung('z2', 70, '2026-10-05'), zahlung('z1', 30, '2026-09-20')])
    assert.deepEqual(soll, [
      { zahlung_id: 'z1', datum: '2026-09-20', betrag_netto: 26.55, ust_satz: 13 },
      { zahlung_id: 'z2', datum: '2026-10-05', betrag_netto: 61.95, ust_satz: 13 },
    ])
    assert.equal(Math.round(soll.reduce((x, r) => x + r.betrag_netto, 0) * 100) / 100, 88.5)
  })

  test('Überzahlung: gedeckelt auf den Rechnungsbetrag; zwei Steuersätze anteilig', () => {
    assert.deepEqual(plan.sollJeZahlung(POS_13, [zahlung('a', 80), zahlung('b', 50, '2026-09-21')]).map(r => [r.zahlung_id, r.betrag_netto]),
      [['a', 70.8], ['b', 17.7]])
    const zwei = plan.sollJeZahlung([{ preis_brutto: 120, menge: 1, ust_satz: 20 }, { preis_brutto: 113, menge: 1, ust_satz: 13 }], [zahlung('z', 233)])
    assert.deepEqual(zwei.map(r => [r.ust_satz, r.betrag_netto]).sort(), [[13, 100], [20, 100]])
  })

  const best = (id, teil) => ({ id, zahlung_id: null, betrag_netto: 88.5, ust_satz: 13, is_locked: false, import_quelle: 'verkauf', storniert_am: null, storno_von_id: null, ...teil })

  test('Bestand passt: nichts tun; abweichender Betrag: gegenbuchen und neu buchen', () => {
    assert.deepEqual(plan.planeVerkaufsEinnahmen(POS_13, [zahlung('z1', 100)], [best('e1', { zahlung_id: 'z1' })]),
      { gesperrt: false, stornieren: [], anlegen: [] })
    const p = plan.planeVerkaufsEinnahmen(POS_13, [zahlung('z1', 100)], [best('e1', { zahlung_id: 'z1', betrag_netto: 50 })])
    assert.deepEqual(p.stornieren, ['e1'])
    assert.deepEqual(p.anlegen.map(x => [x.zahlung_id, x.betrag_netto]), [['z1', 88.5]])
  })

  test('Alt-Einnahme ohne Zahlungsbezug: gegenbuchen und je Zahlung neu; gesperrt: nichts ändern', () => {
    const p = plan.planeVerkaufsEinnahmen(POS_13, [zahlung('z1', 30), zahlung('z2', 70, '2026-10-05')], [best('alt')])
    assert.deepEqual(p.stornieren, ['alt'])
    assert.deepEqual(p.anlegen.map(x => x.zahlung_id), ['z1', 'z2'])
    assert.deepEqual(plan.planeVerkaufsEinnahmen(POS_13, [zahlung('z1', 100)], [best('alt', { is_locked: true })]),
      { gesperrt: true, stornieren: [], anlegen: [] })
  })

  test('stornierte Originale, Gegenbuchungen und manuelle Buchungen zählen nicht; Einnahme einer ungültigen Zahlung wird gegengebucht', () => {
    const p = plan.planeVerkaufsEinnahmen(POS_13, [zahlung('z1', 100)], [
      best('storniert', { zahlung_id: 'z1', storniert_am: '2026-09-21T08:00:00Z' }),
      best('gegen', { zahlung_id: 'z1', betrag_netto: -88.5, storno_von_id: 'storniert' }),
      best('manuell', { import_quelle: 'manuell' }),
      best('weg', { zahlung_id: 'z-storniert' }),
    ])
    assert.deepEqual(p.stornieren, ['weg'])
    assert.deepEqual(p.anlegen.map(x => x.zahlung_id), ['z1'])
  })
})

/** Datenbank-Doppel mit RPCs: pruefe_ea_zeitraum_offen (Tage in `zu` gesperrt) und s112_ea_stornieren (Gegenbuchung) */
function mitRpcs(tabellen, { zu = [], rpcFehler = null } = {}) {
  const db = datenbank(tabellen)
  const rpcAufrufe = []
  db.rpc = async (name, args) => {
    rpcAufrufe.push([name, args])
    if (rpcFehler?.(name)) return { data: null, error: { message: rpcFehler(name) } }
    if (name === 'pruefe_ea_zeitraum_offen') return { data: [{ offen: !zu.includes(args.p_datum) }], error: null }
    if (name === 's112_ea_stornieren') {
      const o = db.tabellen.ea_transaktionen.find(r => r.id === args.p_id && r.tenant_id === args.p_tenant_id)
      o.storniert_am = '2026-09-30T10:00:00Z'
      o.storno_grund = args.p_grund
      db.tabellen.ea_transaktionen.push({ ...o, id: `gegen-${o.id}`, betrag_netto: -o.betrag_netto, storniert_am: null, storno_von_id: o.id })
      return { data: `gegen-${o.id}`, error: null }
    }
    return { data: null, error: { message: `rpc ${name}` } }
  }
  db.rpcAufrufe = rpcAufrufe
  return db
}

describe('abgleichVerkaufsEinnahmen – Ausführung über Service-Role und RPC', nurMitHooks, () => {
  const daten = (zahlungen) => ({ positionen: POS_13, zahlungen, beleg: 'RE 2026-001' })

  test('erste Zahlung: Einnahme am Zahlungstag mit Zahlungsbezug, markiert; kein Löschen', async () => {
    const db = globalThis.__adminFake = mitRpcs({ ea_transaktionen: [ea('manuell', { import_quelle: 'manuell' })] })
    const r = await ve.abgleichVerkaufsEinnahmen(T, VP, daten([zahlung('z1', 30)]))
    assert.deepEqual(r, { ok: true, gesperrt: false, storniert: 0, angelegt: 1 })
    const neu = db.tabellen.ea_transaktionen.find(x => x.zahlung_id === 'z1')
    assert.deepEqual([neu.datum, neu.betrag_netto, neu.ust_satz, neu.beschreibung], ['2026-09-20', 26.55, 13, 'Zahlungseingang RE 2026-001'])
    assert.ok(!arten(db).includes('delete'))
    mandantUndPosten(db)
  })

  test('Alt-Einnahme: per RPC gegengebucht (mit Grund), danach je Zahlung neu gebucht', async () => {
    const db = globalThis.__adminFake = mitRpcs({ ea_transaktionen: [ea('alt', { betrag_netto: 88.5, ust_satz: 13 })] })
    const r = await ve.abgleichVerkaufsEinnahmen(T, VP, daten([zahlung('z1', 30), zahlung('z2', 70, '2026-10-05')]))
    assert.deepEqual(r, { ok: true, gesperrt: false, storniert: 1, angelegt: 2 })
    const storno = db.rpcAufrufe.find(([n]) => n === 's112_ea_stornieren')
    assert.deepEqual(storno[1], { p_tenant_id: T, p_id: 'alt', p_grund: ve.GRUND_EINNAHMEN_NEU })
    const summe = db.tabellen.ea_transaktionen.filter(x => !x.storniert_am && !x.storno_von_id).reduce((x, e2) => x + e2.betrag_netto, 0)
    assert.equal(Math.round(summe * 100) / 100, 88.5, 'aktive Einnahmen: 26,55 + 61,95 (Alt-Zeile storniert, Gegenbuchung −88,50 gleicht sie aus)')
  })

  test('Zahlungstag in abgeschlossenem Zeitraum: heute gebucht, mit Vermerk', async () => {
    const db = globalThis.__adminFake = mitRpcs({ ea_transaktionen: [] }, { zu: ['2025-01-05'] })
    await ve.abgleichVerkaufsEinnahmen(T, VP, daten([zahlung('z1', 100, '2025-01-05')]))
    const neu = db.tabellen.ea_transaktionen[0]
    assert.notEqual(neu.datum, '2025-01-05')
    assert.match(neu.beschreibung, /\(Zahlung vom 05\.01\.2025\)$/)
  })

  test('stornierte Zahlung wird ausgelassen; gesperrte Alt-Einnahme: nichts ändern', async () => {
    let db = globalThis.__adminFake = mitRpcs({ ea_transaktionen: [] })
    let r = await ve.abgleichVerkaufsEinnahmen(T, VP, daten([zahlung('z1', 100, '2026-09-20', { storniertAm: '2026-09-21T08:00:00Z' })]))
    assert.deepEqual(r, { ok: true, gesperrt: false, storniert: 0, angelegt: 0 })
    db = globalThis.__adminFake = mitRpcs({ ea_transaktionen: [ea('alt', { is_locked: true })] })
    r = await ve.abgleichVerkaufsEinnahmen(T, VP, daten([zahlung('z1', 100)]))
    assert.deepEqual(r, { ok: true, gesperrt: true, storniert: 0, angelegt: 0 })
    assert.deepEqual(arten(db), ['select'])
  })

  test('Lese- und RPC-Fehler: sachliche Meldung, nichts angelegt', async () => {
    let db = globalThis.__adminFake = mitRpcs({ ea_transaktionen: [] })
    db.from = () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'timeout' } }) }) }) })
    let r = await ve.abgleichVerkaufsEinnahmen(T, VP, daten([zahlung('z1', 100)]))
    assert.deepEqual(r, { ok: false, fehler: 'E&A-Einnahmen des Verkaufs konnten nicht geladen werden: timeout' })
    db = globalThis.__adminFake = mitRpcs({ ea_transaktionen: [ea('alt')] }, { rpcFehler: n => (n === 's112_ea_stornieren' ? 'gesperrt' : null) })
    r = await ve.abgleichVerkaufsEinnahmen(T, VP, daten([zahlung('z1', 100)]))
    assert.deepEqual(r, { ok: false, fehler: 'E&A-Einnahme des Verkaufs konnte nicht gegengebucht werden: gesperrt' })
    assert.ok(!arten(db).includes('insert'))
  })
})

describe('AfA buchen und zurücknehmen – Rolle vor dem Löschen, abweichende Trefferzahl', nurMitHooks, () => {
  const afaZeile = (id, teil) => ({ id, tenant_id: T, typ: 'ausgabe', is_locked: false, anlage_id: `anl-${id}`, import_quelle: 'manuell', ...teil })
  const RLS = r => !r.is_locked
  let db
  const neueDb = (zeilen, opt = {}) => {
    db = globalThis.__serverFake = datenbank({
      ea_kategorien: [{ id: 'kat-afa', tenant_id: null, name: 'Abschreibung (AfA)' }],
      ea_transaktionen: zeilen,
    }, { darfLoeschen: RLS, ...opt })
    return db
  }
  const zeilenFuer = ids => ids.map((id, i) => ({ anlageId: `anl-${id ?? i}`, name: `Anlage ${i + 1}`, soll: 100 + i, buchungId: id }))
  const alsRolle = role => { globalThis.__membership = { tenantId: T, role, schreibmodule: ['ea'] } }

  beforeEach(() => { globalThis.__revalidiert = [] })

  test('Mitarbeiter ersetzt bereits gebuchte AfA: Abbruch vor dem ersten Löschen', async () => {
    alsRolle('winzer')
    neueDb([afaZeile('b1'), afaZeile('b2')])
    const r = await afa.bucheAfa(2026, zeilenFuer(['b1', 'b2']))
    assert.equal(r.ok, false)
    assert.match(r.fehler, /nur ein Betriebs-Manager ersetzen .* es wurde nichts gebucht/)
    assert.deepEqual(arten(db), [], 'kein Zugriff auf ea_transaktionen')
    assert.deepEqual(idsIn(db), ['b1', 'b2'])
  })

  test('Mitarbeiter bucht erstmals: erlaubt (nichts zu löschen)', async () => {
    alsRolle('winzer')
    neueDb([])
    const r = await afa.bucheAfa(2026, zeilenFuer([null, null]))
    assert.deepEqual(r, { ok: true, gebucht: 2 })
    assert.deepEqual(arten(db), ['insert'])
  })

  test('Betriebs-Manager: alte Buchungen ersetzt', async () => {
    alsRolle('tenant_admin')
    neueDb([afaZeile('b1'), afaZeile('b2')])
    const r = await afa.bucheAfa(2026, zeilenFuer(['b1', 'b2']))
    assert.deepEqual(r, { ok: true, gebucht: 2 })
    assert.deepEqual(arten(db), ['delete', 'insert'])
    assert.deepEqual(idsIn(db), ['neu-1', 'neu-2'])
    assert.ok(globalThis.__revalidiert.includes('/buchhaltung/anlagen'))
  })

  test('Betriebs-Manager, veralteter Tab (eine Buchung inzwischen gelöscht): trotzdem vollständig neu buchen', async () => {
    alsRolle('tenant_admin')
    neueDb([afaZeile('b1')])
    const r = await afa.bucheAfa(2026, zeilenFuer(['b1', 'weg']))
    assert.deepEqual(r, { ok: true, gebucht: 2 })
    assert.deepEqual(arten(db), ['delete', 'select', 'insert'])
    const pruefung = db.aufrufe.filter(a => a.tabelle === 'ea_transaktionen')[1]
    assert.deepEqual(pruefung.filter.find(([art]) => art === 'in'), ['in', 'id', ['weg']])
    assert.ok(pruefung.filter.some(([art, k, v]) => art === 'eq' && k === 'tenant_id' && v === T))
    assert.deepEqual(idsIn(db), ['neu-1', 'neu-2'])
  })

  test('Betriebs-Manager, Buchung inzwischen gesperrt: nicht neu buchen, Seite aktualisieren', async () => {
    alsRolle('tenant_admin')
    neueDb([afaZeile('b1'), afaZeile('b2', { is_locked: true })])
    const r = await afa.bucheAfa(2026, zeilenFuer(['b1', 'b2']))
    assert.equal(r.ok, false)
    assert.equal(r.fehler, 'Die AfA-Buchungen wurden inzwischen geändert – die Seite wurde aktualisiert, bitte erneut buchen.')
    assert.deepEqual(arten(db), ['delete', 'select'], 'kein Insert')
    assert.deepEqual(idsIn(db), ['b2'])
    assert.ok(globalThis.__revalidiert.includes('/buchhaltung/anlagen'), 'pfade() aufgerufen')
  })

  test('Rücknahme: Mitarbeiter – Abbruch ohne Löschen', async () => {
    alsRolle('winzer')
    neueDb([afaZeile('b1')])
    const r = await afa.nimmAfaZurueck(2026, ['b1'])
    assert.equal(r.ok, false)
    assert.match(r.fehler, /nur ein Betriebs-Manager zurücknehmen/)
    assert.deepEqual(arten(db), [])
    assert.deepEqual(idsIn(db), ['b1'])
  })

  test('Rücknahme: Betriebs-Manager, eine Buchung schon weg – Ziel erreicht', async () => {
    alsRolle('system_admin')
    neueDb([afaZeile('b1'), { ...afaZeile('keine-afa'), anlage_id: null }])
    const r = await afa.nimmAfaZurueck(2026, ['b1', 'weg', 'keine-afa'])
    assert.deepEqual(r, { ok: true })
    assert.deepEqual(idsIn(db), ['keine-afa'], 'Buchungen ohne Anlage fasst die Rücknahme nicht an')
    const pruefung = db.aufrufe.filter(a => a.tabelle === 'ea_transaktionen')[1]
    assert.ok(pruefung.filter.some(([art, k]) => art === 'not' && k === 'anlage_id'), 'Prüfung wie das Löschen nur auf AfA-Buchungen')
    assert.ok(globalThis.__revalidiert.includes('/buchhaltung/anlagen'))
  })

  test('Rücknahme: Betriebs-Manager, Buchung gesperrt – Meldung und Seite aktualisieren', async () => {
    alsRolle('tenant_admin')
    neueDb([afaZeile('b1'), afaZeile('b2', { is_locked: true })])
    const r = await afa.nimmAfaZurueck(2026, ['b1', 'b2'])
    assert.equal(r.ok, false)
    assert.equal(r.fehler, 'Die AfA-Buchungen wurden inzwischen geändert – die Seite wurde aktualisiert, bitte erneut zurücknehmen.')
    assert.deepEqual(idsIn(db), ['b2'])
    assert.ok(globalThis.__revalidiert.includes('/buchhaltung/anlagen'))
  })
})
