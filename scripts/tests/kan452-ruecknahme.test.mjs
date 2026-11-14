// KAN-452 G2 (14.11.2026): Gutschrift mit Rücknahme in den Bestand.
// Befund: Eine Gutschrift (KAN-419) berichtigte nur den Betrag – kam die Ware zurück, musste der Bestand von Hand
// nachgebucht werden, ohne Bezug zum Beleg. Neu: je Position „Ware kommt zurück“; die Datenbank bucht die Menge in
// derselben Transaktion am Datum der Gutschrift zurück (Flaschen samt Journal, Produkte mit Lagerbestand) und verweist
// auf die Gutschrift. Datenbank: DB-Test 04_gutschrift_ruecknahme.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gutschriftEingabeFehler, mitRuecknahme, ruecknahmeArt, ruecknahmeSperre } from '../../src/lib/verkauf/gutschrift.ts'
import { alsBeleg } from '../../src/lib/verkauf/rechnungen.ts'
import { fuellungStornoSperren, VERKAUFS_BEWEGUNGEN } from '../../src/lib/handel/fuellungStornoSperre.ts'
import { BEWEGUNG_ART_LABEL, lagerstand } from '../../src/lib/warenwirtschaft/sonstigeProdukte.ts'
import { bewegungsartLabel, istBewegungsart } from '../../src/app/(dashboard)/weinhandel/fuellungen/bewegungsarten.ts'

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
const M = migration('kan452a_gutschrift_ruecknahme')

// Rechnung: 6 Flaschen, 4 Saft (Lagerbestand), 2 Karton (ohne Lagerbestand), 10 l Tankwein, Versand (frei)
const basis = { preis_brutto: 10, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20 }
const WEIN = { ...basis, id: 'pf', name: 'Wein', menge: 6, typ: 'flasche', fuellung_id: 'f1', fuellung_aktiv: true, fuellung_storniert_am: null }
const SAFT = { ...basis, id: 'ps', name: 'Saft', menge: 4, typ: 'sonstiges', sonstige_artikel_id: 'a1', bestand_fuehren: true, artikel_aktiv: true }
const KARTON = { ...basis, id: 'p0', name: 'Karton', menge: 2, typ: 'sonstiges', sonstige_artikel_id: 'a0', bestand_fuehren: false, artikel_aktiv: true }
const TANK = { ...basis, id: 'pt', name: 'Tankwein', menge: 10, typ: 'tank', weinausbau_id: 'w1' }
const FREI = { ...basis, id: 'px', name: 'Versand', menge: 1, typ: 'sonstiges', sonstige_artikel_id: null }
const RAHMEN = { rechnungDatum: '2026-11-10', heute: '2026-11-14', positionen: [WEIN, SAFT, KARTON, TANK, FREI], gutschriften: [] }
const fehler = positionen => gutschriftEingabeFehler({ datum: '2026-11-13', grund: 'Falsche Lieferung zurück', positionen, betrag: 0 }, RAHMEN)

describe('KAN-452: welche Position kann zurück in den Bestand', () => {
  test('Flaschen einer Füllung und Produkte mit Lagerbestand – sonst nichts', () => {
    assert.equal(ruecknahmeArt(WEIN), 'flasche')
    assert.equal(ruecknahmeArt(SAFT), 'produkt')
    for (const p of [KARTON, TANK, FREI, { typ: 'trauben' }, { typ: 'flasche', fuellung_id: null }, { typ: 'sonstiges', sonstige_artikel_id: 'a', bestand_fuehren: null }]) {
      assert.equal(ruecknahmeArt(p), null, JSON.stringify(p))
    }
  })
  test('stornierte Füllung bzw. deaktiviertes Produkt: gesperrt, mit Grund', () => {
    assert.equal(ruecknahmeSperre(WEIN), null)
    assert.equal(ruecknahmeSperre(SAFT), null)
    assert.match(ruecknahmeSperre({ ...WEIN, fuellung_aktiv: false }), /Füllung storniert/)
    assert.match(ruecknahmeSperre({ ...WEIN, fuellung_storniert_am: '2026-11-01T10:00:00Z' }), /Füllung storniert/)
    assert.match(ruecknahmeSperre({ ...SAFT, artikel_aktiv: false }), /Produkt deaktiviert/)
    assert.equal(ruecknahmeSperre(TANK), null)   // dort gibt es die Rücknahme gar nicht
  })
})

describe('KAN-452: Eingabeprüfung (wie die Datenbank)', () => {
  test('in Ordnung: Flaschen ganzzahlig, Produkt auch mit Kommastellen; ohne Kennzeichen wie bisher', () => {
    assert.equal(fehler([{ position_id: 'pf', menge: 2, ruecknahme: true }, { position_id: 'ps', menge: 1.5, ruecknahme: true }]), null)
    assert.equal(fehler([{ position_id: 'pt', menge: 5 }, { position_id: 'px', menge: 1, ruecknahme: false }]), null)
  })
  test('Tankwein, freie Position, Produkt ohne Lagerbestand: abgelehnt an den Positionen', () => {
    for (const id of ['pt', 'px', 'p0']) {
      const f = fehler([{ position_id: id, menge: 1, ruecknahme: true }])
      assert.equal(f.feld, 'positionen', id)
      assert.match(f.text, /nur für Flaschen und für Produkte mit Lagerbestand/, id)
    }
  })
  test('halbe Flasche; stornierte Füllung – die Gutschrift ohne Rücknahme bleibt möglich', () => {
    assert.match(fehler([{ position_id: 'pf', menge: 1.5, ruecknahme: true }]).text, /„Wein“: Flaschen lassen sich nur in ganzen Stück zurücknehmen/)
    const r = { ...RAHMEN, positionen: [{ ...WEIN, fuellung_aktiv: false }] }
    const e = { datum: '2026-11-13', grund: 'Falsche Lieferung zurück', betrag: 0 }
    assert.match(gutschriftEingabeFehler({ ...e, positionen: [{ position_id: 'pf', menge: 1, ruecknahme: true }] }, r).text, /Füllung storniert.*ohne Rücknahme ausstellen/)
    assert.equal(gutschriftEingabeFehler({ ...e, positionen: [{ position_id: 'pf', menge: 1 }] }, r), null)
  })
})

describe('KAN-452: Leser', () => {
  const G = { art: 'gutschrift', aktiv: true, gutschrift_positionen: [
    { position_id: 'pf', name: 'Wein', menge: 2, preis_brutto: 10, ust_satz: 20, frei: false, ruecknahme: true },
    { position_id: 'pt', name: 'Tankwein', menge: 1, preis_brutto: 10, ust_satz: 20, frei: false, ruecknahme: false }] }
  test('Momentaufnahme: Kennzeichen je Zeile; alsBeleg reicht es an den Beleg weiter', () => {
    assert.equal(mitRuecknahme(G), true)
    assert.equal(mitRuecknahme({ gutschrift_positionen: [{ menge: 1 }] }), false)   // Gutschriften vor KAN-452
    assert.equal(mitRuecknahme({}), false)
    assert.deepEqual(alsBeleg(G).verkauf_positionen.map(p => [p.menge, p.ruecknahme]), [[-2, true], [-1, false]])
  })
  test('Bewegungslisten kennen die Art; im Formular „Bestand korrigieren“ ist sie nicht wählbar', () => {
    assert.equal(bewegungsartLabel('ruecknahme'), 'Rücknahme (Gutschrift)')
    assert.equal(istBewegungsart('ruecknahme'), false)
    assert.equal(BEWEGUNG_ART_LABEL.ruecknahme, 'Rücknahme (Gutschrift)')
    assert.equal(lagerstand([{ id: '1', datum: '', art: 'zugang', menge: 20 }, { id: '2', datum: '', art: 'verkauf', menge: -4 }, { id: '3', datum: '', art: 'ruecknahme', menge: 1 }]), 17)
  })
  test('Storno-Sperre der Füllung: die Rücknahme zählt als Bestandsbuchung, nicht als Verkaufszeile', () => {
    assert.equal(VERKAUFS_BEWEGUNGEN.includes('ruecknahme'), false)
    const sperren = fuellungStornoSperren([{ id: 'f1' }], [], [{ fuellung_id: 'f1', art: 'verkauf' }, { fuellung_id: 'f1', art: 'ruecknahme' }])
    assert.match(sperren.get('f1'), /1 Bestandsbuchung/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/folgebuchungen.ts'), /\.not\('art', 'in', '\(verkauf,verkauf_storno\)'\)/)
  })
  test('BSM und Bestandsmeldung: Buchungsart des Verkaufs, Zugang, Kunde wie beim Verkauf', () => {
    const b = quelle('src/lib/behoerden/bsm.ts')
    assert.match(b, /case 'verkauf': case 'verkauf_storno': case 'verkauf_alt': case 'verkauf_alt_storno':\n\s+case 'ruecknahme_storno':.*\n\s+case 'ruecknahme':.*\n\s+return k\.kundeAusland \? 'VK_FL_AU' : 'VK_FL_AT'/)
    assert.match(b, /const istVerkauf = fb\.art\.startsWith\('verkauf'\) \|\| fb\.art\.startsWith\('ruecknahme'\)/)   // KAN-453: auch die Gegenbewegung
    assert.match(b, /fb\.art === 'ruecknahme' \? 'Rücknahme \(Gutschrift\)' : fb\.art === 'ruecknahme_storno'/)
    assert.match(b, /ruecknahme: 'Rücknahme zu einer Gutschrift \(Zugang Flaschenlager\)'/)
    // die Bestandsmeldung übernimmt jede Flaschenbewegung mit ihrem Vorzeichen – ohne Filter auf die Art
    assert.match(quelle('src/lib/behoerden/bestandsmeldung.ts'), /plus\(fb\.fuellung_id, \{ datum: tag\(fb\.datum\), menge: Math\.trunc\(zahlOderNull\(fb\.menge_stk\) \?\? 0\), art: String\(fb\.art \?\? ''\)/)
  })
})

describe('KAN-452: Server Action, Formular, Beleg', () => {
  const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
  test('die Action reicht das Kennzeichen als Wahrheitswert durch und ordnet die Ablehnung den Positionen zu', () => {
    assert.match(a, /p_positionen: positionen\.map\(p => \(\{ position_id: p\.position_id, menge: String\(rund\(p\.menge, 4\)\), ruecknahme: p\.ruecknahme === true \}\)\),/)
    assert.match(a, /\|\| \(p\.ruecknahme !== undefined && typeof p\.ruecknahme !== 'boolean'\)\)\) \{/)
    assert.match(a, /if \(hint === 'gutschrift_menge' \|\| hint === 'ruecknahme'\) return \{ error: meldung, feld: 'positionen' \}/)
  })
  test('Formular: Haken nur an Positionen mit Rücknahme, gesperrt ohne Menge; Rückfrage nennt die Rückbuchung', () => {
    const c = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/GutschriftPanel.tsx')
    assert.match(c, /ruecknahme: zurueck\[String\(p\.id\)\] === true && ruecknahmeArt\(p\) !== null && ruecknahmeSperre\(p\) === null/)
    assert.match(c, /\{ruecknahmeMoeglich && <th className="py-2 font-semibold">Ware kommt zurück<\/th>\}/)
    assert.match(c, /<input type="checkbox" aria-label=\{`Ware kommt zurück: \$\{p\.name\}`\} disabled=\{ohneMenge \|\| r <= 0\}/)
    assert.match(c, /wieder in den Bestand gebucht\.` : ''\),/)
    assert.match(c, /\{mitRuecknahme\(g\) \? ' · Ware zurückgenommen' : ''\}/)
  })
  test('Seite: Angaben für die Rücknahme kommen vom Server; der Vermerk steht am Beleg (auch gedruckt)', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx')
    assert.match(s, /fuellung_id, sonstige_artikel_id, fuellung:fuellungen\(jahrgang, flaschengroesse_ml, pruefnummer, chargennummer, datum, aktiv, storniert_am\), artikel:sonstige_artikel\(aktiv, bestand_fuehren\)/)
    assert.match(s, /bestand_fuehren: \(p\.artikel as R \| null\)\?\.bestand_fuehren === true/)
    const vermerk = /\{gutschrift && p\.ruecknahme === true && <div className="([^"]*)">Ware zurückgenommen<\/div>\}/.exec(s)
    assert.ok(vermerk)
    assert.doesNotMatch(vermerk[1], /no-print/)
  })
  test('Handbuch und Projektregeln', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /Haken „Ware kommt zurück“/)
    assert.doesNotMatch(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /buche sie vorerst von Hand ein/)
    assert.match(quelle('CLAUDE.md'), /Gutschrift mit Rücknahme \(seit 14\.11\.2026, KAN-452\)/)
  })
})

describe('KAN-452: Migration', () => {
  test('Art und Verweis sind an beiden Bewegungstabellen gekoppelt; Prüf-Trigger und Index am Verweis', () => {
    assert.match(M, /ADD CONSTRAINT fuellung_bewegungen_gutschrift_check CHECK \(\(art = 'ruecknahme'\) = \(gutschrift_id IS NOT NULL\)\)/)
    assert.match(M, /ADD CONSTRAINT sonstige_artikel_bewegungen_gutschrift CHECK \(\(art = 'ruecknahme'\) = \(gutschrift_id IS NOT NULL\)\)/)
    for (const t of ['fuellung_bewegungen', 'sonstige_artikel_bewegungen']) {
      assert.match(M, new RegExp(`CREATE INDEX ${t}_gutschrift_idx ON public\\.${t} \\(gutschrift_id\\)`), t)
      assert.match(M, new RegExp(`CREATE TRIGGER z_fremdverweis_gutschrift_id BEFORE INSERT OR UPDATE OF gutschrift_id, tenant_id ON public\\.${t}\\n\\s+FOR EACH ROW EXECUTE FUNCTION public\\.s112_fremdverweis_pruefen\\('gutschrift_id', 'rechnungen', '', '', ''\\)`), t)
    }
  })
  test('Rücknahme ist immer ein Zugang und hat einen Verkaufsbezug', () => {
    assert.match(M, /CHECK \(art NOT IN \('verkauf_storno', 'ruecknahme'\) OR menge_stk > 0\)/)
    assert.match(M, /CHECK \(\(art IN \('verkauf', 'verkauf_storno', 'ruecknahme'\)\) = \(verkaufsposten_id IS NOT NULL\)\)/)
    assert.match(M, /\(art IN \('anfangsbestand', 'zugang', 'verarbeitung', 'ruecknahme'\) AND menge > 0\)/)
  })
  test('gebucht wird nach dem Beleg, in fester Reihenfolge, mit Verweis; der Bestand über die Freeze-Freigabe', () => {
    const beleg = M.indexOf('RETURNING id INTO v_id;')
    const buchung = M.indexOf("VALUES\n        (p_tenant_id, v_b.fuellung_id, p_datum, 'ruecknahme', v_stk, v_alt, v_alt + v_stk, 'Rücknahme zu Gutschrift ' || v_nummer,")
    assert.ok(beleg > 0 && buchung > beleg)
    assert.match(M, /ORDER BY p\.fuellung_id NULLS LAST, p\.sonstige_artikel_id, p\.id/)
    assert.match(M, /PERFORM set_config\('s112\.freeze_frei', 'fuellungen', true\);\n\s+UPDATE public\.fuellungen SET bestand_flaschen = v_alt \+ v_stk WHERE id = v_b\.fuellung_id AND tenant_id = p_tenant_id;\n\s+PERFORM set_config\('s112\.freeze_frei', '', true\);/)
  })
  test('Ablehnungen tragen den HINT für das Formular; Kellerbuch-Abschluss am Datumsfeld', () => {
    assert.equal([...M.matchAll(/HINT = 'ruecknahme'/g)].length, 5)
    assert.match(M, /RAISE EXCEPTION 'Rücknahme mit Datum % nicht möglich: Das Kellerbuch ist bis % abgeschlossen\. Bitte ein späteres Datum wählen oder die Gutschrift ohne Rücknahme ausstellen\.',\n\s+to_char\(p_datum, 'DD\.MM\.YYYY'\), to_char\(v_kb, 'DD\.MM\.YYYY'\) USING ERRCODE = '42501', HINT = 'periodensperre';/)
  })
  test('Journal: Buchungsart des Verkaufs mit positivem Vorzeichen; Rechte und Sicherheit der RPC unverändert', () => {
    assert.match(M, /'code', CASE WHEN coalesce\(v_partner ->> 'land', 'AT'\) <> 'AT' THEN 'VK_FL_AU' ELSE 'VK_FL_AT' END, 'bestand', 'flasche',\n\s+'fuellung_id', fb ->> 'fuellung_id', 'stk', v_stk,/)
    assert.match(M, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\);\n\s+PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);\n\s+PERFORM public\.s112_pruefe_schreibmodul\(p_tenant_id, 'warenwirtschaft'\);/)
    assert.doesNotMatch(M, /GRANT /)
  })
  test('Schema- und Fremdschlüssel-Dateien kennen den Verweis', () => {
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const t of ['fuellung_bewegungen', 'sonstige_artikel_bewegungen']) {
      assert.ok(schema[t].includes('gutschrift_id'), t)
      assert.match(quelle('scripts/fremdschluessel.json'), new RegExp(`\\{"n":"${t}_gutschrift_id_fkey","t":"${t}","s":\\["gutschrift_id"\\],"z":"rechnungen"\\}`), t)
    }
  })
})
