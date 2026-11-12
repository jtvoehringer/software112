// KAN-418 Teil 3 (12.11.2026): Auftragsbestätigung – Inhalt, Texte und Verdrahtung.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  abBetreff, abDateiname, abDatum, abEmpfaengerFehler, abFlaschenGesamt, abHinweise, abMailText, abMoeglich, abNachrichtFehler, abPositionen,
} from '../../src/lib/auftrag/bestaetigung.ts'

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

describe('KAN-418 Teil 3: Inhalt der Auftragsbestätigung', () => {
  test('Positionen: bestellte Flaschen (nicht die offenen), Flaschengröße als Unterzeile', () => {
    const p = abPositionen([
      { name: 'Riesling Reserve 2025', menge: 120, geliefert: 100, fuellung: { flaschengroesse_ml: 750 } },
      { name: 'Zweigelt 2025', menge: '6', fuellung: { flaschengroesse_ml: 1500 } },
      { name: '  ', menge: 12, fuellung: { flaschengroesse_ml: 620 } },
      { name: 'Ohne Füllung', menge: 3, fuellung: null },
    ])
    assert.deepEqual(p, [
      { name: 'Riesling Reserve 2025', sub: '0,75 L', flaschen: 120 },
      { name: 'Zweigelt 2025', sub: '1,5 L', flaschen: 6 },
      { name: 'Position', sub: '620 ml', flaschen: 12 },
      { name: 'Ohne Füllung', sub: null, flaschen: 3 },
    ])
    assert.equal(abFlaschenGesamt(p), 141)
  })
  test('keine Preise: Hinweis auf Reservierung und Preise bei Lieferung', () => {
    assert.deepEqual(abHinweise('2026-11-26'), ['Die Ware ist bis 26.11.2026 für Sie reserviert.', 'Es gelten die Preise zum Zeitpunkt der Lieferung.'])
    assert.deepEqual(abHinweise(null)[0], 'Die Ware ist für Sie reserviert.')
    const pdf = quelle('src/lib/pdf/auftragsbestaetigungPdf.tsx')
    // das Dokument kennt keine Preisfelder (anders als die Rechnung)
    assert.doesNotMatch(pdf, /preisBrutto|fmtEur|MwSt|Rechnungsbetrag|rabatt|€/i)
    assert.ok(pdf.includes('AUFTRAGSBESTÄTIGUNG') && pdf.includes('Flaschen gesamt'))
  })
  test('Datum rein auf dem Text – kein Tagesversatz durch Zeitzonen', () => {
    assert.equal(abDatum('2026-11-12'), '12.11.2026')
    assert.equal(abDatum('2026-01-01T00:30:00+00:00'), '01.01.2026')
    assert.equal(abDatum(null), '')
    assert.equal(abDatum('12.11.2026'), '')
  })
  test('nur für nicht stornierte Aufträge – auch teilgeliefert, geliefert, abgeschlossen', () => {
    for (const status of ['offen', 'teilgeliefert', 'geliefert', 'abgeschlossen']) assert.equal(abMoeglich({ status, storniert_am: null }), true, status)
    assert.equal(abMoeglich({ status: 'storniert', storniert_am: '2026-11-12T10:00:00Z' }), false)
    assert.equal(abMoeglich({ status: 'offen', storniert_am: '2026-11-12T10:00:00Z' }), false)
  })
})

describe('KAN-418 Teil 3: Mail', () => {
  test('Betreff, Dateiname ohne kritische Zeichen', () => {
    assert.equal(abBetreff('AB-2026-0001', 'Weingut Musterhof'), 'Auftragsbestätigung AB-2026-0001 von Weingut Musterhof')
    assert.equal(abDateiname('AB-2026-0001'), 'Auftragsbestaetigung-AB-2026-0001.pdf')
    assert.equal(abDateiname('AB/2026 "x"\r\n.pdf'), 'Auftragsbestaetigung-AB-2026-x-pdf.pdf')
    assert.equal(abDateiname(null), 'Auftragsbestaetigung-Auftrag.pdf')
  })
  test('Standardtext; die optionale Nachricht ergänzt ihn', () => {
    const basis = { kundenName: 'Franz Mayer', nummer: 'AB-2026-0001', reserviertBis: '2026-11-26', betrieb: 'Weingut Musterhof' }
    assert.equal(abMailText(basis), [
      'Sehr geehrte Damen und Herren, Franz Mayer,', '',
      'anbei erhalten Sie unsere Auftragsbestätigung AB-2026-0001. Die Ware ist bis 26.11.2026 für Sie reserviert.', '',
      'Freundliche Grüße', 'Weingut Musterhof',
    ].join('\n'))
    const mit = abMailText({ ...basis, kundenName: null, nachricht: '  Abholung ab Montag möglich.  ' })
    assert.ok(mit.startsWith('Sehr geehrte Damen und Herren,\n'))
    assert.ok(mit.includes('für Sie reserviert.\n\nAbholung ab Montag möglich.\n\nFreundliche Grüße'))
    assert.ok(!abMailText({ ...basis, reserviertBis: null }).includes('reserviert'))
  })
  test('Empfänger: genau eine gültige Adresse; Nachricht begrenzt', () => {
    assert.equal(abEmpfaengerFehler(' kunde@example.at '), null)
    for (const an of ['', '  ', null, undefined, 5]) assert.match(abEmpfaengerFehler(an), /Empfänger-E-Mail-Adresse angeben/, String(an))
    for (const an of ['kunde', 'kunde@', '@example.at', 'a@b', 'a@b.at, c@d.at', 'a b@c.at', 'x'.repeat(320) + '@example.at']) assert.match(abEmpfaengerFehler(an), /gültige E-Mail-Adresse/, an.slice(0, 20))
    assert.equal(abNachrichtFehler(undefined), null)
    assert.equal(abNachrichtFehler('x'.repeat(2000)), null)
    assert.match(abNachrichtFehler('x'.repeat(2001)), /höchstens 2000 Zeichen/)
    assert.match(abNachrichtFehler({}), /nicht gelesen/)
  })
})

describe('KAN-418 Teil 3: Routen', () => {
  const send = quelle('src/app/api/weinhandel/auftraege/[id]/send/route.ts')
  const pdf = quelle('src/app/api/weinhandel/auftraege/[id]/pdf/route.ts')
  const i = (s, t) => { const n = s.indexOf(t); assert.ok(n >= 0, t); return n }
  test('Senden: Zwei-Faktor, Betrieb der Seite, Schreibsperre und Schreibrecht (Mitgliedschaft) vor dem ersten Zugriff', () => {
    assert.ok(i(send, 'await pruefeZweiFaktor()') < i(send, "seitenBetriebKonflikt(membership.tenantId, 'error')"))
    assert.ok(i(send, 'seitenBetriebKonflikt(') < i(send, 'schreibSperreKonflikt(membership)'))
    assert.ok(i(send, 'schreibSperreKonflikt(membership)') < i(send, "canWrite(membership, 'warenwirtschaft')"))
    assert.ok(i(send, "canWrite(membership, 'warenwirtschaft')") < i(send, 'ladeAuftragsbestaetigung(supabase, tenantId, id)'))
    assert.doesNotMatch(send, /canWrite\(membership\.role/)
  })
  test('Senden: Mail nur über belegPerMailSenden, Vermerk über die RPC erst nach dem Versand, kein direktes Update am Auftrag', () => {
    assert.ok(i(send, 'await belegPerMailSenden({') < i(send, "'s112_auftrag_ab_vermerken'"))
    assert.ok(i(send, 'if (!versand.ok) return') < i(send, "'s112_auftrag_ab_vermerken'"))
    assert.doesNotMatch(send, /nodemailer|graph\.microsoft/)
    assert.doesNotMatch(send, /from\('auftraege'\)[^\n]*\.update\(/)
    assert.ok(send.includes("if (vermerkErr) void ereignisMelden("))
    assert.ok(send.includes("art: 'email'") && send.includes('datum: wienTag(gesendetAm)'))
  })
  test('PDF: nur lesend – Zwei-Faktor, Mitgliedschaft, dieselbe Ladefunktion wie der Versand', () => {
    assert.ok(i(pdf, 'await pruefeZweiFaktor()') < i(pdf, 'ladeAuftragsbestaetigung(supabase, membership.tenantId, id)'))
    assert.doesNotMatch(pdf, /\.rpc\b|\.insert\(|\.update\(|belegPerMailSenden/)
    assert.ok(pdf.includes("'Content-Type': 'application/pdf'") && pdf.includes("'Cache-Control': 'no-store'"))
  })
  test('Ladefunktion: eigener Betrieb an jeder Abfrage, Fehler werden ausgewertet, stornierter Auftrag abgelehnt', () => {
    const l = quelle('src/lib/auftrag/bestaetigungLaden.ts')
    assert.equal((l.match(/\.eq\('tenant_id', tenantId\)/g) ?? []).length, 5)
    assert.ok(l.includes('[aRes.error, eRes.error, pRes.error].find(Boolean)') && l.includes('[kRes.error, fRes.error].find(Boolean)'))
    assert.ok(l.includes('if (!abMoeglich(a)) return { ok: false, status: 400'))
    assert.doesNotMatch(l, /preis|rabatt/i)
  })
})

describe('KAN-418 Teil 3: Seite und Migration', () => {
  test('Auftragsdetail: Panel nur ohne Storno, Senden nur mit Schreibrecht; Liste kennzeichnet „bestätigt“', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/page.tsx')
    assert.ok(p.includes('{abMoeglich(a as { status: string; storniert_am: string | null }) && ('))
    assert.ok(p.includes('darfSenden={darfSchreiben}'))
    const panel = quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/AuftragsbestaetigungPanel.tsx')
    assert.ok(panel.includes('{darfSenden && !offen && ('))
    // KAN-418 Teil 4: das Panel dient auch dem Angebot – ohne Angabe bleiben es die Routen der Auftragsbestätigung
    assert.ok(panel.includes('const api = beleg?.api ?? `/api/weinhandel/auftraege/${id}`'))
    assert.ok(panel.includes('href={`${api}/pdf`}') && panel.includes('fetch(`${api}/send`, {'))
    assert.ok(!p.includes('beleg={'), 'die Auftragsseite nutzt die Vorgabe (Auftragsbestätigung)')
    // Ladezustand mit finally, Eingaben erst nach Erfolg leeren
    assert.ok(panel.indexOf('if (!res.ok) {') < panel.indexOf("setNachricht('')"))
    assert.match(panel, /\} finally \{\n\s+setSendet\(false\)/)
    assert.ok(quelle('src/app/(dashboard)/weinhandel/auftraege/page.tsx').includes('{a.ab_versendet_am && <span className="block text-xs text-s112-muted">bestätigt</span>}'))
  })
  test('Migration: Vermerk nur über die RPC – Zugriff vor Abo-Sperre und Schreibmodul, nicht für PUBLIC/anon', () => {
    const sql = migration('kan418d_auftragsbestaetigung')
    const z = sql.indexOf('pruefe_tenant_zugriff(p_tenant_id'), abo = sql.indexOf('s112_pruefe_abo_schreibsperre(p_tenant_id)'), modul = sql.indexOf("s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft')")
    assert.ok(z >= 0 && abo > z && modul > abo, `${z}/${abo}/${modul}`)
    assert.ok(sql.includes('SECURITY DEFINER\nSET search_path = public'))
    assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.s112_auftrag_ab_vermerken(uuid, uuid, text) FROM PUBLIC, anon;'))
    assert.ok(sql.includes("PERFORM set_config('s112.auftrag_frei', 'ja', true);") && sql.includes("PERFORM set_config('s112.auftrag_frei', '', true);"))
    assert.ok(sql.includes('IF v_a.storniert_am IS NOT NULL THEN'))
    // der Schutz-Trigger bleibt unangetastet: direkt änderbar sind weiter nur Frist und Notiz
    assert.doesNotMatch(sql, /s112_auftrag_schutz|a_auftrag_schutz ON/)
  })
})
