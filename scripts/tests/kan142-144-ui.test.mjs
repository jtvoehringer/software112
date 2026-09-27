// KAN-142 / KAN-144 – Menüpfade in Hilfe und Onboarding, Kopfleiste, Notiz-Spalte der Lese (Review 26.09.2026)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --experimental-strip-types --test scripts/tests/kan142-144-ui.test.mjs
//
// Reine Quelltext-Prüfungen (ohne Datenbank, ohne Browser): Reihenfolge der Gruppe „Rieden“ in
// src/lib/navigation/index.ts (Unterpunkte bei ihrem Hauptpunkt), keine flachen Menüpfade in FAQ,
// Handbuch und Onboarding, FAQ und Handbuch nennen für jede Pflichtmeldung ihren Menüpunkt
// (auch Lesedaten: Rieden > Lese);
// Kopfleiste in CD-Blau mit Glocken-Badge weiß/rot/gelb und weißem Fokusrahmen (KAN-142 AK 1/2);
// Lese-Tabelle mit Spalte „Notizen“ nach „kg“, „–“ ohne Notiz, voller Text als title (KAN-144);
// NotizZelle wechselt nie zwischen span und <button> (WebKit kürzt einen <button> nicht per
// -webkit-line-clamp → Endloswechsel auf iOS).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const FAQ = 'src/app/(dashboard)/hilfe/faq/page.tsx'
const HANDBUCH = 'src/app/(dashboard)/hilfe/handbuch/page.tsx'
const ONBOARDING = 'src/app/(dashboard)/admin/onboarding/page.tsx'

/** Öffnendes JSX-Tag ab dem „<“ an Stelle i – bis zum „>“ außerhalb von {…} (Pfeilfunktionen enthalten „>“) */
function tagAb(q, i) {
  let tiefe = 0
  for (let j = i + 1; j < q.length; j++) {
    const c = q[j]
    if (c === '{') tiefe++
    else if (c === '}') tiefe--
    else if (c === '>' && tiefe === 0) return q.slice(i, j + 1)
  }
  throw new Error(`Tag ab Stelle ${i} nicht geschlossen`)
}

/** Alle öffnenden Tags eines Elements (z. B. 'button', 'Link') */
const tags = (q, name) => [...q.matchAll(new RegExp(`<${name}\\b`, 'g'))].map(m => tagAb(q, m.index))

/** Entfernt den JSX-Ausdruck {anfang …} samt Inhalt (Klammern gezählt) */
function ohneAusdruck(q, anfang) {
  const i = q.indexOf(anfang)
  assert.ok(i >= 0, `${anfang} fehlt`)
  let tiefe = 0
  for (let j = i; j < q.length; j++) {
    if (q[j] === '{') tiefe++
    else if (q[j] === '}' && --tiefe === 0) return q.slice(0, i) + q.slice(j + 1)
  }
  throw new Error(`${anfang} nicht geschlossen`)
}

const regexText = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('KAN-142: Menüpfade unter „Rieden“', () => {
  test('Reihenfolge: Rieden · Maßnahmen · • Behandlungsprotokoll · • Cu-Bilanz · • Nährstoffbilanz · Lese · • AMA-Erntemeldung · Betriebsmittel', () => {
    const nav = quelle('src/lib/navigation/index.ts')
    const start = nav.indexOf("key: 'rieden'")
    assert.ok(start >= 0, 'Gruppe „rieden“ fehlt')
    const gruppe = nav.slice(start, nav.indexOf("key: '", start + 1))
    const punkte = [...gruppe.matchAll(/\{ href: '[^']+',\s*label: '([^']+)'([^}]*)\}/g)]
      .map(m => (/\bchild: true\b/.test(m[2]) ? '• ' : '') + m[1])
    assert.deepEqual(punkte, ['Rieden', 'Maßnahmen', '• Behandlungsprotokoll', '• Cu-Bilanz', '• Nährstoffbilanz', 'Lese', '• AMA-Erntemeldung', 'Betriebsmittel'])
  })

  test('FAQ, Handbuch und Onboarding nennen keine flachen Pfade (Pflichtmeldungen ohne „Maßnahmen“, AMA ohne „Lese“)', () => {
    for (const p of [FAQ, HANDBUCH, ONBOARDING]) {
      assert.doesNotMatch(quelle(p), /Rieden (>|›) (Behandlungsprotokoll|Cu-Bilanz|Nährstoffbilanz|AMA-Erntemeldung)|Rieden (>|›) Maßnahmen, Rieden (>|›) Lese/, p)
    }
  })

  test('FAQ und Handbuch nennen denselben Weg zu den Pflichtmeldungen', () => {
    const weg = 'Rieden > Maßnahmen > Behandlungsprotokoll, Cu-Bilanz und Nährstoffbilanz, Rieden > Lese (Lesedaten je Jahrgang), '
      + 'Rieden > Lese > AMA-Erntemeldung (Weinerntemeldung, Weinbestandsmeldung), Kellerbuch > Weinbuch-Sammlung'
    assert.ok(quelle(FAQ).includes(`über ${weg} oder die Karte unter Meldungen & Fristen`), FAQ)
    assert.ok(quelle(HANDBUCH).includes(weg.replace(', Kellerbuch', ' sowie Kellerbuch')), HANDBUCH)
  })

  test('jede genannte Pflichtmeldung hat ihren Menüpunkt im Weg (Druckseite laut Katalog → Menüeintrag)', () => {
    // Menüeinträge (href → label) und Druckpfade der Pflichtmeldungen aus dem Katalog
    const menue = [...quelle('src/lib/navigation/index.ts').matchAll(/\{ href: '([^']+)',\s*label: '([^']+)'/g)]
      .map(m => ({ href: m[1], label: m[2] }))
    const katalog = ['ernte', 'pflanzenschutz', 'kellerbuch'].map(g => quelle(`src/lib/behoerden/katalog/${g}.ts`)).join('\n')
    const druckPfad = (id) => {
      const i = katalog.search(new RegExp(`\\n  '?${regexText(id)}'?: \\{`))
      assert.ok(i >= 0, `Katalog-Eintrag ${id} fehlt`)
      return /druckPfad: '([^']+)'/.exec(katalog.slice(i))[1]
    }
    const h = quelle(HANDBUCH)
    const wegHandbuch = h.slice(h.indexOf('auch ohne Modul Controlling:'), h.indexOf('Leser sehen sie nur mit Modul Controlling'))
    const f = quelle(FAQ)
    const wegFaq = f.slice(f.indexOf('auch ohne Controlling – über'), f.indexOf('oder die Karte unter Meldungen & Fristen'))
    assert.ok(wegHandbuch.length > 30 && wegFaq.length > 30, 'Wegbeschreibung in Handbuch oder FAQ nicht gefunden')

    // Die sieben Pflichtmeldungen, die Handbuch und FAQ aufzählen
    const ids = ['erntemeldung', 'lesedaten', 'bestandsmeldung', 'psm-aufzeichnung', 'cu-bilanz', 'naehrstoffbilanz', 'weinbuch-sammlung']
    for (const id of ids) {
      const pfad = druckPfad(id)
      const punkt = menue.filter(m => pfad === m.href || pfad.startsWith(m.href + '/'))
        .sort((a, b) => b.href.length - a.href.length)[0]
      assert.ok(punkt, `${id}: kein Menüeintrag für ${pfad}`)
      const genannt = new RegExp(`(?:> |, | und )${regexText(punkt.label)}(?![\\p{L}-])`, 'u')
      assert.match(wegHandbuch, genannt, `Handbuch: ${id} (${pfad}) → Menüpunkt „${punkt.label}“ fehlt im Weg`)
      assert.match(wegFaq, genannt, `FAQ: ${id} (${pfad}) → Menüpunkt „${punkt.label}“ fehlt im Weg`)
    }
    // Lesedaten: Druck und CSV nur auf der Jahrgangsseite unter Rieden > Lese, nicht auf der AMA-Seite
    assert.equal(druckPfad('lesedaten'), '/erntemeldung/[id]')
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx'), /<CsvExportKnopf label="Lesedaten als CSV" href=\{csvPfad\('lesedaten'/)
    assert.doesNotMatch(quelle('src/app/(dashboard)/reports/(pflicht)/ama/page.tsx'), /csvPfad\('lesedaten'/)
  })

  test('Pflichtmeldungs-Seiten: Brotkrume wie die Navigation (Maßnahmen bzw. Lese), unverändert', () => {
    for (const s of ['behandlungsprotokoll', 'cu-bilanz', 'naehrstoffbilanz']) {
      const q = quelle(`src/app/(dashboard)/reports/(pflicht)/${s}/page.tsx`)
      assert.match(q, /Brotkrume wie die Navigation \(Rieden › Maßnahmen › …\)/, s)
      assert.match(q, /const zurueck = \{ href: '\/behandlungen', label: 'Maßnahmen' \}/, s)
    }
    const ama = quelle('src/app/(dashboard)/reports/(pflicht)/ama/page.tsx')
    assert.match(ama, /Brotkrume wie die Navigation: Rieden › Lese › AMA-Erntemeldung/)
    assert.match(ama, /<Link href="\/erntemeldung" className="[^"]*">Lese<\/Link>/)
  })
})

describe('KAN-142: Kopfleiste in CD-Blau (AK 1/2)', () => {
  const top = quelle('src/components/layout/Topbar.tsx')
  const kopf = top.slice(top.indexOf('<header'), top.indexOf('</header>'))

  test('Kopfleiste bg-s112-blue-700 statt Anthrazit (bg-s112-text)', () => {
    assert.ok(kopf.length > 0, '<header> fehlt')
    const header = tagAb(top, top.indexOf('<header'))
    assert.match(header, /\bbg-s112-blue-700\b/)
    assert.doesNotMatch(header, /\bbg-s112-text\b/)
  })

  test('Glocken-Badge: Benachrichtigung weiß mit blauer Zahl, Fehler rot, Hinweis gelb – nie blau auf Blau', () => {
    const m = /const badgeFarbe = ([\s\S]*?)\r?\n\s*\r?\n/.exec(top)
    assert.ok(m, 'badgeFarbe fehlt')
    // Ausdruck wie in der Komponente auswerten (reines JS: Ternäre, ?.)
    const farbe = new Function('anzahlErr', 'benachr', 'hinweise', `return (${m[1]})`)
    const b = [{ id: 'b1' }]
    const warn = [{ tone: 'warn' }]
    const err = [{ tone: 'err' }]
    const faelle = [
      ['nur Benachrichtigung (Hinweise geladen)', 0, b, [], 'weiss'],
      ['nur Benachrichtigung (Hinweise noch nicht geladen)', 0, b, null, 'weiss'],
      ['Hinweis', 0, [], warn, 'gelb'],
      ['Hinweis und Benachrichtigung', 0, b, warn, 'gelb'],
      ['Fehler', 1, [], err, 'rot'],
      ['Fehler und Benachrichtigung', 1, b, [...err, ...warn], 'rot'],
    ]
    for (const [titel, anzahlErr, benachr, hinweise, soll] of faelle) {
      const k = farbe(anzahlErr, benachr, hinweise).split(/\s+/)
      assert.ok(!k.includes('bg-s112-blue-700'), `${titel}: Badge blau auf blauer Fläche`)
      if (soll === 'weiss') assert.ok(k.includes('bg-white') && k.includes('text-s112-blue-700'), `${titel}: ${k.join(' ')}`)
      if (soll === 'gelb') assert.ok(k.includes('bg-s112-warn-fg') && k.includes('text-white'), `${titel}: ${k.join(' ')}`)
      if (soll === 'rot') assert.ok(k.includes('bg-s112-err') && k.includes('text-white'), `${titel}: ${k.join(' ')}`)
    }
    // Das Badge an der Glocke verwendet genau diese Farbe
    const badge = tags(kopf, 'span').find(t => t.includes('${badgeFarbe}'))
    assert.ok(badge, 'Badge ohne ${badgeFarbe}')
    assert.match(badge, /\brounded-full\b/)
  })

  test('jedes Bedienelement auf der blauen Fläche hat den weißen Fokusrahmen (FOKUS_HELL)', () => {
    assert.match(top, /const FOKUS_HELL = '[^']*outline-white[^']*'/)
    // Aufgeklappte Menüs liegen auf Weiß – dort gilt der globale blaue Rahmen
    let flaeche = ohneAusdruck(kopf, '{notifOpen && (')
    flaeche = ohneAusdruck(flaeche, '{menuOpen && (')
    const bedien = [...tags(flaeche, 'Link'), ...tags(flaeche, 'button'), ...tags(flaeche, 'a')]
    // Wortmarke, Suche, Glocke, Benutzermenü
    assert.ok(bedien.length >= 4, `nur ${bedien.length} Bedienelemente gefunden`)
    for (const t of bedien) assert.ok(t.includes('${FOKUS_HELL}'), `ohne FOKUS_HELL: ${t.slice(0, 120)}`)
    assert.ok(tags(flaeche, 'Link').some(t => t.includes('href="/dashboard"')), 'Wortmarke fehlt')
  })
})

describe('KAN-144: Notiz-Spalte in der Lese-Tabelle', () => {
  const c = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
  const start = c.indexOf('function NotizZelle(')
  const rest = c.slice(start)
  const notiz = rest.slice(0, rest.search(/\r?\n\}\r?\n/))

  test('Tabelle: Spalte „Notizen“ direkt nach „kg“, Zellen in derselben Reihenfolge wie die Köpfe', () => {
    const iKopf = c.search(/<th\b[^>]*>Ried<\/th>/)
    assert.ok(iKopf >= 0, 'Tabellenkopf der Lese fehlt')
    const kopf = c.slice(c.lastIndexOf('<thead>', iKopf), c.indexOf('</thead>', iKopf))
    const spalten = [...kopf.matchAll(/<th\b[^>]*>([^<]*)<\/th>/g)].map(m => m[1].trim())
    assert.deepEqual(spalten, ['Ried', 'GST', 'Sorte', 'Datum', 'kg', 'Notizen', 'Mostgewicht', 'Qualität'])
    // Erste Zeile im tbody: die Zellen liegen unter den passenden Köpfen
    const tbody = c.indexOf('<tbody>', iKopf)
    const zeile = c.slice(tbody, c.indexOf('</tr>', tbody))
    const zellen = zeile.split(/<td\b/).slice(1)
    const spalteVon = (muster) => zellen.findIndex(z => muster.test(z))
    assert.equal(spalteVon(/p\.menge_kg\b/), spalten.indexOf('kg'), 'kg-Zelle')
    assert.equal(spalteVon(/<NotizZelle text=\{p\.notizen\} \/>/), spalten.indexOf('Notizen'), 'Notiz-Zelle')
    assert.equal(spalteVon(/<MostgewichtAnzeige\b/), spalten.indexOf('Mostgewicht'), 'Mostgewicht-Zelle')
  })

  test('ohne Notiz „–“, mit Notiz der volle Text als title an der Hülle', () => {
    assert.ok(start >= 0, 'NotizZelle fehlt')
    assert.match(notiz, /if \(!text\b[^)]*\) return <span\b[^>]*>–<\/span>/)
    // Äußerstes Element der Rückgabe mit Notiz
    const iReturn = notiz.search(/return \(\s*</)
    assert.ok(iReturn >= 0, 'return ( <…> ) fehlt')
    const huelle = tagAb(notiz, notiz.indexOf('<', iReturn))
    assert.match(huelle, /^<span\b/)
    assert.match(huelle, /\btitle=\{text\}/)
  })

  test('kein Wechsel span ↔ <button>: eine Hülle, gekürzt und gemessen wird immer das innere span', () => {
    assert.doesNotMatch(notiz, /<button\b/)
    const mitRef = tags(notiz, 'span').filter(t => /\bref=\{/.test(t))
    assert.equal(mitRef.length, 1, 'genau ein gemessenes Element')
    assert.match(mitRef[0], /line-clamp-2/)
    assert.match(mitRef[0], /\boffen\b[^`]*line-clamp-none|line-clamp-none[^`]*\boffen\b/, 'aufgeklappt ohne Kürzung')
    assert.match(mitRef[0], /print:line-clamp-none/)
    // Die Hülle trägt kein line-clamp (sonst hinge die Messung wieder an ihr)
    const huelle = tags(notiz, 'span').find(t => /\btitle=\{text\}/.test(t))
    assert.ok(huelle, 'Hülle fehlt')
    assert.doesNotMatch(huelle, /line-clamp/)
  })

  test('Knopf nur per Rolle, Fokus und Tastatur – aufgeklappt bleibt er zum Zuklappen', () => {
    const huelle = tags(notiz, 'span').find(t => /\btitle=\{text\}/.test(t))
    const k = /role=\{(\w+) \? 'button' : undefined\}/.exec(huelle)?.[1]
    assert.ok(k, 'role="button" hängt an keiner Bedingung')
    // Rolle, Fokus, Zustand, Klick und Tastatur hängen an derselben Bedingung
    assert.match(huelle, new RegExp(`tabIndex=\\{${k} \\? 0 : undefined\\}`))
    assert.match(huelle, new RegExp(`aria-expanded=\\{${k} \\? offen : undefined\\}`))
    assert.match(huelle, new RegExp(`onClick=\\{${k} \\? `))
    assert.match(huelle, new RegExp(`onKeyDown=\\{${k} \\? `))
    assert.match(huelle, /e\.key === 'Enter' \|\| e\.key === ' '/)
    // … und die ist „aufgeklappt oder abgeschnitten“
    assert.match(notiz, new RegExp(`const ${k} = (?:offen \\|\\| abgeschnitten|abgeschnitten \\|\\| offen)\\b`))
    // Aufgeklappt wird nicht gemessen, sonst verschwände der Knopf zum Zuklappen
    assert.match(notiz, /if \((?:!el \|\| offen|offen \|\| !el)\) return/)
  })
})
