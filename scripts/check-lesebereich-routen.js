#!/usr/bin/env node
// Wächter „Lesebereich je API-Route“ (KAN-455, 13.11.2026) – prebuild und CI.
//
// Mitarbeiter mit Profil („Vertrieb“, „Extern“) lesen nur ihre Lesebereiche. Die Tabellen sperrt die Datenbank
// (Policy „lesebereich“, KAN-454) – API-Routen laden aber oft per Service-Role oder liefern Dateien, Mails und PDFs,
// an denen keine Policy hängt. Jede Route unter src/app/api steht deshalb in scripts/lesebereich-routen.json:
//   • "bereich" bzw. ["a", "b"]: jeder exportierte Handler (GET, POST …) führt zu einem Aufruf
//       const leseSperre = leseKonflikt(<mitgliedschaft>, '<bereich>' …)
//       if (leseSperre) return leseSperre
//     – im Handler selbst oder in einer lokalen Funktion der Datei, an die er weitergibt;
//   • { "ausnahme": "<Grund ≥ 15 Zeichen>" }: Route ohne Benutzersitzung (Webhook, Cron) bzw. im Bereich „allgemein“.
// Der Build bricht ab bei: Route ohne Eintrag, Eintrag ohne Route, unbekanntem Bereich, Bereich „allgemein“ als Wert
// (dafür gibt es die begründete Ausnahme), fehlendem Aufruf, Aufruf mit anderen Bereichen als in der Liste, Aufruf
// ohne „if (…) return …“ in der Folgezeile und leseKonflikt in einer Route mit Ausnahme.
// Aufruf: node scripts/check-lesebereich-routen.js [--liste]

const fs = require('fs')
const path = require('path')

const HANDLER = /^export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/
const AUFRUF = /const (\w+) = leseKonflikt\((.*)\)\s*(?:\/\/.*)?$/

function routen(dir, basis = dir, liste = []) {
  if (!fs.existsSync(dir)) return liste
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) routen(p, basis, liste)
    else if (e.name === 'route.ts') liste.push(path.relative(basis, path.dirname(p)).split(path.sep).join('/'))
  }
  return liste.sort()
}

/** Bereiche eines Aufrufs: alle Zeichenketten nach dem ersten Argument */
function bereicheAus(argumente) {
  return [...argumente.matchAll(/'([a-z]+)'/g)].map(m => m[1])
}

/** Zerlegt eine Datei in Funktionen der obersten Ebene: [{ name, handler, text }] */
function funktionen(quelle) {
  const zeilen = quelle.split(/\r?\n/)
  const teile = []
  let aktuell = null
  for (const z of zeilen) {
    const kopf = /^(?:export )?(?:async )?function (\w+)/.exec(z)
    if (kopf) {
      aktuell = { name: kopf[1], handler: HANDLER.test(z), zeilen: [] }
      teile.push(aktuell)
    }
    if (aktuell) aktuell.zeilen.push(z)
  }
  return teile.map(t => ({ name: t.name, handler: t.handler, text: t.zeilen.join('\n'), zeilen: t.zeilen }))
}

/** Befunde einer Route. eintrag = Wert aus der Liste, quelle = Inhalt von route.ts */
function pruefeRoute(pfad, eintrag, quelle, bereiche) {
  const fehler = []
  const ausnahme = eintrag && typeof eintrag === 'object' && !Array.isArray(eintrag)
  if (ausnahme) {
    if (typeof eintrag.ausnahme !== 'string' || eintrag.ausnahme.trim().length < 15) fehler.push(`${pfad}: Ausnahme ohne Grund (mindestens 15 Zeichen)`)
    if (/leseKonflikt\(/.test(quelle.replace(/^import .*$/gm, ''))) fehler.push(`${pfad}: ruft leseKonflikt auf, steht aber als Ausnahme in der Liste – Bereich eintragen`)
    return fehler
  }
  const soll = (Array.isArray(eintrag) ? eintrag : [eintrag]).slice()
  if (soll.length === 0 || soll.some(b => typeof b !== 'string')) return [`${pfad}: Eintrag ist weder Bereich, Liste noch Ausnahme`]
  for (const b of soll) {
    if (!bereiche.includes(b)) fehler.push(`${pfad}: unbekannter Bereich „${b}“`)
    if (b === 'allgemein') fehler.push(`${pfad}: Bereich „allgemein“ braucht keine Prüfung – als { "ausnahme": "<Grund>" } eintragen`)
  }
  if (fehler.length) return fehler
  const teile = funktionen(quelle)
  const mitAufruf = new Set()
  for (const t of teile) {
    t.zeilen.forEach((z, i) => {
      const m = AUFRUF.exec(z)
      if (!m) {
        if (/leseKonflikt\(/.test(z)) fehler.push(`${pfad}: leseKonflikt nicht in der Form „const x = leseKonflikt(…)“ (Funktion ${t.name})`)
        return
      }
      const ist = bereicheAus(m[2])
      if (ist.slice().sort().join(',') !== soll.slice().sort().join(',')) fehler.push(`${pfad}: leseKonflikt prüft [${ist.join(', ')}], die Liste nennt [${soll.join(', ')}] (Funktion ${t.name})`)
      const folge = t.zeilen[i + 1] ?? ''
      if (!new RegExp(`^\\s*if \\(${m[1]}\\) return ${m[1]}\\b`).test(folge)) fehler.push(`${pfad}: nach leseKonflikt fehlt „if (${m[1]}) return ${m[1]}“ (Funktion ${t.name})`)
      mitAufruf.add(t.name)
    })
  }
  const handler = teile.filter(t => t.handler)
  if (handler.length === 0) fehler.push(`${pfad}: kein Handler der Form „export async function GET(…)“ gefunden`)
  for (const h of handler) {
    if (mitAufruf.has(h.name)) continue
    // Weitergabe an eine lokale Funktion mit Aufruf (z. B. „return handle(req)“ oder ein Kontext-Helfer)
    const delegiert = [...mitAufruf].some(n => new RegExp(`\\b${n}\\(`).test(h.text))
    if (!delegiert) fehler.push(`${pfad}: Handler ${h.name} ohne leseKonflikt(…, ${soll.map(b => `'${b}'`).join(', ')})`)
  }
  return fehler
}

function pruefe(liste, vorhandene, lese, bereiche) {
  const fehler = []
  const eintraege = liste.routen ?? {}
  for (const r of vorhandene) if (!(r in eintraege)) fehler.push(`${r}: Route ohne Eintrag in scripts/lesebereich-routen.json`)
  for (const r of Object.keys(eintraege)) if (!vorhandene.includes(r)) fehler.push(`${r}: steht in der Liste, aber src/app/api/${r}/route.ts gibt es nicht`)
  for (const r of vorhandene) if (r in eintraege) fehler.push(...pruefeRoute(r, eintraege[r], lese(r), bereiche))
  return fehler
}

module.exports = { pruefe, pruefeRoute, bereicheAus, funktionen, routen }

if (require.main === module) {
  const wurzel = path.resolve(__dirname, '..')
  const api = path.join(wurzel, 'src', 'app', 'api')
  const liste = JSON.parse(fs.readFileSync(path.join(wurzel, 'scripts', 'lesebereich-routen.json'), 'utf8'))
  const bereiche = Object.keys(JSON.parse(fs.readFileSync(path.join(wurzel, 'scripts', 'lesebereiche.json'), 'utf8')).bereiche)
  const vorhandene = routen(api)
  const fehler = pruefe(liste, vorhandene, r => fs.readFileSync(path.join(api, r, 'route.ts'), 'utf8'), bereiche)
  if (process.argv.includes('--liste')) {
    for (const r of vorhandene) {
      const e = liste.routen[r]
      console.log(`${(Array.isArray(e) ? e.join('+') : typeof e === 'string' ? e : 'Ausnahme').padEnd(16)} ${r}${e && e.ausnahme ? `  – ${e.ausnahme}` : ''}`)
    }
  }
  if (fehler.length) {
    console.error(`✗ check-lesebereich-routen: ${fehler.length} Befund(e)`)
    for (const f of fehler) console.error(`  ${f}`)
    process.exit(1)
  }
  const mit = vorhandene.filter(r => typeof liste.routen[r] === 'string' || Array.isArray(liste.routen[r])).length
  console.log(`✓ check-lesebereich-routen: ${vorhandene.length} Routen, ${mit} mit Lesebereich, ${vorhandene.length - mit} begründete Ausnahmen.`)
}
