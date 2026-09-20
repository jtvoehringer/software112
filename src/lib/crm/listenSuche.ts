'use client'

import { useEffect, useRef, useState } from 'react'

// Suchfeld der serverseitig gefilterten Listen (Kontakte, Firmen), 20.9.2026.
//
// Problem: Der Suchtext landet nach 300 ms als ?q= in der URL, die Seite lädt
// die passenden Zeilen. Next.js verschlüsselt die Suchparameter aber im React-
// Key des Seiten-Segments – bei jeder URL-Änderung wird die ganze Seite samt
// Suchfeld NEU GEMOUNTET. Folge (Rückmeldung Jörgen): Fokus weg, der Text
// sprang auf den alten URL-Wert zurück, weiter getippte Buchstaben gingen
// verloren oder kamen doppelt (alter Feldinhalt + neuer Anfangswert).
//
// Lösung: Der Tippstand lebt außerhalb des Bausteins (Modul-Speicher je Liste)
// und überlebt den Neuaufbau; nach dem Mount werden Text, Fokus und Cursor
// wiederhergestellt. Der URL-Wert wird nur übernommen, wenn gerade nicht
// getippt wird (Zurück-Taste, Link mit ?q=).

type Stand = { text: string; caret: number | null; zuletztGetippt: number }
const speicher: Record<string, Stand> = {}
const TIPP_FENSTER_MS = 1500
const VERZOEGERUNG_MS = 300

export function useListenSuche(schluessel: string, urlWert: string, anwenden: (q: string) => void) {
  const gemerkt = speicher[schluessel]
  const tipptGerade = () => !!speicher[schluessel] && Date.now() - speicher[schluessel].zuletztGetippt < TIPP_FENSTER_MS
  const [suche, setSuche] = useState(() => (gemerkt && tipptGerade() ? gemerkt.text : urlWert))
  const ref = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anwendenRef = useRef(anwenden)
  anwendenRef.current = anwenden

  // Nach einem Neuaufbau während des Tippens: Fokus und Cursor zurückholen
  useEffect(() => {
    const st = speicher[schluessel]
    const el = ref.current
    if (!st || !el || !tipptGerade() || document.activeElement === el) return
    el.focus({ preventScroll: true })
    if (st.caret != null) { try { el.setSelectionRange(st.caret, st.caret) } catch { /* Eingabetyp ohne Auswahl */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel])

  // URL von außen geändert: nur übernehmen, wenn nicht getippt wird und nichts aussteht
  useEffect(() => {
    if (tipptGerade() || timer.current) return
    setSuche(urlWert)
    if (speicher[schluessel]) speicher[schluessel].text = urlWert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlWert, schluessel])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    speicher[schluessel] = { text: v, caret: e.target.selectionStart, zuletztGetippt: Date.now() }
    setSuche(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; anwendenRef.current(v.trim()) }, VERZOEGERUNG_MS)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
      anwendenRef.current(suche.trim())
    }
  }

  return { suche, ref, onChange, onKeyDown }
}
