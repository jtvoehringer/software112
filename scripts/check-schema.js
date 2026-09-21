#!/usr/bin/env node
// Schema-Abgleich + Muster-Scan (20.9.2026, nach den Vorfällen der Woche):
//
//  1. Jede Spalte, die im Code in .eq/.neq/.is/.in/.gt/.gte/.lt/.lte/.like/.ilike/
//     .not/.order/.select an einer supabase-Tabelle verwendet wird, muss im
//     Schema (scripts/schema.json, Export aus information_schema) existieren.
//     Fund vom 20.9.: .eq('tenant_id') auf ernte_parzellen/pressung_* – Spalte gibt
//     es nicht, Abfrage bricht, Formular zeigt nichts.
//  2. tf()/ctx.tf() erzwingt tenant_id – nur auf Tabellen, die die Spalte haben.
//  3. .eq(spalte, null)/.neq(spalte, null): PostgREST schickt "eq.null" → Fehler
//     an uuid-Spalten. Richtig ist .is(spalte, null).
//  4. .limit(n) mit n > 1000: PostgREST kappt bei 1.000 – alle() aus
//     lib/supabase/alle.ts verwenden.
//  5. Schreibaufrufe (insert/update/upsert/delete), deren Ergebnis niemand liest:
//     `await (supabase.from(...)...)` als Anweisung ohne const/return/if – der
//     Fehler geht verloren (PSM-Anfangsbestände 20.9.).
//  6. Zahleneingaben (21.9.): `.replace(',', '.')` und nacktes
//     parseFloat/Number(formData.get(…)) lesen „36.125,00“ als 36,125 bzw. „1,5“ als 1
//     (Offene Posten: 36,13 € statt 36.125,00 € gebucht) – dezimal()/zahlAus() aus
//     lib/format.ts verwenden.
//
// Aufruf: node scripts/check-schema.js            (Fehler → Exit 1, läuft im prebuild)
//         node scripts/check-schema.js --warn     (nur Bericht)
// Schema aktualisieren: SQL in scripts/schema.sql gegen Supabase ausführen und
// Ergebnis nach scripts/schema.json speichern (bei jeder Migration mit neuen Spalten).
// Ausnahmen je Zeile: Kommentar `// schema-ignore` in der Zeile davor oder derselben.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'src')
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf8'))
const nurWarnen = process.argv.includes('--warn')

const dateien = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) dateien.push(p)
  }
})(ROOT)

const funde = []   // { datei, zeile, art, text }
const FILTER_RE = /\.(eq|neq|is|in|gt|gte|lt|lte|like|ilike|not|order|contains|overlaps)\(\s*'([^']+)'/g

function ignoriert(zeilen, i) {
  return /schema-ignore/.test(zeilen[i] ?? '') || /schema-ignore/.test(zeilen[i - 1] ?? '')
}

// Verkettete Abfrage ab .from('tabelle'): Text bis zum Ende der Anweisung
// (Klammerbalance ab der öffnenden Klammer vor "supabase" bzw. bis Leerzeile/`;`)
function abfrageText(quelle, start) {
  let tiefe = 0, i = start, ende = quelle.length
  for (; i < quelle.length; i++) {
    const c = quelle[i]
    if (c === '(') tiefe++
    else if (c === ')') { if (tiefe > 0) tiefe--; /* Klammer eines äußeren Wrappers (tf(...), (x as any)) – ignorieren */ }
    else if (c === ';' && tiefe === 0) { ende = i; break }
    else if (c === '\n' && tiefe === 0) {
      const rest = quelle.slice(i + 1, i + 200).replace(/^\s+/, '')
      if (!rest.startsWith('.')) { ende = i; break }   // Kette geht nicht weiter
    }
    if (i - start > 4000) { ende = i; break }
  }
  // Zeilenkommentare durch Leerzeichen ersetzen (Positionen bleiben erhalten) – sonst
  // trifft der Scan auf ".limit(2000)" in einem Hinweis-Kommentar
  return quelle.slice(start, ende).replace(/\/\/[^\n]*/g, k => ' '.repeat(k.length))
}

for (const datei of dateien) {
  const quelle = fs.readFileSync(datei, 'utf8')
  const zeilen = quelle.split('\n')
  const rel = path.relative(path.join(__dirname, '..'), datei)
  const zeileVon = (pos) => quelle.slice(0, pos).split('\n').length

  // 1 + 2 + 3 + 4: je .from('tabelle')
  const fromRe = /\.(?:from|q)\('([a-z_0-9]+)'\)/g   // supabase.from('x') und ctx.q('x') (Dashboard-Kontext)
  let m
  while ((m = fromRe.exec(quelle))) {
    const tabelle = m[1]
    const spalten = schema[tabelle]
    const z = zeileVon(m.index)
    if (ignoriert(zeilen, z - 1)) continue
    if (!spalten) { funde.push({ datei: rel, zeile: z, art: 'tabelle', text: `Tabelle "${tabelle}" nicht im Schema` }); continue }
    const text = abfrageText(quelle, m.index)
    // tf( vor dem from → tenant_id nötig
    const davor = quelle.slice(Math.max(0, m.index - 60), m.index)
    if (/\btf\(\s*\(?\s*[a-zA-Z_.]*$/.test(davor)) {
      if (!spalten.includes('tenant_id')) funde.push({ datei: rel, zeile: z, art: 'tf', text: `tf() auf "${tabelle}" – Tabelle hat keine tenant_id` })
    }
    let f
    FILTER_RE.lastIndex = 0
    while ((f = FILTER_RE.exec(text))) {
      const op = f[1], spalte = f[2]
      if (spalte.includes('.')) continue                  // verknüpfte Tabelle (relation.spalte) – nicht prüfbar
      if (op === 'in' && !spalte.match(/^[a-z_0-9]+$/)) continue
      if (!spalten.includes(spalte)) {
        const zz = zeileVon(m.index + f.index)
        if (!ignoriert(zeilen, zz - 1)) funde.push({ datei: rel, zeile: zz, art: 'spalte', text: `.${op}('${spalte}') – Spalte fehlt auf "${tabelle}"` })
      }
    }
    // .eq(x, null)
    const nullRe = /\.(eq|neq)\(\s*'([^']+)'\s*,\s*null\s*\)/g
    while ((f = nullRe.exec(text))) {
      const zz = zeileVon(m.index + f.index)
      if (!ignoriert(zeilen, zz - 1)) funde.push({ datei: rel, zeile: zz, art: 'null', text: `.${f[1]}('${f[2]}', null) – PostgREST schickt "eq.null"; .is(...) verwenden` })
    }
    // .limit(>1000)
    const limRe = /\.limit\(\s*(\d+)\s*\)/g
    while ((f = limRe.exec(text))) {
      if (parseInt(f[1], 10) > 1000) {
        const zz = zeileVon(m.index + f.index)
        if (!ignoriert(zeilen, zz - 1)) funde.push({ datei: rel, zeile: zz, art: 'limit', text: `.limit(${f[1]}) – PostgREST liefert höchstens 1.000 Zeilen; alle() verwenden` })
      }
    }
    // .select('a, b, rel:fk(x)') – einfache Spalten prüfen
    const selRe = /\.select\(\s*['`]([^'`]*)['`]/g
    while ((f = selRe.exec(text))) {
      const roh = f[1].replace(/\s+/g, ' ')
      // Verknüpfungen entfernen: name:tabelle!inner(...) / tabelle(...)
      // Verknüpfungen (auch verschachtelt, mehrzeilig) von innen nach außen entfernen
      let ohneRel = roh, vorher = ''
      while (vorher !== ohneRel) { vorher = ohneRel; ohneRel = ohneRel.replace(/[a-zA-Z_0-9]+(:[a-zA-Z_0-9!]+)?\s*\([^()]*\)/g, '') }
      for (const teil of ohneRel.split(',')) {
        const s = teil.trim().split('::')[0].split(':').pop().trim()
        if (!s || s === '*' || s.includes('(') || s.includes(')') || s.includes('.')) continue
        if (!/^[a-zäöüß_0-9]+$/i.test(s)) continue
        if (!spalten.includes(s)) {
          const zz = zeileVon(m.index + f.index)
          if (!ignoriert(zeilen, zz - 1)) funde.push({ datei: rel, zeile: zz, art: 'select', text: `.select('… ${s} …') – Spalte fehlt auf "${tabelle}"` })
        }
      }
    }
  }

  // 6: Zahleneingaben ohne dezimal()
  const zahlRe = /\.replace\(',', '\.'\)|\b(?:parseFloat|Number|parseInt)\(\(?(?:formData|fd|form)\.get\(/g
  while ((m = zahlRe.exec(quelle))) {
    const z = zeileVon(m.index)
    if (ignoriert(zeilen, z - 1)) continue
    if (/^\s*(\/\/|\*)/.test(zeilen[z - 1])) continue   // Kommentarzeile
    if (rel.replace(/\\/g, '/').endsWith('src/lib/format.ts')) continue
    const zeile = zeilen[z - 1]
    if (/dezimal\(|zahlAus\(/.test(zeile) && m[0].startsWith('.replace') === false) continue
    if (m[0].startsWith('.replace') && /dezimal\(/.test(zeile) && zeile.includes("replace(/\\./g, '')")) continue
    funde.push({ datei: rel, zeile: z, art: 'zahl', text: `${m[0]}… – Zahleneingabe ohne dezimal()/zahlAus() (lib/format): „36.125,00“ würde als 36,125 gelesen` })
  }

  // 5: Schreibaufruf ohne Auswertung
  const stillRe = /^\s*await \(?(supabase|admin|s|client|db)\b[^\n]*\.from\('([a-z_0-9]+)'\)/gm
  while ((m = stillRe.exec(quelle))) {
    const text = abfrageText(quelle, m.index)
    if (/\.(insert|update|upsert|delete)\(/.test(text)) {
      const z = zeileVon(m.index)
      if (!ignoriert(zeilen, z - 1)) funde.push({ datei: rel, zeile: z, art: 'still', text: `Schreibaufruf auf "${m[2]}" ohne Auswertung von error – Fehler geht verloren` })
    }
  }
}

funde.sort((a, b) => a.datei.localeCompare(b.datei) || a.zeile - b.zeile)
const nachArt = {}
for (const f of funde) nachArt[f.art] = (nachArt[f.art] ?? 0) + 1

if (funde.length === 0) {
  console.log(`✓ Schema-Abgleich: ${dateien.length} Dateien geprüft, keine Funde.`)
  process.exit(0)
}
console.log(`Schema-Abgleich: ${funde.length} Funde in ${new Set(funde.map(f => f.datei)).size} Dateien (${Object.entries(nachArt).map(([k, v]) => `${k}: ${v}`).join(', ')})\n`)
for (const f of funde) console.log(`${f.datei}:${f.zeile}  [${f.art}]  ${f.text}`)
process.exit(nurWarnen ? 0 : 1)
