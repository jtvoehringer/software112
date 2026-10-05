// KAN-88 (05.10.2026): Maßnahmen (Pflanzenschutz- und Düngeaufzeichnung) sowie PSM-/Dünger-Lagerbuchungen werden
// storniert, nicht gelöscht; stornierte zählen in keinem Lager, keiner Bilanz, keiner Meldung. Jede LESENDE Abfrage auf
// behandlungen, psm_lager_bewegungen und duengemittel_lager_bewegungen unter src/ filtert deshalb
// .is('storniert_am', null) – bewusst ungefilterte Leser (Liste mit Kennzeichnung, Bezugsprüfung, Einzelsatz) brauchen
// `// storno-sichtbar: <Grund>` direkt darüber (bis 300 Zeichen) oder in der Kette. DB-Test 40.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = path.join(WURZEL, 'src')
const MARKER = /storno-sichtbar:\s*\S.{10,}/
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

function dateien(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) out.push(...dateien(p))
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

/** Kette ab .from(…)/.q(…) bis zum Ende der Anweisung (wie kan148-storno-leser, Fenster 1.500 Zeichen – lange Select-Listen) */
function kette(s, i) {
  const rest = s.slice(i, i + 1500)
  const ende = rest.slice(1).search(/;\s*\n|\n\s*\n|\n\s*(?:const |let |var |if |for |return |throw |await |try |\}|\]\)|for\b)|\.from\(|\.q\(/)
  return ende >= 0 ? rest.slice(0, ende + 1) : rest
}

test('jede lesende Abfrage auf Maßnahmen und Mittel-Lager filtert stornierte Zeilen oder ist begründet', () => {
  const funde = []
  let geprueft = 0
  for (const f of dateien(SRC)) {
    const s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const re = /\.(?:from|q)\('(behandlungen|psm_lager_bewegungen|duengemittel_lager_bewegungen)'\)/g
    let m
    while ((m = re.exec(s))) {
      const k = kette(s, m.index)
      if (/\.(insert|update|delete|upsert)\(/.test(k)) continue   // schreibende Kette
      if (!/\.select\(/.test(k)) continue
      geprueft++
      const vorher = s.slice(Math.max(0, m.index - 300), m.index)
      if (/\.is\('storniert_am', null\)/.test(k) || MARKER.test(vorher) || MARKER.test(k)) continue
      funde.push(`${path.relative(SRC, f)}:${s.slice(0, m.index).split('\n').length} (${m[1]})`)
    }
  }
  assert.ok(geprueft >= 14, `zu wenige Abfragen gefunden (${geprueft}) – Muster prüfen`)
  assert.deepEqual(funde, [], 'ohne .is(\'storniert_am\', null) bzw. // storno-sichtbar: <Grund>')
})

test('Maßnahmen: stornieren statt löschen, endgültig löschen nur über s112_storniert_loeschen', () => {
  const a = quelle('src/app/(dashboard)/behandlungen/actions.ts')
  assert.doesNotMatch(a, /s112_buchung_loeschen|export async function deleteBehandlung/)
  const st = a.slice(a.indexOf('export async function stornoBehandlung('), a.indexOf('export async function loescheBehandlung('))
  assert.match(st, /\.update\(\{ storniert_am: new Date\(\)\.toISOString\(\), storno_grund: grund\.trim\(\) \}\)/)
  assert.match(st, /\.is\('storniert_am', null\)/)
  assert.ok(!st.includes("from('behandlungen') as any).delete"), 'kein .delete() auf behandlungen')
  assert.match(a, /p_tabelle: 'behandlungen', p_id: id, p_grund: grund\.trim\(\)/)
  assert.match(a, /if \(\(bisher as AR\)\.storniert_am\) throw new AktionsFehler\(STORNIERT_FEST\)/)
  const c = quelle('src/app/(dashboard)/behandlungen/BehandlungenClient.tsx')
  assert.match(c, /<StornoButton action=\{grund => stornoBehandlung\(b\.id, grund\)\}/)
  assert.match(c, /<StornoButton modus="loeschen" label="Endgültig löschen" action=\{grund => loescheBehandlung\(b\.id, grund\)\}/)
  assert.match(quelle('src/app/(dashboard)/behandlungen/[id]/edit/page.tsx'), /if \(\(rawB as AR\)\.storniert_am\) redirect\('\/behandlungen'\)/)
})

test('Lager: Buchungen fest, stornieren statt löschen, Bestand ohne stornierte', () => {
  const a = quelle('src/app/(dashboard)/behandlungen/lager/actions.ts')
  assert.doesNotMatch(a, /s112_buchung_loeschen|deleteLagerBewegung|deleteDuengerBewegung/)
  assert.equal((a.match(/if \(existingId\) throw new AktionsFehler\(LAGER_FEST\)/g) ?? []).length, 2)
  assert.doesNotMatch(a.slice(0, a.indexOf('// ── PSM-Stammdaten')), /\.update\(payload\)/)
  for (const [datei, storno, loesche] of [['LagerClient.tsx', 'stornoLagerBewegung', 'loescheLagerBewegung'], ['DuengerLagerClient.tsx', 'stornoDuengerBewegung', 'loescheDuengerBewegung']]) {
    const c = quelle(`src/app/(dashboard)/behandlungen/lager/${datei}`)
    assert.match(c, new RegExp(`<StornoButton action=\\{grund => ${storno}\\(b\\.id, grund\\)\\}`), datei)
    assert.match(c, new RegExp(`<StornoButton modus="loeschen" label="Endgültig löschen" action=\\{grund => ${loesche}\\(b\\.id, grund\\)\\}`), datei)
    assert.doesNotMatch(c, /setEditBew|Pencil/, datei)
  }
  const p = quelle('src/app/(dashboard)/behandlungen/lager/page.tsx')
  assert.match(p, /lagerKonto\(\(bewegungenByPsm\.get\(id\) \?\? \[\]\)\.filter\(b => !b\.storniert_am\),/)
  assert.match(p, /lagerKonto\(\(bewegungenByDuenger\.get\(d\.id\) \?\? \[\]\)\.filter\(b => !b\.storniert_am\),/)
})

test('Änderungsprotokoll benennt die Bereiche, Löschsperre-Liste und Migration passen', () => {
  const ap = quelle('src/lib/behoerden/aenderungsprotokoll.ts')
  for (const t of ['behandlungen', 'behandlung_grundstuecke', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen']) assert.match(ap, new RegExp(`\\n  ${t}: '`), t)
  const liste = JSON.parse(quelle('scripts/storno-tabellen.json'))
  for (const t of ['behandlungen', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen']) assert.ok(liste.scharf.includes(t), t)
  const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan88_psm_storno.sql'))
  const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan88_psm_storno.sql')
  assert.match(m, /FOREACH t IN ARRAY ARRAY\['behandlungen', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen'\] LOOP/)
  assert.match(m, /CREATE POLICY keine_direktloeschung ON public\.%I AS RESTRICTIVE FOR DELETE TO authenticated USING \(false\)/)
  assert.match(m, /DROP FUNCTION public\.s112_buchung_loeschen\(uuid, text, uuid, text\);/)
  assert.match(m, /CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public\.behandlung_grundstuecke/)
  assert.match(m, /'notizen,storniert_am,storniert_von,storniert_von_name,storno_grund', 'datum'/)
})
