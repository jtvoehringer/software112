// ── Zurück-Navigation (KAN-224, 07.10.2026) ──
//
// Rückmeldung Jörgen 07.10.2026: Nach Abschluss eines Vorgangs (Speichern, Abbrechen, Buchen) immer dorthin zurück,
// woher man kam – z. B. in die Kellerbuch-Übersicht –, und auf jeder Unterseite ein „Zurück“-Knopf.
// Muster: Wer einen Vorgang öffnet, hängt die eigene Seite als `zurueck=<relativer Pfad>` an (mitZurueck). Formular
// bzw. Server Action übernehmen das Ziel nur als sicheren relativen Pfad innerhalb der App (sicheresZiel – kein offener
// Redirect: nichts mit Schema, „//“ oder Backslash) und fallen sonst auf einen Standard je Bereich zurück.
// Die Bestätigung nach dem Abschluss reist als `erledigt=<Schlüssel>` mit; der Text kommt aus ERLEDIGT_TEXT (kein
// beliebiger Text aus der URL). Isomorph, ohne '@/'-Importe.

/** Name des Such-Parameters für das Rückkehr-Ziel */
export const ZURUECK_PARAM = 'zurueck'
/** Name des Such-Parameters für die Bestätigung nach dem Abschluss */
export const ERLEDIGT_PARAM = 'erledigt'

/**
 * Sicheres Rückkehr-Ziel: nur ein relativer Pfad der App („/kellerbuch?tab=x“), sonst `standard`.
 * Abgelehnt: leer, ohne führendes „/“, „//“ (protokollrelativ), Backslash, Steuerzeichen, Schema („/javascript:“ ist
 * als Pfad harmlos, „javascript:…“ ohne „/“ fällt schon weg), API-Routen und der öffentliche Login-Bereich.
 */
export function sicheresZiel(ziel: unknown, standard: string): string {
  if (typeof ziel !== 'string') return standard
  const t = ziel.trim()
  if (!t.startsWith('/') || t.startsWith('//') || t.includes('\\')) return standard
  if (/[\u0000-\u001f\u007f]/.test(t)) return standard
  if (/^\/(api|auth|login)(\/|\?|$)/.test(t)) return standard
  if (t.length > 500) return standard
  return t
}

/** Pfad mit Such-Parameter ergänzen bzw. ersetzen (relativ, ohne Ursprung) */
function mitParam(pfad: string, name: string, wert: string | null): string {
  const [ohneHash, hash] = pfad.split('#', 2)
  const [basis, query] = ohneHash.split('?', 2)
  const p = new URLSearchParams(query ?? '')
  if (wert === null) p.delete(name)
  else p.set(name, wert)
  const q = p.toString()
  return `${basis}${q ? `?${q}` : ''}${hash ? `#${hash}` : ''}`
}

/** Link zu einem Vorgang, der danach auf `zurueck` zurückführt (`zurueck` null/unsicher: Link unverändert) */
export function mitZurueck(href: string, zurueck: string | null | undefined): string {
  if (!zurueck) return href
  const z = sicheresZiel(zurueck, '')
  return z ? mitParam(href, ZURUECK_PARAM, z) : href
}

/** Bestätigungen nach dem Abschluss – Schlüssel in der URL, Text nur von hier */
export const ERLEDIGT_TEXT: Readonly<Record<string, string>> = {
  gespeichert: 'Gespeichert.',
  angelegt: 'Angelegt.',
  storniert: 'Storniert.',
  umzug: 'Umzug gebucht.',
  abfuellung: 'Abfüllung gebucht.',
  verschnitt: 'Verschnitt gebucht.',
  abstufung: 'Abstufung gebucht.',
  verarbeitung: 'Verarbeitung gebucht.',
  zugang: 'Zugangskorrektur gebucht.',
  schwund: 'Schwund gebucht.',
  verkauf: 'Verkauf gespeichert.',
  zukauf: 'Zukauf gebucht.',
  pressung: 'Pressung gespeichert.',
  abgebrochen: 'Abgebrochen – nichts geändert.',
}

/** Ziel nach dem Abschluss: sicheres Rückkehr-Ziel mit Bestätigung (Schlüssel aus ERLEDIGT_TEXT, sonst ohne) */
export function zielNachAbschluss(zurueck: unknown, standard: string, erledigt?: keyof typeof ERLEDIGT_TEXT | null): string {
  const z = sicheresZiel(zurueck, standard)
  const ohneAlt = mitParam(mitParam(z, ERLEDIGT_PARAM, null), ZURUECK_PARAM, null)
  return erledigt && ERLEDIGT_TEXT[erledigt] ? mitParam(ohneAlt, ERLEDIGT_PARAM, String(erledigt)) : ohneAlt
}

/** Text zur Bestätigung aus dem Such-Parameter (unbekannte Schlüssel: null) */
export function erledigtText(schluessel: string | null | undefined): string | null {
  return schluessel && Object.prototype.hasOwnProperty.call(ERLEDIGT_TEXT, schluessel) ? ERLEDIGT_TEXT[schluessel] : null
}

// ── Seitenverlauf des Tabs (sessionStorage) ─────────────────────────────────────────────────────────────────
// document.referrer bleibt bei Client-Navigation (Next.js) auf der Einstiegsseite stehen – deshalb führt der App-Rahmen
// einen eigenen Verlauf (NavVerlauf). Reine Funktionen, damit sie ohne Browser testbar sind.

export const VERLAUF_SCHLUESSEL = 's112_verlauf'
const VERLAUF_MAX = 30

const nurPfad = (eintrag: string) => eintrag.split(/[?#]/, 1)[0]

/** Verlauf nach einem Seitenwechsel: gleiche Seite (auch nur andere Parameter) ersetzt, Rückweg kürzt, sonst anhängen */
export function verlaufNach(verlauf: readonly string[], eintrag: string): string[] {
  const z = sicheresZiel(eintrag, '')
  if (!z) return [...verlauf]
  const v = [...verlauf]
  if (v.length > 0 && nurPfad(v[v.length - 1]) === nurPfad(z)) { v[v.length - 1] = z; return v }
  if (v.length > 1 && nurPfad(v[v.length - 2]) === nurPfad(z)) { v.pop(); v[v.length - 1] = z; return v }
  v.push(z)
  return v.slice(-VERLAUF_MAX)
}

/** Vorherige Seite (anderer Pfad als die aktuelle) aus dem Verlauf; null, wenn keine bekannt */
export function vorherigeSeite(verlauf: readonly string[], aktuell: string): string | null {
  const p = nurPfad(aktuell)
  for (let i = verlauf.length - 1; i >= 0; i--) {
    if (nurPfad(verlauf[i]) !== p) return mitParam(verlauf[i], ERLEDIGT_PARAM, null)
  }
  return null
}

// ── Ziel nach dem Speichern: nur im selben Bereich (KAN-334, 13.10.2026) ──────────────────────────────────────
// Rückmeldung Jörgen 13.10.2026: nach „Speichern“ im gleichen Bereich bleiben, nicht willkürlich abspringen. Die
// vorherige Seite im Verlauf war oft das Dashboard, der Kellerplan oder die Seite, auf der Strg K geöffnet wurde.
// Regel: Die vorherige Seite ist nur Ziel, wenn sie im selben Bereich (Hauptreiter der Navigation) liegt wie das
// Formular; sonst die Liste des Bereichs (`standard`). Ein ausdrücklicher zurueck-Parameter (mitZurueck an einem
// bewusst bereichsübergreifenden Einstieg, z. B. Charge → Füllung) gilt immer.

/** Bereich der Navigation (Hauptreiter) mit den Pfaden seiner Seiten */
export type Bereich = { key: string; hrefs: readonly string[] }

/** Bereich eines Pfads: der Bereich mit dem längsten passenden Navigationspfad (gleich lang: der erste); sonst null */
export function bereichVon(bereiche: readonly Bereich[], pfad: string): string | null {
  const p = nurPfad(pfad).replace(/\/+$/, '') || '/'
  let best: { key: string; len: number } | null = null
  for (const b of bereiche) {
    for (const roh of b.hrefs) {
      const h = nurPfad(roh).replace(/\/+$/, '') || '/'
      if (h === '/') continue
      if ((p === h || p.startsWith(`${h}/`)) && (!best || h.length > best.len)) best = { key: b.key, len: h.length }
    }
  }
  return best?.key ?? null
}

/**
 * Ziel nach dem Speichern: `herkunft` (vorherige Seite), wenn sie im selben Bereich liegt wie das Formular
 * (`aktuell`, ersatzweise `standard`), sonst `standard`.
 */
export function zielImBereich(bereiche: readonly Bereich[], herkunft: string | null, aktuell: string, standard: string): string {
  if (!herkunft) return standard
  const formular = bereichVon(bereiche, aktuell) ?? bereichVon(bereiche, standard)
  return formular !== null && bereichVon(bereiche, herkunft) === formular ? herkunft : standard
}

/**
 * Übergeordnete Seite laut Navigation: der längste Navigationspunkt, unter dem der Pfad liegt; null, wenn der Pfad
 * selbst ein Navigationspunkt ist (Hauptseite – dort kein „Zurück“).
 */
export function elternZiel(navHrefs: readonly string[], pfad: string): string | null {
  const p = nurPfad(pfad).replace(/\/+$/, '') || '/'
  const hrefs = navHrefs.map(h => nurPfad(h).replace(/\/+$/, '') || '/')
  if (hrefs.includes(p) || p === '/' || p === '/dashboard') return null
  const passend = hrefs.filter(h => h !== '/' && (p.startsWith(`${h}/`))).sort((a, b) => b.length - a.length)
  if (passend.length > 0) return passend[0]
  const bereich = `/${p.split('/')[1] ?? ''}`
  return hrefs.find(h => h === bereich || h.startsWith(`${bereich}`)) ?? '/dashboard'
}
