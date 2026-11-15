// Weinshop-Anbindung (KAN-462, 15.11.2026): Weindaten eines Shop-Produkts – Meta-Felder und fertiger Block.
// Rein (ohne Datenbank), damit Vorschau, Übertragung und Tests denselben Inhalt erzeugen.
//
// Entscheidungen Jörgen 15.11.2026 (Plan KAN-462):
//   * nur eigene Meta-Felder mit dem Präfix `s112_` – keine Produktattribute (WooCommerce ersetzt beim Schreiben die
//     ganze Attributliste), Titel, Texte, Bilder, Preise und Kategorien bleiben unberührt;
//   * fehlende Werte werden weggelassen: das Meta-Feld wird geleert (''), nie als 0 übertragen;
//   * `s112_weindaten_html` ist der fertige Block für die Produktvorlage des Shops (ohne Skripte, Werte maskiert).
import { createHash } from 'node:crypto'
// @ts-expect-error TS5097 – .ts-Endung für node:test (ohne Bundler)
import { zahlLokal } from '../format.ts'

export type Weindaten = {
  jahrgang: number | null
  rebsorte: string | null
  ried: string | null
  herkunft: string | null
  qualitaet: string | null
  alkoholVol: number | null
  restzuckerGl: number | null
  saeureGl: number | null
  /** Allergene in Klartext („Sulfite“, „Ei“, „Milch“) */
  allergene: string[]
  energieKj: number | null
  energieKcal: number | null
  /** Öffentlicher Link des freigegebenen E-Labels; null = kein freigegebenes E-Label */
  elabelUrl: string | null
}

/** Ried, wenn alle Herkunftsanteile dieselbe Ried nennen (Summe 100 %); sonst null */
export function einzigeRied(anteile: readonly { weingarten_name: string | null; anteil_pct: number }[]): string | null {
  const mit = anteile.filter(a => a.anteil_pct > 0)
  if (mit.length === 0) return null
  const namen = new Set(mit.map(a => (a.weingarten_name ?? '').trim()))
  if (namen.size !== 1) return null
  const [name] = [...namen]
  return name || null
}

export const META_PRAEFIX = 's112_'
export const META_HTML = 's112_weindaten_html'
export const META_STAND = 's112_stand'

export type MetaFeld = { key: string; value: string }

const zahl = (n: number | null, stellen: number): string =>
  n === null || !Number.isFinite(n) ? '' : zahlLokal(n, { minimumFractionDigits: 0, maximumFractionDigits: stellen, useGrouping: false })

const text = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

export function htmlMaskiert(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Zeilen des Blocks: Beschriftung und Wert – nur vorhandene Werte */
export function weindatenZeilen(d: Weindaten): { name: string; wert: string }[] {
  const z: { name: string; wert: string }[] = []
  const dazu = (name: string, wert: string) => { if (wert) z.push({ name, wert }) }
  dazu('Jahrgang', d.jahrgang === null ? '' : String(d.jahrgang))
  dazu('Rebsorte', text(d.rebsorte))
  dazu('Ried', text(d.ried))
  dazu('Herkunft', text(d.herkunft))
  dazu('Qualitätsstufe', text(d.qualitaet))
  dazu('Alkohol', d.alkoholVol === null ? '' : `${zahl(d.alkoholVol, 1)} % vol`)
  dazu('Restzucker', d.restzuckerGl === null ? '' : `${zahl(d.restzuckerGl, 1)} g/l`)
  dazu('Säure', d.saeureGl === null ? '' : `${zahl(d.saeureGl, 1)} g/l`)
  dazu('Brennwert je 100 ml', d.energieKj === null || d.energieKcal === null ? '' : `${zahl(d.energieKj, 0)} kJ / ${zahl(d.energieKcal, 0)} kcal`)
  return z
}

/** Fertiger Block für die Produktseite: Tabelle der Werte, Allergenhinweis, Link aufs E-Label. Leer, wenn es nichts gibt. */
export function weindatenHtml(d: Weindaten): string {
  const zeilen = weindatenZeilen(d)
  const allergene = d.allergene.map(text).filter(Boolean)
  const link = d.elabelUrl && /^https:\/\//.test(d.elabelUrl) ? d.elabelUrl : null
  if (zeilen.length === 0 && allergene.length === 0 && !link) return ''
  const teile = ['<div class="s112-weindaten">']
  if (zeilen.length > 0) {
    teile.push('<table class="s112-weindaten-tabelle"><tbody>')
    for (const z of zeilen) teile.push(`<tr><th scope="row">${htmlMaskiert(z.name)}</th><td>${htmlMaskiert(z.wert)}</td></tr>`)
    teile.push('</tbody></table>')
  }
  if (allergene.length > 0) teile.push(`<p class="s112-weindaten-allergene">Enthält <strong>${htmlMaskiert(allergene.join(', '))}</strong></p>`)
  if (link) teile.push(`<p class="s112-weindaten-elabel"><a href="${htmlMaskiert(link)}" rel="noopener">Nährwerte und Zutaten</a></p>`)
  teile.push('</div>')
  return teile.join('')
}

/**
 * Alle Meta-Felder – immer vollständig, ein fehlender Wert als '' (leert das Feld im Shop). Zahlen mit Dezimalpunkt
 * (maschinenlesbar), der Block in `s112_weindaten_html` mit Dezimalkomma. `stand` = Tag der Übertragung (JJJJ-MM-TT).
 */
export function weindatenMeta(d: Weindaten, stand: string): MetaFeld[] {
  const n = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : String(v))
  return [
    { key: 's112_jahrgang', value: d.jahrgang === null ? '' : String(d.jahrgang) },
    { key: 's112_rebsorte', value: text(d.rebsorte) },
    { key: 's112_ried', value: text(d.ried) },
    { key: 's112_herkunft', value: text(d.herkunft) },
    { key: 's112_qualitaet', value: text(d.qualitaet) },
    { key: 's112_alkohol_vol', value: n(d.alkoholVol) },
    { key: 's112_restzucker_gl', value: n(d.restzuckerGl) },
    { key: 's112_saeure_gl', value: n(d.saeureGl) },
    { key: 's112_allergene', value: d.allergene.map(text).filter(Boolean).join(', ') },
    { key: 's112_energie_kj', value: n(d.energieKj) },
    { key: 's112_energie_kcal', value: n(d.energieKcal) },
    { key: 's112_elabel_url', value: d.elabelUrl && /^https:\/\//.test(d.elabelUrl) ? d.elabelUrl : '' },
    { key: META_HTML, value: weindatenHtml(d) },
    { key: META_STAND, value: stand },
  ]
}

/** Prüfsumme des Inhalts (ohne den Tag der Übertragung) – zeigt, ob sich seit der letzten Übertragung etwas geändert hat */
export function weindatenPruefsumme(d: Weindaten): string {
  const inhalt = weindatenMeta(d, '').filter(m => m.key !== META_STAND).map(m => `${m.key}=${m.value}`).join('\n')
  return createHash('sha256').update(inhalt, 'utf8').digest('hex').slice(0, 32)
}

export type WeindatenStand = 'nie' | 'aktuell' | 'geaendert' | 'fehler'

/** Stand je Zuordnung aus dem gespeicherten letzten Stand und dem heutigen Inhalt */
export function weindatenStand(z: { weindaten_am: string | null; weindaten_pruefsumme: string | null; weindaten_fehler: string | null }, heute: string | null): WeindatenStand {
  if (z.weindaten_fehler) return 'fehler'
  if (!z.weindaten_am || !z.weindaten_pruefsumme) return 'nie'
  return heute !== null && heute !== z.weindaten_pruefsumme ? 'geaendert' : 'aktuell'
}
