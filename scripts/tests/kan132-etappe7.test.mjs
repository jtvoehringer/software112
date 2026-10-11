// KAN-132 Etappe 7: Löschschutz, keine Maßnahme ohne Grundstück, KI-Regeln – und der Bug vom 30.09.2026
// (Maßnahme erfassen bei Gebeshuber: Ried doppelt angezeigt, GST bei gewählter Ried nicht angehakt).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
  + (p.endsWith('neu/NeueBehandlungForm.tsx') ? readFileSync(new URL('../../src/app/(dashboard)/behandlungen/neu/RiedAuswahlListe.tsx', import.meta.url), 'utf8') : '')

test('Löschschutz in allen drei Lösch-Actions vor dem DELETE', () => {
  const a = quelle('src/app/(dashboard)/weingarten/actions.ts')
  for (const [fn, aufruf] of [
    ['deleteWeingarten', 'loeschSperre(supabase, tenantId, { weingartenIds: [id] })'],
    ['deleteRied', 'loeschSperre(supabase, tenantId, { weingartenIds })'],
    ['deleteGrundstueck', 'loeschSperre(supabase, tenantId, { grundstueckIds: [id] })'],
  ]) {
    const start = a.indexOf(`export async function ${fn}(`)
    const ende = a.indexOf('export async function', start + 10)
    const rumpf = a.slice(start, ende)
    assert.ok(rumpf.includes(aufruf), fn)
    assert.ok(rumpf.indexOf(aufruf) < rumpf.indexOf('.delete()'), `${fn}: Prüfung vor dem Löschen`)
  }
  assert.match(a, /from\('behandlung_grundstuecke'\)[\s\S]{0,120}count: 'exact'/)
  assert.match(a, /from\('kosteneintrag_weingaerten'\)[\s\S]{0,120}count: 'exact'/)
})

test('keine Maßnahme ohne Grundstück: Action lehnt ab, Formular bietet Rieden ohne WI-GST nicht an', () => {
  const a = quelle('src/app/(dashboard)/behandlungen/actions.ts')
  assert.ok(a.indexOf('if (grundstueckeById.size === 0)') > 0)
  assert.ok(a.indexOf('if (grundstueckeById.size === 0)') < a.indexOf('// 3. Behandlung anlegen'), 'Prüfung vor dem Anlegen')
  // Ried-Optionen seit 30.09.2026 gemeinsam für Anlegen und Bearbeiten
  const p = quelle('src/app/(dashboard)/behandlungen/neu/riedOptionen.ts')
  assert.match(p, /spritzbar: gsts\.some\(g => g\.nutzart === 'WI'\)/)
  // Bearbeiten: dieselbe Regel, und die Grundstücke kommen aus derselben Hilfsfunktion
  assert.match(a, /neueGst = await grundstueckeDerAuswahl\(supabase, tenantId, formData\)\r?\n\s+if \(neueGst\.size === 0\) throw new AktionsFehler\(OHNE_WI_GST\)/)
})

test('Bug 30.09.2026: ganze Ried gewählt → ihre GST angehakt, Einzel-Klick nimmt nur dieses GST heraus; eine Lage mit einer Ried = eine Zeile', () => {
  const f = quelle('src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx')
  assert.match(f, /const isGstSel = wgSel \|\| selectedGSTs\.has\(g\.id\)/)
  assert.match(f, /if \(riedGewaehlt\) for \(const g of gstByWeingarten\[wgId\] \?\? \[\]\) n\.set\(g\.id, wgId\)/)
  assert.match(f, /const einzelRied = istEinzelRied\(gruppe\)/)
  assert.match(f, /\{!einzelRied && <div/)
})

test('KI-Kontext: Verteilregel und keine Doppelzählung der Kosten', () => {
  const k = quelle('src/app/api/ki-abfrage/route.ts')
  assert.match(k, /VERTEILUNG AUF GRUNDSTÜCKE \(KAN-132\)/)
  assert.match(k, /NIE den vollen kosteneintraege\.betrag/)
})

test('Rückmeldung 30.09.2026: Rieden beim Bearbeiten änderbar, Snapshots bleiben, Kosten nach der neuen Zuordnung', () => {
  const edit = quelle('src/app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
  assert.match(edit, /import RiedAuswahlListe from '\.\.\/\.\.\/neu\/RiedAuswahlListe'/)
  assert.match(edit, /fd\.set\('ried_auswahl', '1'\)/)
  assert.match(edit, /flaecheHa: flaecheAktuell,/)
  assert.doesNotMatch(edit, /nicht änderbar/)
  const page = quelle('src/app/(dashboard)/behandlungen/[id]/edit/page.tsx')
  assert.match(page, /ladeRiedOptionen\(supabase, tenantId[,)]/)   // KAN-150: optionaler Stichtag (Tag der Maßnahme)
  assert.match(page, /gsts\.every\(g => bisherGst\.has\(g\.id\)\)/)   // ganze Ried vorausgewählt, wenn alle WI-GST dabei
  const a = quelle('src/app/(dashboard)/behandlungen/actions.ts')
  const upd = a.slice(a.indexOf('export async function updateBehandlung'), a.indexOf('export async function deleteBehandlung'))
  assert.match(upd, /if \(formData\.get\('ried_auswahl'\) === '1'\)/)
  assert.match(upd, /if \(snapshot\.has\(g\.id\)\) g\.flaeche_ha = snapshot\.get\(g\.id\)/)   // bisherige Fläche bleibt
  // abgewählte Grundstücke in Blöcken (05.10.2026, URL-Grenze ≈ 350 IDs)
  assert.match(upd, /for \(const block of bloecke\(weg\)\)[\s\S]{0,200}\.delete\(\)\.eq\('behandlung_id', id\)\.in\('grundstueck_id', block\)/)
  assert.ok(upd.includes('.insert(dazu.map('), 'neue GST eingefügt')
  assert.ok(upd.indexOf('.in(\'grundstueck_id\', weg)') < upd.indexOf('await ggfKostenEintragAktualisieren'), 'Kosten nach der neuen Zuordnung')
})

test('Rückmeldung 30.09.2026: Liste – Maßnahme in eigener Spalte, Ried(en) nach „Erntefrei ab“, alphabetisch und nicht fett', () => {
  const k = quelle('src/app/(dashboard)/behandlungen/BehandlungenClient.tsx')
  const kopf = k.slice(k.indexOf('>Maßnahme</th>'), k.indexOf('>Kosten</th>'))
  assert.ok(kopf.indexOf('Erntefrei ab') < kopf.indexOf('Ried(en)'))
  // Abschnitt RiedenZelle bis zur Listen-Komponente (KAN-324: der frühere Endmarker groupByDate ist weg)
  const zelleVon = k.indexOf('function RiedenZelle'), zelleBis = k.indexOf('export default function BehandlungenClient')
  assert.ok(zelleVon >= 0 && zelleBis > zelleVon, 'RiedenZelle steht vor der Listen-Komponente')
  assert.doesNotMatch(k.slice(zelleVon, zelleBis), /font-(medium|semibold|bold)/)
  const p = quelle('src/app/(dashboard)/behandlungen/page.tsx')
  assert.match(p, /\.sort\(KOLLATOR\.compare\)/)
  assert.doesNotMatch(p, /from\('behandlung_grundstuecke'\)/)   // eingebettet über die mandantengefilterte Maßnahme
})
