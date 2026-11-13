#!/usr/bin/env node
// Wächter „Lesebereiche“ (KAN-412, 13.11.2026) – prebuild und CI.
//
// Die Profile „Vertrieb“ und „Extern“ dürfen nur bestimmte Bereiche lesen. Welche Tabelle zu welchem Bereich gehört,
// steht in scripts/lesebereiche.json. Eine Tabelle ohne Bereich wäre für ein Profil entweder ungewollt sichtbar oder
// ungewollt gesperrt – deshalb bricht der Build ab, wenn
//   • eine Tabelle aus scripts/schema.json keinen Bereich hat (neue Tabelle → hier eintragen),
//   • die Liste eine Tabelle nennt, die es nicht (mehr) gibt,
//   • ein Bereich einer Tabelle bzw. eines Profils nicht definiert ist,
//   • ein Profil den Bereich „allgemein“ nicht hat (ohne ihn lädt keine Seite),
//   • ein Spalten-Fall auf eine unbekannte Tabelle, Spalte oder ein unbekanntes Profil zeigt.
// Aufruf: node scripts/check-lesebereiche.js

const fs = require('fs')
const path = require('path')

function pruefe(liste, schema) {
  const fehler = []
  const bereiche = Object.keys(liste.bereiche ?? {})
  const tabellen = liste.tabellen ?? {}
  for (const t of Object.keys(schema)) if (!tabellen[t]) fehler.push(`Tabelle „${t}“ hat keinen Lesebereich (scripts/lesebereiche.json → tabellen)`)
  for (const [t, b] of Object.entries(tabellen)) {
    if (!schema[t]) fehler.push(`Tabelle „${t}“ steht in der Liste, aber nicht in scripts/schema.json`)
    if (!bereiche.includes(b)) fehler.push(`Tabelle „${t}“: unbekannter Bereich „${b}“`)
  }
  for (const [profil, erlaubt] of Object.entries(liste.profile ?? {})) {
    if (!Array.isArray(erlaubt) || !erlaubt.includes('allgemein')) fehler.push(`Profil „${profil}“ braucht den Bereich „allgemein“`)
    for (const b of erlaubt ?? []) if (!bereiche.includes(b)) fehler.push(`Profil „${profil}“: unbekannter Bereich „${b}“`)
    if (new Set(erlaubt).size !== (erlaubt ?? []).length) fehler.push(`Profil „${profil}“: Bereich doppelt`)
  }
  for (const f of liste.spaltenfaelle ?? []) {
    if (!schema[f.tabelle]) { fehler.push(`Spalten-Fall: unbekannte Tabelle „${f.tabelle}“`); continue }
    if (!(liste.profile ?? {})[f.profil]) fehler.push(`Spalten-Fall ${f.tabelle}: unbekanntes Profil „${f.profil}“`)
    for (const s of f.spalten ?? []) if (!schema[f.tabelle].includes(s)) fehler.push(`Spalten-Fall ${f.tabelle}: unbekannte Spalte „${s}“`)
  }
  // KAN-454: Form der Sperr-Policy je Tabelle (scripts/lesebereich-sql.js erzeugt daraus die Liste der Migration)
  const kinder = liste.kinder ?? {}
  const sichten = liste.sichten ?? []
  const freigaben = liste.freigaben ?? []
  for (const [t, k] of Object.entries(kinder)) {
    if (!schema[t]) { fehler.push(`Kindtabelle „${t}“ steht nicht in scripts/schema.json`); continue }
    if (schema[t].includes('tenant_id')) fehler.push(`Kindtabelle „${t}“ hat eine tenant_id – sie braucht die Sperre über tenant_id, nicht über die Elternzeile`)
    if (!schema[t].includes(k.spalte)) fehler.push(`Kindtabelle „${t}“: unbekannte Spalte „${k.spalte}“`)
    if (!schema[k.eltern]) { fehler.push(`Kindtabelle „${t}“: unbekannte Elterntabelle „${k.eltern}“`); continue }
    if (!schema[k.eltern].includes('tenant_id') || kinder[k.eltern] || sichten.includes(k.eltern))
      fehler.push(`Kindtabelle „${t}“: die Elterntabelle „${k.eltern}“ muss eine Tabelle mit tenant_id sein (sie trägt die Sperre)`)
    if (tabellen[k.eltern] !== tabellen[t]) fehler.push(`Kindtabelle „${t}“ (${tabellen[t]}) und Elterntabelle „${k.eltern}“ (${tabellen[k.eltern]}) liegen in verschiedenen Bereichen`)
    if (tabellen[t] === 'allgemein') fehler.push(`Kindtabelle „${t}“ liegt im Bereich „allgemein“ – dort gibt es keine Sperre`)
  }
  for (const t of sichten) if (!schema[t]) fehler.push(`Sicht „${t}“ steht nicht in scripts/schema.json`)
  for (const t of freigaben) {
    if (!schema[t]) { fehler.push(`Freigabe „${t}“ steht nicht in scripts/schema.json`); continue }
    for (const s of ['eigentuemer_tenant_id', 'nutzer_tenant_id']) if (!schema[t].includes(s)) fehler.push(`Freigabe „${t}“: Spalte „${s}“ fehlt`)
  }
  for (const [t, b] of Object.entries(tabellen)) {
    if (b === 'allgemein' || !schema[t] || schema[t].includes('tenant_id')) continue
    if (!kinder[t] && !sichten.includes(t) && !freigaben.includes(t))
      fehler.push(`Tabelle „${t}“ (${b}) hat keine tenant_id – als Kindtabelle (kinder), Sicht (sichten) oder Freigabe (freigaben) eintragen`)
  }
  return fehler
}

module.exports = { pruefe }

if (require.main === module) {
  const wurzel = path.resolve(__dirname, '..')
  const liste = JSON.parse(fs.readFileSync(path.join(wurzel, 'scripts', 'lesebereiche.json'), 'utf8'))
  const schema = JSON.parse(fs.readFileSync(path.join(wurzel, 'scripts', 'schema.json'), 'utf8'))
  const fehler = pruefe(liste, schema)
  if (fehler.length) {
    console.error(`✗ check-lesebereiche: ${fehler.length} Befund(e)`)
    for (const f of fehler) console.error(`  ${f}`)
    process.exit(1)
  }
  const n = Object.keys(liste.tabellen).length
  console.log(`✓ check-lesebereiche: ${n} Tabellen in ${Object.keys(liste.bereiche).length} Bereichen, ${Object.keys(liste.profile).length} Profile, ${(liste.spaltenfaelle ?? []).length} Spalten-Fälle.`)
}
