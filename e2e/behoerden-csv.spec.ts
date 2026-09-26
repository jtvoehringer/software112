// ── Behördenmeldungen als CSV: zentrale Route /meldungen/<id>/csv ─────────────
//
// Prüft für eine Auswahl von Katalog-Meldungen das Standardprofil PROFIL_EXCEL_AT:
// HTTP 200, UTF-8-BOM, Semikolon, CRLF (auch nach der letzten Zeile), Kopf X-Zeilen.
// Die ids werden gegen den Katalog (src/lib/behoerden/katalog.ts) geprüft – eine
// umbenannte Meldung fällt hier auf. Parameter: standardParameter() aus dem Katalog,
// ergänzt um feste Werte.

import { test, expect } from './fixtures'
import { KATALOG_LISTE, type KatalogEintrag } from '../src/lib/behoerden/katalog'
import type { Rolle } from './umgebung'

const JAHR = String(new Date().getFullYear())

/** Meldungen ohne Datensatz-id und ohne Zusatzmodul (Profil Excel-AT) */
const AUSWAHL: Record<string, Record<string, string>> = {
  erntemeldung: { jahrgang: JAHR },
  bestandsmeldung: {},
  flaechenverzeichnis: {},
  gebindeverzeichnis: {},
  'dac-antraege': {},
  'weinbuch-sammlung': {},
  'psm-aufzeichnung': {},
  'cu-bilanz': {},
  naehrstoffbilanz: {},
}

const BOM = [0xef, 0xbb, 0xbf]

function query(e: KatalogEintrag, fest: Record<string, string>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(e.standardParameter?.() ?? {})) if (v !== null && v !== undefined) p.set(k, String(v))
  for (const [k, v] of Object.entries(fest)) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Erwartete Status je Rolle (siehe Zugriff in lib/behoerden/typen.ts) */
function erlaubteStatus(e: KatalogEintrag, rolle: Rolle): number[] {
  if (e.zugriff === 'mitglied') return [200]
  if (e.zugriff === 'betriebsleitung') return rolle === 'leser' ? [200, 403] : [200]
  return [200, 403]
}

test.describe('Behördenmeldungen – CSV', { tag: '@lesend' }, () => {
  test('Auswahl steht im Katalog', () => {
    const ids = new Set(KATALOG_LISTE.map(e => e.id))
    expect(Object.keys(AUSWAHL).filter(id => !ids.has(id)), 'unbekannte Meldungs-ids').toEqual([])
  })

  test('unbekannte Meldung → 404', async ({ page }) => {
    const r = await page.request.get('/meldungen/gibt-es-nicht/csv', { maxRedirects: 0 })
    expect(r.status()).toBe(404)
  })

  for (const [id, fest] of Object.entries(AUSWAHL)) {
    test(`CSV ${id}`, async ({ page, rolle }) => {
      const eintrag = KATALOG_LISTE.find(e => e.id === id)
      test.skip(!eintrag, `${id} fehlt im Katalog (siehe Test „Auswahl steht im Katalog“)`)
      if (!eintrag) return

      const r = await page.request.get(`/meldungen/${id}/csv${query(eintrag, fest)}`, { maxRedirects: 0 })
      const status = r.status()
      expect(erlaubteStatus(eintrag, rolle), `HTTP ${status} für ${rolle}: ${status >= 400 ? await r.text() : ''}`).toContain(status)
      if (status !== 200) return

      expect(r.headers()['content-type'] ?? '').toMatch(/csv/i)
      expect(r.headers()['x-zeilen'], 'Kopf X-Zeilen fehlt').toMatch(/^\d+$/)

      const bytes = await r.body()
      expect([...bytes.subarray(0, 3)], 'UTF-8-BOM fehlt').toEqual(BOM)
      const text = bytes.subarray(3).toString('utf8')
      const kopf = text.split('\r\n')[0]
      expect(kopf, 'Kopfzeile ohne Semikolon').toContain(';')
      expect(text.endsWith('\r\n'), 'kein CRLF nach der letzten Zeile').toBe(true)
      expect(/(^|[^\r])\n/.test(text), 'Zeilenumbruch ohne CR (LF statt CRLF)').toBe(false)
    })
  }
})
