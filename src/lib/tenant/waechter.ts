// ── Betriebs-Wächter: gemeinsame Logik (KAN-30, 25.09.2026) ───────────────────
//
// Der aktive Betrieb steht browserweit im Cookie s112_active_tenant (lib/auth/activeTenant.ts).
// Wechselt ein Tab den Betrieb, schrieben Server Actions eines anderen, noch offenen Tabs bisher
// in den NEUEN Betrieb, obwohl dieser den alten anzeigt (Rechnungsnummernkreis, Lagerabbuchung,
// E&A-Buchung im falschen Betrieb). Schutz in drei Schichten:
//
//  1. Melden:   Jede Seite des Arbeitsbereichs meldet beim Laden den Betrieb, mit dem sie
//               gerendert wurde, über BroadcastChannel(BETRIEB_KANAL) (ohne BroadcastChannel:
//               storage-Ereignis). Ein frisch gerenderter Tab zeigt immer den Betrieb des
//               Cookies – damit ist jeder Wechselweg abgedeckt, der im Arbeitsbereich landet
//               (Betriebsauswahl, /auth/betrieb, neuer Mandant, Anmeldung …). Wechselwege, die
//               außerhalb landen (/abo, /zwei-faktor, /betrieb-waehlen), senden eine Prüf-Meldung
//               ohne Betrieb (BetriebsPruefMelder) – die anderen Tabs fragen dann selbst nach.
//  2. Erkennen: Meldung bzw. Rückkehr in den Tab (visibilitychange/focus/pageshow)
//               → GET /api/betrieb/aktiv; weicht der Betrieb ab, sperrt components/BetriebsWaechter.tsx
//               den Tab bis zum Neuladen.
//  3. Ablehnen: Schreibende Anfragen (Server Actions, POST/PUT/PATCH/DELETE an /api) tragen den
//               Betrieb der Seite im Header SEITEN_BETRIEB_HEADER; Server Actions und API-Routen
//               lehnen ab, wenn er nicht zum Cookie passt (lib/auth/seitenBetrieb.ts).
//
// Bewusst ohne Server- und React-Importe: genutzt von Client, Server und node:test
// (scripts/tests/betriebswaechter.test.mjs).

export const BETRIEB_KANAL = 's112-betrieb'
/** localStorage-Schlüssel für das storage-Ereignis, falls BroadcastChannel fehlt */
export const BETRIEB_SPEICHER_KEY = 's112-betrieb-meldung'
/** Betrieb der Seite an schreibenden Anfragen (Kleinbuchstaben: so liefert ihn headers()) */
export const SEITEN_BETRIEB_HEADER = 'x-s112-seiten-betrieb'
/** Meldung der Server Actions, wenn die Seite zu einem anderen Betrieb gehört als das Cookie */
export const BETRIEB_GEWECHSELT_MELDUNG = 'Der Betrieb wurde in einem anderen Tab gewechselt – bitte Seite neu laden.'
/** Datenattribut am <html>, solange der Tab gesperrt ist – Befehlspalette und AutoRefresh ruhen dann */
export const SPERRE_ATTRIBUT = 'data-s112-betriebssperre'
/** Ereignis an window beim Sperren (z. B. offene Befehlspalette schließen) */
export const SPERRE_EREIGNIS = 's112:betriebssperre'

const MELDUNG_TYP = 's112-betrieb-aktiv'
const PRUEF_TYP = 's112-betrieb-pruefen'
const MAX_ID_LAENGE = 100
const MAX_NAME_LAENGE = 200

/** mandant = tenants.name – unterscheidet Betriebe mit gleichem (frei wählbarem) Anzeigenamen */
export type Betrieb = { tenantId: string; name: string; mandant?: string }
export type BetriebsMeldung = Betrieb & { typ: typeof MELDUNG_TYP; tab: string; zeit: number }
/** „Bitte aktiven Betrieb prüfen“ – von Seiten außerhalb des Arbeitsbereichs (ohne Betrieb) */
export type PruefMeldung = { typ: typeof PRUEF_TYP; tab: string; zeit: number }
/** Warum geprüft wird: Rückkehr in den Tab (gedrosselt), Meldung eines anderen Tabs, Zurück-Cache */
export type PruefAnlass = 'rueckkehr' | 'meldung' | 'erzwingen'
export type AbfrageErgebnis = { ok: true; aktiv: Betrieb | null } | { ok: false }

function id(v: unknown): string | null {
  return typeof v === 'string' && v.trim() && v.length <= MAX_ID_LAENGE ? v.trim() : null
}

function name(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, MAX_NAME_LAENGE) : ''
}

function betriebAus(tenantId: string, m: Record<string, unknown>): Betrieb {
  const mandant = name(m.mandant)
  return mandant ? { tenantId, name: name(m.name), mandant } : { tenantId, name: name(m.name) }
}

/** Ist dieser Tab gerade gesperrt? (Befehlspalette, AutoRefresh) */
export function istTabGesperrt(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(SPERRE_ATTRIBUT)
}

/** Meldung „dieser Tab zeigt Betrieb X“ für BroadcastChannel bzw. localStorage */
export function meldungBauen(betrieb: Betrieb, tab: string, zeit: number = Date.now()): BetriebsMeldung {
  const m: BetriebsMeldung = { typ: MELDUNG_TYP, tenantId: betrieb.tenantId, name: betrieb.name, tab, zeit }
  if (betrieb.mandant) m.mandant = betrieb.mandant
  return m
}

/** Meldung „bitte aktiven Betrieb prüfen“ (ohne Betrieb) */
export function pruefMeldungBauen(tab: string, zeit: number = Date.now()): PruefMeldung {
  return { typ: PRUEF_TYP, tab, zeit }
}

/** Empfangene Meldung prüfen (Objekt aus BroadcastChannel oder JSON aus dem storage-Ereignis) */
export function meldungLesen(roh: unknown): BetriebsMeldung | PruefMeldung | null {
  let wert = roh
  if (typeof wert === 'string') {
    try { wert = JSON.parse(wert) } catch { return null }
  }
  if (!wert || typeof wert !== 'object') return null
  const m = wert as Record<string, unknown>
  const tab = id(m.tab)
  if (!tab) return null
  const zeit = typeof m.zeit === 'number' ? m.zeit : 0
  if (m.typ === PRUEF_TYP) return { typ: PRUEF_TYP, tab, zeit }
  if (m.typ !== MELDUNG_TYP) return null
  const tenantId = id(m.tenantId)
  if (!tenantId) return null
  return { typ: MELDUNG_TYP, ...betriebAus(tenantId, m), tab, zeit }
}

/** Nur Prüf-Meldung (ohne Betrieb)? */
export function istPruefMeldung(m: BetriebsMeldung | PruefMeldung): m is PruefMeldung {
  return m.typ === PRUEF_TYP
}

/** Antwort von GET /api/betrieb/aktiv; null = keine Aussage (abgemeldet, kein Betrieb, Unsinn) */
export function aktivAusAntwort(roh: unknown): Betrieb | null {
  if (!roh || typeof roh !== 'object') return null
  const m = roh as Record<string, unknown>
  const tenantId = id(m.tenantId)
  return tenantId ? betriebAus(tenantId, m) : null
}

/** Muss der Tab gesperrt werden? Nur bei einer eindeutigen, abweichenden Aussage. */
export function weichtAb(seitenBetrieb: string, gemeldet: Betrieb | null | undefined): boolean {
  return !!gemeldet && gemeldet.tenantId !== seitenBetrieb
}

/**
 * Jetzt beim Server nachfragen? Nie im gesperrten Tab. Rückkehr in den Tab (focus und
 * visibilitychange kommen meist paarweise, AutoRefresh lädt dabei ohnehin neu) höchstens alle
 * abstandMs und nie parallel; Meldungen anderer Tabs und der Zurück-Cache immer.
 */
export function abfrageStarten(p: {
  anlass: PruefAnlass; gesperrt: boolean; laeuft: boolean; zuletzt: number; jetzt: number; abstandMs: number
}): boolean {
  if (p.gesperrt) return false
  if (p.anlass !== 'rueckkehr') return true
  return !p.laeuft && p.jetzt - p.zuletzt >= p.abstandMs
}

/**
 * Ergebnis der Abfrage auswerten → Betrieb, auf den gewechselt wurde (Tab sperren), sonst null.
 * Die Antwort des Servers ist die Quelle der Wahrheit (auch gegen die Meldung eines gerade
 * veraltet geladenen Tabs). Nur wenn die Abfrage scheitert (offline, 401, HTML statt JSON),
 * zählt die abweichende Meldung eines anderen Tabs – ohne Meldung wird dann nicht gesperrt
 * (kein Fehlalarm im Einzel-Tab).
 */
export function sperrGrund(seitenBetrieb: string, ergebnis: AbfrageErgebnis, hinweis?: Betrieb | null): Betrieb | null {
  if (ergebnis.ok) return weichtAb(seitenBetrieb, ergebnis.aktiv) ? ergebnis.aktiv : null
  return hinweis && weichtAb(seitenBetrieb, hinweis) ? hinweis : null
}

/** Namen für den Sperrdialog; gleiche Anzeigenamen werden über den Mandantennamen unterschieden */
export function dialogNamen(seite: Betrieb, neu: Betrieb | null): { alt: string; neu: string | null } {
  const alt = seite.name || seite.mandant || 'Betrieb'
  if (!neu) return { alt, neu: null }
  const neuName = neu.name || neu.mandant || ''
  if (neuName && neuName !== alt) return { alt, neu: neuName }
  if (seite.mandant && neu.mandant && seite.mandant !== neu.mandant) return { alt: seite.mandant, neu: neu.mandant }
  return { alt, neu: null }
}

/**
 * Text des Sperrdialogs. ausAnderemTab = ein anderer Tab hat den Wechsel gemeldet (Wortlaut
 * KAN-30); sonst neutral – der Wechsel kann auch aus diesem Tab (Browser-Zurück) oder aus dem
 * Ablauf der Betriebsauswahl stammen.
 */
export function sperrText(ausAnderemTab: boolean, alt: string, neu: string | null): string {
  const wechsel = ausAnderemTab
    ? (neu ? `Der Betrieb wurde in einem anderen Tab auf ‚${neu}‘ gewechselt.` : 'Der Betrieb wurde in einem anderen Tab gewechselt.')
    : (neu ? `Der aktive Betrieb wurde inzwischen auf ‚${neu}‘ gewechselt (z. B. in einem anderen Tab oder Fenster).`
      : 'Der aktive Betrieb wurde inzwischen gewechselt (z. B. in einem anderen Tab oder Fenster).')
  return `${wechsel} Diese Seite zeigt noch ‚${alt}‘. Bitte neu laden, bevor Sie weiterarbeiten.`
}

/**
 * Serverseitig: passt der Betrieb der Seite (Header) zum aktiven Betrieb (Cookie)?
 * Fehlt die Angabe, gilt sie als passend (rückwärtskompatibel: ältere Seiten, Aufrufe ohne
 * Wächter, Skripte).
 */
export function seitenBetriebPasst(seitenBetrieb: string | null | undefined, aktiverBetrieb: string): boolean {
  const seite = (seitenBetrieb ?? '').trim()
  return !seite || seite === aktiverBetrieb
}

type RequestAehnlich = { url: string; method?: unknown; headers?: unknown }

function requestAehnlich(input: unknown): input is RequestAehnlich {
  return !!input && typeof input === 'object' && !(input instanceof URL) && typeof (input as { url?: unknown }).url === 'string'
}

function urlVon(input: unknown): string | null {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (requestAehnlich(input)) return input.url
  return null
}

/**
 * fetch-Argumente um den Betrieb der Seite ergänzen – für jede schreibende Anfrage (alles außer
 * GET/HEAD) an die eigene Herkunft: Server Actions (POST mit „Next-Action“, vom Next-Router über
 * das globale fetch geschickt) ebenso wie POST/PUT/PATCH/DELETE an /api (KI-Assistent, Import,
 * Export, Belege …). Routen, die den Header nicht prüfen, ignorieren ihn; fremde Herkünfte
 * (Supabase, Stripe) bekommen ihn nie. Rückgabe null = unverändert lassen.
 */
export function mitSeitenBetrieb(
  input: unknown,
  init: RequestInit | undefined,
  tenantId: string | null,
  origin: string,
): RequestInit | null {
  if (!tenantId) return null
  const req = requestAehnlich(input) ? input : null
  const methode = String(init?.method ?? (typeof req?.method === 'string' ? req.method : 'GET')).toUpperCase()
  if (methode === 'GET' || methode === 'HEAD') return null
  const url = urlVon(input)
  if (url === null) return null
  let ziel: URL
  try { ziel = new URL(url, origin) } catch { return null }
  if (ziel.origin !== origin) return null
  // init.headers ersetzt die Kopfzeilen eines Request-Objekts – daher von dort übernehmen
  const kopf = new Headers((init?.headers ?? req?.headers ?? undefined) as HeadersInit | undefined)
  kopf.set(SEITEN_BETRIEB_HEADER, tenantId)
  return { ...(init ?? {}), headers: kopf }
}

const HERKUNFT_PRUEFUNG = 'https://s112.invalid'

/** Protokollrelativ („//host“) oder mit Backslash – Browser lesen das als fremde Herkunft */
function fremdHerkunftFormat(pfad: string): boolean {
  return !pfad.startsWith('/') || pfad.startsWith('//') || pfad.includes('\\')
}

/**
 * Rücksprungziel für /auth/betrieb?weiter=… – nur relative Pfade der eigenen Anwendung
 * (kein offener Redirect: keine fremde Herkunft, kein „//host“, keine Steuerzeichen).
 * Geprüft wird VOR und NACH der URL-Normalisierung: Punktsegmente wie „/.//host“,
 * „/a/..//host“ oder „/%2e//host“ ergeben erst nach dem Auflösen „//host“.
 */
export function sichererWeiterPfad(roh: string | null | undefined): string | null {
  if (typeof roh !== 'string' || !roh || roh.length > 2000) return null
  if (fremdHerkunftFormat(roh) || /[\u0000-\u001f\u007f]/.test(roh)) return null
  let u: URL
  try { u = new URL(roh, HERKUNFT_PRUEFUNG) } catch { return null }
  if (u.origin !== HERKUNFT_PRUEFUNG) return null
  const ziel = u.pathname + u.search + u.hash
  if (fremdHerkunftFormat(ziel)) return null
  if (u.pathname.startsWith('/auth/')) return null   // keine Schleife über den Wechsel selbst
  return ziel
}

/** Stationen der Anmeldung – kein eigenes Ziel, sie reichen ihr eigenes `weiter` durch (KAN-78) */
const ANMELDE_STATIONEN = ['/', '/login', '/zwei-faktor', '/betrieb-waehlen', '/dashboard']

/**
 * KAN-78: Rücksprungziel, wenn der Proxy eine Anfrage auf /login bzw. /zwei-faktor umleitet – Pfad und Query der
 * angefragten Seite (z. B. ein gescannter QR-Code auf /kellerbuch/behaelter/<id>). Für die Stationen der Anmeldung
 * selbst deren eigenes `weiter` (Kette Login → Zwei-Faktor → Betriebswahl), sonst keins. Nur sichere relative Pfade.
 */
export function weiterFuerUmleitung(pathname: string, search: string): string | null {
  if (ANMELDE_STATIONEN.includes(pathname)) return sichererWeiterPfad(new URLSearchParams(search).get('weiter'))
  return sichererWeiterPfad(pathname + search)
}

/** KAN-78: Pfad mit `weiter`-Parameter – nur, wenn das Ziel ein sicherer relativer Pfad ist */
export function mitWeiter(pfad: string, weiter: string | null | undefined): string {
  const ziel = sichererWeiterPfad(weiter)
  if (!ziel) return pfad
  return `${pfad}${pfad.includes('?') ? '&' : '?'}weiter=${encodeURIComponent(ziel)}`
}

/** Link auf den regulären Wechselweg (Route Handler /auth/betrieb) */
export function wechselUrl(tenantId: string, weiter?: string | null): string {
  const p = new URLSearchParams({ tenant_id: tenantId })
  const ziel = sichererWeiterPfad(weiter)
  if (ziel) p.set('weiter', ziel)
  return `/auth/betrieb?${p.toString()}`
}
