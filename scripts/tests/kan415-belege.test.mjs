// KAN-415 (11.11.2026) – Belege an E&A-Buchungen: Datei beim Erfassen, nachträglich anhängen, gescannten Beleg zuordnen,
// mehrere je Buchung, Beleg von der Buchung aus öffnen.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const m = () => laden('lib/buchhaltung/belegAnhang.ts')
const d = (name, type, size) => ({ name, type, size })

describe('KAN-415: Prüfung der Dateien', nurMitHooks, () => {
  test('keine Datei und erlaubte Dateien sind in Ordnung', async () => {
    const { belegDateienFehler } = await m()
    assert.equal(belegDateienFehler([]), null)
    assert.equal(belegDateienFehler([d('r.pdf', 'application/pdf', 1000), d('f.jpg', 'image/jpeg', 2000), d('g.png', 'image/png', 1), d('h.webp', 'image/webp', 1)]), null)
  })
  test('falscher Typ, leere Datei, zu viele, zusammen zu groß', async () => {
    const { belegDateienFehler, BELEG_MAX_BYTES, BELEG_MAX_ANZAHL } = await m()
    assert.match(belegDateienFehler([d('x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10)]), /nicht unterstütztes Dateiformat/)
    assert.match(belegDateienFehler([d('leer.pdf', 'application/pdf', 0)]), /ist leer/)
    assert.match(belegDateienFehler(Array.from({ length: BELEG_MAX_ANZAHL + 1 }, (_, i) => d(`b${i}.pdf`, 'application/pdf', 10))), /Höchstens/)
    assert.match(belegDateienFehler([d('a.pdf', 'application/pdf', BELEG_MAX_BYTES / 2), d('b.pdf', 'application/pdf', BELEG_MAX_BYTES / 2 + 1)]), /zusammen zu groß/)
    assert.equal(belegDateienFehler([d('a.pdf', 'application/pdf', BELEG_MAX_BYTES)]), null)   // genau die Grenze geht
  })
  test('Ablagepfad beginnt mit dem Betrieb, Dateiname ohne Sonderzeichen; Texte', async () => {
    const { belegPfad, belegAnzahlText, belegDateiPfad } = await m()
    assert.equal(belegPfad('t1', 'Rechnung März (2).pdf', 1700000000000, 1), 't1/1700000000000-1-Rechnung_M_rz__2_.pdf')
    assert.equal(belegPfad('t1', '', 5), 't1/5-0-beleg')
    assert.ok(belegPfad('t1', 'x'.repeat(300) + '.pdf', 5).length < 150)
    assert.equal(belegAnzahlText(1), '1 Beleg')
    assert.equal(belegAnzahlText(3), '3 Belege')
    assert.equal(belegDateiPfad('abc'), '/api/buchhaltung/belege/abc/datei')
  })
})

describe('KAN-415: Wege und Absicherung', () => {
  test('Buchung erfassen: Belege werden vor dem Anlegen geprüft und danach angehängt', () => {
    const a = quelle('src/app/(dashboard)/buchhaltung/actions.ts')
    const pruefung = a.indexOf("belegDateienFehler(belege)"), anlegen = a.indexOf("}).select('id').single()"), anhaengen = a.indexOf('haengeDateienAn(supabase, tenantId')
    assert.ok(pruefung > 0 && anlegen > pruefung && anhaengen > anlegen, 'Reihenfolge prüfen → anlegen → anhängen')
    // KAN-421: Hinweise (Belege, Kostenrechnung) werden gesammelt und gemeinsam als belegFehler zurückgegeben
    assert.match(a, /if \(erg\.error\) hinweise\.push\(`Die Buchung ist gespeichert, aber nicht alle Belege/)
    assert.match(a, /if \(hinweise\.length > 0\) return \{ ok: true, belegFehler: hinweise\.join\(' '\) \}/)
    const f = quelle('src/app/(dashboard)/buchhaltung/neu/page.tsx')
    assert.match(f, /<BelegDateiFeld \/>/)
    assert.match(f, /beleg_fehler=/)
    assert.match(quelle('next.config.ts'), /serverActions: \{ bodySizeLimit: '5mb' \}/)
  })
  test('Anhängen: Datei wird bei gescheiterter Zeile wieder entfernt, Beleg ist sofort „verbucht“', () => {
    const s = quelle('src/lib/buchhaltung/belegSpeichern.ts')
    assert.match(s, /status: 'verbucht'/)
    assert.match(s, /ea_transaktion_id: transaktionId/)
    assert.ok(s.indexOf('.upload(pfad') < s.indexOf(".from('ea_belege') as any).insert("), 'erst Datei, dann Zeile')
    assert.match(s, /if \(insErr\) \{\s*(?:\/\/[^\n]*\n\s*)?await supabase\.storage\.from\(BELEG_BUCKET\)\.remove\(\[pfad\]\)/)
    assert.match(s, /storniert_am \|\| b\.storno_von_id/)
  })
  test('Route anhang: Zwei-Faktor, Seitenbetrieb, Schreibsperre, Recht E&A, Modul; Zuordnen nur unverbuchter Belege mit Trefferprüfung', () => {
    const r = quelle('src/app/api/buchhaltung/belege/anhang/route.ts')
    const zf = r.indexOf('pruefeZweiFaktor()'), sb = r.indexOf('seitenBetriebKonflikt('), ss = r.indexOf('schreibSperreKonflikt('), re = r.indexOf("canWrite(membership, 'ea')")
    assert.ok(zf > 0 && sb > zf && ss > sb && re > ss)
    assert.match(r, /modul_ea/)
    assert.match(r, /\.in\('status', \['erkannt', 'fehler'\]\)\s*\.select\('id'\)/)
    assert.match(r, /buchungFuerAnhangFehler\(supabase, tenantId, transaktionId\)/)
  })
  test('Route datei: nur lesend, über id und Betrieb, kurzlebige Adresse', () => {
    const r = quelle('src/app/api/buchhaltung/belege/[id]/datei/route.ts')
    assert.match(r, /pruefeZweiFaktor\(\)/)
    assert.match(r, /\.eq\('id', id\)\.eq\('tenant_id', tenantId\)/)
    assert.match(r, /createSignedUrl\(pfad, GUELTIG_S\)/)
    assert.doesNotMatch(r, /\.(insert|update|delete|upsert)\(/)
  })
  test('Buchungsliste und Belegseiten: Büroklammer je Buchung, verbuchte Belege lassen sich öffnen', () => {
    const p = quelle('src/app/(dashboard)/buchhaltung/page.tsx')
    assert.match(p, /<BelegAnhang transaktionId=\{b\.id\}/)
    assert.match(p, /darfAnhaengen=\{darfAnhaengen && !b\.stornoStatus\}/)
    assert.match(quelle('src/lib/behoerden/ea-journal.ts'), /ea_belege\(id, dateiname, hochgeladen_am\)/)
    assert.match(quelle('src/app/(dashboard)/buchhaltung/belege/[id]/page.tsx'), /if \(beleg\.status === 'verbucht'\) redirect\(belegDateiPfad\(id\)\)/)
    assert.match(quelle('src/app/(dashboard)/buchhaltung/belege/page.tsx'), /href=\{belegDateiPfad\(b\.id\)\}/)
    const k = quelle('src/components/buchhaltung/BelegAnhang.tsx')
    assert.match(k, /finally \{\s*setLaeuft\(false\)/)
    assert.match(k, /if \(!res\.ok\)/)
  })
})

// UAT 12.11.2026 (Nebenbefund): Die Box steht in einer Tabellenzelle ohne Zeilenumbruch – Hinweis und Fehlermeldung
// liefen rechts über den Rand hinaus. Die Box setzt den Umbruch selbst zurück.
test('KAN-415: Hochladebox bricht ihren Text um (nicht das whitespace-nowrap der Tabellenzelle)', () => {
  const k = quelle('src/components/buchhaltung/BelegAnhang.tsx')
  const box = k.split('\n').find(z => z.includes('id={`${id}-feld`}'))
  assert.ok(box, 'Box nicht gefunden')
  for (const klasse of ['whitespace-normal', 'wrap-break-word', 'text-left', 'w-80', 'max-w-[90vw]']) assert.ok(box.includes(klasse), klasse)
})
