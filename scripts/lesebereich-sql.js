#!/usr/bin/env node
// Erzeugt aus scripts/lesebereiche.json die Liste der Sperr-Policies „lesebereich“ (KAN-454, R2 zu KAN-412).
//
// Die Migration kan412b_lesebereich enthält genau diese Liste (zeilen()); der Test kan454-lesebereich vergleicht sie
// mit der Migration und mit dem DB-Test 02, damit Liste, Datenbank und Test nicht auseinanderlaufen.
//   • Tabelle mit tenant_id:      NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('<bereich>')))
//   • Kindtabelle ohne tenant_id: EXISTS (Elternzeile sichtbar) – die Elternzeile trägt die Sperre
//   • Freigaben (Gemeinschaften): beide Betriebe der Freigabe dürfen nicht gesperrt sein
//   • Bereich „allgemein“ und Sichten (security_invoker): keine Policy
// Aufruf: node scripts/lesebereich-sql.js   (gibt die VALUES-Zeilen aus)

const fs = require('fs')
const path = require('path')

/** [{ tabelle, bereich, art: 'tenant' | 'kind' | 'freigabe', eltern, spalte }] – sortiert nach Tabelle */
function zeilen(liste) {
  const sichten = new Set(liste.sichten ?? [])
  const freigaben = new Set(liste.freigaben ?? [])
  const kinder = liste.kinder ?? {}
  return Object.keys(liste.tabellen).sort()
    .filter(t => liste.tabellen[t] !== 'allgemein' && !sichten.has(t))
    .map(t => {
      const bereich = liste.tabellen[t]
      if (freigaben.has(t)) return { tabelle: t, bereich, art: 'freigabe', eltern: null, spalte: null }
      if (kinder[t]) return { tabelle: t, bereich, art: 'kind', eltern: kinder[t].eltern, spalte: kinder[t].spalte }
      return { tabelle: t, bereich, art: 'tenant', eltern: null, spalte: null }
    })
}

const q = v => (v === null ? 'NULL' : `'${v}'`)

/** VALUES-Zeilen für den DO-Block der Migration */
function werteSql(liste) {
  return zeilen(liste).map(z => `    (${q(z.tabelle)}, ${q(z.bereich)}, ${q(z.art)}, ${q(z.eltern)}, ${q(z.spalte)})`).join(',\n')
}

/** 'tabelle=bereich' je Tabelle mit Policy – für den DB-Test */
function sollListe(liste) {
  return zeilen(liste).map(z => `${z.tabelle}=${z.bereich}`)
}

module.exports = { zeilen, werteSql, sollListe }

if (require.main === module) {
  const liste = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'lesebereiche.json'), 'utf8'))
  console.log(werteSql(liste))
}
