// KAN-456 PR 4 (14.11.2026): „Vertrieb“ ohne Kellerbuch und Lese.
// Befund: „Vertrieb“ liest Verkauf und Lager, die Datenbank liefert ihm aus Kellerbuch und Lese 0 Zeilen – ohne Fehler.
// Prüfungen, die diese Daten brauchen, fielen deshalb still falsch aus: Ein Zukauf von Trauben ließ sich ändern oder
// stornieren, obwohl er schon verpresst war (0 Treffer = „nichts hängt daran“); beim Storno eines Verkaufs mit Trauben
// wäre der Traubenverkauf (BKI) aktiv geblieben; die Zukaufsgrenze rechnete mit 0 ha Betriebsfläche; ein E-Label ließ
// sich mit leerem Zutaten-Vorschlag freigeben. Dazu leere Auswahlen (Charge, Gebinde, Ried) und Sackgassen.
// Neu: eine Regel (src/lib/auth/profilGrenzen.ts) – in der Oberfläche ausgeblendet UND in der Server Action abgelehnt.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zukaufArtFehler, zukaufArtenErlaubt, verkaufTypFehler, verkaufTypenErlaubt, verkaufPositionenFehler } from '../../src/lib/auth/profilGrenzen.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const W = 'src/app/(dashboard)/weinhandel'

const VERTRIEB = { role: 'winzer', profil: 'vertrieb' }
const EXTERN = { role: 'winzer', profil: 'extern' }
const OHNE = [{ role: 'winzer' }, { role: 'tenant_admin' }, { role: 'system_admin' }, { role: 'leser' }, { role: 'winzer', profil: null }]

describe('KAN-456: Regel – was Daten eines Bereichs braucht, gibt es nur mit Leserecht dort', () => {
  test('ohne Profil ändert sich nichts: jede Art und jeder Typ erlaubt', () => {
    for (const m of OHNE) {
      assert.deepEqual(zukaufArtenErlaubt(m), ['wein', 'most', 'trauben', 'maische', 'flaschen'])
      assert.deepEqual(verkaufTypenErlaubt(m), ['flasche', 'tank', 'sonstiges', 'trauben'])
      assert.equal(verkaufPositionenFehler(m, [{ typ: 'tank', weinausbau_id: 'w' }, { typ: 'trauben', traubenverkauf_id: 't' }]), null)
    }
  })
  test('Vertrieb: Zukauf nur Flaschen; Verkauf nur Flasche und Sonstiges', () => {
    assert.deepEqual(zukaufArtenErlaubt(VERTRIEB), ['flaschen'])
    assert.deepEqual(verkaufTypenErlaubt(VERTRIEB), ['flasche', 'sonstiges'])
    assert.match(zukaufArtFehler(VERTRIEB, 'trauben'), /Trauben und Maische .* Leserecht für den Bereich Lese/)
    assert.match(zukaufArtFehler(VERTRIEB, 'maische'), /Bereich Lese/)
    assert.match(zukaufArtFehler(VERTRIEB, 'wein'), /Wein und Most .* Bereich Kellerbuch/)
    assert.match(zukaufArtFehler(VERTRIEB, 'most'), /Bereich Kellerbuch/)
    assert.match(verkaufTypFehler(VERTRIEB, 'tank'), /Tankverkauf .* Bereich Kellerbuch/)
    assert.match(verkaufTypFehler(VERTRIEB, 'trauben'), /Weintrauben .* Bereich Lese/)
  })
  test('unbekannte Art gilt als Wein/Most (gesperrt ohne Kellerbuch), nicht als frei', () => {
    assert.match(zukaufArtFehler(VERTRIEB, 'neu'), /Kellerbuch/)
    assert.match(zukaufArtFehler(VERTRIEB, null), /Kellerbuch/)
    assert.equal(zukaufArtFehler({ role: 'winzer' }, 'neu'), null)
  })
  test('Extern (liest weder Kellerbuch noch Lese): dieselben Grenzen', () => {
    assert.deepEqual(zukaufArtenErlaubt(EXTERN), ['flaschen'])
    assert.deepEqual(verkaufTypenErlaubt(EXTERN), ['flasche', 'sonstiges'])
  })
  test('Storno: eine einzige Tank- oder Traubenposition genügt – auch erkannt an der Verknüpfung statt am Typ', () => {
    assert.equal(verkaufPositionenFehler(VERTRIEB, [{ typ: 'flasche' }, { typ: 'sonstiges' }]), null)
    assert.match(verkaufPositionenFehler(VERTRIEB, [{ typ: 'flasche' }, { typ: 'trauben' }]), /Weintrauben/)
    assert.match(verkaufPositionenFehler(VERTRIEB, [{ typ: 'sonstiges', traubenverkauf_id: 't1' }]), /Weintrauben/)
    assert.match(verkaufPositionenFehler(VERTRIEB, [{ typ: 'flasche', weinausbau_id: 'w1' }]), /Tankverkauf/)
    assert.equal(verkaufPositionenFehler(VERTRIEB, []), null)
  })
})

describe('KAN-456: Server Actions lehnen ab, bevor geschrieben wird', () => {
  test('Zukauf: Erfassen, Ändern (neue UND bisherige Art) und Stornieren', () => {
    const a = quelle(`${W}/zukauf/actions.ts`)
    assert.equal([...a.matchAll(/pruefeZukaufArt\(membership, f\.art\)/g)].length, 2)   // createZukauf, updateZukauf
    assert.match(a, /const a = alt as AR\n {2}pruefeZukaufArt\(membership, a\.art\)/)
    assert.match(a, /\.select\('id, ziel_weinausbau_id, datum, menge, art'\)/)
    // vor den Sperren, die ohne Leserecht blind wären
    assert.ok(a.indexOf('pruefeZukaufArt(membership, (zukauf as AR).art)') < a.indexOf('const sperre = loeschSperreText(await zukaufVerweise('))
    assert.ok(a.indexOf('pruefeZukaufArt(membership, (zukauf as AR).art)') > 0)
  })
  test('Verkauf erfassen: je Position; Verkauf stornieren: vor dem ersten Schreibzugriff', () => {
    assert.match(quelle(`${W}/verkauf/actions.ts`), /const grenze = verkaufTypFehler\(membership, p\.typ\); if \(grenze\) throw new AktionsFehler\(`\$\{nr\}: \$\{grenze\}`\)/)
    const b = quelle('src/lib/verkauf/bestand.ts')
    // nach der Prüfung der Mitgliedschaft (sonst verdrängte sie „Kein aktiver Mandant“), vor dem ersten Schreibzugriff
    const pruefung = b.indexOf('const grenze = verkaufPositionenFehler(membership, positionen)')
    assert.ok(pruefung > b.indexOf("throw new AktionsFehler('Kein aktiver Mandant gefunden')", b.indexOf('export async function verkaufspostenStornieren')))
    const stornoAb = b.indexOf('export async function verkaufspostenStornieren')
    const ersterSchreibzugriff = Math.min(...['.update(', '.insert(', '.rpc(', 'chargeBestandAendern(', 'fuellungBestandAendern('].map(s => b.indexOf(s, pruefung)).filter(i => i > 0))
    assert.ok(stornoAb > 0 && pruefung < ersterSchreibzugriff)
  })
  test('E-Label: Speichern und Freigeben nur mit Leserecht Kellerbuch', () => {
    const a = quelle(`${W}/fuellungen/[id]/elabel/actions.ts`)
    assert.match(a, /if \(!canRead\(membership, 'keller'\)\) \{\n\s+throw new AktionsFehler\('E-Labels können hier nicht bearbeitet oder freigegeben werden/)
    assert.match(quelle(`${W}/fuellungen/[id]/elabel/page.tsx`), /const schreiben = kellerLesbar && \(canWrite\(membership, 'kellerbuch'\) \|\| canWrite\(membership, 'warenwirtschaft'\)\)/)
  })
})

describe('KAN-456: Oberfläche blendet aus statt leer oder falsch zu zeigen', () => {
  test('Formulare bekommen die erlaubten Typen bzw. Arten vom Server (canRead nie aus dem Rollennamen im Client)', () => {
    assert.match(quelle('src/app/api/verkauf-stammdaten/route.ts'), /typen_erlaubt: verkaufTypenErlaubt\(membership\),/)
    assert.match(quelle('src/app/api/zukauf-stammdaten/route.ts'), /arten_erlaubt: zukaufArtenErlaubt\(membership\) \}\)/)
    assert.match(quelle(`${W}/verkauf/neu/page.tsx`), /\.filter\(t => typenErlaubt\.includes\(t\) \|\| pos\.typ === t\)\.map\(t => \(/)
    assert.match(quelle(`${W}/zukauf/neu/page.tsx`), /ART_OPTIONS\.filter\(o => artenErlaubt === null \|\| artenErlaubt\.includes\(o\.value\)\)/)
  })
  test('Zukaufsliste: Zukaufsgrenze nur mit Leserecht Rieden; Bearbeiten und Stornieren nur bei erlaubter Art', () => {
    const p = quelle(`${W}/zukauf/page.tsx`)
    assert.match(p, /if \(istWeinproduzent && canRead\(membership, 'rieden'\)\) \{/)
    assert.match(p, /const bearbeitbar = zukaufArtFehler\(membership, p\.art\) === null/)
    assert.match(p, /\{bearbeitbar && <StopPropagation className="flex items-center justify-end gap-2">/)
    assert.match(quelle(`${W}/zukauf/[id]/edit/page.tsx`), /if \(zukaufArtFehler\(membership, z\.art\)\) redirect\(KEIN_LESERECHT_ZIEL\)/)
  })
  test('Neue Füllung nur mit Leserecht Kellerbuch (Regel und Guard)', () => {
    assert.match(quelle('src/lib/navigation/seitenBereich.ts'), /\['\/weinhandel\/fuellungen\/neu', 'keller'\],/)
    assert.match(quelle(`${W}/fuellungen/neu/page.tsx`), /await requireLesen\('keller'\)/)
  })
  test('Warenlager: Tankwein, Rückverfolgung, Füllung löschen nur mit Kellerbuch; Traubenverkauf nur mit Lese', () => {
    const p = quelle(`${W}/page.tsx`)
    assert.match(p, /\{kellerLesbar && <section>/)
    assert.match(p, /\{leseLesbar && <section>/)
    assert.match(p, /\{kellerLesbar && <Link href=\{`\/kellerbuch\/rueckverfolgung\?fuellung_id=\$\{f\.id\}`\}/)
    assert.match(p, /\{kellerLesbar && <FuellungLoeschen /)
    assert.match(p, /kellerLesbar \? 'Lagerwert gesamt \(Einstandspreis\)' : 'Lagerwert Flaschen und Zukauf \(Einstandspreis\)'/)
  })
  test('Füllung bearbeiten: Charge und Prüfnummer nachtragen nur mit Kellerbuch – sonst ein Satz, wer es macht', () => {
    const p = quelle(`${W}/fuellungen/[id]/edit/page.tsx`)
    assert.match(p, /\) : !kellerLesbar \? null : \(\n\s+<div>\n\s+<label className=\{labelCls\}>Weinausbau-Charge<\/label>/)
    assert.match(p, /\) : !kellerLesbar \? \(\n\s+<p className="text-xs text-s112-muted">Noch keine Prüfnummer eingetragen\./)
  })
})
