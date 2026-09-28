// Gemeinsame Test-Hilfen für die Charakterisierungstests der Buchungslogik
// (STABILITAET.md, Stufe 3 Punkt 2, 28.09.2026):
//   scripts/tests/verkauf-bestand.test.mjs, kellerbuch-storno.test.mjs,
//   kellerbuch-folgebuchungen.test.mjs, finanzen-uebersicht.test.mjs
//
// 1. hooksRegistrieren(): Resolve-Hook wie in ea-verkaufseinnahmen.test.mjs – '@/'-Aliase und
//    endungslose Importe auf src/…/*.ts, Server-Module durch data:-Doppel ersetzt:
//    'server-only' (leer), '@/lib/supabase/admin' / '@/lib/supabase/server' (liefern
//    globalThis.__adminFake bzw. __serverFake), 'next/cache' (protokolliert revalidatePath),
//    '@/lib/auth/roles' (Mitgliedschaft aus globalThis.__membership, canWrite wie das Original
//    für Membership-Objekte).
// 2. datenbank(): Supabase-Attrappe, die ihre Parameter wirklich auswertet. Filter (eq, neq, in,
//    is, not, gte, lte, or, contains, auch auf eingebettete Felder wie 'fuellungen.aktiv'),
//    order/limit/range, count/head, maybeSingle; update/delete/insert ändern die Tabellen im
//    Speicher. Jeder Aufruf landet mit Tabelle, Art, Filtern und Werten in `aufrufe`.
//    Eingriffe:  vorher(eintrag, tabellen) läuft unmittelbar vor der Ausführung und kann
//                { error } liefern (Datenbankfehler) oder die Tabellen ändern (paralleler
//                Vorgang);  rls(eintrag, zeile) → false blendet eine Zeile still aus (wie RLS).
//    Diese Datei ist keine Testdatei (kein *.test.mjs) und wird nur importiert.

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const HIER = path.dirname(fileURLToPath(import.meta.url))
export const SRC = path.resolve(HIER, '../../src')

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)

export const DOPPEL = {
  'server-only': modul('export {}'),
  '@/lib/supabase/admin': modul('export const createSupabaseAdminClient = () => globalThis.__adminFake'),
  '@/lib/supabase/server': modul('export const createSupabaseServerClient = async () => globalThis.__serverFake'),
  'next/cache': modul('export const revalidatePath = (...a) => { (globalThis.__revalidiert ??= []).push(a[0]) }'),
  '@/lib/auth/roles': modul(`
    const rolleVon = r => (r && typeof r === 'object') ? r.role : r
    export const getCurrentMembership = async () => globalThis.__membership ?? null
    export const canAdmin = r => { const x = rolleVon(r); return x === 'system_admin' || x === 'tenant_admin' }
    export const canWrite = (r, m) => {
      const rolle = rolleVon(r)
      if (rolle === 'system_admin' || rolle === 'tenant_admin') return true
      if (rolle !== 'winzer') return false
      const mods = (r && typeof r === 'object') ? r.schreibmodule : (globalThis.__membership?.schreibmodule ?? [])
      if (m === 'betrieb') return true
      return m ? mods.includes(m) : mods.length > 0
    }
  `),
}

export const hooksMoeglich = typeof nodeModule.registerHooks === 'function'
export const nurMitHooks = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node ≥ 22.15 nötig)' }

let registriert = false
export function hooksRegistrieren() {
  if (!hooksMoeglich || registriert) return
  registriert = true
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

export const laden = async rel => import(pathToFileURL(path.join(SRC, rel)).href)

/** Gültige, gut lesbare UUIDs (storno.ts/folgebuchungen.ts prüfen das Format) */
export const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ── Supabase-Attrappe ─────────────────────────────────────────────────────────

/** Wert eines (auch eingebetteten) Felds: 'fuellungen.aktiv' → zeile.fuellungen.aktiv */
function feld(zeile, schluessel) {
  let w = zeile
  for (const teil of schluessel.split('.')) {
    if (w == null) return undefined
    w = Array.isArray(w) ? w.map(x => x?.[teil]) : w[teil]
  }
  return w
}

const gleich = (a, b) => {
  if (Array.isArray(a)) return a.some(x => gleich(x, b))
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a === 'boolean' || typeof b === 'boolean') return false
  return String(a) === String(b)
}

/** PostgREST-or-Filter der Form 'a.eq.x,b.eq.y' */
function orBedingung(ausdruck) {
  const teile = ausdruck.split(',').map(t => {
    const [k, op, ...rest] = t.split('.')
    const v = rest.join('.')
    if (op !== 'eq') throw new Error(`Attrappe: or-Operator ${op} nicht nachgebildet`)
    return r => gleich(feld(r, k), v)
  })
  return r => teile.some(b => b(r))
}

/** Vergleich wie in Postgres: Zahlen numerisch (auch numeric als Text), sonst als Text (Datum 'JJJJ-MM-TT'); NULL → null */
function vergleich(a, b) {
  if (a == null || b == null) return null
  const x = Number(a), y = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(x) && Number.isFinite(y)) return x === y ? 0 : x < y ? -1 : 1
  const s = String(a), t = String(b)
  return s === t ? 0 : s < t ? -1 : 1
}

const kopie = x => (x == null ? x : structuredClone(x))

export function datenbank(tabellen, { vorher = () => null, rls = () => true, rpc = null } = {}) {
  const aufrufe = []
  let zaehler = 0

  function from(tabelle) {
    const bedingungen = []
    const ordnung = []
    const eintrag = { tabelle, art: 'select', filter: [], werte: null, spalten: null, optionen: null, mitSelect: false, getroffen: [] }
    aufrufe.push(eintrag)
    let bereich = null
    let grenze = null
    let einzeln = false

    const passt = r => bedingungen.every(b => b(r)) && rls(eintrag, r)

    const sortieren = zeilen => {
      if (ordnung.length === 0) return zeilen
      return [...zeilen].sort((a, b) => {
        for (const [k, auf] of ordnung) {
          const x = feld(a, k), y = feld(b, k)
          if (x === y) continue
          if (x == null) return 1
          if (y == null) return -1
          const v = x < y ? -1 : 1
          return auf ? v : -v
        }
        return 0
      })
    }

    const ausfuehren = () => {
      const eingriff = vorher(eintrag, tabellen)
      if (eingriff?.error) {
        eintrag.fehler = eingriff.error
        return Promise.resolve({ data: null, error: eingriff.error, count: null })
      }
      const zeilen = tabellen[tabelle] ?? (tabellen[tabelle] = [])
      if (eintrag.art === 'insert') {
        const neu = eintrag.werte.map(z => ({ id: `neu-${++zaehler}`, ...kopie(z) }))
        zeilen.push(...neu)
        eintrag.getroffen = neu.map(r => r.id)
        return Promise.resolve({ data: eintrag.mitSelect ? kopie(neu) : null, error: null })
      }
      let treffer = sortieren(zeilen.filter(passt))
      if (eintrag.art === 'update') {
        for (const r of treffer) Object.assign(r, kopie(eintrag.werte))
        eintrag.getroffen = treffer.map(r => r.id)
        return Promise.resolve({ data: eintrag.mitSelect ? kopie(treffer) : null, error: null })
      }
      if (eintrag.art === 'delete') {
        tabellen[tabelle] = zeilen.filter(r => !treffer.includes(r))
        eintrag.getroffen = treffer.map(r => r.id)
        return Promise.resolve({ data: eintrag.mitSelect ? kopie(treffer) : null, error: null })
      }
      const anzahl = treffer.length
      if (bereich) treffer = treffer.slice(bereich[0], bereich[1] + 1)
      if (grenze != null) treffer = treffer.slice(0, grenze)
      eintrag.getroffen = treffer.map(r => r.id)
      const count = eintrag.optionen?.count ? anzahl : null
      if (eintrag.optionen?.head) return Promise.resolve({ data: null, count, error: null })
      return Promise.resolve({ data: kopie(treffer), count, error: null })
    }

    const q = {
      select(spalten, optionen) {
        if (eintrag.art === 'select') { eintrag.spalten = spalten ?? '*'; eintrag.optionen = optionen ?? null } else eintrag.mitSelect = true
        return q
      },
      update(werte) { eintrag.art = 'update'; eintrag.werte = werte; return q },
      delete() { eintrag.art = 'delete'; return q },
      insert(z) { eintrag.art = 'insert'; eintrag.werte = Array.isArray(z) ? z : [z]; return q },
      eq(k, v) { eintrag.filter.push(['eq', k, v]); bedingungen.push(r => gleich(feld(r, k), v)); return q },
      neq(k, v) { eintrag.filter.push(['neq', k, v]); bedingungen.push(r => !gleich(feld(r, k), v)); return q },
      in(k, v) { eintrag.filter.push(['in', k, v]); bedingungen.push(r => v.some(x => gleich(feld(r, k), x))); return q },
      is(k, v) { eintrag.filter.push(['is', k, v]); bedingungen.push(r => (feld(r, k) ?? null) === v); return q },
      not(k, op, v) {
        eintrag.filter.push(['not', k, op, v])
        if (op !== 'is') throw new Error(`Attrappe: not-Operator ${op} nicht nachgebildet`)
        bedingungen.push(r => (feld(r, k) ?? null) !== v)
        return q
      },
      gte(k, v) { eintrag.filter.push(['gte', k, v]); bedingungen.push(r => { const c = vergleich(feld(r, k), v); return c !== null && c >= 0 }); return q },
      lte(k, v) { eintrag.filter.push(['lte', k, v]); bedingungen.push(r => { const c = vergleich(feld(r, k), v); return c !== null && c <= 0 }); return q },
      or(ausdruck) { eintrag.filter.push(['or', ausdruck]); bedingungen.push(orBedingung(ausdruck)); return q },
      contains(k, v) {
        eintrag.filter.push(['contains', k, v])
        bedingungen.push(r => Array.isArray(feld(r, k)) && v.every(x => feld(r, k).includes(x)))
        return q
      },
      order(k, opt) { ordnung.push([k, opt?.ascending !== false]); return q },
      limit(n) { grenze = n; return q },
      range(a, b) { bereich = [a, b]; return q },
      maybeSingle() {
        einzeln = true
        return ausfuehren().then(r => {
          if (r.error) return { data: null, error: r.error }
          if ((r.data ?? []).length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } }
          return { data: r.data?.[0] ?? null, error: null }
        })
      },
      then(ok, fehler) { return ausfuehren().then(ok, fehler) },
    }
    void einzeln
    return q
  }

  const rpcAufruf = async (name, args) => {
    aufrufe.push({ tabelle: `rpc:${name}`, art: 'rpc', filter: [], werte: args })
    if (rpc) return rpc(name, args)
    return { data: null, error: { message: `rpc ${name} nicht nachgebildet` } }
  }

  return {
    from, rpc: rpcAufruf, aufrufe, tabellen,
    auth: { getUser: async () => ({ data: { user: { id: 'benutzer-1' } }, error: null }) },
  }
}

// ── Auswertung des Protokolls ─────────────────────────────────────────────────

/** Schreibzugriffe in Reihenfolge als 'art tabelle' */
export const schreibzugriffe = db =>
  db.aufrufe.filter(a => a.art !== 'select').map(a => `${a.art} ${a.tabelle}`)

/** Alle Zugriffe in Reihenfolge als 'art tabelle' */
export const zugriffe = db => db.aufrufe.map(a => `${a.art} ${a.tabelle}`)

/** Hat der Aufruf den Filter [art, k, v]? */
export const hatFilter = (aufruf, art, k, v) =>
  aufruf.filter.some(f => f[0] === art && f[1] === k && (v === undefined || JSON.stringify(f[2]) === JSON.stringify(v)))

/**
 * Aufrufe ohne Mandantenfilter tenant_id = tenantId (Inserts: jede Zeile trägt tenant_id).
 * `ausnahmen`: Tabellen ohne tenant_id-Spalte (z. B. verschneidung_quellen).
 */
export function ohneMandant(db, tenantId, ausnahmen = []) {
  return db.aufrufe
    .filter(a => a.art !== 'rpc' && !ausnahmen.includes(a.tabelle))
    .filter(a => (a.art === 'insert'
      ? !a.werte.every(z => z.tenant_id === tenantId)
      : !hatFilter(a, 'eq', 'tenant_id', tenantId)))
    .map(a => `${a.art} ${a.tabelle}`)
}

/** Zeile einer Tabelle per id */
export const zeile = (db, tabelle, id) => (db.tabellen[tabelle] ?? []).find(r => r.id === id)

/** Fehler nur für den n-ten Aufruf einer Art auf einer Tabelle (1-basiert) */
export function fehlerBei(tabelle, art, fehler, nr = 1) {
  let n = 0
  return e => {
    if (e.tabelle === tabelle && e.art === art && ++n === nr) return { error: fehler }
    return null
  }
}
