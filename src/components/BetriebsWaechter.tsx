'use client'

// ── Betriebs-Wächter (KAN-30, 25.09.2026) ─────────────────────────────────────
// Sicherheitsnetz gegen Betriebswechsel in einem anderen Tab: Alle Tabs eines Browsers teilen
// sich den aktiven Betrieb (Cookie). Das (dashboard)-Layout übergibt hier den Betrieb, mit dem
// die Seite gerendert wurde; weicht der aktive Betrieb davon ab, wird der Tab gesperrt, bis er
// neu geladen ist. Logik, Entscheidungen und Nachrichtenformat: lib/tenant/waechter.ts.
//
//  - Melden: beim Laden „dieser Tab zeigt Betrieb X“ über BroadcastChannel (Fallback storage).
//    Seiten außerhalb des Arbeitsbereichs, auf denen ein Wechsel landen kann (/abo,
//    /zwei-faktor, /betrieb-waehlen), senden mit <BetriebsPruefMelder /> „bitte prüfen“.
//  - Erkennen: Meldung eines anderen Tabs → Gegenprobe über GET /api/betrieb/aktiv (Quelle der
//    Wahrheit, schützt vor der Meldung eines gerade veraltet geladenen Tabs); Rückkehr in den Tab
//    (visibilitychange/focus, höchstens alle 15 s wie AutoRefresh; pageshow aus dem Zurück-Cache)
//    → dieselbe Abfrage. Kein Takt – nur ohne BroadcastChannel alle 60 s bei sichtbarem Tab.
//  - Layout mit anderem Betrieb neu gerendert (router.refresh/AutoRefresh nach einem Wechsel):
//    sofort sperren – Formular- und Client-Zustand gehören noch zum alten Betrieb.
//  - Schreibende Anfragen: Header mit dem Betrieb der Seite (siehe lib/auth/seitenBetrieb.ts).
//  - Nur-Lesen-Modus (KAN-5): Mit schreibgesperrt=true (Abo gesperrt) schickt derselbe
//    fetch-Wrapper schreibende API- und Supabase-Anfragen gar nicht erst ab, sondern antwortet
//    sofort mit der Meldung des Servers; Server Actions gehen an den Server (Formular bekommt
//    seine gewohnte Antwort), ihre Antwort wird nur mitgelesen. Bei einer Ablehnung meldet er
//    NUR_LESEN_EREIGNIS (Hinweis: components/NurLesenHinweis.tsx). Welche Anfragen, in welcher
//    Form: lib/abo/nurLesen.ts. Die Sperre selbst bleibt der Server bzw. die Datenbank.
// Einmal gesperrt bleibt gesperrt (auch wenn der Betrieb zurückgewechselt wird). Solange die
// Sperre steht, trägt <html> das Attribut SPERRE_ATTRIBUT: AutoRefresh lädt dann keine Daten des
// anderen Betriebs unter die Überlagerung, die Befehlspalette (Strg K) bleibt zu.
// Ein einzelner Tab verhält sich unverändert: keine Anzeige, keine Abfrage beim Laden.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight } from 'lucide-react'
import { useDialog } from '@/components/ui/useDialog'
import {
  BETRIEB_KANAL, BETRIEB_SPEICHER_KEY, SPERRE_ATTRIBUT, SPERRE_EREIGNIS,
  abfrageStarten, aktivAusAntwort, dialogNamen, istPruefMeldung, meldungBauen, meldungLesen,
  mitSeitenBetrieb, pruefMeldungBauen, sperrGrund, sperrText, wechselUrl, weichtAb,
  type AbfrageErgebnis, type Betrieb, type BetriebsMeldung, type PruefAnlass, type PruefMeldung,
} from '@/lib/tenant/waechter'
import {
  NUR_LESEN_EREIGNIS, anfragePfad, schreibAnfrageArt, sperrAntwort, sperrArtFuer, sperrArtImText, zurueckhalten,
  type NurLesenDetail, type SchreibAnfrage,
} from '@/lib/abo/nurLesen'

const PRUEF_ABSTAND_MS = 15_000       // wie AutoRefresh; focus und visibilitychange kommen meist paarweise
const FALLBACK_INTERVALL_MS = 60_000  // nur ohne BroadcastChannel

// ── Betrieb der Seite an schreibende Anfragen hängen ───────────────────────────
// Modulweit, weil der fetch-Wrapper außerhalb von React läuft; beim Verlassen des
// Arbeitsbereichs (Wächter entfernt) wieder null → kein Header.
let seitenBetrieb: string | null = null
// KAN-5: Nur-Lesen-Modus der Seite (Abo gesperrt) – ebenso modulweit, beim Verlassen false
let nurLesen = false
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null
const FETCH_MARKE = '__s112SeitenBetrieb'
type MarkiertesFetch = typeof fetch & { [FETCH_MARKE]?: true }

function nurLesenMelden(detail: NurLesenDetail) {
  try { window.dispatchEvent(new CustomEvent<NurLesenDetail>(NUR_LESEN_EREIGNIS, { detail })) } catch { /* Hinweis ist Zusatznutzen */ }
}

/** Art der schreibenden Anfrage im Nur-Lesen-Modus, sonst null (Anfrage unberührt) */
function nurLesenArt(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): SchreibAnfrage | null {
  if (!nurLesen) return null
  try { return schreibAnfrageArt(input, init, window.location.origin, SUPABASE_URL) } catch { return null /* im Zweifel absenden – der Server sperrt ohnehin */ }
}

/** Nur-Lesen-Modus: API-/Supabase-Schreibanfrage zurückhalten → fertige Antwort wie vom Server */
function nurLesenAntwort(art: Exclude<SchreibAnfrage, 'aktion'>, input: Parameters<typeof fetch>[0]): Response {
  const pfad = anfragePfad(input, window.location.origin)
  nurLesenMelden({ art, sperrArt: sperrArtFuer(art, pfad) })
  const a = sperrAntwort(art, pfad)
  return new Response(a.body, { status: a.status, headers: a.headers })
}

/**
 * Server Action im Nur-Lesen-Modus: wird abgeschickt (der Server antwortet in der Form, die das
 * Formular erwartet); eine Kopie der Antwort wird auf die Sperrmeldung geprüft → Hinweis.
 */
function actionMitlesen(antwort: Promise<Response>) {
  antwort.then(res => {
    let kopie: Response
    try { kopie = res.clone() } catch { return }
    kopie.text().then(text => {
      const sperrArt = sperrArtImText(text)
      if (sperrArt) nurLesenMelden({ art: 'aktion', sperrArt })
    }).catch(() => { /* Hinweis ist Zusatznutzen */ })
  }).catch(() => { /* Netzfehler meldet der Aufrufer selbst */ })
}

function fetchErweitern() {
  const original = window.fetch as MarkiertesFetch
  if (original[FETCH_MARKE]) return
  const erweitert: MarkiertesFetch = (input, init) => {
    const art = nurLesenArt(input, init)
    if (art && art !== 'aktion' && zurueckhalten(art)) return Promise.resolve(nurLesenAntwort(art, input))
    let neu: RequestInit | null = null
    try { neu = mitSeitenBetrieb(input, init, seitenBetrieb, window.location.origin) } catch { /* Anfrage nie am Wrapper scheitern lassen */ }
    const antwort = original.call(window, input, neu ?? init)
    if (art === 'aktion') actionMitlesen(antwort)
    return antwort
  }
  erweitert[FETCH_MARKE] = true
  window.fetch = erweitert
}

function tabKennung(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }
}

function kanalOeffnen(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null
  try { return new BroadcastChannel(BETRIEB_KANAL) } catch { return null }
}

function ueberSpeicherMelden(meldung: BetriebsMeldung | PruefMeldung) {
  try { localStorage.setItem(BETRIEB_SPEICHER_KEY, JSON.stringify(meldung)) } catch { /* privater Modus, Speicher gesperrt */ }
}

/**
 * „Bitte aktiven Betrieb prüfen“ an die Tabs des Arbeitsbereichs – für Seiten außerhalb von
 * (dashboard), auf denen ein Betriebswechsel landen kann, ohne dass ein Wächter ihn meldet
 * (/abo, Zwei-Faktor-Pflicht → /zwei-faktor, Betriebsauswahl).
 */
export function BetriebsPruefMelder() {
  useEffect(() => {
    const meldung = pruefMeldungBauen(tabKennung())
    const kanal = kanalOeffnen()
    if (kanal) {
      try { kanal.postMessage(meldung) } catch { /* Meldung ist Zusatznutzen */ }
    } else {
      ueberSpeicherMelden(meldung)
    }
    return () => { kanal?.close() }
  }, [])
  return null
}

type Sperre = { neu: Betrieb | null; ausAnderemTab: boolean }

export default function BetriebsWaechter({ tenantId, name, mandant, schreibgesperrt = false }: Betrieb & { schreibgesperrt?: boolean }) {
  // Betrieb, mit dem diese Seite geladen wurde – bleibt bis zum Neuladen fest
  const [seite] = useState<Betrieb>(() => (mandant ? { tenantId, name, mandant } : { tenantId, name }))
  const [sperre, setSperre] = useState<Sperre | null>(null)
  const [wechselt, setWechselt] = useState(false)
  const gesperrt = useRef(false)
  const letztePruefung = useRef(0)   // 0: die erste Rückkehr nach dem Laden fragt sofort nach
  const laeuft = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  const sperren = useCallback((neu: Betrieb | null, ausAnderemTab: boolean) => {
    if (gesperrt.current) return
    gesperrt.current = true
    setSperre({ neu, ausAnderemTab })
  }, [])

  /** Aktiven Betrieb beim Server erfragen; hinweis = abweichende Meldung eines anderen Tabs */
  const pruefen = useCallback(async (anlass: PruefAnlass, hinweis?: Betrieb) => {
    if (!abfrageStarten({
      anlass, gesperrt: gesperrt.current, laeuft: laeuft.current,
      zuletzt: letztePruefung.current, jetzt: Date.now(), abstandMs: PRUEF_ABSTAND_MS,
    })) return
    laeuft.current = true
    letztePruefung.current = Date.now()
    let ergebnis: AbfrageErgebnis = { ok: false }
    try {
      const res = await fetch('/api/betrieb/aktiv', { cache: 'no-store' })
      if (res.ok) ergebnis = { ok: true, aktiv: aktivAusAntwort(await res.json()) }
    } catch {
      // offline bzw. keine JSON-Antwort – ergebnis bleibt { ok: false }
    } finally {
      laeuft.current = false
    }
    const neu = sperrGrund(seite.tenantId, ergebnis, hinweis)
    if (neu) sperren(neu, anlass === 'meldung')
  }, [seite, sperren])

  // Header für schreibende Anfragen
  useEffect(() => {
    const eigener = seite.tenantId
    fetchErweitern()
    seitenBetrieb = eigener
    return () => { if (seitenBetrieb === eigener) seitenBetrieb = null }
  }, [seite])

  // Nur-Lesen-Modus (KAN-5): folgt dem Layout – nach Zahlung und Neuladen wieder frei
  useEffect(() => {
    fetchErweitern()
    nurLesen = schreibgesperrt
    return () => { nurLesen = false }
  }, [schreibgesperrt])

  // Melden und Meldungen anderer Tabs empfangen
  useEffect(() => {
    const tab = tabKennung()
    const meldung = meldungBauen(seite, tab)

    const empfangen = (roh: unknown) => {
      const m = meldungLesen(roh)
      if (!m || m.tab === tab) return
      if (istPruefMeldung(m)) { void pruefen('meldung'); return }
      if (weichtAb(seite.tenantId, m)) void pruefen('meldung', { tenantId: m.tenantId, name: m.name, mandant: m.mandant })
    }

    const kanal = kanalOeffnen()
    if (kanal) {
      kanal.onmessage = e => empfangen(e.data)
      try { kanal.postMessage(meldung) } catch { /* Meldung ist Zusatznutzen */ }
    }

    const onStorage = (e: StorageEvent) => { if (e.key === BETRIEB_SPEICHER_KEY && e.newValue) empfangen(e.newValue) }
    let intervall: number | undefined
    if (!kanal) {
      window.addEventListener('storage', onStorage)
      ueberSpeicherMelden(meldung)
      intervall = window.setInterval(() => { if (document.visibilityState === 'visible') void pruefen('rueckkehr') }, FALLBACK_INTERVALL_MS)
    }

    return () => {
      kanal?.close()
      window.removeEventListener('storage', onStorage)
      window.clearInterval(intervall)
    }
  }, [seite, pruefen])

  // Rückkehr in den Tab
  useEffect(() => {
    const sichtbar = () => { if (document.visibilityState === 'visible') void pruefen('rueckkehr') }
    const fokus = () => { void pruefen('rueckkehr') }
    const zurueckCache = (e: PageTransitionEvent) => { if (e.persisted) void pruefen('erzwingen') }
    document.addEventListener('visibilitychange', sichtbar)
    window.addEventListener('focus', fokus)
    window.addEventListener('pageshow', zurueckCache)
    return () => {
      document.removeEventListener('visibilitychange', sichtbar)
      window.removeEventListener('focus', fokus)
      window.removeEventListener('pageshow', zurueckCache)
    }
  }, [pruefen])

  // Layout mit anderem Betrieb neu gerendert (router.refresh/AutoRefresh nach Wechsel)
  useEffect(() => {
    if (weichtAb(seite.tenantId, { tenantId, name })) sperren(mandant ? { tenantId, name, mandant } : { tenantId, name }, false)
  }, [seite, tenantId, name, mandant, sperren])

  // Sperre signalisieren (AutoRefresh, Befehlspalette) und Hintergrund sperren: alles außer der
  // Überlagerung inert – auch später eingehängte Elemente
  useEffect(() => {
    if (!sperre) return
    const html = document.documentElement
    html.setAttribute(SPERRE_ATTRIBUT, '1')
    window.dispatchEvent(new Event(SPERRE_EREIGNIS))
    const eigen = overlayRef.current
    const gesetzt: HTMLElement[] = []
    const inert = (el: Element) => {
      if (el !== eigen && el instanceof HTMLElement && !el.inert) { el.inert = true; gesetzt.push(el) }
    }
    Array.from(document.body.children).forEach(inert)
    const beobachter = new MutationObserver(eintraege => eintraege.forEach(e => e.addedNodes.forEach(n => { if (n instanceof Element) inert(n) })))
    beobachter.observe(document.body, { childList: true })
    return () => {
      beobachter.disconnect()
      gesetzt.forEach(el => { el.inert = false })
      html.removeAttribute(SPERRE_ATTRIBUT)
    }
  }, [sperre])

  // Fokus in der Überlagerung halten; kein Schließen per Escape
  const dialog = useDialog(!!sperre, undefined, 'Betrieb gewechselt')

  if (!sperre) return null

  const namen = dialogNamen(seite, sperre.neu)
  const neuLaden = () => { setWechselt(true); window.location.reload() }
  const zurueck = () => {
    setWechselt(true)
    window.location.assign(wechselUrl(seite.tenantId, window.location.pathname + window.location.search + window.location.hash))
  }

  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-[1000] overflow-y-auto bg-black/50">
      <div className="min-h-full flex items-center justify-center p-4">
        <div {...dialog} role="alertdialog" aria-labelledby="betriebswaechter-titel" aria-describedby="betriebswaechter-text betriebswaechter-verlust"
          className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 focus:outline-none">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-s112-warn-bg text-s112-warn-fg flex items-center justify-center shrink-0" aria-hidden="true">
              <ArrowLeftRight size={20} strokeWidth={1.75} />
            </span>
            <h2 id="betriebswaechter-titel" className="text-lg font-semibold text-s112-text">Betrieb gewechselt</h2>
          </div>
          <p id="betriebswaechter-text" className="text-sm text-s112-text-1">
            {sperrText(sperre.ausAnderemTab, namen.alt, namen.neu)}
          </p>
          <p id="betriebswaechter-verlust" className="text-sm text-s112-text-1">
            Nicht gespeicherte Eingaben auf dieser Seite gehen dabei verloren.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={neuLaden} disabled={wechselt}
              className="flex-1 bg-s112-teal text-white py-2.5 px-4 rounded-xl font-semibold hover:bg-opacity-90 text-sm disabled:opacity-60">
              Neu laden
            </button>
            <button type="button" onClick={zurueck} disabled={wechselt}
              className="flex-1 py-2.5 px-4 rounded-xl border border-s112-border text-s112-text-2 hover:bg-s112-bg text-sm disabled:opacity-60">
              Zurück zu ‚{namen.alt}‘ wechseln
            </button>
          </div>
          <p className="text-xs text-s112-muted">
            Alle Tabs und Fenster dieses Browsers arbeiten im selben Betrieb – „Zurück … wechseln“ gilt daher für alle, andere
            offene Tabs werden dann ihrerseits gesperrt. Für paralleles Arbeiten in zwei Betrieben einen zweiten Browser, ein
            zweites Browserprofil oder ein privates Fenster verwenden.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
