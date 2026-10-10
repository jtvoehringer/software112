#!/usr/bin/env node
/**
 * fremdschluessel-aus-typen.js – erzeugt scripts/fremdschluessel.json für check-einbettung.js (Sweep 113, 10.10.2026)
 *
 * Quelle sind die von Supabase generierten Typen (Relationships je Tabelle): Name, Spalten und Zieltabelle jedes
 * Fremdschlüssels im Schema public. Nach jeder Migration mit neuen oder geänderten Fremdschlüsseln neu erzeugen:
 *
 *   npx supabase gen types typescript --project-id zwcsgnemijkpyxrqykul --schema public > <typen.ts>
 *   node scripts/fremdschluessel-aus-typen.js <typen.ts>
 */
const fs = require('fs')
const path = require('path')

/** Fremdschlüssel aus dem Text der generierten Typen: [{ n, t, s, z }] (Name, Tabelle, Spalten, Ziel) – nur Tables */
function fremdschluesselAusTypen(text) {
  const tabStart = text.indexOf('Tables: {')
  const tabEnde = text.indexOf('Views: {', tabStart)
  if (tabStart < 0 || tabEnde < 0) throw new Error('Abschnitt „Tables“ in den Typen nicht gefunden')
  const t = text.slice(tabStart, tabEnde)
  const aus = []
  // Tabellenkopf „      name: {“ gefolgt von Row/Insert/Update/Relationships
  const kopf = /\n {6}([a-z0-9_]+): \{\n {8}Row: \{/g
  const koepfe = []
  let m
  while ((m = kopf.exec(t))) koepfe.push({ name: m[1], i: m.index })
  koepfe.forEach((k, j) => {
    const block = t.slice(k.i, j + 1 < koepfe.length ? koepfe[j + 1].i : t.length)
    const rel = /foreignKeyName: "([^"]+)"\s*\n\s*columns: \[([^\]]*)\]\s*\n\s*isOneToOne: (?:true|false)\s*\n\s*referencedRelation: "([^"]+)"/g
    let r
    while ((r = rel.exec(block))) {
      const s = [...r[2].matchAll(/"([^"]+)"/g)].map(x => x[1])
      aus.push({ n: r[1], t: k.name, s, z: r[3] })
    }
  })
  return aus.sort((a, b) => (a.t + a.n).localeCompare(b.t + b.n))
}

if (require.main === module) {
  const quelle = process.argv[2]
  if (!quelle) { console.error('Aufruf: node scripts/fremdschluessel-aus-typen.js <typen.ts>'); process.exit(2) }
  const liste = fremdschluesselAusTypen(fs.readFileSync(quelle, 'utf8'))
  const ziel = path.join(__dirname, 'fremdschluessel.json')
  fs.writeFileSync(ziel, '[\n' + liste.map(f => '  ' + JSON.stringify(f)).join(',\n') + '\n]\n')
  console.log(`${liste.length} Fremdschlüssel → ${path.relative(process.cwd(), ziel)}`)
}

module.exports = { fremdschluesselAusTypen }
