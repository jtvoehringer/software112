// Nebenbefund 11.11.2026 (12"-Notebook, Musterhof): Behandlungsprotokoll lief rechts aus der Karte („Witterung“
// abgeschnitten), die zweite Zeile der Navigation schnitt „Bestandsmeldung“ ab.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('Nebenbefund 12"-Notebook: nichts läuft unsichtbar aus dem Bild', () => {
  test('TabNav: Zeile 2 bricht ab md um (unter md weiter waagrecht verschiebbar)', () => {
    const t = quelle('src/components/layout/TabNav.tsx')
    assert.match(t, /flex gap-1 overflow-x-auto scrollbar-none md:flex-wrap md:overflow-x-visible">\s*\{aktiv\.items\.map/)
  })

  test('Behandlungsprotokoll: volle Inhaltsbreite, Kopfzellen und Mengen brechen um, Scrollen bleibt als Rückfall', () => {
    const s = quelle('src/app/(dashboard)/reports/(pflicht)/behandlungsprotokoll/page.tsx')
    assert.doesNotMatch(s, /className="[^"]*max-w-6xl/)
    const kopf = s.match(/<th key=\{h\} className="([^"]*)"/)
    assert.ok(kopf, 'Kopfzelle gefunden')
    assert.doesNotMatch(kopf[1], /whitespace-nowrap/)
    assert.match(s, /mengen\.split\(' · '\)\.map\(t => <span key=\{t\} className="block [^"]*whitespace-nowrap">/)
    assert.match(s, /<div className="overflow-x-auto">\s*<table className="w-full text-xs border-collapse">/)
  })
})
