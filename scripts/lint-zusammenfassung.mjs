// Kompakter ESLint-Lauf für `npm run verify` (KAN-140) – `npm run lint` bleibt die volle Einzelansicht.
//
// - Errors werden vollständig ausgegeben (Format „stylish“), Warnings nur als Zählung je Regel.
// - Sperre gegen neue Warnings: Vergleich mit scripts/eslint-baseline.json (Ausgangswert je Regel).
//   Exit 1 bei mindestens einem Error oder wenn eine Regel mehr Warnings hat als ihr Ausgangswert
//   (Regel ohne Eintrag = Ausgangswert 0). Für solche Regeln zeigt das Skript die Stellen auf
//   geänderten Zeilen (git: Arbeitsstand gegenüber dem Abzweig von origin/main, sonst gegenüber HEAD;
//   neue Dateien ganz).
// - Warnings abgebaut: `npm run lint:baseline` schreibt die aktuellen Zahlen – nur, wenn es keine
//   Errors gibt und keine Regel über ihrem Ausgangswert liegt. Erhöhen nur bewusst von Hand in der
//   JSON-Datei, mit Begründung im PR.
// - Cache unter node_modules/.cache/eslint/ (eine Datei je Arbeitsverzeichnis, auch bei einer
//   Junction auf die node_modules des Haupt-Checkouts; `npm ci` leert ihn).
import { ESLint } from 'eslint'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_DATEI = path.join(WURZEL, 'scripts', 'eslint-baseline.json')
const CACHE_ORT = path.join(WURZEL, 'node_modules', '.cache', 'eslint') + path.sep
// Warnings ohne ruleId sind `// eslint-disable`-Kommentare, die nichts unterdrücken
// (reportUnusedDisableDirectives: 'warn' in eslint.config.mjs).
const OHNE_REGEL = '(unbenutzte eslint-disable-Kommentare)'
const MAX_EINZELN = 60

const baselineSchreiben = process.argv.includes('--baseline')

const regelVon = (m) => m.ruleId ?? OHNE_REGEL
const relativ = (datei) => path.relative(WURZEL, datei).split(path.sep).join('/')

function baselineLesen() {
  if (!existsSync(BASELINE_DATEI)) return null
  const inhalt = JSON.parse(readFileSync(BASELINE_DATEI, 'utf8'))
  return inhalt.regeln ?? {}
}

function git(args) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: WURZEL,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

// Geänderte Zeilen je Datei (Zeilennummern des Arbeitsstands): Pfad → [[von, bis], …] oder 'alle'.
function geaenderteZeilen() {
  const basis = git(['merge-base', 'origin/main', 'HEAD'])?.trim() || 'HEAD'
  const diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', basis]) ?? ''
  const zeilen = new Map()
  let datei = null
  for (const roh of diff.split('\n')) {
    const z = roh.replace(/\r$/, '')
    if (z.startsWith('+++ ')) {
      datei = z.startsWith('+++ b/') ? z.slice(6) : null
      if (datei && !zeilen.has(datei)) zeilen.set(datei, [])
    } else if (datei && z.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(z)
      if (!m) continue
      const von = Number(m[1])
      const anzahl = m[2] === undefined ? 1 : Number(m[2])
      if (anzahl > 0) zeilen.get(datei).push([von, von + anzahl - 1])
    }
  }
  for (const d of (git(['ls-files', '--others', '--exclude-standard']) ?? '').split('\n')) {
    const pfad = d.trim()
    if (pfad) zeilen.set(pfad, 'alle')
  }
  return zeilen
}

// Ergebnis auf ausgewählte Meldungen einschränken (für die Ausgabe mit „stylish“).
function nurMeldungen(r, messages) {
  return {
    ...r,
    messages,
    errorCount: 0,
    fatalErrorCount: 0,
    fixableErrorCount: 0,
    warningCount: messages.length,
    fixableWarningCount: messages.filter((m) => m.fix).length,
  }
}

async function neueStellenZeigen(ergebnisse, ueber, stylish) {
  const zeilen = geaenderteZeilen()
  const ueberSet = new Set(ueber)
  const aufZeilen = []
  const inDateien = []
  for (const r of ergebnisse) {
    const bereiche = zeilen.get(relativ(r.filePath))
    if (!bereiche) continue
    const betroffen = r.messages.filter((m) => m.severity === 1 && ueberSet.has(regelVon(m)))
    if (betroffen.length === 0) continue
    const geaendert = betroffen.filter(
      (m) => bereiche === 'alle' || bereiche.some(([von, bis]) => m.line >= von && m.line <= bis),
    )
    if (geaendert.length > 0) aufZeilen.push(nurMeldungen(r, geaendert))
    inDateien.push({ datei: relativ(r.filePath), anzahl: betroffen.length })
  }
  const anzahl = aufZeilen.reduce((s, r) => s + r.messages.length, 0)
  if (anzahl > 0 && anzahl <= MAX_EINZELN) {
    console.log('Stellen auf geänderten Zeilen:')
    process.stdout.write(await stylish.format(aufZeilen))
  } else if (anzahl > MAX_EINZELN || inDateien.length > 0) {
    console.log(
      anzahl > 0
        ? `${anzahl} Stellen auf geänderten Zeilen – Einzelansicht mit \`npx eslint <datei>\`:`
        : 'Keine davon auf geänderten Zeilen (z. B. Verwendung entfernt), aber in geänderten Dateien:',
    )
    for (const { datei, anzahl: n } of inDateien) console.log(`  ${datei} (${n})`)
  } else {
    console.log('Keine davon in geänderten Dateien gefunden – Einzelansicht mit `npm run lint`.')
  }
}

async function main() {
  let eslint
  let ergebnisse
  try {
    eslint = new ESLint({
      cwd: WURZEL,
      cache: true,
      cacheLocation: CACHE_ORT,
      cacheStrategy: 'content',
    })
    ergebnisse = await eslint.lintFiles(['.'])
  } catch (fehler) {
    console.error(`ESLint konnte nicht laufen: ${fehler?.message ?? fehler}`)
    return 2
  }

  const stylish = await eslint.loadFormatter('stylish')
  let errors = 0
  const zaehlung = new Map()
  for (const r of ergebnisse) {
    for (const m of r.messages) {
      if (m.severity === 2 || m.fatal) errors++
      else if (m.severity === 1) zaehlung.set(regelVon(m), (zaehlung.get(regelVon(m)) ?? 0) + 1)
    }
  }
  const warnings = [...zaehlung.values()].reduce((a, b) => a + b, 0)

  if (errors > 0) process.stdout.write(await stylish.format(ESLint.getErrorResults(ergebnisse)))

  const baseline = baselineLesen()
  const vergleich = baseline ?? Object.fromEntries(zaehlung)
  const regeln = [...new Set([...zaehlung.keys(), ...Object.keys(vergleich)])].sort(
    (a, b) => (zaehlung.get(b) ?? 0) - (zaehlung.get(a) ?? 0) || a.localeCompare(b),
  )
  const ueber = regeln.filter((r) => (zaehlung.get(r) ?? 0) > (vergleich[r] ?? 0))
  const unter = regeln.filter((r) => (zaehlung.get(r) ?? 0) < (vergleich[r] ?? 0))

  console.log(`ESLint: ${errors} Errors, ${warnings} Warnings in ${ergebnisse.length} Dateien`)
  console.log('Warnings je Regel (aktuell / Ausgangswert aus scripts/eslint-baseline.json):')
  const breite = String(Math.max(0, ...regeln.map((r) => Math.max(zaehlung.get(r) ?? 0, vergleich[r] ?? 0)))).length
  for (const r of regeln) {
    const ist = zaehlung.get(r) ?? 0
    const soll = vergleich[r] ?? 0
    const marke = ist > soll ? '  <-- ÜBER DEM AUSGANGSWERT' : ist < soll ? '  (gesunken)' : ''
    console.log(`  ${String(ist).padStart(breite)} / ${String(soll).padStart(breite)}  ${r}${marke}`)
  }

  if (baselineSchreiben) {
    if (errors > 0 || (baseline && ueber.length > 0)) {
      console.log(
        '\nAusgangswerte NICHT geschrieben: ' +
          (errors > 0 ? 'es gibt Errors. ' : '') +
          (baseline && ueber.length > 0
            ? `Über dem Ausgangswert: ${ueber.join(', ')}. Erhöhen nur bewusst von Hand in scripts/eslint-baseline.json (mit Begründung im PR).`
            : ''),
      )
      return 1
    }
    const neu = {
      stand: new Date().toISOString().slice(0, 10),
      summe: warnings,
      regeln: Object.fromEntries(regeln.filter((r) => zaehlung.get(r)).map((r) => [r, zaehlung.get(r)])),
    }
    writeFileSync(BASELINE_DATEI, JSON.stringify(neu, null, 2) + '\n')
    console.log(`\nAusgangswerte geschrieben: scripts/eslint-baseline.json (${warnings} Warnings) – mit committen.`)
    return 0
  }

  if (!baseline) {
    console.log('\nscripts/eslint-baseline.json fehlt – mit `npm run lint:baseline` anlegen.')
    return 1
  }

  if (ueber.length > 0) {
    console.log(
      `\nNeue Warnings: ${ueber.map((r) => `${r} ${zaehlung.get(r) ?? 0} statt ${vergleich[r] ?? 0}`).join(', ')}.`,
    )
    await neueStellenZeigen(ergebnisse, ueber, stylish)
    console.log('Beheben, nicht die Ausgangswerte erhöhen (CLAUDE.md, Abschnitt Stabilität).')
  } else if (unter.length > 0) {
    console.log('\nWeniger Warnings als im Ausgangswert – `npm run lint:baseline` ausführen und scripts/eslint-baseline.json mit committen.')
  }

  return errors > 0 || ueber.length > 0 ? 1 : 0
}

process.exitCode = await main()
