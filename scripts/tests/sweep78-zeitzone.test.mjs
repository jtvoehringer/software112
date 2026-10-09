// Sweep 78 (09.10.2026): Datum/Uhrzeit in Server-Code immer mit timeZone 'Europe/Vienna' formatieren.
// Vercel läuft in UTC: toLocaleString()/toLocaleDateString() ohne timeZone zeigten Zeitstempel (Monatsabschluss gesperrt
// am, Dauerauftrags-Protokoll, storniert am, hochgeladen am …) 1–2 Stunden zu früh und zwischen 0 und 2 Uhr Wiener Zeit
// mit dem Datum des Vortags; „Stand/Gedruckt: heute“ ebenso. Reine Datumswerte ('2026-10-09' = UTC-Mitternacht) bleiben
// mit Wiener Zone derselbe Tag. Hier: Zeitzonen-Rechnung unter TZ=UTC (wie auf Vercel) und der Wächter (Regel 3).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-datum.js'))
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8')
const WIEN = { timeZone: 'Europe/Vienna' }

function unterUtc(fn) {
  const alt = process.env.TZ
  process.env.TZ = 'UTC'
  try { return fn() } finally { if (alt === undefined) delete process.env.TZ; else process.env.TZ = alt }
}

describe('Formatierung auf einem UTC-Server', () => {
  test('Zeitstempel nach Mitternacht Wiener Zeit: ohne Zone der Vortag, mit Zone richtig', () => {
    unterUtc(() => {
      const storno = new Date('2026-10-09T22:30:00Z')   // 10.10.2026, 00:30 in Wien (Sommerzeit)
      assert.equal(storno.toLocaleDateString('de-AT'), '9.10.2026', 'Gegenprobe: alter Code zeigte den Vortag')
      assert.equal(storno.toLocaleDateString('de-AT', WIEN), '10.10.2026')
    })
  })
  test('Uhrzeit: ohne Zone UTC (2 Stunden zu früh), mit Zone Wien', () => {
    unterUtc(() => {
      const gesperrt = new Date('2026-10-09T08:15:00Z')
      const opt = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      assert.match(gesperrt.toLocaleString('de-AT', opt), /08:15/)
      assert.match(gesperrt.toLocaleString('de-AT', { ...WIEN, ...opt }), /10:15/)
    })
  })
  test('reine Datumswerte bleiben mit Wiener Zone derselbe Tag (auch Winterzeit, auch mit T00:00:00)', () => {
    unterUtc(() => {
      for (const d of ['2026-10-09', '2026-01-01', '2026-03-29', '2026-10-25']) {
        const [j, m, t] = d.split('-').map(Number)
        const soll = `${t}.${m}.${j}`
        assert.equal(new Date(d).toLocaleDateString('de-AT', WIEN), soll, d)
        assert.equal(new Date(`${d}T00:00:00`).toLocaleDateString('de-AT', WIEN), soll, `${d}T00:00:00`)
      }
    })
  })
})

describe('check-datum Regel 3: Datumsanzeige ohne Zeitzone in Server-Code', () => {
  test('Server-Code ohne timeZone → Fund (Datum, Uhrzeit, Intl, Zeitstempel-toLocaleString)', () => {
    for (const t of ["const s = new Date(x.storniert_am).toLocaleDateString('de-AT')",
      "const s = d.toLocaleTimeString('de-AT', { hour: '2-digit' })",
      "const f = new Intl.DateTimeFormat('de-AT', { month: 'long' })",
      "const s = new Date(ts).toLocaleString('de-AT', { day: '2-digit', hour: '2-digit' })",
      "const s = new Date().toLocaleDateString()"]) {
      assert.equal(pruefeText(t + '\n').funde.length, 1, t)
    }
  })
  test('kein Fund: mit timeZone, Zahlen, Client-Komponenten, Ausnahme', () => {
    assert.equal(pruefeText("const s = d.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })\n").funde.length, 0)
    assert.equal(pruefeText("const s = d.toLocaleDateString('de-AT', {\n  timeZone: 'Europe/Vienna', day: '2-digit' })\n").funde.length, 0)
    assert.equal(pruefeText("const s = n.toLocaleString('de-DE', { maximumFractionDigits: 2 })\n").funde.length, 0)
    assert.equal(pruefeText("'use client'\nconst s = new Date(x).toLocaleDateString('de-AT')\n").funde.length, 0)
    assert.deepEqual(pruefeText("// datum-ok: bewusst UTC für den technischen Protokollkopf\nconst s = d.toLocaleString('de-AT', { hour: '2-digit' })\n"),
      { funde: [], ausnahmen: 1 })
  })
  test('ganzes Projekt ohne Fund; Monatsabschluss und Dauerauftrags-Protokoll zeigen Wiener Zeit', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
    for (const p of ['src/app/(dashboard)/buchhaltung/monatsabschluss/page.tsx', 'src/app/(dashboard)/buchhaltung/dauerauftraege/page.tsx']) {
      assert.match(quelle(p), /toLocaleString\('de-AT', \{ timeZone: 'Europe\/Vienna', day: '2-digit'/, p)
    }
  })
})
