// Regressionstests (05.10.2026): vollständig gebrauchte Mengen seitenweise laden (alle()).
// PostgREST liefert höchstens 1.000 Zeilen je Anfrage – ohne Fehler. Nach dem Import-Befund (PR #232: 4.164 Kontakte
// ohne Firma) wurden alle weiteren Stellen auf großen Tabellen gesucht (scripts/check-alle.js) und umgestellt.
// Stand Produktion 05.10.2026 je Betrieb: kontakte 8.290, firmen 4.652, behandlung_grundstuecke 1.520.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { alle, SEITENGROESSE } from '../../src/lib/supabase/alle.ts'

const require = createRequire(import.meta.url)
const waechter = require('../check-alle.js')
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// ── alle() selbst: Attrappe eines PostgREST-Builders mit 1.000er-Deckel ─────────────────────────────────────────
class Attrappe {
  constructor(quelle) {
    this.zeilen = quelle.zeilen
    this.fehlerAb = quelle.fehlerAb ?? null
    this.aufrufe = quelle.aufrufe
    this.url = new URL(quelle.url.toString())
  }
  range(von, bis) {
    this.aufrufe.push([von, bis])
    if (this.fehlerAb !== null && von >= this.fehlerAb) return Promise.resolve({ data: null, error: { message: 'Zeitüberschreitung' } })
    const ende = Math.min(bis + 1, von + 1000)   // PostgREST "Max rows"
    return Promise.resolve({ data: this.zeilen.slice(von, ende), error: null })
  }
}
const abfrage = (anzahl, extra = {}) => new Attrappe({
  zeilen: Array.from({ length: anzahl }, (_, i) => ({ id: i })), url: 'https://x.supabase.co/rest/v1/firmen', aufrufe: [], ...extra,
})

test('alle() liefert alle 4.652 Firmen (Befund Gebeshuber), lückenlos und in Reihenfolge', async () => {
  const q = abfrage(4652)
  const { data, error } = await alle(q)
  assert.equal(error, null)
  assert.equal(data.length, 4652)
  assert.ok(data.every((z, i) => z.id === i))
  assert.equal(SEITENGROESSE, 1000)
})

test('alle() mit weniger als einer Seite braucht genau eine Anfrage; genau 1.000 Zeilen eine Folgeanfrage', async () => {
  const klein = abfrage(17)
  assert.equal((await alle(klein)).data.length, 17)
  assert.deepEqual(klein.aufrufe, [[0, 999]])
  const voll = abfrage(1000)
  assert.equal((await alle(voll)).data.length, 1000)
})

test('alle() gibt einen Fehler eines Folgeblocks weiter statt still eine Teilmenge zu liefern', async () => {
  const { error } = await alle(abfrage(8290, { fehlerAb: 3000 }))
  assert.deepEqual(error, { message: 'Zeitüberschreitung' })
})

// ── Umgestellte Stellen: jede lesende Abfrage der Tabelle in der Datei ist gepaged ──────────────────────────────
// [Datei, Tabelle, was ohne alle() still verloren ging]
const UMGESTELLT = [
  ['src/app/api/email/poll/route.ts', 'kontakte', 'E-Mails von Adressen ab dem 1.001. Kontakt keinem Kontakt zugeordnet'],
  ['src/app/api/email/poll/route.ts', 'firmen', 'E-Mails ab der 1.001. Firma keiner Firma zugeordnet'],
  // leseKontext.ts (Abnehmer-Auswahl): lädt seit 05.10.2026 keine Kontakte/Firmen mehr – Suche, siehe abnehmer-suche.test.mjs
  ['src/app/(dashboard)/buchhaltung/belege/[id]/page.tsx', 'firmen', 'Lieferanten fehlten in Auswahl und Dublettenprüfung'],
  ['src/app/api/buchhaltung/belege/route.ts', 'firmen', 'Lieferanten-Vorschlag fand Firmen ab der 1.001. nicht'],
  ['src/app/(dashboard)/behandlungen/neu/riedOptionen.ts', 'grundstuecke', 'Rieden/GST fehlten im Maßnahmen-Formular'],
  ['src/app/(dashboard)/behandlungen/actions.ts', 'grundstuecke', 'Maßnahme auf Rieden ohne alle Grundstücke verteilt'],
  ['src/app/(dashboard)/buchhaltung/svs/actions.ts', 'grundstuecke', 'Einheitswert-Import meldete GST als nicht gefunden'],
  ['src/app/(dashboard)/weingarten/import-gis/actions.ts', 'grundstuecke', 'GIS-Import legte vorhandene GST doppelt an'],
  ['src/app/(dashboard)/weingarten/rueckverfolgung/page.tsx', 'grundstuecke', 'GST fehlten in der Auswahl'],
  ['src/app/(dashboard)/weinhandel/zukauf/page.tsx', 'grundstuecke', 'Betriebsfläche (Zukaufgrenze) zu klein'],
  ['src/app/api/verkauf-stammdaten/route.ts', 'grundstuecke', 'GST fehlten im Traubenverkauf'],
  ['src/app/(dashboard)/behandlungen/lager/page.tsx', 'behandlungen', 'Betriebsmittel-Verbrauch zu niedrig'],
  ['src/app/(dashboard)/behandlungen/lager/page.tsx', 'psm_lager_bewegungen', 'PSM-Lagerbestand falsch'],
  ['src/app/(dashboard)/behandlungen/lager/page.tsx', 'duengemittel_lager_bewegungen', 'Dünger-Lagerbestand falsch'],
  ['src/app/(dashboard)/behandlungen/lager/page.tsx', 'betriebsmittel_lager_bewegungen', 'Betriebsmittel-Lagerbestand falsch'],
  ['src/app/(dashboard)/behandlungen/page.tsx', 'kosteneintraege', 'Kosten je Maßnahme zu niedrig'],
  ['src/app/api/kostenrechnung/route.ts', 'kosteneintraege', 'Jahresauswertung Kostenrechnung unvollständig', { begrenztErlaubt: true }],
  ['src/app/api/kostenrechnung/route.ts', 'kosteneintrag_weingaerten', 'Aufteilung auf Rieden unvollständig'],
  // KAN-346/374: offene Posten und Umsatz laufen zentral über src/lib/verkauf/umsatz.ts (Offene Posten, Dashboard,
  // Finanzübersicht, Morgenbericht, Umsatz-Auswertung)
  ['src/lib/verkauf/umsatz.ts', 'rechnungen', 'offene Posten fehlten in Liste und Summe, Monatsumsatz zu niedrig'],
  ['src/lib/verkauf/umsatz.ts', 'zahlungen', 'Teilzahlungen nicht abgezogen'],
  // KAN-375: Reiter „Offene Posten“ in /reports über ladeOffenePostenListe (umsatz.ts, oben) statt eigener Abfrage
  ['src/app/(dashboard)/reports/(controlling)/page.tsx', 'pipeline_eintraege', 'Pipeline-Auswertung unvollständig'],
  ['src/app/(dashboard)/crm/pipeline/page.tsx', 'pipeline_eintraege', 'Einträge fehlten auf der Pipeline-Tafel'],
  ['src/app/(dashboard)/admin/zeiterfassung/page.tsx', 'zeiterfassung', 'Stundensummen zu niedrig'],
]

// begrenztErlaubt: daneben gibt es in der Datei eine bewusst begrenzte Liste (z. B. die letzten 300 Einträge, .limit(300))
for (const [datei, tabelle, verlust, { begrenztErlaubt = false } = {}] of UMGESTELLT) {
  test(`${datei}: ${tabelle} seitenweise (sonst: ${verlust})`, () => {
    const text = readFileSync(path.join(WURZEL, datei), 'utf8')
    const q = waechter.abfragen(text, datei).filter(a => a.tabelle === tabelle && !(begrenztErlaubt && a.begrenzt))
    assert.ok(q.length > 0, `keine lesende Abfrage auf ${tabelle} gefunden`)
    for (const a of q) {
      assert.ok(a.gepaged, `${datei}:${a.zeile} ${tabelle} ohne alle()`)
      assert.ok(a.sortiert, `${datei}:${a.zeile} ${tabelle} alle() ohne .order()`)
    }
    assert.match(text, /import \{[^}]*\balle\b[^}]*\} from '(?:@\/lib\/supabase\/alle|\.\.\/supabase\/alle\.ts)'/)
  })
}

test('Fehler beim Laden brechen Abgleich-Importe ab statt mit Teilmenge weiterzurechnen', () => {
  const svs = readFileSync(path.join(WURZEL, 'src/app/(dashboard)/buchhaltung/svs/actions.ts'), 'utf8')
  assert.match(svs, /if \(gstFehler\) return \{ ok: false, fehler:/)
  const gis = readFileSync(path.join(WURZEL, 'src/app/(dashboard)/weingarten/import-gis/actions.ts'), 'utf8')
  assert.match(gis, /if \(gFehler\) throw new AktionsFehler\(/)
})
