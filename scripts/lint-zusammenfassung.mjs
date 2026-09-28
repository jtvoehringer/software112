// Kompakter ESLint-Lauf für `npm run verify` (KAN-140) – `npm run lint` bleibt die volle Einzelansicht.
//
// - Errors werden vollständig ausgegeben (Format „stylish“), Warnings nur als Zählung je Regel.
// - Sperre gegen neue Warnings: Vergleich mit scripts/eslint-baseline.json (Ausgangswert je Regel).
//   Exit 1 bei mindestens einem Error oder wenn eine Regel mehr Warnings hat als ihr Ausgangswert
//   (Regel ohne Eintrag = Ausgangswert 0); im Pull-Request-Lauf der CI auch, wenn eine Regel
//   darunter liegt – dann ist der Ausgangswert mit `npm run lint:baseline` zu senken (Ratsche, sonst
//   ließe sich der frei gewordene Spielraum später mit neuen Warnings füllen). Lokal und beim Push
//   auf main nur ein Hinweis (siehe exitCode/ratscheAktiv in scripts/lint-auswertung.mjs).
// - Für Regeln über dem Ausgangswert zeigt das Skript die Stellen auf geänderten Zeilen (git:
//   Arbeitsstand gegenüber dem Abzweig vom Ziel-Branch, siehe basisErmitteln in
//   scripts/lint-auswertung.mjs; neue Dateien ganz). Ist keine Vergleichsbasis ermittelbar, sagt es
//   das ausdrücklich (in der CI braucht es dafür den Checkout mit fetch-depth: 0).
// - Grenze: gezählt wird je Regel – eine abgebaute Warning gleicht eine neue derselben Regel aus.
// - Warnings abgebaut: `npm run lint:baseline` schreibt die aktuellen Zahlen – nur, wenn es keine
//   Errors gibt und keine Regel über ihrem Ausgangswert liegt. Erhöhen nur bewusst von Hand in der
//   JSON-Datei, mit Begründung im PR.
// - Cache unter node_modules/.cache/eslint/ (eine Datei je Arbeitsverzeichnis, auch bei einer
//   Junction auf die node_modules des Haupt-Checkouts; `npm ci` leert ihn).
// - Reine Logik (Diff-Parser, Vergleich, Baseline, Exit-Code) in scripts/lint-auswertung.mjs,
//   getestet in scripts/tests/lint-zusammenfassung.test.mjs.
import { ESLint } from 'eslint'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  basisErmitteln,
  zeilenAusDiff,
  aufGeaendertenZeilen,
  vergleichen,
  baselineVerweigerung,
  neueBaseline,
  exitCode,
  ratscheAktiv,
} from './lint-auswertung.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_DATEI = path.join(WURZEL, 'scripts', 'eslint-baseline.json')
const CACHE_ORT = path.join(WURZEL, 'node_modules', '.cache', 'eslint') + path.sep
// Warnings ohne ruleId sind `// eslint-disable`-Kommentare, die nichts unterdrücken
// (reportUnusedDisableDirectives: 'warn' in eslint.config.mjs).
const OHNE_REGEL = '(unbenutzte eslint-disable-Kommentare)'
const MAX_EINZELN = 60

const baselineSchreiben = process.argv.includes('--baseline')
const RATSCHE = ratscheAktiv(process.env)

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
// null, wenn keine Vergleichsbasis ermittelbar ist (z. B. flacher CI-Checkout ohne origin/main).
function geaenderteZeilen() {
  const { basis } = basisErmitteln(git, process.env)
  if (!basis) return null
  const diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', basis])
  if (diff === null) return null
  const zeilen = zeilenAusDiff(diff)
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
  if (!zeilen) {
    console.log(
      'Vergleichsbasis origin/main nicht verfügbar – geänderte Zeilen unbekannt. ' +
        'Stellen mit `npx eslint <datei>` bzw. `npm run lint` suchen (CI: Checkout mit fetch-depth: 0).',
    )
    return
  }
  const ueberSet = new Set(ueber)
  const aufZeilen = []
  const inDateien = []
  for (const r of ergebnisse) {
    const bereiche = zeilen.get(relativ(r.filePath))
    if (!bereiche) continue
    const betroffen = r.messages.filter((m) => m.severity === 1 && ueberSet.has(regelVon(m)))
    if (betroffen.length === 0) continue
    const geaendert = betroffen.filter((m) => aufGeaendertenZeilen(bereiche, m.line))
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
  const { vergleich, regeln, ueber, unter } = vergleichen(zaehlung, baseline)

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
    const grund = baselineVerweigerung({ errors, baseline, ueber })
    if (grund) {
      console.log(`\nAusgangswerte NICHT geschrieben: ${grund}`)
      return 1
    }
    const neu = neueBaseline(zaehlung)
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
    console.log(
      RATSCHE
        ? `\nAusgangswert senken: ${unter.join(', ')} unter dem Ausgangswert – \`npm run lint:baseline\` ausführen und scripts/eslint-baseline.json committen (im Pull Request rot, damit kein Spielraum für neue Warnings bleibt). Hat dieser PR die Regel nicht angefasst (ein anderer PR hat sie auf main schon gesenkt, ohne die Baseline nachzuziehen), genügt dasselbe nach einem Rebase auf main.`
        : '\nWeniger Warnings als im Ausgangswert – `npm run lint:baseline` ausführen und scripts/eslint-baseline.json mit committen (im Pull Request ist die CI sonst rot).',
    )
  }

  return exitCode({ errors, ueber, unter, ratsche: RATSCHE })
}

process.exitCode = await main()
