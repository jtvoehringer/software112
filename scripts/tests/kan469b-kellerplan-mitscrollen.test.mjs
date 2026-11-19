// KAN-469 (UAT 19.11.2026): Im Kellerplan ließ sich ein Gebinde nur auf Ziele ziehen, die gerade sichtbar waren –
// beim Ziehen mit dem Zeiger (Pointer-Ereignisse, touch-action: none) scrollt der Browser nicht von selbst. Jetzt
// scrollt die Seite mit, sobald der Zeiger am Rand des scrollenden Rahmens ist (src/lib/ui/randScrollen.ts).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RAND_TEMPO, RAND_ZONE, randTempo, scrollEltern } from '../../src/lib/ui/randScrollen.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-469: Tempo am Rand', () => {
  // Rahmen von 100 bis 900 (z. B. der Inhaltsbereich unter der Kopfleiste)
  test('in der Mitte wird nicht gescrollt', () => {
    for (const pos of [100 + RAND_ZONE, 500, 900 - RAND_ZONE]) assert.equal(randTempo(pos, 100, 900), 0, String(pos))
  })
  test('unten: positiv, je näher am Rand desto schneller, an und unter der Kante das Höchsttempo', () => {
    const knapp = randTempo(900 - RAND_ZONE + 1, 100, 900)
    const halb = randTempo(900 - RAND_ZONE / 2, 100, 900)
    assert.ok(knapp >= 1 && knapp < halb && halb < RAND_TEMPO, `${knapp} ${halb}`)
    assert.equal(randTempo(900, 100, 900), RAND_TEMPO)
    assert.equal(randTempo(1200, 100, 900), RAND_TEMPO)   // Zeiger unter dem Fenster (Zeiger bleibt eingefangen)
  })
  test('oben: dasselbe mit negativem Vorzeichen', () => {
    assert.equal(randTempo(100 + RAND_ZONE / 2, 100, 900), -randTempo(900 - RAND_ZONE / 2, 100, 900))
    assert.equal(randTempo(100, 100, 900), -RAND_TEMPO)
    assert.equal(randTempo(-50, 100, 900), -RAND_TEMPO)
  })
  test('kleiner Rahmen: die Mitte bleibt frei; kein Rahmen bzw. keine Position: 0', () => {
    assert.equal(randTempo(150, 100, 200), 0)
    assert.ok(randTempo(195, 100, 200) > 0 && randTempo(105, 100, 200) < 0)
    assert.equal(randTempo(50, 100, 100), 0)
    assert.equal(randTempo(NaN, 100, 900), 0)
  })
  test('ohne DOM (Server, Test) gibt es keinen Rahmen', () => {
    assert.equal(scrollEltern(null), null)
  })
})

describe('KAN-469: Kellerplan scrollt beim Ziehen mit', () => {
  const k = quelle('src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx')
  test('Bewegung merkt den Zeiger, wertet aus und startet die Schleife – nur solange gezogen wird', () => {
    const f = k.slice(k.indexOf('function handleCanvasPointerMove('), k.indexOf('function zeigerAuswerten('))
    for (const s of ['if (!ziehRef.current && !dragStateRef.current) return', 'zeigerRef.current = { x: e.clientX, y: e.clientY }', 'zeigerAuswerten(e.clientX, e.clientY)', 'randScrollenStarten()']) assert.ok(f.includes(s), s)
  })
  test('Schleife: scrollt den Rahmen, zählt die Strecke mit und wertet die Stelle unter dem ruhenden Zeiger neu aus', () => {
    const f = k.slice(k.indexOf('function randScrollenStarten()'), k.indexOf('function handleCanvasPointerMove('))
    for (const s of ['if (!z || (!ziehRef.current && !dragStateRef.current)) return', 'const el = scrollEltern(canvasRef.current)',
      'randTempo(z.y, Math.max(r.top, 0), Math.min(r.bottom, window.innerHeight))', 'el.scrollTop += vy',
      'scrollSummeRef.current = { x: scrollSummeRef.current.x + dx, y: scrollSummeRef.current.y + dy }', 'auswertenRef.current(z.x, z.y)',
      'scrollBildRef.current = requestAnimationFrame(schritt)']) assert.ok(f.includes(s), s)
  })
  test('Planmodus: die gescrollte Strecke zählt zur Verschiebung (das Symbol springt nicht)', () => {
    assert.ok(k.includes('const dy   = ((clientY - ds.startY + scrollSummeRef.current.y) / rect.height) * 100'))
    assert.ok(k.includes('const dyPct = rect ? Math.abs(((e.clientY - ds.startY + scrollSummeRef.current.y) / rect.height) * 100) : 0'))
  })
  test('Loslassen und Abbruch beenden die Schleife; Abbruch bucht und speichert nichts', () => {
    assert.equal(k.split('randScrollenStoppen()').length - 1, 4)   // Definition, Loslassen (Ziehen), Loslassen (Verschieben), Abbruch
    const a = k.slice(k.indexOf('function handleCanvasPointerCancel()'), k.indexOf('// ── Resize'))
    assert.ok(a.includes('ziehRef.current = null') && a.includes('dragStateRef.current = null') && a.includes('setZieh(null)'))
    assert.ok(!/setBuchen|savePos|saveTankPos/.test(a.slice(0, a.indexOf('useEffect'))))
    assert.ok(k.includes('onPointerCancel={handleCanvasPointerCancel}'))
    assert.ok(k.includes('useEffect(() => () => { if (scrollBildRef.current !== null) cancelAnimationFrame(scrollBildRef.current) }, [])'))
  })
})
