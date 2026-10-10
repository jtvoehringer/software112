#!/usr/bin/env node
/**
 * check-einbettung.js – Wächter „Einbettungen in .select() passen zu einem Fremdschlüssel“ (Sweep 113, 10.10.2026)
 *
 * PostgREST löst eine Einbettung wie `lieferant:firmen!lieferant_firma_id(name)` über einen Fremdschlüssel auf. Findet es
 * keinen passenden, scheitert die GANZE Abfrage mit PGRST200 – erst zur Laufzeit. Fund im ersten E2E-Lauf gegen Staging:
 * Pflanzenschutz › Lager lieferte HTTP 500, weil (lieferant_firma_id, tenant_id) ein Verbund-Fremdschlüssel ist und der
 * Spalten-Hinweis „!lieferant_firma_id“ nur einspaltige Fremdschlüssel findet (bis Sweep 88 blieb die Liste still leer).
 *
 * Geprüft wird jede Einbettung in einem Text-Literal gegen scripts/fremdschluessel.json:
 *  - `ziel!hinweis(`  – ziel muss eine Tabelle sein; der Hinweis ist der Name eines Fremdschlüssels zwischen ziel und einer
 *                       anderen Tabelle oder eine Spalte, die ALLEIN einen solchen Fremdschlüssel bildet.
 *  - `spalte_id(` bzw. `spalte_id!inner(` (Einbettung über die Spalte) – die Spalte muss allein einen Fremdschlüssel bilden.
 * Verbund-Fremdschlüssel daher immer über ihren Namen ansprechen: `firmen!betriebsmittel_lager_bewegungen_lieferant_fkey(…)`.
 *
 * Seit E2E-Ausbau 3 (11.10.2026) außerdem: keine Typumwandlung in einem Filter (or()/and()-Text wie `jahrgang::text.ilike.…`
 * oder `.ilike('jahrgang::text', …)`) – PostgREST erlaubt sie nur im select und antwortet sonst mit 400.
 *
 * Fremdschlüssel neu erzeugen (nach Migrationen): siehe scripts/fremdschluessel-aus-typen.js.
 * Ausnahme je Stelle: `// einbettung-ignore: <Grund ≥ 15 Zeichen>` in derselben oder der Zeile davor.
 *
 * Aufruf: node scripts/check-einbettung.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-einbettung.js') → { pruefeText, index } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const MODIFIKATOR = new Set(['inner', 'left'])

/** `spalte::typ.operator.` in einem Filtertext (or(), and(), filter()) */
const FILTER_CAST = /\b([a-z_][a-z0-9_]*)::([a-z_]+)\.(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|fts|plfts|phfts|wfts|match|imatch)\./g

/** Nachschlagestrukturen aus der Fremdschlüsselliste */
function index(fks, tabellen) {
  const namen = new Map()           // Name → FK
  const einspaltig = new Map()      // Spalte → [FK] (nur einspaltige)
  const verbund = new Map()         // Spalte → [FK] (Spalte ist Teil eines Verbund-FK)
  const bekannt = new Set(tabellen)
  for (const f of fks) {
    namen.set(f.n, f)
    bekannt.add(f.t); bekannt.add(f.z)
    const ziel = f.s.length === 1 ? einspaltig : verbund
    for (const s of f.s) { if (!ziel.has(s)) ziel.set(s, []); ziel.get(s).push(f) }
  }
  return { namen, einspaltig, verbund, tabellen: bekannt }
}

/** Verbindet der Fremdschlüssel f die Tabellen p und x (in einer der beiden Richtungen)? */
const verbindet = (f, p, x) => (f.t === p && f.z === x) || (f.t === x && f.z === p)

/** Einbettungen in einem Text-Literal prüfen → [{ pos, meldung }] (pos = Index im Literal).
 *  quelle = Tabelle der Abfrage (.from('…')), wenn bekannt – sonst wird ohne Ausgangstabelle (lockerer) geprüft. */
function pruefeLiteral(lit, ix, quelle = null) {
  const funde = []
  // Stapel der Ausgangstabellen: oben die Abfrage, darunter je geöffnete Einbettung (null = unbekannt bzw. keine)
  const stapel = [quelle && ix.tabellen.has(quelle) ? quelle : null]
  const re = /(^|[\s,(:])([a-z_][a-z0-9_]*)(?:!([a-z_][a-z0-9_]*))?(?:!(?:inner|left))?\s*\(|\(|\)/g
  let m
  while ((m = re.exec(lit))) {
    if (m[0] === ')') { if (stapel.length > 1) stapel.pop(); continue }
    if (m[0] === '(') { stapel.push(null); continue }
    const x = m[2], h = m[3]
    const pos = m.index + m[1].length
    const p = stapel[stapel.length - 1]
    let eingebettet = null
    if (h && !MODIFIKATOR.has(h)) {
      eingebettet = ix.tabellen.has(x) ? x : null
      if (!eingebettet) funde.push({ pos, meldung: `„${x}!${h}“: ${x} ist keine bekannte Tabelle` })
      else {
        const nachName = ix.namen.get(h)
        if (nachName) {
          const ok = p ? verbindet(nachName, p, x) : (nachName.t === x || nachName.z === x)
          if (!ok) funde.push({ pos, meldung: `„${x}!${h}“: der Fremdschlüssel ${h} verbindet ${nachName.t} → ${nachName.z}${p ? `, nicht ${p} und ${x}` : `, nicht ${x}`}` })
        } else {
          const passt = (f) => p ? verbindet(f, p, x) : (f.z === x || f.t === x)
          if (!(ix.einspaltig.get(h) ?? []).some(passt)) {
            const vb = (ix.verbund.get(h) ?? []).find(passt)
            funde.push({ pos, meldung: vb
              ? `„${x}!${h}“: ${h} ist Teil des Verbund-Fremdschlüssels ${vb.n} (${vb.s.join(', ')}) – Hinweis über den Namen: ${x}!${vb.n}`
              : `„${x}!${h}“: kein Fremdschlüssel über ${h} zwischen ${p ?? x} und ${p ? x : 'einer anderen Tabelle'}` })
          }
        }
      }
    } else if (ix.tabellen.has(x)) {
      eingebettet = x                                   // ziel( bzw. ziel!inner( – Einbettung ohne Hinweis
    } else if (/_id$/.test(x)) {
      // Einbettung über eine Spalte der Ausgangstabelle: spalte_id( bzw. spalte_id!inner(
      const kandidaten = (ix.einspaltig.get(x) ?? []).filter(f => !p || f.t === p)
      if (kandidaten.length) eingebettet = kandidaten[0].z
      else {
        const vb = (ix.verbund.get(x) ?? []).find(f => !p || f.t === p)
        if (vb) funde.push({ pos, meldung: `„${x}(“: ${x} bildet nur den Verbund-Fremdschlüssel ${vb.n} (${vb.s.join(', ')}) – Einbettung über den Namen: ${vb.z}!${vb.n}(…)` })
        else if (p && ix.einspaltig.has(x)) funde.push({ pos, meldung: `„${x}(“: ${p} hat keinen Fremdschlüssel über ${x}` })
      }
    }
    stapel.push(eingebettet)
  }
  return funde
}

/** Alle Text-Literale einer Quelldatei prüfen → [{ zeile, meldung }] */
function pruefeText(text, ix) {
  const zeilen = text.split(/\r?\n/)
  const zeileVon = (i) => text.slice(0, i).split('\n').length
  const ausnahme = (z) => /einbettung-ignore:\s*\S.{13,}/.test(zeilen[z - 1] ?? '') || /einbettung-ignore:\s*\S.{13,}/.test(zeilen[z - 2] ?? '')
  const funde = []
  const lit = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  let m
  while ((m = lit.exec(text))) {
    const inhalt = m[1] ?? m[2] ?? m[3] ?? ''
    // Typumwandlung in einem Filter (E2E-Ausbau 3, 11.10.2026): PostgREST kennt `spalte::text` nur im select, im Filter
    // antwortet es mit 400 – die globale Suche lieferte so für jeden Suchtext HTTP 500.
    for (const c of inhalt.matchAll(FILTER_CAST)) {
      const z = zeileVon(m.index + 1 + c.index)
      if (!ausnahme(z)) funde.push({ zeile: z, meldung: `Typumwandlung „${c[1]}::${c[2]}“ in einem Filter – PostgREST antwortet mit 400 (nur im select erlaubt; Bereich oder eigene Spalte verwenden)` })
    }
    if (/::/.test(inhalt) && /\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|match|imatch)\(\s*$/.test(text.slice(Math.max(0, m.index - 30), m.index))) {
      const z = zeileVon(m.index + 1)
      if (!ausnahme(z)) funde.push({ zeile: z, meldung: `Typumwandlung „${inhalt}“ als Filterspalte – PostgREST antwortet mit 400` })
    }
    if (!inhalt.includes('(')) continue
    const davor = text.slice(Math.max(0, m.index - 600), m.index)
    const froms = [...davor.matchAll(/(?:\.from|\bq)\(\s*'([a-z_][a-z0-9_]*)'\s*\)/g)]
    const letzte = froms[froms.length - 1]
    const quelle = letzte && !davor.slice(letzte.index).includes(';') ? letzte[1] : null
    for (const f of pruefeLiteral(inhalt, ix, quelle)) {
      const z = zeileVon(m.index + 1 + f.pos)
      if (!ausnahme(z)) funde.push({ zeile: z, meldung: f.meldung })
    }
  }
  return funde
}

function dateien(dir) {
  const aus = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') aus.push(...dateien(p)) }
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) aus.push(p)
  }
  return aus
}

if (require.main === module) {
  const wurzel = path.join(__dirname, '..')
  const fks = JSON.parse(fs.readFileSync(path.join(__dirname, 'fremdschluessel.json'), 'utf8'))
  const tabellen = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf8')))
  const ix = index(fks, tabellen)
  const liste = dateien(path.join(wurzel, 'src'))
  const funde = []
  for (const d of liste) for (const f of pruefeText(fs.readFileSync(d, 'utf8'), ix)) funde.push({ datei: path.relative(wurzel, d).replace(/\\/g, '/'), ...f })
  if (funde.length) {
    console.error(`✗ check-einbettung: ${funde.length} Abfrage(n), an denen PostgREST zur Laufzeit scheitert (Einbettung ohne Fremdschlüssel → PGRST200, Typumwandlung im Filter → 400):`)
    for (const f of funde) console.error(`  ${f.datei}:${f.zeile}  ${f.meldung}`)
    console.error('  Fremdschlüssel veraltet? Neu erzeugen: siehe scripts/fremdschluessel-aus-typen.js. Ausnahme: // einbettung-ignore: <Grund>')
    process.exit(1)
  }
  console.log(`✓ check-einbettung: ${liste.length} Dateien, alle Einbettungen passen zu einem der ${fks.length} Fremdschlüssel, keine Typumwandlung in einem Filter.`)
}

module.exports = { pruefeText, pruefeLiteral, index }
