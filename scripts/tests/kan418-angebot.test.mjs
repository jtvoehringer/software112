// KAN-418 Teil 4 (12.11.2026): Angebot – mit Preisen, ohne Reservierung; bearbeitbar solange offen; einmalige Übernahme
// in einen Auftrag, dessen Lieferung die Angebotspreise vorschlägt (Entscheidungen Jörgen: alle Fragen A).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANGEBOT_STATUS_LABEL, angebotAbgelaufen, angebotBetreff, angebotDateiname, angebotEinzelpreis, angebotFehler, angebotGrundFehler,
  angebotHinweise, angebotMailText, angebotOffen, angebotPositionenAus, angebotPositionenFuerDb, angebotRabattText, angebotSummen,
  angebotVersendbar, angebotZeileBrutto,
} from '../../src/lib/auftrag/angebot.ts'
import { angebotsPreis, lieferVorschlag } from '../../src/lib/auftrag/lieferung.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}

const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'
const KOPF = { kunde: `kontakt:${F1}`, datum: '2026-11-12', gueltig_bis: '2026-11-26', notizen: null }
const POS = { fuellung_id: F1, menge: 6, preis_brutto: 12.5, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 13 }

describe('KAN-418 Teil 4: Status und Gültigkeit', () => {
  test('offen = bearbeitbar/übernehmbar; abgelaufen ist nur ein Hinweis', () => {
    assert.deepEqual(Object.keys(ANGEBOT_STATUS_LABEL), ['offen', 'angenommen', 'abgelehnt', 'storniert'])
    assert.equal(angebotOffen({ status: 'offen', storniert_am: null }), true)
    for (const s of ['angenommen', 'abgelehnt', 'storniert']) assert.equal(angebotOffen({ status: s }), false, s)
    assert.equal(angebotAbgelaufen({ status: 'offen', gueltig_bis: '2026-11-11' }, '2026-11-12'), true)
    assert.equal(angebotAbgelaufen({ status: 'offen', gueltig_bis: '2026-11-12' }, '2026-11-12'), false)
    assert.equal(angebotAbgelaufen({ status: 'angenommen', gueltig_bis: '2026-11-01' }, '2026-11-12'), false)
    // ein abgelaufenes Angebot bleibt offen (übernehmbar)
    assert.equal(angebotOffen({ status: 'offen', gueltig_bis: '2026-11-01' }), true)
    assert.equal(angebotVersendbar({ status: 'abgelehnt' }), true)
    assert.equal(angebotVersendbar({ status: 'storniert', storniert_am: '2026-11-12T10:00:00Z' }), false)
  })
})

describe('KAN-418 Teil 4: Eingaben', () => {
  test('Positionen aus dem Formular: Zahlenfelder mit Dezimalpunkt, leere Zeilen fallen weg', () => {
    const p = angebotPositionenAus(JSON.stringify([
      { fuellung_id: F1, menge: '6', preis_brutto: '12.5', rabatt_pct: '10', sonderrabatt_pct: '', ust_satz: '13' },
      { fuellung_id: '', menge: '', preis_brutto: '', rabatt_pct: '0', sonderrabatt_pct: '0', ust_satz: '13' },
    ]))
    assert.deepEqual(p, [{ fuellung_id: F1, menge: 6, preis_brutto: 12.5, rabatt_pct: 10, sonderrabatt_pct: 0, ust_satz: 13 }])
    assert.equal(angebotPositionenAus('kein json'), null)
    assert.equal(angebotPositionenAus(JSON.stringify([{ fuellung_id: 'keine-uuid', menge: '1', preis_brutto: '1' }])), null)
    // Komma, Tausenderpunkt und mehr als zwei Nachkommastellen werden nicht gedeutet, sondern abgelehnt
    for (const preis of ['12,50', '1.234,5', '12.555', 'abc', '']) {
      const q = angebotPositionenAus(JSON.stringify([{ fuellung_id: F1, menge: '1', preis_brutto: preis, ust_satz: '13' }]))
      assert.match(angebotFehler(KOPF, q, '2026-11-12'), /Position 1: Bitte einen Preis je Flasche/, preis)
    }
  })
  test('Prüfung von Kopf und Positionen', () => {
    assert.equal(angebotFehler(KOPF, [POS], '2026-11-12'), null)
    assert.equal(angebotFehler({ ...KOPF, kunde: '' }, [POS], '2026-11-12'), 'Bitte einen Kunden wählen.')
    assert.match(angebotFehler({ ...KOPF, datum: '2026-11-13' }, [POS], '2026-11-12'), /nicht in der Zukunft/)
    assert.match(angebotFehler({ ...KOPF, gueltig_bis: '2026-11-11' }, [POS], '2026-11-12'), /nicht vor dem Angebotsdatum/)
    // „gültig bis“ in der Vergangenheit ist erlaubt, solange nicht vor dem Angebotsdatum (rückdatiertes Angebot)
    assert.equal(angebotFehler({ ...KOPF, datum: '2026-10-01', gueltig_bis: '2026-10-15' }, [POS], '2026-11-12'), null)
    assert.match(angebotFehler(KOPF, [], '2026-11-12'), /mindestens eine Position/)
    assert.match(angebotFehler(KOPF, null, '2026-11-12'), /konnten nicht gelesen werden/)
    assert.match(angebotFehler(KOPF, [{ ...POS, fuellung_id: '' }], '2026-11-12'), /Position 1: Bitte eine Füllung/)
    assert.match(angebotFehler(KOPF, [POS, { ...POS, menge: 0 }], '2026-11-12'), /Position 2: Bitte eine Menge ab 1/)
    assert.match(angebotFehler(KOPF, [{ ...POS, rabatt_pct: 101 }], '2026-11-12'), /Rabatt muss zwischen 0 und 100/)
    assert.match(angebotFehler(KOPF, [{ ...POS, sonderrabatt_pct: -1 }], '2026-11-12'), /Sonderrabatt muss zwischen 0 und 100/)
    assert.match(angebotFehler(KOPF, [{ ...POS, ust_satz: NaN }], '2026-11-12'), /Steuersatz/)
    assert.match(angebotFehler(KOPF, Array.from({ length: 101 }, () => POS), '2026-11-12'), /Höchstens 100 Positionen/)
    assert.equal(angebotFehler(KOPF, [{ ...POS, preis_brutto: 0 }], '2026-11-12'), null)   // Gratisflasche
  })
  test('Form für die Datenbank: Zahlen als Text mit Dezimalpunkt und zwei Stellen', () => {
    assert.deepEqual(angebotPositionenFuerDb([{ ...POS, rabatt_pct: 7.5 }]),
      [{ fuellung_id: F1, menge: '6', preis_brutto: '12.50', rabatt_pct: '7.50', sonderrabatt_pct: '0.00', ust_satz: '13.00' }])
  })
  test('Grund: beim Storno Pflicht, beim Ablehnen freiwillig', () => {
    assert.equal(angebotGrundFehler('abgelehnt', ''), null)
    assert.match(angebotGrundFehler('storniert', 'kurz'), /mindestens 10 Zeichen/)
    assert.equal(angebotGrundFehler('storniert', 'irrtümlich angelegt'), null)
    assert.match(angebotGrundFehler('abgelehnt', 'x'.repeat(501)), /höchstens 500/)
  })
})

describe('KAN-418 Teil 4: Beträge wie im Verkauf', () => {
  test('Zeile: Preis × (1 − Rabatt) × (1 − Sonderrabatt) × Menge, kaufmännisch auf Cent', () => {
    assert.equal(angebotZeileBrutto({ menge: 6, preis_brutto: 12.5, rabatt_pct: 10, sonderrabatt_pct: 5 }), 64.13)   // 64,125 → 64,13
    assert.equal(angebotZeileBrutto({ menge: 1, preis_brutto: 1.13, rabatt_pct: 50 }), 0.57)   // 0,565 → 0,57 (binär wäre 0,56)
    assert.equal(angebotEinzelpreis({ preis_brutto: 12.5, rabatt_pct: 10, sonderrabatt_pct: 0 }), 11.25)
    assert.equal(angebotRabattText({ rabatt_pct: 10, sonderrabatt_pct: 2.5 }), '10 % + 2,5 %')
    assert.equal(angebotRabattText({ rabatt_pct: 0, sonderrabatt_pct: 0 }), '')
  })
  test('Summen: brutto = Summe der gerundeten Zeilen, Netto und Steuer je Satz herausgerechnet', () => {
    const s = angebotSummen([
      { menge: 6, preis_brutto: '12.50', rabatt_pct: '0', sonderrabatt_pct: '0', ust_satz: '13.00' },   // 75,00
      { menge: 12, preis_brutto: '9.90', rabatt_pct: '10', sonderrabatt_pct: '0', ust_satz: '13.00' },  // 106,92
      { menge: 2, preis_brutto: '20', rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20 },               // 40,00
    ])
    assert.equal(s.flaschen, 20)
    assert.equal(s.brutto, 221.92)
    assert.deepEqual(s.ust, [{ satz: 13, netto: 160.99, steuer: 20.93 }, { satz: 20, netto: 33.33, steuer: 6.67 }])
    assert.equal(s.netto, 194.32)
    assert.equal(Math.round((s.netto + s.ust.reduce((x, u) => x + u.steuer, 0)) * 100), Math.round(s.brutto * 100))
    assert.deepEqual(angebotSummen([]), { brutto: 0, netto: 0, ust: [], flaschen: 0 })
  })
})

describe('KAN-418 Teil 4: Texte', () => {
  test('PDF-Hinweise, Dateiname, Betreff, Mail', () => {
    assert.deepEqual(angebotHinweise('2026-11-26'), ['Dieses Angebot gilt bis 26.11.2026.', 'Das Angebot ist freibleibend, die Ware ist nicht reserviert.'])
    assert.equal(angebotDateiname('AN-2026-0007'), 'Angebot-AN-2026-0007.pdf')
    assert.equal(angebotDateiname('../x y'), 'Angebot-x-y.pdf')
    assert.equal(angebotBetreff('AN-2026-0007', 'Weingut Musterhof'), 'Angebot AN-2026-0007 von Weingut Musterhof')
    const m = angebotMailText({ kundenName: 'Gasthaus Krone', nummer: 'AN-2026-0007', gueltigBis: '2026-11-26', nachricht: ' Wie besprochen. ', betrieb: 'Weingut Musterhof' })
    assert.match(m, /anbei erhalten Sie unser Angebot AN-2026-0007\. Es gilt bis 26\.11\.2026\./)
    assert.match(m, /\n\nWie besprochen\.\n\nFreundliche Grüße\nWeingut Musterhof$/)
  })
})

describe('KAN-418 Teil 4: Lieferung mit Angebotspreisen (Frage 3A)', () => {
  test('Auftragsposition mit Preis → Vorschlag; ohne Preis → Preise von heute (null)', () => {
    assert.equal(angebotsPreis({ preis_brutto: null }), null)
    assert.deepEqual(angebotsPreis({ preis_brutto: '11.00', rabatt_pct: '0.00', sonderrabatt_pct: '5.00', ust_satz: '13.00' }),
      { preis_brutto: 11, rabatt_pct: 0, sonderrabatt_pct: 5, ust_satz: 13 })
    assert.deepEqual(angebotsPreis({ preis_brutto: 0 }), { preis_brutto: 0, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: null })
    const v = lieferVorschlag([
      { id: 'a', fuellung_id: F1, name: 'GV', menge: 10, geliefert: 4, preis_brutto: '9.90', rabatt_pct: '10', sonderrabatt_pct: null, ust_satz: '13' },
      { id: 'b', fuellung_id: F2, name: 'ZW', menge: 6, geliefert: 0 },
    ])
    assert.deepEqual(v, [
      { position_id: 'a', fuellung_id: F1, name: 'GV', offen: 6, preis: { preis_brutto: 9.9, rabatt_pct: 10, sonderrabatt_pct: 0, ust_satz: 13 } },
      { position_id: 'b', fuellung_id: F2, name: 'ZW', offen: 6, preis: null },
    ])
  })
  test('Verkaufsformular: Angebotspreis vor dem Preis der Füllung, Rabatte nach der Kundenwahl gesetzt', () => {
    const f = quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx')
    assert.match(f, /preis_brutto: p\.preis \? String\(p\.preis\.preis_brutto\) : f\?\.vk_preis_brutto != null/)
    assert.match(f, /ust_satz: String\(p\.preis\?\.ust_satz \?\? ustStandard\)/)
    const wahl = f.indexOf('if (t) kundeWaehlen(r.kunde, t)')
    const preise = f.indexOf('rabattFuerNeuePosition({ rabatt_pct: preis.rabatt_pct, sonderrabatt_pct: preis.sonderrabatt_pct })')
    assert.ok(wahl > 0 && preise > wahl, 'Angebotsrabatte müssen nach der Kundenwahl gesetzt werden')
    const a = quelle('src/app/(dashboard)/weinhandel/auftraege/actions.ts')
    assert.match(a, /select\('id, fuellung_id, name, menge, geliefert, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz'\)/)
  })
})

describe('KAN-418 Teil 4: Migration', () => {
  const m = migration('kan418f_angebot')
  test('Status je Art, Übernahme genau einmal, Fremdverweis mit Trigger und Index', () => {
    assert.match(m, /art = 'auftrag' AND status IN \('offen', 'teilgeliefert', 'geliefert', 'abgeschlossen', 'storniert'\)/)
    assert.match(m, /art = 'angebot' AND status IN \('offen', 'angenommen', 'abgelehnt', 'storniert'\)/)
    assert.match(m, /CREATE UNIQUE INDEX auftraege_angebot_idx ON public\.auftraege \(angebot_id\);/)
    assert.match(m, /CREATE TRIGGER z_fremdverweis_angebot_id BEFORE INSERT OR UPDATE OF angebot_id, tenant_id ON public\.auftraege/)
    assert.match(m, /CHECK \(angebot_id IS NULL OR art = 'auftrag'\)/)
  })
  test('Nummernkreis AN mit Spaltenrechten; interne Funktionen ohne Recht für Benutzer', () => {
    assert.match(m, /ADD COLUMN angebot_prefix  text NOT NULL DEFAULT 'AN'/)
    assert.match(m, /GRANT SELECT \(angebot_prefix, angebot_stellen, angebot_zaehler\) ON public\.tenant_einstellungen TO authenticated, anon;/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_angebotsnummer_ziehen\(uuid\) FROM PUBLIC, anon, authenticated;/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_angebot_schreiben_intern\(uuid, uuid, jsonb, jsonb\) FROM PUBLIC, anon, authenticated;/)
  })
  test('öffentliche RPCs: Zugriff, Abo-Sperre, Schreibmodul – und anon ausgeschlossen', () => {
    for (const fn of ['s112_angebot_anlegen', 's112_angebot_aendern', 's112_angebot_status_setzen']) {
      const start = m.indexOf(`CREATE FUNCTION public.${fn}(`)
      const rumpf = m.slice(start, m.indexOf('$$;', start))
      assert.match(rumpf, /SECURITY DEFINER\s+SET search_path = public/, fn)
      const z = rumpf.indexOf('PERFORM public.pruefe_tenant_zugriff(p_tenant_id'), a = rumpf.indexOf('PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id)')
      const s = rumpf.indexOf("PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft')")
      assert.ok(z > 0 && a > z && s > a, `${fn}: Reihenfolge der Prüfungen`)
      assert.match(m, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`), fn)
    }
    assert.match(m, /IF v_a\.status <> 'offen' THEN\s+RAISE EXCEPTION 'Das Angebot % ist nicht mehr offen und lässt sich nicht mehr ändern\.'/)
  })
  test('Auftrag aus Angebot: offen, gleicher Kunde, Preise an die Positionen; Auftragsstorno greift nicht auf Angebote', () => {
    assert.match(m, /IF v_an\.status <> ''offen'' THEN/)
    assert.match(m, /IF v_an\.kontakt_id IS DISTINCT FROM v_kontakt OR v_an\.firma_id IS DISTINCT FROM v_firma THEN/)
    assert.match(m, /UPDATE public\.auftraege SET status = ''angenommen''/)
    assert.match(m, /SET preis_brutto = q\.preis_brutto, rabatt_pct = q\.rabatt_pct, sonderrabatt_pct = q\.sonderrabatt_pct, ust_satz = q\.ust_satz/)
    assert.match(m, /x\.art <> ''auftrag''/)
    assert.equal((m.match(/Ankerstelle nicht genau einmal gefunden/g) ?? []).length, 2)
  })
})

describe('KAN-418 Teil 4: Verdrahtung', () => {
  test('Actions: Rechte vorab, Schreiben nur über die RPCs', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/angebote/actions.ts')
    const ctx = a.slice(a.indexOf('async function getCtx()'), a.indexOf('function neuLaden()'))
    assert.ok(ctx.indexOf('pruefeSeitenBetrieb(') < ctx.indexOf('pruefeSchreibzugriff(') && ctx.indexOf('pruefeSchreibzugriff(') < ctx.indexOf("canWrite(membership, 'warenwirtschaft')"))
    for (const rpc of ['s112_angebot_anlegen', 's112_angebot_aendern', 's112_angebot_status_setzen']) assert.match(a, new RegExp(`'${rpc}'`), rpc)
    assert.doesNotMatch(a, /\.from\('auftraege'\)|\.from\('auftrag_positionen'\)/)
    assert.match(a, /const fehler = angebotFehler\(kopf, positionen, heuteWien\(\)\)/)
  })
  test('Seiten und Lader filtern auf die Art – ein Angebot erscheint nie als Auftrag (und umgekehrt)', () => {
    for (const p of ['angebote/page.tsx', 'angebote/[id]/page.tsx', 'angebote/[id]/bearbeiten/page.tsx']) {
      assert.match(quelle(`src/app/(dashboard)/weinhandel/${p}`), /\.eq\('art', 'angebot'\)/, p)
    }
    assert.match(quelle('src/lib/auftrag/angebotLaden.ts'), /\.eq\('id', angebotId\)\.eq\('tenant_id', tenantId\)\.eq\('art', 'angebot'\)/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/page.tsx'), /\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.eq\('art', 'auftrag'\)/)
    assert.match(quelle('src/lib/auftrag/bestaetigungLaden.ts'), /\.eq\('tenant_id', tenantId\)\.eq\('art', 'auftrag'\)\.maybeSingle\(\)/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/auftraege/actions.ts'), /\.eq\('id', auftragId\)\.eq\('tenant_id', tenantId\)\.eq\('art', 'auftrag'\)/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/auftraege/page.tsx'), /\.eq\('tenant_id', tenantId\)\.eq\('art', 'auftrag'\)/)
  })
  test('Bearbeiten und Aktionen nur am offenen Angebot und nur mit Schreibrecht', () => {
    const b = quelle('src/app/(dashboard)/weinhandel/angebote/[id]/bearbeiten/page.tsx')
    assert.match(b, /if \(!canWrite\(membership, 'warenwirtschaft'\)\) redirect/)
    assert.match(b, /if \(!angebotOffen\(a as/)
    const d = quelle('src/app/(dashboard)/weinhandel/angebote/[id]/page.tsx')
    assert.match(d, /\{darfSchreiben && offen && <AngebotAktionen/)
    const k = quelle('src/app/(dashboard)/weinhandel/angebote/[id]/AngebotAktionen.tsx')
    assert.match(k, /href=\{`\/weinhandel\/auftraege\/neu\?angebot=\$\{id\}`\}/)
    assert.match(k, /await rueckfrage\(\{/)
    assert.doesNotMatch(k, /confirm\(/)
    assert.match(k, /\} finally \{\s+setLaeuft\(false\)/)
  })
  test('Übernahme: Auftragsformular vorbelegt, Kunde fest, Angebot wandert bis in die RPC', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/auftraege/neu/page.tsx')
    assert.match(p, /const angebotId = auftragIdAus\(\(await searchParams\)\.angebot\)/)
    assert.match(p, /\.eq\('id', angebotId\)\.eq\('tenant_id', tenantId\)\.eq\('art', 'angebot'\)/)
    assert.match(p, /else if \(!angebotOffen\(an as/)
    const f = quelle('src/app/(dashboard)/weinhandel/auftraege/neu/AuftragForm.tsx')
    assert.match(f, /if \(angebot\) fd\.set\('angebot_id', angebot\.id\)/)
    assert.match(f, /disabled=\{!!angebot\}/)
    const a = quelle('src/app/(dashboard)/weinhandel/auftraege/actions.ts')
    assert.match(a, /\{ angebot_id: auftragIdAus\(formData\.get\('angebot_id'\)\) \}/)
  })
  test('PDF und Versand: eigene Routen mit Zwei-Faktor; Senden mit Seiten-Betrieb, Schreibsperre und Schreibrecht', () => {
    const pdf = quelle('src/app/api/weinhandel/angebote/[id]/pdf/route.ts')
    assert.match(pdf, /const zweiFaktor = await pruefeZweiFaktor\(\)\s+if \(zweiFaktor\) return zweiFaktor/)
    assert.match(pdf, /ladeAngebot\(supabase, membership\.tenantId, id\)/)
    const send = quelle('src/app/api/weinhandel/angebote/[id]/send/route.ts')
    assert.match(send, /const zweiFaktor = await pruefeZweiFaktor\(\)\s+if \(zweiFaktor\) return zweiFaktor/)
    assert.ok(send.indexOf('seitenBetriebKonflikt(') < send.indexOf('schreibSperreKonflikt(') && send.indexOf('schreibSperreKonflikt(') < send.indexOf("canWrite(membership, 'warenwirtschaft')"))
    assert.match(send, /belegPerMailSenden\(\{/)
    assert.match(send, /angebotMailText\(\{/)
    const panel = quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/AuftragsbestaetigungPanel.tsx')
    assert.match(panel, /const api = beleg\?\.api \?\? `\/api\/weinhandel\/auftraege\/\$\{id\}`/)
    const lader = quelle('src/lib/auftrag/angebotLaden.ts')
    assert.match(lader, /if \(!angebotVersendbar\(a\)\) return \{ ok: false, status: 400/)
    assert.match(lader, /summen: angebotSummen\(zeilen\)/)
  })
  test('Menüpunkt und Wächter-Listen', () => {
    assert.match(quelle('src/lib/navigation/index.ts'), /href: '\/weinhandel\/angebote',\s+label: 'Angebote'/)
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const s of ['gueltig_bis', 'angebot_id', 'abgelehnt_am', 'abgelehnt_grund']) assert.ok(schema.auftraege.includes(s), s)
    for (const s of ['preis_brutto', 'rabatt_pct', 'sonderrabatt_pct', 'ust_satz']) assert.ok(schema.auftrag_positionen.includes(s), s)
    for (const s of ['angebot_prefix', 'angebot_stellen', 'angebot_zaehler']) assert.ok(schema.tenant_einstellungen.includes(s), s)
    assert.match(quelle('scripts/fremdschluessel.json'), /"n":"auftraege_angebot_id_fkey","t":"auftraege","s":\["angebot_id"\],"z":"auftraege"/)
  })
})
