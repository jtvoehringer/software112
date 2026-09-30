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
// 2. datenbank(): Supabase-Attrappe. Sie wertet aus:
//    - Filter eq, neq, in, is, not(…, 'is', …), gte, lte, or (nur eq, gte, lte), contains;
//      unbekannte Operatoren scheitern laut
//    - die select-Liste: zurück kommen nur die genannten Spalten, auch bei .update/.delete/.insert
//      mit .select('id'); '*' = alle Schlüssel der Testzeile, Alias 'a:spalte'. Fehlt eine
//      genannte Spalte in der Testzeile, kommt null (wie eine leere Spalte)
//    - Einbettungen 'alias:tabelle!hint(spalten)' bzw. 'tabelle!inner(spalten)': Die Testdaten
//      bringen sie FERTIG VERSCHACHTELT unter dem Ausgabeschlüssel (Alias, sonst Tabellenname) mit –
//      die Attrappe verbindet keine Tabellen und prüft weder Fremdschlüssel noch Hint; fehlt die
//      Einbettung in der Testzeile, kommt null. Ein Filter auf ein eingebettetes Feld
//      ('fuellungen.aktiv') braucht die Einbettung in der select-Liste (sonst Fehler). Mit !inner
//      filtert er die Elternzeilen (ohne verknüpfte Zeile fällt die Elternzeile ganz weg), ohne
//      !inner nur die Einbettung selbst (1:1 → null, 1:n → gefilterte Liste) – wie PostgREST
//    - order: Zahlen numerisch (auch numeric als Text), sonst Textvergleich nach Codepunkten (keine
//      Kollation der Datenbank); NULL wie in Postgres aufsteigend zuletzt, absteigend zuerst
//      (nullsFirst übersteuert); limit/range, count/head, maybeSingle
//    - update/delete/insert ändern die Tabellen im Speicher
//    Nicht nachgebildet: Schema (unbekannte Spaltennamen und Spaltentypen fallen nicht auf),
//    Constraints, Trigger, Kaskaden, echte RLS (nur über den Eingriff rls), single(), Casts und
//    JSON-Pfade in der select-Liste, order auf eingebettete Tabellen.
//    Jeder Aufruf landet mit Tabelle, Art, Filtern und Werten in `aufrufe`.
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

/** PostgREST-or-Filter der Form 'a.eq.x,b.gte.y' (eq, gte, lte) */
function orBedingung(ausdruck) {
  const teile = ausdruck.split(',').map(t => {
    const [k, op, ...rest] = t.split('.')
    const v = rest.join('.')
    if (op === 'eq') return r => gleich(feld(r, k), v)
    if (op === 'gte') return r => (vergleich(feld(r, k), v) ?? -1) >= 0
    if (op === 'lte') return r => (vergleich(feld(r, k), v) ?? 1) <= 0
    throw new Error(`Attrappe: or-Operator ${op} nicht nachgebildet`)
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

/** Oberste Ebene einer select-Liste an Kommas außerhalb von Klammern trennen */
function teileSelect(spalten) {
  const teile = []
  let tiefe = 0
  let akt = ''
  for (const z of spalten) {
    if (z === '(') tiefe++
    if (z === ')') tiefe--
    if (z === ',' && tiefe === 0) { teile.push(akt.trim()); akt = '' } else akt += z
  }
  if (akt.trim()) teile.push(akt.trim())
  return teile
}

const NAME = '[A-Za-z_][A-Za-z0-9_]*'
const SELECT_TEIL = new RegExp(`^(?:(${NAME}):)?(${NAME}|\\*)((?:!${NAME})*)(?:\\(([\\s\\S]*)\\))?$`)

/**
 * select-Liste → [{ stern } | { schluessel, spalte, einbettung: null | { inner, liste } }];
 * null = keine Liste (alle Schlüssel der Testzeile)
 */
function selectListe(spalten) {
  if (spalten == null) return null
  return teileSelect(spalten).map(teil => {
    const m = teil.match(SELECT_TEIL)
    if (!m) throw new Error(`Attrappe: select-Teil „${teil}“ nicht nachgebildet`)
    const [, alias, name, hints, innen] = m
    if (name === '*') {
      if (alias || hints || innen !== undefined) throw new Error(`Attrappe: select-Teil „${teil}“ nicht nachgebildet`)
      return { stern: true }
    }
    if (innen === undefined) {
      if (hints) throw new Error(`Attrappe: Hint „${hints}“ ohne Einbettung in „${teil}“`)
      return { schluessel: alias ?? name, spalte: name, einbettung: null }
    }
    if (innen.trim() === '') throw new Error(`Attrappe: leere Einbettung „${teil}“ nicht nachgebildet`)
    return {
      schluessel: alias ?? name,
      spalte: name,
      einbettung: { inner: hints.split('!').includes('inner'), liste: selectListe(innen) },
    }
  })
}

/** Zeile(n) auf die select-Liste beschränken; Einbettungen liegen in der Testzeile unter dem Ausgabeschlüssel */
function projiziere(zeile, liste) {
  if (liste == null || zeile == null) return zeile
  if (Array.isArray(zeile)) return zeile.map(z => projiziere(z, liste))
  const aus = {}
  for (const t of liste) {
    if (t.stern) { Object.assign(aus, zeile); continue }
    if (t.einbettung) aus[t.schluessel] = projiziere(zeile[t.schluessel] ?? null, t.einbettung.liste)
    else aus[t.schluessel] = t.spalte in zeile ? zeile[t.spalte] : null
  }
  return aus
}

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

    // Bedingung: { k, pruefe } – pruefe(Wert des Felds k); k = null: pruefe(ganze Zeile) (or)
    const bedingungErfuellt = (b, r) => (b.k == null ? b.pruefe(r) : b.pruefe(feld(r, b.k)))

    /**
     * Bedingungen aufteilen: auf die Zeile selbst und je Einbettung (Schlüssel vor dem ersten Punkt).
     * Ein Filter auf ein eingebettetes Feld braucht die Einbettung in der select-Liste.
     */
    const planen = () => {
      const liste = eintrag.art === 'select' ? selectListe(eintrag.spalten) : null
      const einbettungen = new Map((liste ?? []).filter(t => t.einbettung).map(t => [t.schluessel, t.einbettung]))
      const zeilenBed = []
      const einbettBed = new Map()
      for (const b of bedingungen) {
        if (b.k == null || !b.k.includes('.')) { zeilenBed.push(b); continue }
        const [kopf, ...rest] = b.k.split('.')
        if (!einbettungen.has(kopf)) {
          throw new Error(`Attrappe: Filter auf „${b.k}“, aber keine Einbettung „${kopf}“ in der select-Liste (${eintrag.art} ${tabelle})`)
        }
        if (!einbettBed.has(kopf)) einbettBed.set(kopf, [])
        einbettBed.get(kopf).push({ k: rest.join('.'), pruefe: b.pruefe })
      }
      return { liste, einbettungen, zeilenBed, einbettBed }
    }

    const einbettungPasst = (wert, bed) => bed.every(b => bedingungErfuellt(b, wert))

    const passtMit = ({ einbettungen, zeilenBed, einbettBed }) => r => {
      if (!zeilenBed.every(b => bedingungErfuellt(b, r))) return false
      for (const [kopf, e] of einbettungen) {
        if (!e.inner) continue
        // !inner: ohne verknüpfte (bzw. passende) Zeile fällt die Elternzeile weg
        const w = r[kopf]
        const bed = einbettBed.get(kopf) ?? []
        if (w == null) return false
        if (Array.isArray(w) ? !w.some(x => einbettungPasst(x, bed)) : !einbettungPasst(w, bed)) return false
      }
      return rls(eintrag, r)
    }

    /** Filter auf eingebettete Felder beschränken die Einbettung selbst (1:1 → null, 1:n → gefiltert) */
    const einbettungenFiltern = (zeilen, einbettBed) => {
      for (const r of zeilen) {
        for (const [kopf, bed] of einbettBed) {
          const w = r[kopf]
          if (w == null) continue
          r[kopf] = Array.isArray(w) ? w.filter(x => einbettungPasst(x, bed)) : (einbettungPasst(w, bed) ? w : null)
        }
      }
      return zeilen
    }

    // Wie Postgres: Zahlen numerisch (vergleich), NULL aufsteigend zuletzt, absteigend zuerst
    const sortieren = zeilen => {
      if (ordnung.length === 0) return zeilen
      return [...zeilen].sort((a, b) => {
        for (const [k, auf, nullenZuerst] of ordnung) {
          const x = feld(a, k), y = feld(b, k)
          if (x == null && y == null) continue
          if (x == null) return nullenZuerst ? -1 : 1
          if (y == null) return nullenZuerst ? 1 : -1
          const c = vergleich(x, y)
          if (c === 0) continue
          return auf ? c : -c
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
      const rueckgabe = z => (eintrag.mitSelect ? projiziere(kopie(z), selectListe(eintrag.rueckSpalten)) : null)
      if (eintrag.art === 'insert') {
        const neu = eintrag.werte.map(z => ({ id: `neu-${++zaehler}`, ...kopie(z) }))
        zeilen.push(...neu)
        eintrag.getroffen = neu.map(r => r.id)
        return Promise.resolve({ data: rueckgabe(neu), error: null })
      }
      const plan = planen()
      let treffer = sortieren(zeilen.filter(passtMit(plan)))
      if (eintrag.art === 'update') {
        for (const r of treffer) Object.assign(r, kopie(eintrag.werte))
        eintrag.getroffen = treffer.map(r => r.id)
        return Promise.resolve({ data: rueckgabe(treffer), error: null })
      }
      if (eintrag.art === 'delete') {
        tabellen[tabelle] = zeilen.filter(r => !treffer.includes(r))
        eintrag.getroffen = treffer.map(r => r.id)
        return Promise.resolve({ data: rueckgabe(treffer), error: null })
      }
      const anzahl = treffer.length
      if (bereich) treffer = treffer.slice(bereich[0], bereich[1] + 1)
      if (grenze != null) treffer = treffer.slice(0, grenze)
      eintrag.getroffen = treffer.map(r => r.id)
      const count = eintrag.optionen?.count ? anzahl : null
      if (eintrag.optionen?.head) return Promise.resolve({ data: null, count, error: null })
      return Promise.resolve({ data: projiziere(einbettungenFiltern(kopie(treffer), plan.einbettBed), plan.liste), count, error: null })
    }

    const q = {
      select(spalten, optionen) {
        if (eintrag.art === 'select') { eintrag.spalten = spalten ?? '*'; eintrag.optionen = optionen ?? null } else { eintrag.mitSelect = true; eintrag.rueckSpalten = spalten ?? '*' }
        return q
      },
      update(werte) { eintrag.art = 'update'; eintrag.werte = werte; return q },
      delete() { eintrag.art = 'delete'; return q },
      insert(z) { eintrag.art = 'insert'; eintrag.werte = Array.isArray(z) ? z : [z]; return q },
      eq(k, v) { eintrag.filter.push(['eq', k, v]); bedingungen.push({ k, pruefe: w => gleich(w, v) }); return q },
      neq(k, v) { eintrag.filter.push(['neq', k, v]); bedingungen.push({ k, pruefe: w => !gleich(w, v) }); return q },
      in(k, v) { eintrag.filter.push(['in', k, v]); bedingungen.push({ k, pruefe: w => v.some(x => gleich(w, x)) }); return q },
      is(k, v) { eintrag.filter.push(['is', k, v]); bedingungen.push({ k, pruefe: w => (w ?? null) === v }); return q },
      not(k, op, v) {
        eintrag.filter.push(['not', k, op, v])
        if (op !== 'is') throw new Error(`Attrappe: not-Operator ${op} nicht nachgebildet`)
        bedingungen.push({ k, pruefe: w => (w ?? null) !== v })
        return q
      },
      gte(k, v) { eintrag.filter.push(['gte', k, v]); bedingungen.push({ k, pruefe: w => { const c = vergleich(w, v); return c !== null && c >= 0 } }); return q },
      lte(k, v) { eintrag.filter.push(['lte', k, v]); bedingungen.push({ k, pruefe: w => { const c = vergleich(w, v); return c !== null && c <= 0 } }); return q },
      or(ausdruck) { eintrag.filter.push(['or', ausdruck]); bedingungen.push({ k: null, pruefe: orBedingung(ausdruck) }); return q },
      contains(k, v) {
        eintrag.filter.push(['contains', k, v])
        bedingungen.push({ k, pruefe: w => Array.isArray(w) && v.every(x => w.includes(x)) })
        return q
      },
      order(k, opt) {
        if (opt?.referencedTable || opt?.foreignTable) throw new Error('Attrappe: order auf eingebettete Tabelle nicht nachgebildet')
        const auf = opt?.ascending !== false
        ordnung.push([k, auf, opt?.nullsFirst ?? !auf])
        return q
      },
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
