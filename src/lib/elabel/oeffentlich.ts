// KAN-217 (07.10.2026): öffentliche E-Label-Seite – Adresse, Sprache und Beschriftungen (DE/EN).
// KAN-218 (08.10.2026): alle 24 EU-Amtssprachen (sprachen.ts, Begriffe uebersetzungen.ts, Zugriff texte.ts).
// Isomorph und ohne '@/'-Importe (node:test).
//
// Adresse: ist NEXT_PUBLIC_ELABEL_HOST gesetzt (Entscheidung Jörgen 06.10.2026: Domain hohenstein-partner.at, z. B.
// e.hohenstein-partner.at), lautet der Link https://<host>/<code> – der Proxy schreibt Anfragen an diesen Host auf /e/<code>
// um. Ohne Variable (bis DNS und Vercel-Domain stehen) zeigt der QR-Code auf <App>/e/<code>; diese Adresse bleibt auch
// danach gültig, gedruckte Etiketten funktionieren also weiter.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/elabel/eingabe.ts)
import { ELABEL_SPRACHEN, intlSprache, istSprache, type Sprache } from './sprachen.ts'
export type { Sprache } from './sprachen.ts'

/** Gültige E-Label-Kennung (CHECK elabels.code: 10 Zeichen ohne verwechselbare 0/O/1/I/L) */
export function istElabelCode(x: string): boolean {
  return /^[2-9A-HJKMNP-Z]{10}$/.test(x)
}

/** Host der E-Label-Domain (klein, ohne Port) oder null */
export function elabelHost(env: string | undefined = process.env.NEXT_PUBLIC_ELABEL_HOST): string | null {
  const h = (env ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return h || null
}

/** Öffentlicher Link eines E-Labels (für den QR-Code) */
export function elabelUrl(code: string, appBasis: string, host: string | null = elabelHost()): string {
  return host ? `https://${host}/${code}` : `${appBasis.replace(/\/+$/, '')}/e/${code}`
}

/** Pfad, auf den der Proxy eine Anfrage an den E-Label-Host umschreibt (null = nicht umschreiben) */
export function elabelRewritePfad(anfrageHost: string | null | undefined, pfad: string, host: string | null = elabelHost()): string | null {
  if (!host || !anfrageHost) return null
  if (anfrageHost.split(':')[0].toLowerCase() !== host) return null
  if (pfad.startsWith('/e/')) return null
  return pfad === '/' ? '/e' : `/e${pfad}`
}

/**
 * Sprache: ?lang=<Amtssprache> vor der Browsersprache (Accept-Language, erste EU-Amtssprache in der Reihenfolge des
 * Browsers). KAN-218: Browser ohne EU-Amtssprache (z. B. Japanisch) bekommen Englisch, ohne Angabe Deutsch.
 */
export function elabelSprache(lang: string | null | undefined, acceptLanguage: string | null | undefined): Sprache {
  const l = (lang ?? '').trim().toLowerCase()
  if (istSprache(l)) return l
  const bevorzugt = (acceptLanguage ?? '').split(',').map(s => s.trim().split(';')[0].toLowerCase()).filter(b => b && b !== '*')
  for (const b of bevorzugt) {
    const code = b.split('-')[0]
    if (istSprache(code)) return code
  }
  return bevorzugt.length > 0 ? 'en' : 'de'
}

/** Alle Sprachen für den Umschalter (Reihenfolge wie die Liste der Amtssprachen) */
export const ELABEL_SPRACHLISTE: readonly Sprache[] = ELABEL_SPRACHEN

export type TextSchluessel =
  | 'titel' | 'zutaten' | 'naehrwerte' | 'je100' | 'energie' | 'fett' | 'gesaettigt' | 'kohlenhydrate' | 'zucker'
  | 'eiweiss' | 'salz' | 'alkohol' | 'enthaelt' | 'geringfuegig' | 'allergenHinweis' | 'nichtGefunden' | 'sprache'

/** Deutsch/Englisch; sprache = Name der Sprache in ihr selbst (Umschalter). Übrige Sprachen: uebersetzungen.ts */
export const TEXTE: Record<'de' | 'en', Record<TextSchluessel, string>> = {
  de: {
    titel: 'Zutaten und Nährwerte', zutaten: 'Zutatenliste', naehrwerte: 'Nährwertdeklaration', je100: 'je 100 ml',
    energie: 'Brennwert', fett: 'Fett', gesaettigt: 'davon gesättigte Fettsäuren', kohlenhydrate: 'Kohlenhydrate',
    zucker: 'davon Zucker', eiweiss: 'Eiweiß', salz: 'Salz', alkohol: 'Alkohol', enthaelt: 'Enthält',
    geringfuegig: 'Enthält geringfügige Mengen von', allergenHinweis: 'Allergene sind fett hervorgehoben.',
    nichtGefunden: 'Dieses E-Label gibt es nicht oder es ist nicht freigegeben.', sprache: 'Deutsch',
  },
  en: {
    titel: 'Ingredients and nutrition', zutaten: 'List of ingredients', naehrwerte: 'Nutrition declaration', je100: 'per 100 ml',
    energie: 'Energy', fett: 'Fat', gesaettigt: 'of which saturates', kohlenhydrate: 'Carbohydrate',
    zucker: 'of which sugars', eiweiss: 'Protein', salz: 'Salt', alkohol: 'Alcohol', enthaelt: 'Contains',
    geringfuegig: 'Contains negligible amounts of', allergenHinweis: 'Allergens are shown in bold.',
    nichtGefunden: 'This e-label does not exist or has not been released.', sprache: 'English',
  },
}

/**
 * „Enthält geringfügige Mengen von …“ (VO 1169/2011 Art. 34 Abs. 5) – in manchen Sprachen steht die Aufzählung
 * mitten im Satz (amtliche Vorlage mit „…“, z. B. LT, GA, HU), sonst dahinter.
 */
export function geringfuegigSatz(vorlage: string, liste: string): string {
  return vorlage.includes('…') ? `${vorlage.replace('…', liste)}.` : `${vorlage} ${liste}.`
}

/** Zahl für die Anzeige im Format der Sprache (Komma im Deutschen, Punkt im Englischen …) */
export function zahlText(wert: number, stellen: number, sprache: Sprache): string {
  return wert.toLocaleString(intlSprache(sprache), { minimumFractionDigits: stellen, maximumFractionDigits: stellen })
}

/**
 * KAN-219: Umleitung eines gedruckten QR-Codes folgen – vom Start-E-Label über umleitung_auf bis zum letzten
 * freigegebenen Ziel (höchstens `max` Schritte, Schleifen werden abgebrochen). Ein nicht (mehr) freigegebenes oder
 * fehlendes Ziel beendet die Kette beim letzten gültigen E-Label.
 */
export async function folgeUmleitung<T extends { id: string; umleitung_auf: string | null }>(
  start: T, ladeFreigegeben: (id: string) => Promise<T | null>, max = 5,
): Promise<T> {
  let aktuell = start
  const gesehen = new Set([start.id])
  for (let i = 0; i < max && aktuell.umleitung_auf; i++) {
    if (gesehen.has(aktuell.umleitung_auf)) break
    const ziel = await ladeFreigegeben(aktuell.umleitung_auf)
    if (!ziel) break
    gesehen.add(ziel.id)
    aktuell = ziel
  }
  return aktuell
}

/** KAN-219: Grund der Umleitung – Pflicht, mindestens 10 Zeichen (wie die RPC); null = in Ordnung */
export function umleitungGrundFehler(grund: string): string | null {
  return grund.trim().length < 10 ? 'Bitte einen Grund für die Umleitung angeben (mindestens 10 Zeichen).' : null
}
