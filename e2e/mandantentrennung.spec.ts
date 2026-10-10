// ── Mandantentrennung: Datensätze eines fremden Betriebs bleiben unsichtbar ────
//
// E2E_FREMDE_IDS = JSON-Array mit Pfaden zu Datensätzen aus Betrieb B, z. B.
//   ["/crm/kontakte/<uuid>", { "pfad": "/kellerbuch/weinausbau/<uuid>", "text": "Grüner Veltliner Ried X 2025" }]
// Die Test-Benutzer gehören zu Betrieb A. Erwartet: 404, Weiterleitung weg vom Pfad
// oder eine leere Seite (der optionale `text` des fremden Datensatzes kommt nicht vor).

import { test, expect } from './fixtures'
import { FREMD_ID, FREMD_MARKE, fremdeDatensaetze, gegenStaging } from './umgebung'

const NICHT_GEFUNDEN = /nicht gefunden|existiert nicht|could not be found|kein Zugriff|keine Berechtigung/i

test.describe('Mandantentrennung', { tag: '@lesend' }, () => {
  const datensaetze = fremdeDatensaetze()

  test('fremde Datensätze konfiguriert', async () => {
    test.skip(datensaetze.length === 0, 'E2E_FREMDE_IDS nicht gesetzt – Mandantentrennung wird nicht geprüft')
    expect(datensaetze.length).toBeGreaterThan(0)
  })

  for (const d of datensaetze) {
    test(`fremder Datensatz ${d.pfad}`, async ({ page, rolle }) => {
      test.skip(!!d.rollen && !d.rollen.includes(rolle), `nur für ${d.rollen?.join(', ')}`)

      const antwort = await page.goto(d.pfad, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
      const status = antwort?.status() ?? 0
      const ziel = new URL(page.url()).pathname
      const body = await page.locator('body').innerText()

      if (d.text) expect(body, 'Inhalt des fremden Datensatzes sichtbar').not.toContain(d.text)

      const abgewiesen = status === 404 || status === 403 || ziel !== d.pfad || NICHT_GEFUNDEN.test(body)
      if (!d.text) {
        expect(abgewiesen, `HTTP ${status}, Ziel ${ziel}: weder 404 noch Weiterleitung noch Hinweis „nicht gefunden“ – ohne „text“ ist eine leere Seite nicht prüfbar`).toBe(true)
      }
      expect(status, 'Serverfehler statt sauberer Abweisung').toBeLessThan(500)
    })
  }
})

// ── Suche, Exporte, CSV-Meldungen und API mit Daten bzw. IDs des Fremdbetriebs (nur Staging, e2e/fremdbetrieb.sql) ──
//
// Jede Antwort darf die Marke „E2E-Fremd“ weder im Inhalt noch im Dateinamen tragen. Wird eine fremde ID ausdrücklich
// angefragt, ist die Antwort eine Abweisung (4xx) bzw. eine Leermeldung (X-Zeilen: 0) – nie 200 mit Daten, nie 5xx.

type Abruf = {
  pfad: string
  /** ausdrücklich eine fremde ID angefragt: 200 nur als Leermeldung bzw. leere Liste erlaubt */
  fremdeId?: boolean
}

const ABRUFE: Abruf[] = [
  // Suche
  { pfad: `/api/global-search?q=${encodeURIComponent(FREMD_MARKE)}` },
  ...['kontakt', 'firma', 'kunde', 'lieferant', 'email'].map(art => ({ pfad: `/api/crm/suche?art=${art}&q=${encodeURIComponent(FREMD_MARKE)}` })),
  { pfad: `/api/crm/suche?ids=${FREMD_ID.kontakt}`, fremdeId: true },
  { pfad: `/api/crm/suche?art=firma&ids=${FREMD_ID.firma}`, fremdeId: true },
  // Datenexporte
  ...['kontakte', 'firmen', 'lager', 'verkauf'].map(x => ({ pfad: `/api/export/${x}` })),
  { pfad: '/api/export/rieden-geo?format=kml' },
  { pfad: `/api/export/rieden-geo?format=gpx&id=${FREMD_ID.ried}`, fremdeId: true },
  // Auswertungen und Dokumente zu einer fremden ID
  { pfad: `/api/reports/fuellung-bv?id=${FREMD_ID.fuellung}`, fremdeId: true },
  { pfad: `/api/weinhandel/fuellungen/${FREMD_ID.fuellung}/datenblatt`, fremdeId: true },
  { pfad: `/api/weinexport/${FREMD_ID.export}/dokument/rechnung`, fremdeId: true },
  // CSV-Behördenmeldungen mit fremder ID (zentrale Route, gleiche Ladefunktion wie die Druckseite)
  { pfad: `/meldungen/bewegungsbuch/csv?behaelter=${FREMD_ID.behaelter}`, fremdeId: true },
  { pfad: `/meldungen/keller-behandlungen/csv?behaelter=${FREMD_ID.behaelter}`, fremdeId: true },
  { pfad: `/meldungen/weinbuch/csv?charge=${FREMD_ID.charge}`, fremdeId: true },
  { pfad: `/meldungen/transportbescheinigung/csv?id=${FREMD_ID.verkauf}`, fremdeId: true },
  { pfad: `/meldungen/exportauftrag/csv?id=${FREMD_ID.export}`, fremdeId: true },
]

/** Leere Antwort auf eine ausdrücklich angefragte fremde ID: Leermeldung, leere Trefferliste bzw. leerer Export */
function leer(text: string, kopf: Record<string, string>): boolean {
  if (kopf['x-zeilen'] === '0') return true
  // Geo-Export (GPX/KML): Dokumentkopf ohne Wegpunkt, Route, Spur oder Placemark
  if (/xml/.test(kopf['content-type'] ?? '')) return !/<(wpt|rte|trk|Placemark)\b/.test(text)
  try {
    const j = JSON.parse(text) as unknown
    if (Array.isArray(j)) return j.length === 0
    if (j && typeof j === 'object') return Object.values(j).every(v => !Array.isArray(v) || v.length === 0)
  } catch { /* kein JSON */ }
  return false
}

test.describe('Mandantentrennung: Suche, Exporte und API', { tag: '@lesend' }, () => {
  test.skip(!gegenStaging(), 'Fremdbetrieb gibt es nur auf Staging (e2e/fremdbetrieb.sql)')

  for (const a of ABRUFE) {
    test(`ohne fremde Daten: ${a.pfad}`, async ({ page }) => {
      const antwort = await page.request.get(a.pfad, { failOnStatusCode: false })
      const status = antwort.status()
      const kopf = antwort.headers()
      const text = await antwort.text()

      expect(status, `${a.pfad}: Serverfehler statt sauberer Abweisung`).toBeLessThan(500)
      expect(kopf['content-disposition'] ?? '', 'Dateiname mit Daten des Fremdbetriebs').not.toContain(FREMD_MARKE)
      expect(text, `${a.pfad}: Daten des Fremdbetriebs in der Antwort`).not.toContain(FREMD_MARKE)
      if (a.fremdeId && status === 200) {
        expect(leer(text, kopf), `${a.pfad}: HTTP 200 mit Inhalt auf eine fremde ID (${kopf['content-type']}, ${text.length} Zeichen)`).toBe(true)
      }
    })
  }
})
