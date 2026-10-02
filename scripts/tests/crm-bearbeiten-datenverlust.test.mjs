// CRM: Datenverlust beim Bearbeiten von Kontakten und Firmen (Hotfix 02.10.2026)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Befund: Das Bearbeiten-Formular schrieb Felder zurück, die die Seite gar nicht geladen hatte –
//   - Kontakt auf der Detailseite: ohne Firmen-/Rabattgruppen-Auswahl → Firma und Rabattgruppe leer
//   - Kontakt aus der Liste/Detailseite: email_weitere, skonto_pct, skonto_tage, betrieb_nr nicht geladen
//     → weitere E-Mails geleert, Skonto auf 0 % / 10 Tage, BKI-Betriebsnummer leer angezeigt
//   - updateKontakt schrieb betrieb_nr gar nicht (Änderung ging verloren)
//   - Firma: email_weitere nicht geladen (Liste und Detail), Skonto in der Liste nicht übernommen
// Abgesichert: Spalten-Abgleich Formular ↔ Select ↔ Update, nurGesendeteFelder() (fehlende
// FormData-Schlüssel bleiben unverändert), Auswahllisten auf der Detailseite.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as liste from '../../src/lib/crm/liste.ts'
import { nurGesendeteFelder } from '../../src/lib/crm/formFelder.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const actions = quelle('src/app/(dashboard)/crm/actions.ts')
const kontakteClient = quelle('src/app/(dashboard)/crm/kontakte/KontakteClient.tsx')
const firmenClient = quelle('src/app/(dashboard)/crm/firmen/FirmenClient.tsx')

/** Ausschnitt ab `start` bis zum nächsten `ende` */
function abschnitt(text, start, ende) {
  const a = text.indexOf(start)
  assert.ok(a >= 0, `nicht gefunden: ${start}`)
  const b = text.indexOf(ende, a + start.length)
  return text.slice(a, b < 0 ? undefined : b)
}
/** Feldnamen eines Formulars: name="…" plus fd.set('…') */
function formularFelder(src) {
  const n = new Set()
  for (const m of src.matchAll(/name="([a-z_]+)"/g)) n.add(m[1])
  for (const m of src.matchAll(/fd\.set\('([a-z_]+)'/g)) n.add(m[1])
  return n
}
/** Spaltennamen eines Select-Strings (ohne Relationen) */
function spalten(sel) {
  return new Set(sel.replace(/[a-z_]+:[a-z_]+\([^)]*\)/g, '').split(',').map(s => s.trim()).filter(Boolean))
}
/** Payload-Schlüssel einer Action (Zeilen „  feld: …“ bzw. formData.has('feld')) */
function payloadFelder(fn) {
  const body = abschnitt(actions, `export async function ${fn}(`, '\nexport ')
  const p = abschnitt(body, 'const payload', '\n    }')
  const n = new Set()
  for (const m of p.matchAll(/^\s{6}([a-z_]+):/gm)) n.add(m[1])
  for (const m of p.matchAll(/formData\.has\('([a-z_]+)'\)/g)) n.add(m[1])
  for (const m of p.matchAll(/\.\.\.\(formData\.get\('([a-z_]+)'\)/g)) n.add(m[1])
  if (/kontaktPositionQuelle\(formData\)/.test(p)) { n.add('position'); n.add('quelle') }
  return n
}

describe('Kontakt bearbeiten', () => {
  const form = abschnitt(kontakteClient, 'export function KontaktForm(', '// ── Aktivitäts-Log')
  const felder = formularFelder(form)
  const sel = spalten(liste.KONTAKT_SPALTEN)

  test('Formular kennt die erwarteten Felder', () => {
    for (const f of ['email_weitere', 'skonto_pct', 'skonto_tage', 'betrieb_nr', 'rabattgruppe_id', 'firma_id', 'stammkunde', 'position', 'quelle'])
      assert.ok(felder.has(f), f)
  })

  test('KONTAKT_SPALTEN lädt jedes Formularfeld (sonst setzt Speichern es zurück)', () => {
    for (const f of felder) assert.ok(sel.has(f), `Spalte fehlt im Select: ${f}`)
  })

  test('Liste und Detailseite laden über KONTAKT_SPALTEN und kontaktAusZeile', () => {
    assert.match(liste.ladeKontakteSeite.toString(), /KONTAKT_SPALTEN/)
    const detail = quelle('src/app/(dashboard)/crm/kontakte/[id]/page.tsx')
    assert.match(detail, /\.select\(`\$\{KONTAKT_SPALTEN\}, firmen:firma_id\(name, segment\)`\)/)
    assert.match(detail, /kontaktAusZeile\(k\)/)
    assert.match(quelle('src/app/(dashboard)/crm/kontakte/page.tsx'), /\.map\(kontaktAusZeile\)/)
  })

  test('kontaktAusZeile übernimmt die bisher fehlenden Felder', () => {
    const z = liste.kontaktAusZeile({
      id: 'k1', nachname: 'Huber', segment: 'privat', email_weitere: ['a@b.at'], skonto_pct: '2.5', skonto_tage: 0,
      betrieb_nr: '4285221', rabattgruppe_id: 'r1', firma_id: 'f1', firmen: { name: 'Gasthaus' }, zahlungsziel_tage: 0,
    })
    assert.deepEqual(z.email_weitere, ['a@b.at'])
    assert.equal(z.skonto_pct, 2.5)
    assert.equal(z.skonto_tage, 0, '0 Tage bleibt 0')
    assert.equal(z.betrieb_nr, '4285221')
    assert.equal(z.zahlungsziel_tage, 0, '0 = bei Erhalt bleibt 0')
    assert.equal(z.firma_name, 'Gasthaus')
    const leer = liste.kontaktAusZeile({ id: 'k2', nachname: 'X', segment: 'privat' })
    assert.equal(leer.skonto_pct, 0)
    assert.equal(leer.skonto_tage, 10)
    assert.equal(leer.zahlungsziel_tage, 14)
  })

  test('updateKontakt schreibt dieselben Felder wie createKontakt (auch betrieb_nr) – nur Formularfelder', () => {
    const neu = payloadFelder('createKontakt'), upd = payloadFelder('updateKontakt')
    neu.delete('tenant_id')
    assert.ok(upd.has('betrieb_nr'))
    assert.deepEqual([...upd].sort(), [...neu].sort())
    for (const f of upd) assert.ok(felder.has(f), `Update-Feld ohne Formularfeld: ${f}`)
  })

  test('Detailseite übergibt Firmen und Rabattgruppen an das Formular', () => {
    const detail = quelle('src/app/(dashboard)/crm/kontakte/[id]/page.tsx')
    assert.match(detail, /firmen=\{/)
    assert.match(detail, /rabattgruppen=\{/)
    const dc = quelle('src/app/(dashboard)/crm/kontakte/[id]/KontaktDetailClient.tsx')
    assert.match(dc, /<KontaktForm[\s\S]{0,200}firmen=\{firmen\}[\s\S]{0,60}rabattgruppen=\{rabattgruppen\}/)
  })

  test('zugeordnete, nicht auswählbare Firma/Rabattgruppe bleibt im Formular erhalten', () => {
    assert.match(form, /initial\?\.firma_id && !firmen\.some\(f => f\.id === initial\.firma_id\)/)
    assert.match(form, /initial\?\.rabattgruppe_id && !rabattgruppen\.some\(r => r\.id === initial\.rabattgruppe_id\)/)
  })
})

describe('Firma bearbeiten', () => {
  const form = abschnitt(firmenClient, 'export function FirmaForm(', '\nfunction ')
  const felder = formularFelder(form)

  test('Liste und Detailseite laden jedes Formularfeld', () => {
    const listeSel = spalten(/from\('firmen'\)[\s\S]*?\.select\('([^']+)'/.exec(liste.ladeFirmenSeite.toString())[1])
    const detailSel = spalten(/from\('firmen'\) as any\)\s*\.select\('(id, accountnummer[^']+)'\)/.exec(quelle('src/app/(dashboard)/crm/firmen/[id]/page.tsx'))[1])
    for (const f of felder) {
      assert.ok(listeSel.has(f), `Liste: ${f}`)
      assert.ok(detailSel.has(f), `Detail: ${f}`)
    }
  })

  test('Liste übernimmt Skonto und weitere E-Mails in die Zeile', () => {
    const p = quelle('src/app/(dashboard)/crm/firmen/page.tsx')
    assert.match(p, /skonto_pct: f\.skonto_pct \?\? 0, skonto_tage: f\.skonto_tage \?\? 10/)
    assert.match(p, /email_weitere: \(f\.email_weitere/)
  })

  test('updateFirma schreibt dieselben Felder wie createFirma – nur Formularfelder', () => {
    const neu = payloadFelder('createFirma'), upd = payloadFelder('updateFirma')
    neu.delete('tenant_id')
    assert.deepEqual([...upd].sort(), [...neu].sort())
    for (const f of upd) assert.ok(felder.has(f), `Update-Feld ohne Formularfeld: ${f}`)
  })
})

describe('nurGesendeteFelder', () => {
  test('nur Schlüssel, die das Formular sendet; leere Werte zählen als gesendet', () => {
    const fd = new FormData()
    fd.set('vorname', '')
    fd.set('stammkunde', 'false')
    const p = nurGesendeteFelder(fd, { vorname: null, stammkunde: false, email_weitere: [], skonto_tage: 10, betrieb_nr: null })
    assert.deepEqual(p, { vorname: null, stammkunde: false })
  })

  test('updateKontakt und updateFirma filtern damit, Zahlungsziel nur bei gesendetem Feld geprüft', () => {
    for (const fn of ['updateKontakt', 'updateFirma']) {
      const body = abschnitt(actions, `export async function ${fn}(`, '\nexport ')
      assert.match(body, /const payload: AR = nurGesendeteFelder\(formData, \{/, fn)
      assert.match(body, /formData\.has\('zahlungsziel_tage'\) \? \{ zahlungsziel_tage: parseZahlungszielTage\(formData\) \}/, fn)
      assert.match(body, /payload\.aktualisiert_am = new Date\(\)\.toISOString\(\)/, fn)
      assert.doesNotMatch(body, /formData\.get\('rabattgruppe_id'\) !== undefined/, `${fn}: get() liefert null, nie undefined`)
    }
  })
})
