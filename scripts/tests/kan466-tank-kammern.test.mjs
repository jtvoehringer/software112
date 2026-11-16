// KAN-466 (16.11.2026): Tank mit Kammern – Stufe 1 (Stammdaten und Anzeige).
// Geprüft wird: Eingaberegeln (wie die RPC s112_tank_anlegen), Namensvorschlag und Zusatz in Auswahllisten, Gruppierung
// nach Tank (oberste Kammer zuerst), Ladefunktion (Auswahlname nur für Listen – Aufzeichnungen behalten den Namen),
// Gebindeverzeichnis (Kammern einzeln, Spalten Tank und Kammer), Server Actions, Migration und Register.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KAMMERN_MAX, KAMMERN_MIN, TANK_TYPEN, kammerVorschlag, nachTank, tankDbFehler, tankEingabeFehler, tankTypLabel, tankZusatz,
} from '../../src/lib/keller/tanks.ts'
import { zuBehaelterZeile } from '../../src/lib/keller/behaelter.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const kammern = (...vol) => vol.map((v, i) => ({ name: `A10/${i + 1}`, volumen_liter: v }))
const zeile = (o = {}) => ({ id: 'g', tenant_id: 't', name: 'A10/1', typ: 'stahltank', volumen_liter: '3000', aktiv: true, eigentuemer_name: 'Weingut X', ...o })

describe('KAN-466: Eingaberegeln', () => {
  test('gültig: 2 bis 12 Kammern mit eigenem Namen und Volumen', () => {
    assert.equal(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: kammern(3000, 2000, 2000) }), null)
    assert.equal(tankEingabeFehler({ name: 'A10', typ: 'holzfass', kammern: kammern(1, 0.5) }), null)
    assert.equal(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: kammern(...Array(KAMMERN_MAX).fill(100)) }), null)
    assert.deepEqual([KAMMERN_MIN, KAMMERN_MAX], [2, 12])
  })
  test('Name und Typ des Tanks', () => {
    assert.match(tankEingabeFehler({ name: '  ', typ: 'stahltank', kammern: kammern(1, 1) }), /Namen für den geteilten Tank/)
    assert.match(tankEingabeFehler({ name: 'x'.repeat(51), typ: 'stahltank', kammern: kammern(1, 1) }), /höchstens 50 Zeichen/)
    assert.match(tankEingabeFehler({ name: 'A10', typ: 'barrique', kammern: kammern(1, 1) }), /Typ des geteilten Tanks/)
    assert.match(tankEingabeFehler({ name: 'A10', typ: 'presse', kammern: kammern(1, 1) }), /Typ des geteilten Tanks/)
    assert.match(tankEingabeFehler({ name: 'A10', typ: '', kammern: kammern(1, 1) }), /Typ des geteilten Tanks/)
  })
  test('Anzahl, Namen und Volumen der Kammern', () => {
    assert.match(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: kammern(1) }), /2 bis 12 Kammern/)
    assert.match(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: kammern(...Array(13).fill(1)) }), /2 bis 12 Kammern/)
    assert.match(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: [{ name: '', volumen_liter: 1 }, { name: 'b', volumen_liter: 1 }] }), /Kammer 1: bitte einen Namen/)
    assert.match(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: [{ name: 'Oben', volumen_liter: 1 }, { name: ' oben ', volumen_liter: 1 }] }), /Kammer 2: der Name „oben“ kommt doppelt vor/)
    assert.match(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: [{ name: 'a10', volumen_liter: 1 }, { name: 'b', volumen_liter: 1 }] }), /nicht wie der geteilte Tank/)
    for (const v of [null, 0, -5, NaN, Infinity]) {
      assert.match(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: [{ name: 'a', volumen_liter: 1 }, { name: 'b', volumen_liter: v }] }), /Kammer 2: bitte das Fassungsvermögen/, String(v))
    }
    assert.match(tankEingabeFehler({ name: 'A10', typ: 'stahltank', kammern: kammern(1, 10_000_000) }), /zu groß/)
  })
  test('Typen wie der CHECK der Tabelle – ohne Presse und Barriques', () => {
    assert.deepEqual(TANK_TYPEN.map(t => t.wert), ['stahltank', 'lagertank', 'immervolltank', 'holzfass', 'betonei', 'amphore', 'bottich', 'gaerstaender', 'zisterne', 'sonstiges'])
    assert.equal(tankTypLabel('immervolltank'), 'Immervoll-Tank')
    assert.equal(tankTypLabel(null), '–')
  })
})

describe('KAN-466: Namen und Anzeige', () => {
  test('Vorschlag „<Tank>/<Nr>“; ohne Tank-Namen leer', () => {
    assert.equal(kammerVorschlag(' A10 ', 1), 'A10/1')
    assert.equal(kammerVorschlag('Stahltank 15', 3), 'Stahltank 15/3')
    assert.equal(kammerVorschlag('  ', 2), '')
  })
  test('Zusatz in Auswahllisten: Tank-Name nur, wenn er nicht schon im Namen der Kammer steht', () => {
    assert.equal(tankZusatz({ name: 'A10/1', tank_id: 'x', tank_name: 'A10', kammer_nr: 1, tank_kammern: 3 }), 'Kammer 1 von 3')
    assert.equal(tankZusatz({ name: 'a10 unten', tank_id: 'x', tank_name: 'A10', kammer_nr: 1, tank_kammern: 3 }), 'Kammer 1 von 3')
    assert.equal(tankZusatz({ name: 'Unten', tank_id: 'x', tank_name: 'A10', kammer_nr: 1, tank_kammern: 3 }), 'Geteilter Tank A10, Kammer 1 von 3')   // KAN-468: Bezeichnung „Geteilter Tank“
    assert.equal(tankZusatz({ name: 'A10/3', tank_id: 'x', tank_name: 'A10', kammer_nr: 3, tank_kammern: 2 }), 'Kammer 3', 'nach dem Löschen einer mittleren Kammer ohne „von“')
    assert.equal(tankZusatz({ name: 'A10/1', tank_id: 'x', tank_name: 'A10', kammer_nr: 1, tank_kammern: null }), 'Kammer 1')
    assert.equal(tankZusatz({ name: 'T5', tank_id: null, kammer_nr: null }), null)
    assert.equal(tankZusatz({ name: 'T5' }), null)
  })
  test('Gruppierung: eigenständige Gebinde bleiben, Kammern von oben nach unten, Tanks nach Name (a2 vor a10)', () => {
    const z = [
      { name: 'T1', volumen_liter: 500 },
      { name: 'A10/1', tank_id: 'a10', tank_name: 'A10', kammer_nr: 1, tank_kammern: 3, volumen_liter: 3000 },
      { name: 'A2/2', tank_id: 'a2', tank_name: 'A2', kammer_nr: 2, tank_kammern: 2, volumen_liter: 1000 },
      { name: 'A10/3', tank_id: 'a10', tank_name: 'A10', kammer_nr: 3, tank_kammern: 3, volumen_liter: 2000 },
      { name: 'A10/2', tank_id: 'a10', tank_name: 'A10', kammer_nr: 2, tank_kammern: 3, volumen_liter: 2000 },
    ]
    const g = nachTank(z)
    assert.deepEqual(g.einzeln.map(x => x.name), ['T1'])
    assert.deepEqual(g.tanks.map(t => t.name), ['A2', 'A10'])
    assert.deepEqual(g.tanks[1].kammern.map(k => k.name), ['A10/3', 'A10/2', 'A10/1'])
    assert.deepEqual([g.tanks[1].volumen, g.tanks[1].anzahl], [7000, 3])
    // Kellergemeinschaft: der Partner sieht nur die freigegebene Kammer – der Tank hat trotzdem zwei
    assert.deepEqual([g.tanks[0].kammern.length, g.tanks[0].anzahl, g.tanks[0].volumen], [1, 2, 1000])
    assert.deepEqual(nachTank([]), { einzeln: [], tanks: [] })
  })
  test('Meldungen der Datenbank: HINT tank_… wird durchgereicht, doppelte Namen übersetzt', () => {
    assert.equal(tankDbFehler({ code: '22023', message: 'Ein Tank mit Kammern braucht 2 bis 12 Kammern.', hint: 'tank_kammern' }), 'Ein Tank mit Kammern braucht 2 bis 12 Kammern.')
    assert.match(tankDbFehler({ code: '23505', message: 'duplicate key value violates unique constraint "gebinde_tanks_name_je_betrieb"' }), /geteilten Tank mit diesem Namen/)
    assert.match(tankDbFehler({ code: '23505', message: 'duplicate key value violates unique constraint "behaelter_name_je_betrieb"' }), /Gebinde mit einem dieser Namen/)
    assert.equal(tankDbFehler({ code: '42501', message: 'permission denied' }), null)
    assert.equal(tankDbFehler(null), null)
  })
})

describe('KAN-468: Sammelmaßnahme für einen geteilten Tank', () => {
  test('Stand der Auswahl: alle, teilweise, keine', async () => {
    const { auswahlStand, tankSammelPfad } = await import('../../src/lib/keller/tanks.ts')
    assert.equal(auswahlStand(['a', 'b', 'c'], new Set(['a', 'b', 'c', 'x'])), 'alle')
    assert.equal(auswahlStand(['a', 'b', 'c'], new Set(['b'])), 'teil')
    assert.equal(auswahlStand(['a', 'b', 'c'], new Set(['x'])), 'keine')
    assert.equal(auswahlStand([], new Set(['x'])), 'keine')
    assert.equal(tankSammelPfad('25286978-c78a-4ac5-acf9-1359de58046c'), '/kellerbuch/sammelbehandlung?tank=25286978-c78a-4ac5-acf9-1359de58046c')
  })
  test('Seite: Vorauswahl nur mit gültiger Tank-ID, Kammern beisammen (oberste zuerst), Tank über die Gebindeliste', () => {
    const p = quelle('src/app/(dashboard)/kellerbuch/sammelbehandlung/page.tsx')
    assert.ok(p.includes("typeof sp.tank === 'string' && /^[0-9a-f-]{36}$/i.test(sp.tank) ? sp.tank : null"))
    assert.ok(p.includes('const vorauswahl = tankWahl ? chargen.filter(c => c.tankId === tankWahl).map(c => c.id) : []'))
    assert.ok(p.includes('|| (b.kammerNr ?? 0) - (a.kammerNr ?? 0)'))
    assert.ok(p.includes('ladeBehaelter(supabase, tenantId),'))
    assert.ok(!p.includes("from('gebinde_tanks')"), 'keine eigene Abfrage auf die Tank-Tabelle')
  })
  test('Liste: Tank-Zeile mit „ganzer Tank“ (teilweise = Strich), wirkt auf alle belegten Kammern auch bei Filter; Suche nach dem Tank', () => {
    const c = quelle('src/app/(dashboard)/kellerbuch/sammelbehandlung/SammelClient.tsx')
    assert.ok(c.includes("ref.current.indeterminate = stand === 'teil'"))
    assert.ok(c.includes('for (const c of chargen) if (c.tankId) m.set(c.tankId, [...(m.get(c.tankId) ?? []), c.id])'), 'aus allen Chargen, nicht nur den sichtbaren')
    assert.ok(c.includes('const tankKopf = c.tankId && sichtbar[i - 1]?.tankId !== c.tankId ? ('))
    assert.ok(c.includes('useState<Set<string>>(() => new Set(vorauswahl))'))
    assert.ok(c.includes('geteilter tank ${c.tankName}'))
    assert.ok(c.includes("fd.set('chargen_json', JSON.stringify(auswahl.map(c => c.id)))"), 'gebucht wird unverändert über die Sammelmaßnahme')
  })
  test('Sichtprüfung 16.11.2026: Ziel des Knopfs – ab zwei belegten Kammern die Sammelmaßnahme, bei einer die Kellerbehandlung der Kammer, sonst keines', async () => {
    const { tankBehandlungZiel } = await import('../../src/lib/keller/tanks.ts')
    // die Sammelmaßnahme lehnt weniger als zwei Gebinde ab – der Knopf darf nicht in ein Formular führen, das sich nicht speichern lässt
    assert.deepEqual(tankBehandlungZiel('t1', ['k1', 'k2']), { href: '/kellerbuch/sammelbehandlung?tank=t1', text: 'Behandlung für alle Kammern', sammel: true })
    assert.deepEqual(tankBehandlungZiel('t1', ['k1']), { href: '/kellerbuch/behaelter/k1/behandlungen', text: 'Behandlung für die belegte Kammer', sammel: false })
    assert.equal(tankBehandlungZiel('t1', []), null)
    assert.match(quelle('src/lib/kellerbuch/sammelbehandlung.ts'), /if \(p\.chargen\.length < 2\) return 'Bitte mindestens zwei Gebinde wählen/)
  })
  test('Einstiege nur mit Schreibrecht; ohne belegte Kammer ausgegraut', () => {
    const k = quelle('src/app/(dashboard)/kellerbuch/page.tsx')
    assert.ok(k.includes('{eigen && writeOk && (() => {'))
    assert.ok(k.includes('const ziel = tankBehandlungZiel(t.id, t.kammern.filter(k => (chargenByBehaelter.get(k.id)?.length ?? 0) > 0).map(k => k.id))'))
    const t = quelle('src/app/(dashboard)/kellerbuch/behaelter/tank/[id]/page.tsx')
    assert.ok(t.includes('const behandlungZiel = tankBehandlungZiel(id, kammern.filter(k => k.eigen_liter > 0.005).map(k => k.id))'))
    assert.ok(t.includes('{darf && (behandlungZiel'))
    const e = quelle('src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx')
    assert.ok(e.includes('{dialogTank && writeOk && (dialogTankBelegt ? ('))
    assert.ok(e.includes('const dialogTankBelegt = dialogTankBelegte >= 2'))
    assert.ok(e.includes('href={tankSammelPfad(dialogTank.id)}'))
  })
  test('Bezeichnung „Geteilter Tank“ in Überschriften, Knöpfen und Listen', () => {
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/page.tsx').includes('>Geteilter Tank {t.name}</span>'))
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/gebinde/page.tsx').includes('>Geteilten Tank anlegen</Link>'))
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/behaelter/tank/neu/page.tsx').includes('Neuer geteilter Tank</h1>'))
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/behaelter/tank/[id]/page.tsx').includes('>Geteilter Tank {tank.name}</h1>'))
    assert.ok(quelle('src/components/kellerbuch/TankForm.tsx').includes("'Geteilten Tank anlegen'"))
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx').includes('<p className="truncate">Geteilter Tank {t.name}</p>'))
    assert.ok(quelle('src/lib/behoerden/gebindeverzeichnis.ts').includes("{ kopf: 'Geteilter Tank', typ: 'text', wert: z => z.tank },"))
  })
})

describe('Abnahme 16.11.2026: Kellerbehandlung von der Charge aus', () => {
  test('Chargen-Seite: Knopf „Kellerbehandlung“ führt zu den Behandlungen des Gebindes und zurück zur Charge; ohne Gebinde ausgegraut', () => {
    const p = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
    assert.ok(p.includes('href={mitZurueck(`/kellerbuch/behaelter/${weinausbau.behaelter_id}/behandlungen`, `/kellerbuch/weinausbau/${weinausbau.id}`)}'))
    assert.ok(p.includes('<FlaskConical size={13} strokeWidth={1.75} />Kellerbehandlung'))
    assert.ok(p.includes('{weinausbau.behaelter_id ? ('))
    assert.ok(p.includes('Die Charge liegt in keinem Gebinde – Kellerbehandlungen werden am Gebinde erfasst'))
    assert.ok(existsSync(path.join(WURZEL, 'src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx')), 'Zielseite vorhanden')
  })
})

describe('KAN-466: Ladefunktion', () => {
  test('Kammer: Tank-Felder, Auswahlname mit Zusatz – name und anzeigeName bleiben für Aufzeichnungen unverändert', () => {
    const b = zuBehaelterZeile(zeile({ tank_id: 'tk', kammer_nr: 1, tank_name: 'A10', tank_kammern: 3 }))
    assert.deepEqual([b.tank_id, b.kammer_nr, b.tank_name, b.tank_kammern], ['tk', 1, 'A10', 3])
    assert.equal(b.name, 'A10/1')
    assert.equal(b.anzeigeName, 'A10/1')
    assert.equal(b.auswahlName, 'A10/1 · Kammer 1 von 3')
  })
  test('Kammer eines Partnerbetriebs: Betrieb am Ende', () => {
    const b = zuBehaelterZeile(zeile({ fremd: true, tank_id: 'tk', kammer_nr: 2, tank_name: 'A10', tank_kammern: 3, name: 'A10/2' }))
    assert.equal(b.anzeigeName, 'A10/2 · Weingut X')
    assert.equal(b.auswahlName, 'A10/2 · Kammer 2 von 3 · Weingut X')
  })
  test('eigenständiges Gebinde und Datenbank vor der Migration (Spalten fehlen): wie bisher', () => {
    const b = zuBehaelterZeile(zeile({ name: 'T5' }))
    assert.deepEqual([b.tank_id, b.kammer_nr, b.tank_name, b.tank_kammern], [null, null, null, null])
    assert.equal(b.auswahlName, 'T5')
    assert.equal(zuBehaelterZeile(zeile({ name: 'T5', fremd: true })).auswahlName, 'T5 · Weingut X')
  })
})

describe('KAN-466: Seiten, Aktionen und Meldung', () => {
  test('Auswahllisten verwenden den Auswahlnamen; Meldungen und Bewegungsbuch nicht', () => {
    for (const p of ['src/app/(dashboard)/kellerbuch/umziehen/page.tsx', 'src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx',
      'src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts', 'src/app/(dashboard)/kellerbuch/produktion/neu/page.tsx',
      'src/app/(dashboard)/kellerbuch/umzug/[id]/edit/page.tsx', 'src/app/api/zukauf-stammdaten/route.ts']) {
      assert.match(quelle(p), /b\.auswahlName/, p)
    }
    for (const p of ['src/lib/behoerden/bewegungsbuch.ts', 'src/lib/behoerden/bestandsmeldung.ts', 'src/lib/behoerden/lagerstand.ts',
      'src/lib/behoerden/keller-auswertungen.ts', 'src/lib/behoerden/keller-behandlungen.ts', 'src/lib/behoerden/bki-stammdaten.ts']) {
      assert.ok(!/auswahlName/.test(quelle(p)), `${p}: Aufzeichnungen ohne Auswahl-Zusatz`)
    }
  })
  test('Gebindeverzeichnis: Spalten Tank und Kammer nach dem Gebinde, je Kammer eine Zeile mit eigenem Nennvolumen', () => {
    const v = quelle('src/lib/behoerden/gebindeverzeichnis.ts')
    assert.match(v, /\{ kopf: 'Gebinde', typ: 'text', wert: z => z\.gebinde \},\n[^\n]*\n\s+\{ kopf: 'Geteilter Tank', typ: 'text', wert: z => z\.tank \},\n\s+\{ kopf: 'Kammer', typ: 'ganzzahl', wert: z => z\.kammer \},\n\s+\{ kopf: 'Typ'/)
    assert.match(v, /tank: g\.tank_id \? text\(g\.tank_name\) : null,\n\s+kammer: g\.tank_id \? g\.kammer_nr : null,/)
    assert.ok(!/gebinde_tanks/.test(v), 'der Tank selbst ist keine Zeile')
    assert.ok(!/tank/i.test(quelle('src/lib/behoerden/bki-stammdaten.ts')), 'BKI-EDV-Liste unverändert')
  })
  test('Aktionen: Schreibrecht-Helfer zuerst, Regeln vor der RPC, Update mit Betriebsfilter und Zeilenprüfung', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const anlegen = a.slice(a.indexOf('export async function createTank'), a.indexOf('export async function updateTank'))
    const i = s => { const n = anlegen.indexOf(s); assert.ok(n >= 0, s); return n }
    assert.ok(i('await kellerbuchSchreibrecht()') < i('tankEingabeFehler({ name, typ, kammern })'))
    assert.ok(i('tankEingabeFehler({ name, typ, kammern })') < i("'s112_tank_anlegen'"))
    assert.match(anlegen, /p_tenant_id: tenantId/)
    assert.match(anlegen, /tankDbFehler\(error\) \?\? dbFehlerText\(error/)
    const aendern = a.slice(a.indexOf('export async function updateTank'))
    assert.match(aendern, /await kellerbuchSchreibrecht\(\)/)
    assert.match(aendern, /\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.select\('id'\)/)
    assert.match(aendern, /throw new AktionsFehler\(NICHT_GESPEICHERT\)/)
    assert.match(aendern, /if \(gleichErr\) throw new AktionsFehler/)
    const loeschen = a.slice(a.indexOf('export async function deleteBehaelter'), a.indexOf('// TANK MIT KAMMERN'))
    assert.match(loeschen, /\.select\('id, tank_id'\)/)
    assert.match(loeschen, /from\('gebinde_tanks'\) as any\)\.delete\(\)\.eq\('id', tankId\)\.eq\('tenant_id', tenantId\)/)
  })
  test('Formulare: Typ und Standort einer Kammer gesperrt; Tank-Formular meldet Fehler im Formular und entsperrt den Knopf', () => {
    const f = quelle('src/components/kellerbuch/BehaelterForm.tsx')
    assert.match(f, /name="typ"[^>]*disabled=\{!!kammer\}/)
    assert.match(f, /name="standort"[^>]*disabled=\{!!kammer\}/)
    const d = quelle('src/components/kellerbuch/GebindeClient.tsx')
    assert.equal((d.match(/disabled=\{!!gebinde\.tank_id\}/g) ?? []).length, 3, 'Typ, Standort, Material')
    const t = quelle('src/components/kellerbuch/TankForm.tsx')
    assert.match(t, /role="alert"/)
    assert.match(t, /finally \{\s*setSaving\(false\)/)
    assert.match(t, /const reihenfolge = kammern\.map\(\(_, i\) => i\)\.reverse\(\)/, 'oberste Kammer oben')
  })
  test('Übersicht: Kammern stehen im Block des Tanks, nicht zusätzlich in den Listen', () => {
    const k = quelle('src/app/(dashboard)/kellerbuch/page.tsx')
    assert.match(k, /tanks: nachTank\(liste\)\.tanks,/)
    assert.match(k, /belegt: liste\.filter\(b => !b\.tank_id && istBelegt\(b\)\)/)
    assert.match(k, /leer: liste\.filter\(b => !b\.tank_id && !istBelegt\(b\)\)/)
    assert.match(k, /t\.kammern\.map\(k => zeile\(k, true\)\)/)
  })
})

describe('KAN-466: Migration und Register', () => {
  const ordner = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(ordner).find(n => /_kan466_tank_kammern\.sql$/.test(n))
  const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan466_tank_kammern.sql')
  test('Tabelle: alle Policies TO authenticated, anon ohne Rechte, Name je Betrieb eindeutig', () => {
    assert.ok(existsSync(pfad), 'Migration kan466_tank_kammern fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.gebinde_tanks([^;]*);/g)]
    assert.ok(policies.every(p => / TO authenticated\b/.test(p[2])), 'jede Policy TO authenticated')
    assert.deepEqual(policies.map(p => p[1]).sort(), ['abo_schreibsperre_del', 'abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'gebinde_tanks_delete',
      'gebinde_tanks_insert', 'gebinde_tanks_select', 'gebinde_tanks_update', 'lesebereich', 'mitgliedschaft_aktiv', 'modul_delete', 'modul_insert',
      'modul_update', 'zwei_faktor_aal'])
    assert.match(sql, /REVOKE ALL ON public\.gebinde_tanks FROM anon;/)
    assert.match(sql, /CREATE UNIQUE INDEX gebinde_tanks_name_je_betrieb ON public\.gebinde_tanks \(tenant_id, lower\(btrim\(name\)\)\)/)
    assert.match(sql, /s112_lesegesperrte_tenants\('keller'\)/)
    assert.equal((sql.match(/s112_darf_schreiben\(tenant_id, 'kellerbuch'\)/g) ?? []).length, 4)
  })
  test('Kammer: Spalten, Fremdverweis-Trigger, Index; Trigger- und Anlege-Funktion nach den Regeln für DB-Funktionen', () => {
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN tank_id\s+uuid REFERENCES public\.gebinde_tanks\(id\),/)
    assert.match(sql, /CHECK \(\(tank_id IS NULL\) = \(kammer_nr IS NULL\)\)/)
    assert.match(sql, /CREATE UNIQUE INDEX behaelter_tank_kammer ON public\.behaelter \(tank_id, kammer_nr\);/)
    assert.match(sql, /CREATE TRIGGER z_fremdverweis_tank_id BEFORE INSERT OR UPDATE OF tank_id, tenant_id ON public\.behaelter\n\s+FOR EACH ROW EXECUTE FUNCTION public\.s112_fremdverweis_pruefen\('tank_id', 'gebinde_tanks', '', '', ''\);/)
    for (const fn of ['s112_kammer_vom_tank()', 's112_tank_an_kammern()']) {
      assert.ok(sql.includes(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`), fn)
    }
    assert.equal((sql.match(/SECURITY DEFINER SET search_path = public/g) ?? []).length, 3)
    const rpc = sql.slice(sql.indexOf('CREATE FUNCTION public.s112_tank_anlegen'), sql.indexOf('-- ── 4.'))
    const i = s => { const n = rpc.indexOf(s); assert.ok(n >= 0, s); return n }
    assert.ok(i('PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY[') < i('PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);'))
    assert.ok(i('PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);') < i("public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')"))
    assert.ok(i("set_config('s112.tank_frei', '1', true)") < i('INSERT INTO public.behaelter') && i('INSERT INTO public.behaelter') < i("set_config('s112.tank_frei', '', true)"))
    assert.match(rpc, /REVOKE EXECUTE ON FUNCTION public\.s112_tank_anlegen\(uuid, text, text, text, text, text, jsonb\) FROM PUBLIC, anon;/)
  })
  test('lade_behaelter: neue Spalten am Ende, Leseprüfung unverändert, nicht für anon; Musterhof-Reset räumt Tanks ab', () => {
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /bezeichnung_lang text, tank_id uuid, kammer_nr smallint, tank_name text, tank_kammern integer\)/)
    assert.match(sql, /public\.s112_aal_ok\(\) AND NOT public\.s112_betrieb_gesperrt\(p_tenant_id\) \/\* KAN-455 \*\/ AND public\.s112_darf_lesen\(p_tenant_id, 'keller'\)/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.lade_behaelter\(uuid\) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public\.lade_behaelter\(uuid\) TO authenticated, service_role;/)
    assert.match(sql, /delete from gebinde_tanks where tenant_id = c_t;/)
  })
  test('Register: Lesebereich, Schema, Fremdschlüssel, DB-Test-Sollwerte, Pilot-Abräumen', () => {
    assert.equal(JSON.parse(quelle('scripts/lesebereiche.json')).tabellen.gebinde_tanks, 'keller')
    const schema = JSON.parse(quelle('scripts/schema.json'))
    assert.deepEqual(schema.gebinde_tanks, ['id', 'tenant_id', 'name', 'typ', 'material', 'standort', 'notizen', 'created_at', 'updated_at'])
    assert.deepEqual(schema.behaelter.slice(-2), ['tank_id', 'kammer_nr'])
    const fk = JSON.parse(quelle('scripts/fremdschluessel.json'))
    assert.deepEqual(fk.filter(x => x.t === 'gebinde_tanks').map(x => `${x.s.join(',')}→${x.z}`), ['tenant_id→tenants'])
    assert.ok(fk.some(x => x.t === 'behaelter' && x.s.join(',') === 'tank_id' && x.z === 'gebinde_tanks'))
    const helfer = quelle('scripts/db-tests/_helfer.sql')
    assert.match(helfer, /\('gebinde_tanks',\s+'SA,TA,W\*\{kellerbuch\}',\s+'SA,TA,W\*\{kellerbuch\}',\s+'SA,TA\{kellerbuch\}'\)/)
    for (const fn of ['s112_kammer_vom_tank()', 's112_tank_an_kammern()', 's112_tank_anlegen(p_tenant_id uuid, p_name text, p_typ text, p_material text, p_standort text, p_notizen text, p_kammern jsonb)']) {
      assert.ok(helfer.includes(`'${fn}')`), fn)
    }
    assert.match(quelle('scripts/pilot-abraeumen.sql'), /\('gebinde_tanks', 'behalten', NULL, NULL, 'tenant_id'\)/)
    assert.match(quelle('docs/Leserechte.md'), /dac_antrag, gebinde_tanks, keller_behandlungen/)
  })
})
