// KAN-269 (10.10.2026): GitHub-Actions-Minuten sparen – das Repository ist privat, der Free-Plan hat ein Monatskontingent,
// und ohne Verrechnung startet GitHub danach keinen Job mehr (auch nicht das Pflicht-Gate „check“).
//   - keine Zeitpläne (schedule) in GitHub Actions – Cron-Aufgaben laufen als Vercel-Cron (vercel.json)
//   - das Gate läuft nur bei PRs (nicht zusätzlich beim Push auf main), ältere Läufe desselben PRs werden abgebrochen
//   - Jobs auf deployment_status brauchen ein Job-`if` (jedes Deployment meldet mehrere Zustände)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const wurzel = new URL('../../', import.meta.url)
const lies = (p) => readFileSync(new URL(p, wurzel), 'utf8').replace(/\r\n/g, '\n')
const workflows = readdirSync(new URL('.github/workflows/', wurzel)).filter(f => /\.ya?ml$/.test(f))

describe('KAN-269: Actions-Minuten', () => {
  test('kein Workflow mit Zeitplan (schedule) – Cron-Aufgaben gehören in vercel.json', () => {
    for (const f of workflows) assert.doesNotMatch(lies(`.github/workflows/${f}`), /^\s*schedule:/m, f)
    const crons = JSON.parse(lies('vercel.json')).crons.map(c => c.path)
    assert.ok(crons.includes('/api/m365/subscribe'), 'M365-Webhook-Erneuerung läuft als Vercel-Cron')
  })

  test('Gate „Prüfungen (verify)“ nur bei PRs (und manuell), mit Abbruch älterer Läufe', () => {
    const v = lies('.github/workflows/tenant-isolation-check.yml')
    const on = v.slice(v.indexOf('\non:'), v.indexOf('\njobs:'))
    assert.match(on, /\n {2}pull_request:\n {4}branches: \[main\]/)
    assert.doesNotMatch(on, /\n {2}push:/, 'kein zweiter Lauf beim Push auf main')
    assert.match(on, /concurrency:\n {2}group: verify-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n {2}cancel-in-progress: true/)
    // die Pflicht-Checks des Rulesets heißen weiter „check“ und „abhaengigkeiten“
    assert.match(v, /\n {2}check:\n/)
    assert.match(v, /\n {2}abhaengigkeiten:\n/)
  })

  test('deployment_status: jeder Job ohne needs hat ein Job-if (sonst ein Runner je Deployment-Zustand)', () => {
    for (const f of workflows) {
      const w = lies(`.github/workflows/${f}`)
      if (!/^\s*deployment_status:/m.test(w)) continue
      const jobs = w.slice(w.indexOf('\njobs:\n') + 7).split(/\n(?= {2}[a-z0-9_-]+:\n)/)
      for (const j of jobs) {
        const name = j.match(/^ {2}([a-z0-9_-]+):/)?.[1]
        if (!name || /\n {4}needs:/.test(j)) continue
        assert.match(j, /\n {4}if: /, `${f}: Job „${name}“ braucht ein if`)
      }
    }
    assert.match(lies('.github/workflows/e2e.yml'), /if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event\.deployment_status\.state == 'success' && startsWith\(github\.event\.deployment\.environment, 'Preview'\)\)/)
  })
})
