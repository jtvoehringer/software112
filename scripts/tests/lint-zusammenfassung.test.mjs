// Tests für die reine Logik hinter `npm run lint:verify` (scripts/lint-auswertung.mjs, KAN-140):
// Hunk-Parser, Vergleichsbasis, Regelvergleich, Baseline-Schreiben und Exit-Code.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --test scripts/tests/lint-zusammenfassung.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  basisErmitteln,
  zeilenAusDiff,
  aufGeaendertenZeilen,
  vergleichen,
  baselineVerweigerung,
  neueBaseline,
  exitCode,
  ratscheAktiv,
} from '../lint-auswertung.mjs'

describe('zeilenAusDiff', () => {
  test('+N ohne Anzahl = eine Zeile, +N,M = M Zeilen', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3 +3 @@ export const x = 1',
      '@@ -10,2 +11,3 @@',
    ].join('\n')
    assert.deepEqual(zeilenAusDiff(diff), new Map([['src/a.ts', [[3, 3], [11, 13]]]]))
  })

  test('+N,0 (reine Löschung) ergibt keine Zeile, die Datei bleibt aber bekannt', () => {
    const diff = ['--- a/src/b.ts', '+++ b/src/b.ts', '@@ -5,2 +4,0 @@'].join('\n')
    assert.deepEqual(zeilenAusDiff(diff), new Map([['src/b.ts', []]]))
  })

  test('+++ /dev/null (gelöschte Datei) wird übersprungen, auch ihre Hunks', () => {
    const diff = [
      '--- a/src/weg.ts',
      '+++ /dev/null',
      '@@ -1,4 +0,0 @@',
      '--- a/src/c.ts',
      '+++ b/src/c.ts',
      '@@ -1 +1,2 @@',
    ].join('\n')
    assert.deepEqual(zeilenAusDiff(diff), new Map([['src/c.ts', [[1, 2]]]]))
  })

  test('neue Datei (--- /dev/null) wird mit ihren Zeilen erfasst', () => {
    const diff = ['--- /dev/null', '+++ b/src/neu.ts', '@@ -0,0 +1,7 @@'].join('\n')
    assert.deepEqual(zeilenAusDiff(diff), new Map([['src/neu.ts', [[1, 7]]]]))
  })

  test('CRLF-Zeilenenden werden toleriert', () => {
    const diff = ['--- a/src/d.ts', '+++ b/src/d.ts', '@@ -2 +2,2 @@', ''].join('\r\n')
    assert.deepEqual(zeilenAusDiff(diff), new Map([['src/d.ts', [[2, 3]]]]))
  })

  test('Pfade mit Leerzeichen: git hängt einen TAB an die +++-Zeile, der wird entfernt', () => {
    const diff = ['+++ b/src/app/(dashboard)/weingärten/neu page.tsx\t', '@@ -1 +1 @@'].join('\n')
    assert.deepEqual(zeilenAusDiff(diff), new Map([['src/app/(dashboard)/weingärten/neu page.tsx', [[1, 1]]]]))
  })

  test('von git in Anführungszeichen gesetzte Pfade werden übersprungen', () => {
    const diff = ['+++ "b/src/a\\"b.ts"', '@@ -1 +1 @@', '+++ b/src/c.ts', '@@ -2 +2 @@'].join('\n')
    assert.deepEqual(zeilenAusDiff(diff), new Map([['src/c.ts', [[2, 2]]]]))
  })

  test('echte git-Ausgabe: Umlaute und Leerzeichen (core.quotePath=false wie im Skript)', () => {
    const ort = mkdtempSync(path.join(tmpdir(), 'lint-diff-'))
    const git = (...args) =>
      execFileSync('git', ['-c', 'core.quotePath=false', '-c', 'core.autocrlf=false', ...args], {
        cwd: ort,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    try {
      git('init', '-q')
      mkdirSync(path.join(ort, 'weingärten'))
      const dateien = ['weingärten/neu page.tsx', 'ohne.ts']
      for (const d of dateien) writeFileSync(path.join(ort, d), 'a\nb\nc\n')
      git('add', '.')
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
      for (const d of dateien) writeFileSync(path.join(ort, d), 'a\nB\nc\nd\n')
      assert.deepEqual(
        zeilenAusDiff(git('diff', '-U0', 'HEAD')),
        new Map([
          ['ohne.ts', [[2, 2], [4, 4]]],
          ['weingärten/neu page.tsx', [[2, 2], [4, 4]]],
        ]),
      )
    } finally {
      rmSync(ort, { recursive: true, force: true })
    }
  })

  test('leerer oder fehlender Diff ergibt eine leere Map', () => {
    assert.equal(zeilenAusDiff('').size, 0)
    assert.equal(zeilenAusDiff(null).size, 0)
  })
})

describe('aufGeaendertenZeilen', () => {
  test('Bereichsgrenzen inklusive, "alle" für neue Dateien', () => {
    assert.equal(aufGeaendertenZeilen([[3, 5]], 3), true)
    assert.equal(aufGeaendertenZeilen([[3, 5]], 5), true)
    assert.equal(aufGeaendertenZeilen([[3, 5]], 6), false)
    assert.equal(aufGeaendertenZeilen([], 1), false)
    assert.equal(aufGeaendertenZeilen('alle', 999), true)
  })
})

// Attrappe für git: Antworten je Argumentliste, sonst null (= Fehler).
function gitAttrappe(antworten) {
  const aufrufe = []
  const git = (args) => {
    aufrufe.push(args.join(' '))
    return antworten[args.join(' ')] ?? null
  }
  return { git, aufrufe }
}

describe('basisErmitteln', () => {
  test('lokal: merge-base mit origin/main', () => {
    const { git } = gitAttrappe({
      'rev-parse --verify -q HEAD': 'kopf\n',
      'merge-base origin/main HEAD': 'abzweig\n',
    })
    assert.deepEqual(basisErmitteln(git, {}), { basis: 'abzweig', quelle: 'Abzweig von origin/main' })
  })

  test('Pull Request: GITHUB_BASE_REF hat Vorrang', () => {
    const { git } = gitAttrappe({
      'rev-parse --verify -q HEAD': 'kopf\n',
      'merge-base origin/release HEAD': 'rel\n',
      'merge-base origin/main HEAD': 'abzweig\n',
    })
    assert.equal(basisErmitteln(git, { GITHUB_BASE_REF: 'release', GITHUB_ACTIONS: 'true' }).basis, 'rel')
  })

  test('flacher PR-Checkout ohne origin/main, HEAD ist Merge-Commit: HEAD^1', () => {
    const { git } = gitAttrappe({
      'rev-parse --verify -q HEAD': 'kopf\n',
      'rev-parse --verify -q HEAD^2': 'pr\n',
      'rev-parse --verify -q HEAD^1': 'mainspitze\n',
    })
    assert.deepEqual(basisErmitteln(git, { GITHUB_BASE_REF: 'main', GITHUB_ACTIONS: 'true' }), {
      basis: 'mainspitze',
      quelle: 'HEAD^1 (Merge-Commit)',
    })
  })

  test('flacher Checkout ohne origin/main und ohne Merge-Commit: null statt HEAD', () => {
    const { git } = gitAttrappe({ 'rev-parse --verify -q HEAD': 'kopf\n' })
    assert.deepEqual(basisErmitteln(git, { GITHUB_ACTIONS: 'true' }), { basis: null, quelle: null })
  })

  test('Push auf main in der CI (Abzweig = HEAD): HEAD^1', () => {
    const { git } = gitAttrappe({
      'rev-parse --verify -q HEAD': 'kopf\n',
      'merge-base origin/main HEAD': 'kopf\n',
      'rev-parse --verify -q HEAD^1': 'vorher\n',
    })
    assert.equal(basisErmitteln(git, { GITHUB_ACTIONS: 'true' }).basis, 'vorher')
  })

  test('lokal auf main (Abzweig = HEAD): HEAD bleibt Basis (Arbeitsstand gegen HEAD)', () => {
    const { git } = gitAttrappe({
      'rev-parse --verify -q HEAD': 'kopf\n',
      'merge-base origin/main HEAD': 'kopf\n',
      'rev-parse --verify -q HEAD^1': 'vorher\n',
    })
    assert.equal(basisErmitteln(git, {}).basis, 'kopf')
  })
})

describe('vergleichen', () => {
  const zaehlung = new Map([
    ['a', 5],
    ['b', 2],
    ['neu', 1],
  ])

  test('Regel ohne Eintrag zählt als 0, Regel ohne Warnings bleibt sichtbar', () => {
    const { regeln, ueber, unter } = vergleichen(zaehlung, { a: 5, b: 3, weg: 4 })
    assert.deepEqual(ueber, ['neu'])
    assert.deepEqual(unter, ['b', 'weg'])
    assert.deepEqual(regeln, ['a', 'b', 'neu', 'weg'])
  })

  test('ohne Baseline gilt die Zählung selbst (nichts über, nichts unter)', () => {
    const { ueber, unter, vergleich } = vergleichen(zaehlung, null)
    assert.deepEqual(ueber, [])
    assert.deepEqual(unter, [])
    assert.deepEqual(vergleich, { a: 5, b: 2, neu: 1 })
  })

  test('Grenze: Abbau und neue Warning derselben Regel gleichen sich aus', () => {
    const { ueber, unter } = vergleichen(new Map([['a', 5]]), { a: 5 })
    assert.deepEqual([ueber, unter], [[], []])
  })
})

describe('Baseline schreiben', () => {
  test('verweigert bei Errors', () => {
    assert.match(baselineVerweigerung({ errors: 1, baseline: { a: 1 }, ueber: [] }), /Errors/)
  })

  test('verweigert bei Überschreitung und nennt die Regel', () => {
    assert.match(baselineVerweigerung({ errors: 0, baseline: { a: 1 }, ueber: ['a'] }), /Über dem Ausgangswert: a\./)
  })

  test('erlaubt ohne Errors und ohne Überschreitung, auch beim ersten Anlegen', () => {
    assert.equal(baselineVerweigerung({ errors: 0, baseline: { a: 3 }, ueber: [] }), null)
    assert.equal(baselineVerweigerung({ errors: 0, baseline: null, ueber: ['a'] }), null)
  })

  test('abgebaute Regeln fallen heraus, Reihenfolge stimmt, ohne Datum und Summe (konfliktarm)', () => {
    const neu = neueBaseline(
      new Map([
        ['b', 2],
        ['weg', 0],
        ['a', 5],
        ['c', 2],
      ]),
    )
    assert.deepEqual(neu, { regeln: { a: 5, b: 2, c: 2 } })
    assert.deepEqual(Object.keys(neu.regeln), ['a', 'b', 'c'])
  })
})

describe('exitCode', () => {
  test('rot bei Errors oder Überschreitung', () => {
    assert.equal(exitCode({ errors: 1, ueber: [], unter: [], ratsche: false }), 1)
    assert.equal(exitCode({ errors: 0, ueber: ['a'], unter: [], ratsche: false }), 1)
  })

  test('gesunken: ohne Ratsche grün, mit Ratsche rot', () => {
    assert.equal(exitCode({ errors: 0, ueber: [], unter: ['a'], ratsche: false }), 0)
    assert.equal(exitCode({ errors: 0, ueber: [], unter: ['a'], ratsche: true }), 1)
  })

  test('gleichauf: grün', () => {
    assert.equal(exitCode({ errors: 0, ueber: [], unter: [], ratsche: true }), 0)
  })
})

describe('ratscheAktiv', () => {
  test('nur im Pull-Request-Lauf der CI', () => {
    assert.equal(ratscheAktiv({ CI: 'true', GITHUB_EVENT_NAME: 'pull_request' }), true)
  })

  test('Push auf main: nur Hinweis – zwei grüne PRs, die dieselbe Regel senken, machen main nicht rot', () => {
    assert.equal(ratscheAktiv({ CI: 'true', GITHUB_EVENT_NAME: 'push' }), false)
    assert.equal(ratscheAktiv({ CI: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch' }), false)
  })

  test('lokal bzw. CI=false: aus', () => {
    assert.equal(ratscheAktiv({}), false)
    assert.equal(ratscheAktiv({ CI: 'false', GITHUB_EVENT_NAME: 'pull_request' }), false)
  })
})
