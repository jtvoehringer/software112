// Reine Logik für scripts/lint-zusammenfassung.mjs (KAN-140) – ohne ESLint und ohne Seiteneffekte,
// damit scripts/tests/lint-zusammenfassung.test.mjs sie direkt prüfen kann.
//
// - basisErmitteln: Vergleichsbasis für „geänderte Zeilen“ (git-Aufruf wird hereingereicht).
// - zeilenAusDiff: Hunks aus `git diff -U0` → Pfad → [[von, bis], …] (Zeilennummern des Arbeitsstands).
// - vergleichen: Zählung je Regel gegen den Ausgangswert → ueber/unter.
// - baselineVerweigerung / neueBaseline: Bedingungen und Inhalt für `npm run lint:baseline`.
// - exitCode: rot bei Errors, Regeln über dem Ausgangswert und – in der CI – auch darunter
//   (Ratsche: der Ausgangswert muss nach einem Abbau gesenkt werden, sonst ließe sich der frei
//   gewordene Spielraum später mit neuen Warnings füllen).

// Vergleichsbasis: Abzweig vom Ziel-Branch. Reihenfolge:
//   1. merge-base mit origin/$GITHUB_BASE_REF (Pull Request in GitHub Actions), sonst origin/main;
//      ist der Abzweig HEAD selbst (Push auf main in der CI), dann HEAD^1 = Stand vor dem Push.
//   2. HEAD ist ein Merge-Commit (PR-Checkout ohne origin/main, braucht fetch-depth ≥ 2): HEAD^1.
//   3. sonst null – geänderte Zeilen unbekannt (NICHT stillschweigend HEAD).
// `git(args)` liefert stdout oder null bei einem Fehler.
export function basisErmitteln(git, env = {}) {
  const kopf = git(['rev-parse', '--verify', '-q', 'HEAD'])?.trim() || null
  const vorgaenger = () => git(['rev-parse', '--verify', '-q', 'HEAD^1'])?.trim() || null
  const ziele = []
  if (env.GITHUB_BASE_REF) ziele.push(`origin/${env.GITHUB_BASE_REF}`)
  if (!ziele.includes('origin/main')) ziele.push('origin/main')
  for (const ziel of ziele) {
    const abzweig = git(['merge-base', ziel, 'HEAD'])?.trim()
    if (!abzweig) continue
    if (abzweig === kopf && env.GITHUB_ACTIONS) {
      const vor = vorgaenger()
      if (vor) return { basis: vor, quelle: 'HEAD^1 (Push auf den Ziel-Branch)' }
    }
    return { basis: abzweig, quelle: `Abzweig von ${ziel}` }
  }
  if (git(['rev-parse', '--verify', '-q', 'HEAD^2'])?.trim()) {
    const vor = vorgaenger()
    if (vor) return { basis: vor, quelle: 'HEAD^1 (Merge-Commit)' }
  }
  return { basis: null, quelle: null }
}

// Hunks aus `git diff -U0`: `+N` ohne Anzahl = 1 Zeile, `+N,0` = reine Löschung (keine Zeile),
// `+++ /dev/null` = gelöschte Datei (übersprungen). CRLF wird toleriert.
export function zeilenAusDiff(diffText) {
  const zeilen = new Map()
  let datei = null
  for (const roh of (diffText ?? '').split('\n')) {
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
  return zeilen
}

// Liegt eine Meldung auf geänderten Zeilen? bereiche = [[von, bis], …] oder 'alle' (neue Datei).
export function aufGeaendertenZeilen(bereiche, zeile) {
  if (bereiche === 'alle') return true
  return (bereiche ?? []).some(([von, bis]) => zeile >= von && zeile <= bis)
}

// zaehlung: Map Regel → Anzahl; baseline: { Regel: Anzahl } oder null (dann gilt die Zählung selbst).
// Regel ohne Eintrag = Ausgangswert 0. Sortierung: absteigend nach aktueller Anzahl, dann Name.
export function vergleichen(zaehlung, baseline) {
  const vergleich = baseline ?? Object.fromEntries(zaehlung)
  const ist = (r) => zaehlung.get(r) ?? 0
  const soll = (r) => vergleich[r] ?? 0
  const regeln = [...new Set([...zaehlung.keys(), ...Object.keys(vergleich)])].sort(
    (a, b) => ist(b) - ist(a) || a.localeCompare(b),
  )
  return {
    vergleich,
    regeln,
    ueber: regeln.filter((r) => ist(r) > soll(r)),
    unter: regeln.filter((r) => ist(r) < soll(r)),
  }
}

// Grund, warum `--baseline` nicht schreibt, oder null.
export function baselineVerweigerung({ errors, baseline, ueber }) {
  const gruende = []
  if (errors > 0) gruende.push('es gibt Errors.')
  if (baseline && ueber.length > 0) {
    gruende.push(
      `Über dem Ausgangswert: ${ueber.join(', ')}. Erhöhen nur bewusst von Hand in scripts/eslint-baseline.json (mit Begründung im PR).`,
    )
  }
  return gruende.length > 0 ? gruende.join(' ') : null
}

// Neuer Inhalt von scripts/eslint-baseline.json: nur Regeln mit mindestens einer Warning
// (abgebaute Regeln fallen heraus), absteigend nach Anzahl, bei Gleichstand nach Name.
export function neueBaseline(zaehlung, stand) {
  const regeln = [...zaehlung.entries()]
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  return {
    stand,
    summe: regeln.reduce((s, [, n]) => s + n, 0),
    regeln: Object.fromEntries(regeln),
  }
}

export function exitCode({ errors, ueber, unter, ci }) {
  if (errors > 0 || ueber.length > 0) return 1
  if (ci && unter.length > 0) return 1
  return 0
}
