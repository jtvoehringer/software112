'use client'

// Sprachsteuerung für bot:112 (Rückmeldung 2.9.2026, Paket "Premium: Bot:112
// mit Sprachsteuerung") – Variante A: Web Speech API des Browsers.
//
// Bewusst ohne Server-Anteil: Der Browser (Chrome, Edge, Safari inkl. iPhone/
// iPad) transkribiert selbst, der erkannte Text geht denselben Weg wie eine
// getippte Nachricht an /api/assistent/chat. Am Bot, seinen Tools und dem
// Bestätigungsschritt vor jedem Schreibzugriff ändert sich dadurch nichts.
// Firefox unterstützt die API nicht -> `unterstuetzt` = false, das Widget
// blendet den Mikrofon-Button dann einfach aus.
//
// Ein späterer Umstieg auf Server-Transkription (Whisper/Deepgram, robuster
// bei Dialekt und Nebengeräuschen) ersetzt nur diesen Hook - Widget und Bot
// bleiben identisch.

import { useCallback, useEffect, useRef, useState } from 'react'

// Die Web Speech API ist (noch) nicht in lib.dom.d.ts enthalten - Minimal-Typen
// für das, was hier gebraucht wird.
type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } }
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
type SpeechRecognitionErrorLike = { error: string }
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const FEHLER_TEXT: Record<string, string> = {
  'not-allowed':   'Mikrofonzugriff wurde verweigert – bitte in den Browser-Einstellungen für diese Seite erlauben.',
  'service-not-allowed': 'Spracherkennung ist in diesem Browser nicht freigegeben.',
  'audio-capture': 'Kein Mikrofon gefunden.',
  'network':       'Spracherkennung nicht erreichbar (Netzwerk).',
  'no-speech':     'Nichts gehört – bitte nochmal versuchen.',
  'language-not-supported': 'Deutsch wird von der Spracherkennung dieses Browsers nicht unterstützt.',
}

export type Spracheingabe = {
  /** false z.B. in Firefox -> Mikrofon-Button ausblenden */
  unterstuetzt: boolean
  /** true, solange das Mikrofon aktiv zuhört */
  hoert: boolean
  /** laufender Zwischenstand der Erkennung (zum Live-Anzeigen im Eingabefeld) */
  zwischenstand: string
  fehler: string | null
  start: () => void
  /** Aufnahme beenden - der bis dahin erkannte Text wird abgeschickt */
  stop: () => void
  /** Aufnahme verwerfen - nichts wird abgeschickt (z.B. Panel geschlossen) */
  abbrechen: () => void
}

/**
 * @param onFertig wird einmal mit dem endgültig erkannten Text aufgerufen,
 *                 sobald der Browser die Äußerung als abgeschlossen erkennt.
 */
export function useSpracheingabe(onFertig: (text: string) => void): Spracheingabe {
  const [unterstuetzt, setUnterstuetzt] = useState(false)
  const [hoert, setHoert]               = useState(false)
  const [zwischenstand, setZwischenstand] = useState('')
  const [fehler, setFehler]             = useState<string | null>(null)
  const recRef     = useRef<SpeechRecognitionLike | null>(null)
  const onFertigRef = useRef(onFertig)
  onFertigRef.current = onFertig

  // Erst im Effect prüfen (nicht beim Rendern), damit Server- und Client-HTML
  // übereinstimmen und kein Hydration-Mismatch entsteht.
  useEffect(() => { setUnterstuetzt(getCtor() !== null) }, [])

  useEffect(() => () => { recRef.current?.abort() }, [])

  const stop = useCallback(() => { recRef.current?.stop() }, [])
  const abbrechen = useCallback(() => {
    const rec = recRef.current
    if (!rec) return
    // onend feuert auch nach abort() - vorher den Callback neutralisieren,
    // damit ein halb erkannter Satz nicht doch noch rausgeht.
    rec.onresult = null
    rec.onend = () => { recRef.current = null; setHoert(false); setZwischenstand('') }
    rec.abort()
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor || recRef.current) return
    setFehler(null)
    setZwischenstand('')
    const rec = new Ctor()
    // de-AT: österreichisches Deutsch; Browser fallen auf de-DE zurück, wenn
    // sie die Variante nicht kennen. continuous=false: eine Äußerung, danach
    // Ende - passt zum Chat-Rhythmus (eine Nachricht pro Aufnahme).
    rec.lang = 'de-AT'
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1
    let endgueltig = ''
    rec.onstart  = () => setHoert(true)
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) endgueltig += r[0].transcript
        else interim += r[0].transcript
      }
      setZwischenstand((endgueltig + interim).trim())
    }
    rec.onerror = (e) => {
      // "aborted" kommt auch beim bewussten Abbrechen (Panel schließen o.ä.) -
      // keine Fehlermeldung dafür.
      if (e.error !== 'aborted') setFehler(FEHLER_TEXT[e.error] ?? `Spracherkennung: ${e.error}`)
    }
    rec.onend = () => {
      recRef.current = null
      setHoert(false)
      setZwischenstand('')
      const text = endgueltig.trim()
      if (text) onFertigRef.current(text)
    }
    recRef.current = rec
    try { rec.start() } catch (err) { recRef.current = null; setFehler(String(err)) }
  }, [])

  return { unterstuetzt, hoert, zwischenstand, fehler, start, stop, abbrechen }
}

// ── Vorlesen (Text-to-Speech) ────────────────────────────────────────────
// Gegenstück zur Spracheingabe: Antworten des Bots optional vorlesen lassen,
// damit man im Weingarten nicht aufs Handy schauen muss. Ebenfalls rein
// Browser-eigen (speechSynthesis), keine Kosten, kein Server.

export function kannVorlesen(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function vorlesen(text: string): void {
  if (!kannVorlesen()) return
  window.speechSynthesis.cancel()
  // Markdown-Reste (Sternchen, Aufzählungszeichen) würden sonst mitgelesen.
  const bereinigt = text.replace(/[*_`#>]/g, '').replace(/^\s*[-•]\s+/gm, '')
  const u = new SpeechSynthesisUtterance(bereinigt)
  u.lang = 'de-AT'
  const stimmen = window.speechSynthesis.getVoices()
  const stimme = stimmen.find(v => v.lang === 'de-AT') ?? stimmen.find(v => v.lang.startsWith('de'))
  if (stimme) u.voice = stimme
  u.rate = 1.0
  window.speechSynthesis.speak(u)
}

export function vorlesenStoppen(): void {
  if (kannVorlesen()) window.speechSynthesis.cancel()
}
