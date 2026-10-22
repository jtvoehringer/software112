// KAN-353 (22.10.2026): Kunde/Lieferant direkt aus der Partner-Suche anlegen.
// UAT-Befund: In Zukauf, Verkauf, Traubenverkauf und Lese ließ sich nur ein bestehender Partner suchen – für einen
// neuen hieß es abbrechen, ins CRM, von vorn. Entscheidung Jörgen 22.10.2026: „+ Neue Firma“ / „+ Neuer Kontakt“ in
// <PartnerSuche> (bei leerer Liste und dauerhaft unten), kleiner Dialog, Speichern über eine CRM-Action mit allen
// üblichen Prüfungen und derselben Anlage wie im CRM; ohne CRM-Schreibrecht kein „+ Neu“.
//
// Aufruf:  npm run -s test:csv   (Action-Tests: Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'
import {
  anlageTypen, standardRolle, namensVorschlag, schnellAnlagePruefen, schnellTreffer,
} from '../../src/lib/crm/schnellAnlage.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

// ── Prüfung und Vorbelegung (reine Funktionen) ─────────────────────────────────

describe('lib/crm/schnellAnlage', () => {
  test('was angelegt werden darf: Kunde/Lieferant beides, sonst nur die eine Tabelle', () => {
    assert.deepEqual(anlageTypen('kunde'), ['firma', 'kontakt'])
    assert.deepEqual(anlageTypen('lieferant'), ['firma', 'kontakt'])
    assert.deepEqual(anlageTypen('firma'), ['firma'])
    assert.deepEqual(anlageTypen('kontakt'), ['kontakt'])
    const r = schnellAnlagePruefen({ typ: 'firma', art: 'kontakt', name: 'Huber GmbH' })
    assert.equal(r.ok, false)
  })

  test('Rolle: Zukauf → Lieferant, Verkauf → Kunde, ausdrückliche Angabe gewinnt', () => {
    assert.equal(standardRolle('lieferant'), 'lieferant')
    assert.equal(standardRolle('kunde'), 'kunde')
    assert.equal(standardRolle('firma'), 'kunde')
    assert.equal(standardRolle('kontakt', 'lieferant'), 'lieferant')
  })

  test('Suchtext als Name: Firma ganz, Kontakt letztes Wort = Nachname', () => {
    assert.deepEqual(namensVorschlag('firma', '  Weingut   Huber '), { name: 'Weingut Huber', vorname: '', nachname: '' })
    assert.deepEqual(namensVorschlag('kontakt', 'Maria Anna Huber'), { name: '', vorname: 'Maria Anna', nachname: 'Huber' })
    assert.deepEqual(namensVorschlag('kontakt', 'Huber'), { name: '', vorname: '', nachname: 'Huber' })
    assert.deepEqual(namensVorschlag('kontakt', ''), { name: '', vorname: '', nachname: '' })
  })

  test('Pflichtfelder: Firmenname bzw. Nachname wie im CRM', () => {
    assert.match(schnellAnlagePruefen({ typ: 'firma', art: 'kunde', name: '  ' }).fehler, /Namen der Firma/)
    assert.match(schnellAnlagePruefen({ typ: 'kontakt', art: 'kunde', vorname: 'Maria' }).fehler, /Nachnamen/)
    assert.equal(schnellAnlagePruefen({ typ: 'kontakt', art: 'kunde', nachname: 'Huber' }).ok, true)
    assert.match(schnellAnlagePruefen({ typ: 'firma', art: 'kunde', name: 'x'.repeat(201) }).fehler, /zu lang/)
  })

  test('Betriebsnummer optional, nur Ziffern (höchstens 10), Leerzeichen entfernt, „0“ abgelehnt', () => {
    const basis = { typ: 'firma', art: 'lieferant', name: 'Huber' }
    assert.equal(schnellAnlagePruefen(basis).felder.betrieb_nr, '')
    assert.equal(schnellAnlagePruefen({ ...basis, betrieb_nr: ' 428 5221 ' }).felder.betrieb_nr, '4285221')
    assert.match(schnellAnlagePruefen({ ...basis, betrieb_nr: 'AT-12' }).fehler, /nur Ziffern/)
    assert.match(schnellAnlagePruefen({ ...basis, betrieb_nr: '12345678901' }).fehler, /höchstens 10/)
    assert.match(schnellAnlagePruefen({ ...basis, betrieb_nr: '000' }).fehler, /„0“/)
    assert.doesNotMatch(schnellAnlagePruefen({ ...basis, betrieb_nr: 'x' }).fehler, /Weinbau/)
  })

  test('Land: Standard AT, Namen werden zum ISO-Code, Unbekanntes abgelehnt', () => {
    const basis = { typ: 'kontakt', art: 'kunde', nachname: 'Huber' }
    assert.equal(schnellAnlagePruefen(basis).felder.land, 'AT')
    assert.equal(schnellAnlagePruefen({ ...basis, land: 'de' }).felder.land, 'DE')
    assert.equal(schnellAnlagePruefen({ ...basis, land: 'Deutschland' }).felder.land, 'DE')
    assert.match(schnellAnlagePruefen({ ...basis, land: 'Atlantis' }).fehler, /Unbekanntes Land/)
  })

  test('Firma: Verkauf erzwingt Kunde, Zukauf Lieferant; ohne Kennzeichen abgelehnt; Standardwerte wie im CRM-Formular', () => {
    const v = schnellAnlagePruefen({ typ: 'firma', art: 'kunde', name: 'Gasthaus Post', ist_kunde: false })
    assert.equal(v.felder.ist_kunde, 'true')
    assert.equal(v.felder.ist_lieferant, 'false')
    assert.equal(v.felder.is_lead, 'true')
    assert.equal(v.felder.segment, 'handel')
    assert.equal(v.felder.zahlungsziel_tage, '30')
    const z = schnellAnlagePruefen({ typ: 'firma', art: 'lieferant', name: 'Weingut Huber' })
    assert.equal(z.felder.ist_lieferant, 'true')
    assert.equal(z.felder.ist_kunde, 'false')
    assert.equal(z.felder.is_lead, 'false')   // reiner Lieferant ist kein Verkaufs-Lead
    assert.match(schnellAnlagePruefen({ typ: 'firma', art: 'firma', name: 'X', ist_kunde: false, ist_lieferant: false }).fehler, /Kunde.*Lieferant/)
    assert.equal(schnellAnlagePruefen({ typ: 'firma', art: 'firma', name: 'X', ist_kunde: true, ist_lieferant: true }).felder.ist_lieferant, 'true')
  })

  test('Kontakt: Segment privat, Zahlungsziel 14, Firma nur bei z.H.-Suche (art=kontakt)', () => {
    const k = schnellAnlagePruefen({ typ: 'kontakt', art: 'kontakt', vorname: 'Maria', nachname: 'Huber', firma_id: 'f-1' })
    assert.equal(k.felder.segment, 'privat')
    assert.equal(k.felder.zahlungsziel_tage, '14')
    assert.equal(k.felder.firma_id, 'f-1')
    assert.equal(k.anzeige, 'Maria Huber')
    assert.equal(schnellAnlagePruefen({ typ: 'kontakt', art: 'kunde', nachname: 'Huber', firma_id: 'f-1' }).felder.firma_id, '')
  })

  test('Treffer im Format der Suche: Präfix nur bei Kunde/Lieferant, Konditionen leer, Betriebsnummer mit', () => {
    const p = schnellAnlagePruefen({ typ: 'firma', art: 'lieferant', name: 'Weingut Huber', betrieb_nr: '4285221' })
    const t = schnellTreffer('lieferant', 'firma', 'id-1', p.felder, p.anzeige, 'K-0042')
    assert.equal(t.id, 'firma:id-1')
    assert.equal(t.label, 'Weingut Huber')
    assert.match(t.sub, /Firma · neu angelegt · K-0042 · Betr\.Nr\. 4285221/)
    assert.deepEqual(t.daten, { typ: 'firma', firma_id: null, rabatt_pct: null, sonderrabatt_pct: 0, skonto_pct: 0, skonto_tage: 10, betrieb_nr: '4285221' })
    const k = schnellAnlagePruefen({ typ: 'kontakt', art: 'kontakt', nachname: 'Huber', firma_id: 'f-9' })
    const tk = schnellTreffer('kontakt', 'kontakt', 'id-2', k.felder, k.anzeige, null)
    assert.equal(tk.id, 'id-2')
    assert.equal(tk.daten.firma_id, 'f-9')
    assert.equal(tk.daten.betrieb_nr, null)
  })
})

// ── Server Action partnerSchnellAnlegen (CRM-Actions mit Attrappen) ────────────

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul(`export const pruefeSeitenBetrieb = async () => { if (globalThis.__fremdeSeite) throw new Error('Diese Seite gehört zu einem anderen Betrieb.') }
  export const seitenBetriebFehler = async () => null`)
DOPPEL['@/lib/auth/sperren'] = modul(`export const pruefeSchreibzugriff = async () => { if (globalThis.__nurLesen) throw new Error('Nur-Lesen-Modus: das Abo ist gesperrt.') }
  export const schreibSperreFehler = async () => null`)
hooksRegistrieren()
const crm = hooksMoeglich ? await laden('app/(dashboard)/crm/actions.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const als = (role, schreibmodule = null) => { globalThis.__membership = { tenantId: T, role, schreibmodule } }
const db = (tabellen = {}) => {
  const d = datenbank({ kontakte: [], firmen: [], ...tabellen }, { rpc: name => name === 'get_next_accountnummer' ? { data: 'K-0042', error: null } : { data: null, error: { message: 'unbekannt' } } })
  globalThis.__serverFake = d
  return d
}

beforeEach(() => { als('tenant_admin'); globalThis.__fremdeSeite = false; globalThis.__nurLesen = false })

describe('partnerSchnellAnlegen', nurMitHooks, () => {
  test('ohne Schreibrecht CRM, mit fremder Seite oder im Nur-Lesen-Modus: Meldung vor jedem Datenbankzugriff', async () => {
    const eingabe = { typ: 'firma', art: 'lieferant', name: 'Weingut Huber' }
    for (const [rolle, mods] of [['leser', []], ['winzer', ['kellerbuch', 'warenwirtschaft']]]) {
      als(rolle, mods)
      const d = db()
      assert.match((await crm.partnerSchnellAnlegen(eingabe)).error, /Freigabe CRM nötig/, rolle)
      assert.deepEqual(d.aufrufe, [], rolle)
    }
    als('tenant_admin')
    globalThis.__fremdeSeite = true
    let d = db()
    assert.match((await crm.partnerSchnellAnlegen(eingabe)).error, /anderen Betrieb/)
    assert.deepEqual(d.aufrufe, [])
    globalThis.__fremdeSeite = false
    globalThis.__nurLesen = true
    d = db()
    assert.match((await crm.partnerSchnellAnlegen(eingabe)).error, /Nur-Lesen/)
    assert.deepEqual(d.aufrufe, [])
  })

  test('Mitarbeiter mit CRM: Lieferant wird mit Kundennummer angelegt und als Treffer zurückgegeben', async () => {
    als('winzer', ['crm'])
    const d = db()
    const r = await crm.partnerSchnellAnlegen({ typ: 'firma', art: 'lieferant', name: ' Weingut  Huber ', betrieb_nr: '4285221', land: 'AT' })
    assert.equal(r.error, undefined)
    const f = d.tabellen.firmen[0]
    assert.equal(f.tenant_id, T)
    assert.equal(f.name, 'Weingut Huber')
    assert.equal(f.accountnummer, 'K-0042')
    assert.equal(f.ist_lieferant, true)
    assert.equal(f.ist_kunde, false)
    assert.equal(f.betrieb_nr, '4285221')
    assert.equal(f.land, 'AT')
    assert.equal(f.zahlungsziel_tage, 30)
    assert.equal(r.treffer.id, `firma:${f.id}`)
    assert.equal(r.treffer.label, 'Weingut Huber')
    assert.equal(r.treffer.daten.betrieb_nr, '4285221')
    assert.ok(d.aufrufe.some(a => a.tabelle === 'rpc:get_next_accountnummer'))
  })

  test('Kontakt als Kunde: Vor-/Nachname, Segment privat, Zahlungsziel 14; z.H. mit Firma', async () => {
    const d = db()
    const r = await crm.partnerSchnellAnlegen({ typ: 'kontakt', art: 'kunde', vorname: 'Maria', nachname: 'Huber' })
    const k = d.tabellen.kontakte[0]
    assert.equal(k.vorname, 'Maria')
    assert.equal(k.nachname, 'Huber')
    assert.equal(k.segment, 'privat')
    assert.equal(k.zahlungsziel_tage, 14)
    assert.equal(k.firma_id, null)
    assert.equal(r.treffer.id, `kontakt:${k.id}`)
    const r2 = await crm.partnerSchnellAnlegen({ typ: 'kontakt', art: 'kontakt', nachname: 'Gruber', firma_id: 'f-7' })
    assert.equal(d.tabellen.kontakte[1].firma_id, 'f-7')
    assert.equal(r2.treffer.id, d.tabellen.kontakte[1].id)
  })

  test('Validierung vor dem Schreiben: Fehler zurück, nichts angelegt', async () => {
    const d = db()
    assert.match((await crm.partnerSchnellAnlegen({ typ: 'firma', art: 'kunde', name: '' })).error, /Namen der Firma/)
    assert.match((await crm.partnerSchnellAnlegen({ typ: 'firma', art: 'kunde', name: 'X', betrieb_nr: 'abc' })).error, /nur Ziffern/)
    assert.match((await crm.partnerSchnellAnlegen({ typ: 'kontakt', art: 'firma', nachname: 'X' })).error, /nur eine Firma/)
    assert.equal(d.aufrufe.filter(a => a.art === 'insert').length, 0)
  })

  test('Dublette: gleichnamiger aktiver Partner → Hinweis statt Anlage; mit trotzDublette angelegt', async () => {
    const d = db({ firmen: [{ id: 'f-1', tenant_id: T, name: 'Weingut Huber', aktiv: true }] })
    const eingabe = { typ: 'firma', art: 'lieferant', name: 'weingut huber' }
    const r = await crm.partnerSchnellAnlegen(eingabe)
    assert.equal(r.dublette, 'Weingut Huber')
    assert.equal(r.treffer, undefined)
    assert.equal(d.tabellen.firmen.length, 1)
    const r2 = await crm.partnerSchnellAnlegen({ ...eingabe, trotzDublette: true })
    assert.ok(r2.treffer)
    assert.equal(d.tabellen.firmen.length, 2)
  })

  test('Datenbankfehler beim Anlegen wird gemeldet', async () => {
    const d = datenbank({ firmen: [] }, {
      rpc: () => ({ data: 'K-1', error: null }),
      vorher: e => (e.art === 'insert' ? { error: { message: 'new row violates row-level security policy', code: '42501' } } : null),
    })
    globalThis.__serverFake = d
    const r = await crm.partnerSchnellAnlegen({ typ: 'firma', art: 'kunde', name: 'Gasthaus Post' })
    assert.ok(r.error)
    assert.equal(r.treffer, undefined)
  })

  test('CRM-Formular unverändert: createKontakt/createFirma legen über dieselbe Anlage an', async () => {
    const d = db()
    const fd = new FormData()
    fd.set('nachname', 'Huber'); fd.set('segment', 'privat'); fd.set('zahlungsziel_tage', '14')
    const r = await crm.createKontakt(fd)
    assert.equal(r.error, undefined)
    assert.equal(r.id, d.tabellen.kontakte[0].id)
    assert.equal(d.tabellen.kontakte[0].accountnummer, 'K-0042')
  })
})

// ── Verdrahtung ────────────────────────────────────────────────────────────────

const SUCHE = 'src/components/crm/PartnerSuche.tsx'
const DIALOG = 'src/components/crm/PartnerNeuDialog.tsx'
const ACTIONS = 'src/app/(dashboard)/crm/actions.ts'

test('Action: gleiche Prüfungen und gleiche Anlage wie das CRM (keine zweite Wahrheit)', () => {
  const t = lies(ACTIONS)
  const fn = t.slice(t.indexOf('export async function partnerSchnellAnlegen'), t.indexOf('// E-Mail-Adresse einem bestehenden Kontakt'))
  assert.match(fn, /await getTenantId\(\)/)   // pruefeSeitenBetrieb, pruefeSchreibzugriff, canWrite(membership, 'crm')
  assert.match(fn, /schnellAnlagePruefen\(eingabe\)/)
  assert.match(fn, /firmaEinfuegen\(supabase, tenantId, fd\)/)
  assert.match(fn, /kontaktEinfuegen\(supabase, tenantId, fd\)/)
  assert.match(fn, /firmaNamensDublette|kontaktNamensDublette/)
  assert.match(t, /export async function createKontakt[\s\S]{0,300}kontaktEinfuegen\(supabase, tenantId, formData\)/)
  assert.match(t, /export async function createFirma[\s\S]{0,300}firmaEinfuegen\(supabase, tenantId, formData\)/)
  assert.match(t, /export async function pruefeKontaktDublette[\s\S]{0,600}kontaktNamensDublette/)
  assert.match(t, /export async function pruefeFirmaDublette[\s\S]{0,600}firmaNamensDublette/)
  const kopf = t.slice(t.indexOf('async function getTenantId'), t.indexOf('// KAN-150 F1'))
  assert.match(kopf, /pruefeSeitenBetrieb\(membership\.tenantId\)[\s\S]*pruefeSchreibzugriff\(membership\)[\s\S]*canWrite\(membership, m\)/)
})

test('PartnerSuche: „+ Neu“ nur mit Recht und nicht gesperrt, bei leerer Liste und unten in der Liste', () => {
  const t = lies(SUCHE)
  assert.match(t, /anlegen = false/)
  assert.match(t, /const neuMoeglich = anlegen && !disabled/)
  assert.match(t, /const neuKnoepfe = neuMoeglich && \(/)
  assert.equal((t.match(/\{neuKnoepfe\}/g) ?? []).length, 2)
  assert.match(t, /treffer\.length === 0 && \(neuMoeglich \|\|/)
  assert.match(t, /'\+ Neue Firma'/)
  assert.match(t, /'\+ Neuer Kontakt'/)
  assert.match(t, /anlageTypen\(art\)\.map/)
  // neuer Partner sofort ausgewählt
  assert.match(t, /const angelegt = \(t: SchnellTreffer\) => \{ setGewaehlt\(t\); onChange\(t\.id, t\)/)
  assert.match(t, /suchtext=\{query\}/)
  // kein Link ins CRM, keine Rechteprüfung im Client
  assert.doesNotMatch(t, /href=["'{]\/crm/)
  for (const datei of [SUCHE, DIALOG]) {
    assert.doesNotMatch(lies(datei), /from '@\/lib\/auth\/roles'|canWrite\(/, datei)
  }
})

test('Dialog: barrierefrei (useDialog: role=dialog, Fokus, Esc), scrollbar, Fehler als alert, kein verschachteltes Formular', () => {
  const t = lies(DIALOG)
  assert.match(t, /useDialog\(true, onAbbrechen, titel\)/)
  assert.match(t, /\{\.\.\.dialog\}/)
  assert.match(t, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/)
  assert.match(t, /autoFocus/)
  assert.equal((t.match(/role="alert"/g) ?? []).length, 2)
  assert.doesNotMatch(t, /<form/)
  assert.match(t, /createPortal\(/)
  assert.match(t, /e\.key !== 'Enter'[\s\S]{0,80}e\.preventDefault\(\)[\s\S]{0,40}e\.stopPropagation\(\)/)
  assert.match(t, /partnerSchnellAnlegen\(eingabe\)/)
  assert.match(t, /finally \{\s*setSpeichern\(false\)/)
  assert.match(t, /<LandOptionen aktuell=\{land\} \/>/)
  assert.match(t, /useState\('AT'\)/)
})

test('alle Formulare mit PartnerSuche reichen das CRM-Recht durch (Berichtsfilter ausgenommen)', () => {
  const formulare = {
    'src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx': { anzahl: 2, rolle: 'lieferant' },
    'src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx': { anzahl: 2, rolle: 'kunde' },
    'src/app/(dashboard)/weinhandel/traubenverkauf/TraubenverkaufClient.tsx': { anzahl: 2, rolle: 'kunde' },
    'src/app/(dashboard)/erntemeldung/[id]/TraubenverkaufSection.tsx': { anzahl: 2, rolle: 'kunde' },
  }
  for (const [datei, { anzahl, rolle }] of Object.entries(formulare)) {
    const t = lies(datei)
    const stellen = t.split('<PartnerSuche').slice(1).map(s => s.slice(0, s.indexOf('/>')))
    assert.equal(stellen.length, anzahl, datei)
    for (const s of stellen) {
      assert.match(s, /anlegen=\{crmSchreiben\}/, datei)
      assert.match(s, new RegExp(`anlageRolle="${rolle}"`), datei)
    }
  }
  // Der Kundenfilter der Berichte ist kein Formular – dort wird nichts angelegt
  assert.doesNotMatch(lies('src/app/(dashboard)/reports/ReportsClient.tsx'), /<PartnerSuche[^>]*anlegen=/)
})

test('Recht kommt vom Server mit der Mitgliedschaft (canWrite(membership, …), nie im Client)', () => {
  for (const route of ['src/app/api/zukauf-stammdaten/route.ts', 'src/app/api/verkauf-stammdaten/route.ts']) {
    assert.match(lies(route), /crm_schreiben: !!membership && canWrite\(membership, 'crm'\)/, route)
  }
  assert.match(lies('src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx'), /setCrmSchreiben\(j2\.crm_schreiben === true\)/)
  assert.match(lies('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx'), /setCrmSchreiben\(json\.crm_schreiben === true\)/)
  assert.match(lies('src/app/(dashboard)/weinhandel/traubenverkauf/page.tsx'), /crmSchreiben=\{canWrite\(membership, 'crm'\)\}/)
  assert.match(lies('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts'), /const crmSchreiben = canWrite\(membership, 'crm'\)/)
  assert.match(lies('src/app/(dashboard)/erntemeldung/[id]/page.tsx'), /crmSchreiben=\{crmSchreiben\}/)
  const sektion = lies('src/app/(dashboard)/erntemeldung/[id]/TraubenverkaufSection.tsx')
  assert.equal((sektion.match(/<TVForm[^>]*crmSchreiben=\{crmSchreiben\}/g) ?? []).length, 2)
})
