// KAN-419 G1 (13.11.2026): Gutschrift zur Rechnung – Regeln und Leser.
// Befund: Es gab nur den Vollstorno (KAN-379). Der Stornobeleg rechnet mit der Momentaufnahme seines Originals, eine
// Teilmenge konnte dieses Modell nicht abbilden; offene Posten kannten kein Guthaben.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GUTSCHRIFT_GRUND_MIN, gutschriftBrutto, gutschriftSumme, bereitsGutgeschrieben, restMenge, betragAufteilen,
  neueGutschriftBrutto, restBetrag, gutschriftEingabeFehler,
} from '../../src/lib/verkauf/gutschrift.ts'
import { alsBeleg, istGutschrift, zaehltMitBetrag, STORNO_FELDER } from '../../src/lib/verkauf/rechnungen.ts'

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

// Rechnung: 12 × 10 € zu 20 % und 6 × 11,30 € zu 13 % = 187,80 € (wie DB-Test 04)
const P1 = { id: 'p1', name: 'Kiste', menge: 12, preis_brutto: 10, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20 }
const P2 = { id: 'p2', name: 'Saft', menge: 6, preis_brutto: 11.3, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 13 }
const G1 = { art: 'gutschrift', aktiv: true, gutschrift_positionen: [{ position_id: 'p1', name: 'Kiste', menge: 2, preis_brutto: 10, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20, frei: false }] }
const RAHMEN = { rechnungDatum: '2026-11-10', heute: '2026-11-13', positionen: [P1, P2], gutschriften: [G1] }
const EINGABE = { datum: '2026-11-12', grund: 'Zwei Kisten beschädigt', positionen: [], betrag: 0 }

describe('KAN-419: Beträge und Restmengen', () => {
  test('Betrag einer Gutschrift = Summe der gerundeten Zeilen; inaktive zählen nicht', () => {
    assert.equal(gutschriftBrutto(G1), 20)
    assert.equal(gutschriftBrutto({ gutschrift_positionen: [{ menge: 3, preis_brutto: 1.005, rabatt_pct: 0 }] }), 3.02)   // 3,015 → 3,02 kaufmännisch
    assert.equal(gutschriftBrutto({}), 0)
    assert.equal(gutschriftSumme([G1, { ...G1, aktiv: false }, G1]), 40)
  })
  test('Restmenge je Position aus allen bisherigen Gutschriften; freie Zeilen zählen nicht mit', () => {
    const frei = { art: 'gutschrift', gutschrift_positionen: [{ position_id: null, menge: 1, preis_brutto: 5, frei: true }] }
    const bisher = bereitsGutgeschrieben([G1, G1, frei])
    assert.equal(bisher.get('p1'), 4)
    assert.equal(restMenge(P1, bisher), 8)
    assert.equal(restMenge(P2, bisher), 6)
    assert.equal(restMenge({ id: 'p1', menge: 3 }, bisher), 0)   // nie negativ
  })
  test('Restbetrag der Rechnung und Betrag der neuen Gutschrift', () => {
    assert.equal(restBetrag([P1, P2], []), 187.8)
    assert.equal(restBetrag([P1, P2], [G1]), 167.8)
    assert.equal(neueGutschriftBrutto({ positionen: [{ position_id: 'p2', menge: 2 }], betrag: 5 }, [P1, P2]), 27.6)
    // Rabatt der Position wirkt auch in der Gutschrift
    assert.equal(neueGutschriftBrutto({ positionen: [{ position_id: 'r', menge: 1 }], betrag: 0 }, [{ id: 'r', menge: 4, preis_brutto: 1.13, rabatt_pct: 50 }]), 0.57)
  })
})

describe('KAN-419: freier Betrag anteilig auf die Steuersätze', () => {
  test('wie die Datenbank: 18,78 € → 6,78 € (13 %) und 12,00 € (20 %)', () => {
    assert.deepEqual(betragAufteilen(18.78, [P1, P2]), [{ ustSatz: 13, anteil: 6.78 }, { ustSatz: 20, anteil: 12 }])
  })
  test('die Anteile ergeben immer genau den Betrag (Rundungsrest auf dem größten Anteil)', () => {
    const pos = [{ menge: 1, preis_brutto: 33.33, ust_satz: 10 }, { menge: 1, preis_brutto: 33.33, ust_satz: 13 }, { menge: 1, preis_brutto: 33.34, ust_satz: 20 }]
    for (const betrag of [0.01, 0.02, 1, 9.99, 10, 33.33, 100]) {
      const teile = betragAufteilen(betrag, pos)
      assert.equal(Math.round(teile.reduce((s, t) => s + t.anteil, 0) * 100), Math.round(betrag * 100), String(betrag))
      assert.ok(teile.every(t => t.anteil > 0))
    }
  })
  test('ein Steuersatz: alles dort; ohne Satz gilt 13 %; kein Betrag bzw. Rechnung ohne Wert: nichts', () => {
    assert.deepEqual(betragAufteilen(7.5, [P1]), [{ ustSatz: 20, anteil: 7.5 }])
    assert.deepEqual(betragAufteilen(3, [{ menge: 1, preis_brutto: 9, ust_satz: null }]), [{ ustSatz: 13, anteil: 3 }])
    assert.deepEqual(betragAufteilen(0, [P1]), [])
    assert.deepEqual(betragAufteilen(5, [{ menge: 1, preis_brutto: 0, ust_satz: 20 }]), [])
  })
})

describe('KAN-419: Eingabeprüfung (wie die Datenbank)', () => {
  const fehler = e => gutschriftEingabeFehler({ ...EINGABE, ...e }, RAHMEN)
  test('in Ordnung: Position bis zur Restmenge, freier Betrag bis zum Restbetrag', () => {
    assert.equal(fehler({ positionen: [{ position_id: 'p1', menge: 10 }] }), null)
    assert.equal(fehler({ betrag: 167.8 }), null)
    assert.equal(fehler({ positionen: [{ position_id: 'p2', menge: 1 }], betrag: 5 }), null)
  })
  test('Datum: Pflicht, nicht vor der Rechnung, nicht in der Zukunft – Meldung am Datumsfeld', () => {
    assert.deepEqual(fehler({ datum: '', betrag: 5 })?.feld, 'datum')
    assert.match(fehler({ datum: '2026-11-09', betrag: 5 }).text, /Datum der Gutschrift \(09\.11\.2026\) liegt vor dem Rechnungsdatum \(10\.11\.2026\)/)
    assert.match(fehler({ datum: '2026-11-14', betrag: 5 }).text, /liegt in der Zukunft/)
  })
  test('Grund mindestens 10 Zeichen', () => {
    assert.equal(GUTSCHRIFT_GRUND_MIN, 10)
    assert.equal(fehler({ grund: 'zu kurz', betrag: 5 }).feld, 'grund')
    assert.equal(fehler({ grund: '   ', betrag: 5 }).feld, 'grund')
  })
  test('nichts gewählt, fremde, doppelte Position, Menge 0, über der Restmenge', () => {
    assert.match(fehler({}).text, /mindestens eine Position oder einen Betrag/)
    assert.match(fehler({ positionen: [{ position_id: 'x', menge: 1 }] }).text, /gehört nicht zu dieser Rechnung/)
    assert.match(fehler({ positionen: [{ position_id: 'p2', menge: 1 }, { position_id: 'p2', menge: 1 }] }).text, /doppelt/)
    assert.match(fehler({ positionen: [{ position_id: 'p2', menge: 0 }] }).text, /größer als 0/)
    assert.match(fehler({ positionen: [{ position_id: 'p1', menge: 11 }] }).text, /„Kiste“: höchstens 10 gutschreibbar/)
  })
  test('über dem Restbetrag – am Betragsfeld, wenn ein Betrag im Spiel ist', () => {
    const f = fehler({ betrag: 167.81 })
    assert.equal(f.feld, 'betrag')
    assert.match(f.text, /\(167,81 €\) übersteigt den noch gutschreibbaren Betrag \(167,80 €\)/)
    assert.equal(fehler({ betrag: -1 }).feld, 'betrag')
  })
})

describe('KAN-419: Leser', () => {
  test('alsBeleg: Zeilen der Gutschrift mit negativer Menge, ohne Lieferscheine; zählt mit Betrag', () => {
    const b = alsBeleg(G1)
    assert.equal(istGutschrift(G1), true)
    assert.equal(zaehltMitBetrag(G1), true)
    assert.equal(zaehltMitBetrag({ ...G1, aktiv: false }), false)
    assert.deepEqual(b.verkauf_positionen.map(p => p.menge), [-2])
    assert.deepEqual(b.lieferscheine, [])
    assert.deepEqual(b.verkaufsposten_ids, [])
    assert.equal(G1.gutschrift_positionen[0].menge, 2, 'die Momentaufnahme bleibt unverändert')
  })
  test('Umsatz: Gutschrift negativ; offene Posten: Gutschrift mindert, Guthaben bei Überzahlung', async () => {
    const u = quelle('src/lib/verkauf/umsatz.ts')
    assert.match(u, /if \(r\.art === 'storno' \|\| r\.art === 'gutschrift' \|\| r\.storniert === true\) return true/)
    assert.match(u, /offen: r\.bezahlt \? 0 : Math\.max\(0, rund2\(brutto - gezahlt - gutgeschrieben\)\),\n\s+guthaben: Math\.max\(0, rund2\(gezahlt \+ gutgeschrieben - brutto\)\),/)
    assert.match(u, /\.filter\(r => r\.art !== 'gutschrift'\)   \/\/ KAN-419/)
    assert.match(u, /belege\.filter\(r => !r\.bezahlt \|\| gutgeschrieben\.has\(String\(r\.id\)\)\)/)
    assert.match(STORNO_FELDER, /gutschrift_zu_id, gutschrift_positionen, gutschrift_zu:gutschrift_zu_id\(id, rechnungsnummer, datum\)/)
  })
  test('Schema- und Fremdschlüssel-Dateien kennen die neuen Spalten', () => {
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const s of ['gutschrift_zu_id', 'gutschrift_positionen']) assert.ok(schema.rechnungen.includes(s), s)
    for (const s of ['gutschrift_prefix', 'gutschrift_stellen', 'gutschrift_zaehler']) assert.ok(schema.tenant_einstellungen.includes(s), s)
    assert.match(quelle('scripts/fremdschluessel.json'), /\{"n":"rechnungen_gutschrift_zu_id_fkey","t":"rechnungen","s":\["gutschrift_zu_id"\],"z":"rechnungen"\}/)
  })
})

describe('KAN-419: Migration und DB-Test', () => {
  const m = migration('kan419a_gutschrift')
  test('Belegart, Verweis und Momentaufnahme sind gekoppelt; Prüf-Trigger und Index am Verweis', () => {
    assert.match(m, /ADD CONSTRAINT rechnungen_art CHECK \(art IN \('rechnung', 'storno', 'gutschrift'\)\),/)
    assert.match(m, /ADD CONSTRAINT rechnungen_gutschrift_verweis CHECK \(\(art = 'gutschrift'\) = \(gutschrift_zu_id IS NOT NULL\)\),/)
    assert.match(m, /CREATE INDEX rechnungen_gutschrift_zu_idx ON public\.rechnungen \(gutschrift_zu_id\);/)
    assert.match(m, /CREATE TRIGGER z_fremdverweis_gutschrift_zu_id BEFORE INSERT OR UPDATE OF gutschrift_zu_id, tenant_id ON public\.rechnungen/)
  })
  test('RPC: Zugriff, Abo, Schreibmodul zuerst; Preise aus der Rechnung; nur für angemeldete Benutzer', () => {
    assert.match(m, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\);\n\s+PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);\n\s+PERFORM public\.s112_pruefe_schreibmodul\(p_tenant_id, 'warenwirtschaft'\);/)
    assert.match(m, /WHERE p\.id = \(v_e ->> 'position_id'\)::uuid AND v\.rechnung_id = v_r\.id AND v\.tenant_id = p_tenant_id;/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_gutschrift_anlegen\([^)]*\) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public\.s112_gutschrift_anlegen\([^)]*\) TO authenticated;/)
    for (const intern of ['s112_gutschriftnummer_ziehen(uuid, date)', 's112_gutschrift_summe(uuid, uuid)']) {
      assert.ok(m.includes(`REVOKE EXECUTE ON FUNCTION public.${intern} FROM PUBLIC, anon, authenticated;`), intern)
    }
    assert.equal(m.split('SET search_path = public').length - 1, 3, 'jede neue Funktion mit search_path')
  })
  test('Abgleich „bezahlt“ und Storno-Sperre über genau eine Ankerstelle', () => {
    assert.equal(m.split('Ankerstelle nicht genau einmal gefunden').length - 1, 2)
    assert.match(m, /v_gezahlt := v_gezahlt \+ public\.s112_gutschrift_summe\(v_tenant, v_re\);/)
    assert.match(m, /Zur Rechnung % gibt es eine Gutschrift – sie lässt sich nicht mehr stornieren\./)
  })
  test('DB-Test 04 mit Mutationen; Soll-Listen in 01, 14, 18 und _helfer', () => {
    const t = quelle('scripts/db-tests/04_gutschrift.sql')
    assert.equal(t.split('@mutation ').length - 1, 5)
    assert.match(t, /PERFORM pg_temp\.s112_ende\(c_datei, v_erg, v_t0, 27\);/)
    assert.match(quelle('scripts/db-tests/_helfer.sql'), /\('mandant',\s+'-US', true , 's112_gutschrift_anlegen\(p_tenant_id uuid, p_rechnung_id uuid, p_datum date, p_grund text, p_positionen jsonb, p_betrag numeric, p_betrag_text text\)'\)/)
    assert.match(quelle('scripts/db-tests/14_abo_schreibsperre.sql'), /'s112_gutschrift_anlegen', format\('SELECT public\.s112_gutschrift_anlegen\(/)
  })
})
