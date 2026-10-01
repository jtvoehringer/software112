#!/usr/bin/env node
/**
 * check-storno.js – Wächter „Stornieren statt Löschen“ bei berichtsrelevanten Buchungen (KAN-145, 30.09.2026)
 *
 * Vorgabe Jörgen/BKI (26.09.2026): Berichtsrelevante Buchungen (Tabellen in scripts/storno-tabellen.json) werden
 * storniert – die Zeile bleibt, gekennzeichnet –, endgültig gelöscht wird nur eine stornierte Zeile über die RPC
 * public.s112_storniert_loeschen (Betriebsleitung, mit Grund). Läuft im prebuild und bricht den Build ab bei:
 *  1. DELETE_APP    `.from('<tabelle>') … .delete()` unter src/ auf einer gelisteten Tabelle
 *  2. DELETE_VAR    `.from(<Variable/Template>) … .delete()` unter src/ – die Tabelle ist nicht erkennbar
 *                   (so löschte storno.ts `loescheNachRueckbuchung` Verschnitte und Umzüge)
 *  3. DELETE_SQL    `DELETE FROM [public.]<tabelle>` in sql/, scripts/ und supabase/migrations/ – bei Migrationen
 *                   erst ab STICHTAG_MIGRATION (die eingespielte Remote-Historie davor bleibt unverändert).
 * Kommentare zählen nicht (Scanner aus check-replica.js). Ausnahme je Stelle: „// storno-ausnahme: <Grund>“ bzw.
 * „-- storno-ausnahme: <Grund>“ in derselben Zeile oder allein in der Zeile davor, Grund mind. 15 Zeichen.
 * ALTFAELLE: bekannte Stellen aus der Zeit vor KAN-145 (Datei → Tabellen); sie werden mit den Folgetickets C, D, F
 * und G abgebaut. Eine neue Stelle in einer Altfall-Datei ist trotzdem ein Fund, sobald die Tabelle nicht gelistet ist.
 *
 * Aufruf: node scripts/check-storno.js [--liste]   (Exit 1 bei Funden; --liste zeigt Ausnahmen und Altfälle)
 * Für Tests: require('./check-storno.js') → { pruefeText, pruefeWurzel, TABELLEN } ohne Seiteneffekte;
 * S112_GUARD_ROOT prüft ein anderes Projektverzeichnis (scripts/tests/check-storno.test.mjs).
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-replica.js')

const WURZEL = process.env.S112_GUARD_ROOT || path.join(__dirname, '..')
const TABELLEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'storno-tabellen.json'), 'utf8')).berichtsrelevant
/** Migrationen ab dieser Version werden geprüft (Remote-Historie davor ist unveränderlich) */
const STICHTAG_MIGRATION = '20260930120000'
const MIN_GRUND = 15
const AUSNAHME = /storno-ausnahme\s*:\s*(.*)$/i

/** Bekannte Stellen vor KAN-145: Datei (relativ, mit /) → Tabellen; Abbau in den Folgetickets */
const ALTFAELLE = {
  // C Lese/AMA (nach KAN-129)
  'src/app/(dashboard)/erntemeldung/actions.ts': ['ernte_parzellen', 'ama_meldepositionen', 'pressung_behaelter', 'pressung_weingaerten', 'pressungen', 'weinausbau', 'weinjahrgaenge', 'traubenverkauf', 'ama_erntemeldungen'],
  'src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts': ['traubenverkauf'],
  // D Verkauf/E/A: abgebaut (KAN-149 D1–D3, 01.10.2026)
  // G Aufräumen: Wartungs- und Cleanup-Skripte (künftig mit s112.loeschen_erlaubt)
  'sql/cleanup_gebeshuber_kompletter_reset.sql': ['*'],
  'sql/cleanup_testdaten_2026-08-05.sql': ['*'],
  // E = KAN-88 Maßnahmen, Lager
  'src/app/(dashboard)/behandlungen/actions.ts': ['behandlungen', 'behandlung_grundstuecke'],
  'src/app/(dashboard)/behandlungen/lager/actions.ts': ['psm_lager_bewegungen', 'duengemittel_lager_bewegungen'],
  // B Kellerbuch – wird in diesem Ticket (Block B) abgebaut
  'src/lib/kellerbuch/storno.ts': ['*'],
  'src/app/(dashboard)/kellerbuch/actions.ts': ['keller_behandlungen'],
  'src/app/(dashboard)/weinhandel/actions.ts': ['keller_umzuege', 'fuellung_chargen'],
}

/**
 * Eingespielte Migrationen (Remote-Historie, Datei nicht mehr änderbar), deren DELETE in der Lösch-RPC
 * s112_storniert_loeschen steht: löscht nur stornierte Zeilen, nur mit dem Kennzeichen s112.storno_loeschen, mit Grund
 * im Protokoll – Datei → [Tabellen, Grund]. Nur für solche RPC-Migrationen verwenden.
 */
const LOESCH_RPC_MIGRATIONEN = {
  'supabase/migrations/20260930153205_kan148c1d_loeschsperre_lese.sql': [['ernte_parzellen', 'weinausbau'],
    'Lösch-RPC s112_storniert_loeschen (KAN-148 C1d): nur stornierte Zeilen, Kennzeichen s112.storno_loeschen, Grund im Protokoll'],
  'supabase/migrations/20260930161020_kan148c2a_ama_versionen.sql': [['ama_meldepositionen'],
    'RPC s112_ama_meldung_speichern (KAN-148 C2): ersetzt nur die Positionen einer offenen (nicht eingereichten) Meldung; eingereichte Versionen schützt a_ama_position_schutz'],
  'supabase/migrations/20261001131300_kan150f2a_antraege_storno.sql': [['ernte_parzellen', 'weinausbau'],
    'Lösch-RPC s112_storniert_loeschen (KAN-150 F2a): nur stornierte Zeilen bzw. freigegebene Entwürfe, Kennzeichen s112.storno_loeschen, Grund im Protokoll'],
  'supabase/migrations/20261001124303_kan150f1d_herkunft_charge.sql': [['weinausbau_weingaerten'],
    'RPC s112_herkunft_setzen (KAN-150 F1d): entfernt nur abgewählte Rieden einer nicht stornierten Charge, Kennzeichen s112.storno_loeschen, alte und neue Rieden samt Grund im Protokoll'],
}

function rel(datei) { return path.relative(WURZEL, datei).split(path.sep).join('/') }

/** Ausnahme mit Grund in der Zeile oder allein in der Zeile davor; liefert Grund, '' (zu kurz) oder null */
function ausnahmeGrund(zeilen, idx) {
  for (const z of [zeilen[idx], idx > 0 && /^\s*(\/\/|--)/.test(zeilen[idx - 1]) ? zeilen[idx - 1] : '']) {
    const m = AUSNAHME.exec(z || '')
    if (m) return m[1].trim().length >= MIN_GRUND ? m[1].trim() : ''
  }
  return null
}

/**
 * Prüft einen Dateitext. art: 'app' (TS/TSX unter src/) oder 'sql'. Liefert { funde, ausnahmen, altfaelle }.
 */
function pruefeText(text, art, datei = '') {
  const code = ohneKommentare(text, art === 'app' ? 'js' : 'sql')
  const zeilen = text.split(/\r?\n/)
  const zeileVon = i => code.slice(0, i).split('\n').length - 1
  const funde = [], ausnahmen = [], altfaelle = []
  const alt = ALTFAELLE[datei] ?? []
  const melde = (i, regel, tabelle, text) => {
    const z = zeileVon(i)
    const grund = ausnahmeGrund(zeilen, z)
    if (grund) { ausnahmen.push({ datei, zeile: z + 1, regel, tabelle, grund }); return }
    const rpc = LOESCH_RPC_MIGRATIONEN[datei]
    if (rpc && tabelle && rpc[0].includes(tabelle)) { ausnahmen.push({ datei, zeile: z + 1, regel, tabelle, grund: rpc[1] }); return }
    if (grund === '') { funde.push({ datei, zeile: z + 1, regel, tabelle, text: 'storno-ausnahme ohne ausreichenden Grund (mind. 15 Zeichen)' }); return }
    if (alt.includes('*') || (tabelle && alt.includes(tabelle))) { altfaelle.push({ datei, zeile: z + 1, regel, tabelle }); return }
    funde.push({ datei, zeile: z + 1, regel, tabelle, text })
  }
  if (art === 'app') {
    const re = /\.delete\s*\(/g
    let m
    while ((m = re.exec(code))) {
      const vor = code.slice(Math.max(0, m.index - 600), m.index)
      const i = vor.lastIndexOf('.from(')
      if (i < 0) continue
      const arg = vor.slice(i + 6)
      const lit = /^\s*(['"`])([A-Za-z_][\w]*)\1\s*\)/.exec(arg)
      if (lit) {
        if (TABELLEN.includes(lit[2])) melde(m.index, 'DELETE_APP', lit[2], `.delete() auf „${lit[2]}“ – berichtsrelevant: stornieren statt löschen (KAN-145)`)
      } else if (/^\s*[A-Za-z_`$]/.test(arg) && !/^\s*['"]/.test(arg)) {
        melde(m.index, 'DELETE_VAR', null, '.from(<Variable>).delete() – Tabelle nicht erkennbar; berichtsrelevante Tabellen werden storniert (KAN-145)')
      }
    }
  } else {
    const re = /\bdelete\s+from\s+(?:only\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi
    let m
    while ((m = re.exec(code))) {
      const t = m[1].toLowerCase()
      if (TABELLEN.includes(t)) melde(m.index, 'DELETE_SQL', t, `DELETE FROM ${t} – berichtsrelevant: stornieren statt löschen bzw. begründete Wartung mit s112.loeschen_erlaubt (KAN-145)`)
    }
  }
  return { funde, ausnahmen, altfaelle }
}

function dateien(verzeichnis, endungen) {
  const out = []
  const start = path.join(WURZEL, verzeichnis)
  if (!fs.existsSync(start)) return out
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      // db-tests: jedes DELETE dort läuft in zurückgerollten Transaktionen und prüft gerade die Sperren
      if (e.isDirectory()) { if (!['node_modules', 'migrations_legacy', 'db-tests'].includes(e.name)) lauf(f) }
      else if (endungen.some(x => e.name.endsWith(x))) out.push(f)
    }
  }
  lauf(start)
  return out
}

function pruefeWurzel() {
  const erg = { funde: [], ausnahmen: [], altfaelle: [], anzahl: 0 }
  const sammle = (r) => { erg.funde.push(...r.funde); erg.ausnahmen.push(...r.ausnahmen); erg.altfaelle.push(...r.altfaelle); erg.anzahl++ }
  for (const f of dateien('src', ['.ts', '.tsx'])) sammle(pruefeText(fs.readFileSync(f, 'utf8'), 'app', rel(f)))
  for (const v of ['sql', 'scripts', 'supabase']) {
    for (const f of dateien(v, ['.sql'])) {
      const r = rel(f)
      if (r.startsWith('supabase/migrations/')) {
        const version = path.basename(f).split('_')[0]
        if (!(version >= STICHTAG_MIGRATION)) continue
      }
      sammle(pruefeText(fs.readFileSync(f, 'utf8'), 'sql', r))
    }
  }
  return erg
}

if (require.main === module) {
  const erg = pruefeWurzel()
  const liste = process.argv.includes('--liste')
  if (liste) {
    for (const a of erg.ausnahmen) console.log(`  Ausnahme  ${a.datei}:${a.zeile} ${a.regel} ${a.tabelle ?? ''} – ${a.grund}`)
    for (const a of erg.altfaelle) console.log(`  Altfall   ${a.datei}:${a.zeile} ${a.regel} ${a.tabelle ?? ''}`)
  }
  if (erg.funde.length > 0) {
    console.error(`\n✖ check-storno: ${erg.funde.length} Fund(e) – Stornieren statt Löschen (KAN-145, CLAUDE.md):\n`)
    for (const f of erg.funde) console.error(`  ${f.datei}:${f.zeile}  ${f.regel}  ${f.text}`)
    console.error('\nBegründete Ausnahme je Stelle: // storno-ausnahme: <Grund> bzw. -- storno-ausnahme: <Grund> (mind. 15 Zeichen).\n')
    process.exit(1)
  }
  console.log(`✓ check-storno: ${erg.anzahl} Dateien geprüft, ${TABELLEN.length} berichtsrelevante Tabellen; ${erg.ausnahmen.length} begründete Ausnahme(n), ${erg.altfaelle.length} Altfall-Stelle(n) (Abbau in KAN-145 B und den Folgetickets).`)
}

module.exports = { pruefeText, pruefeWurzel, TABELLEN, ALTFAELLE, STICHTAG_MIGRATION }
