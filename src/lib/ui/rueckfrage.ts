// ── Rückfragen statt window.confirm (KAN-359, 22.10.2026) ──
// UAT (Paul): Meldungen erscheinen an verschiedenen Orten und in verschiedener Form – darunter die Browser-Dialoge
// window.confirm/alert (nicht gestaltbar, am Handy klein, je Browser anders, von Vorleseprogrammen uneinheitlich
// angesagt). Entscheidung Jörgen 22.10.2026: Rückfragen („Endgültig löschen?“, „Prüfnummer wird entzogen – fortfahren?“)
// laufen über einen eigenen, barrierefreien Dialog (RueckfrageDialog im Root-Layout). Konzept: docs/Meldungskonzept.md.
//
// Hier nur der Zustand (ohne React und DOM, testbar): eine Warteschlange offener Rückfragen. Der Dialog meldet sich an
// (wirtAnmelden), zeigt die erste offene Rückfrage und beantwortet sie. Aufruf im Client:
//
//   if (!(await rueckfrage({ titel: 'Eintrag löschen?', text: '…', bestaetigen: 'Löschen', gefaehrlich: true }))) return
//
// Server-Rückfragen ({ bestaetigung } → erneut senden mit pn_bestaetigt=1) bleiben; nur die Abfrage im Client wird ersetzt.

export type RueckfrageOptionen = {
  /** Kurze Frage, z. B. „Eintrag löschen?“ – Überschrift des Dialogs */
  titel: string
  /** Erklärung bzw. Folgen (Zeilenumbrüche bleiben erhalten) */
  text?: string | null
  /** Beschriftung des Bestätigungsknopfs – ein Verb („Löschen“, „Buchen“); Standard „Fortfahren“ */
  bestaetigen?: string
  /** Beschriftung des Abbrechen-Knopfs; Standard „Abbrechen“ */
  abbrechen?: string
  /** Löschen, Entziehen, Unumkehrbares: roter Knopf, Fokus startet auf „Abbrechen“ */
  gefaehrlich?: boolean
}

export type OffeneRueckfrage = {
  id: number
  titel: string
  text: string | null
  bestaetigen: string
  abbrechen: string
  gefaehrlich: boolean
}

type Eintrag = { frage: OffeneRueckfrage; antworte: (ok: boolean) => void }

let schlange: Eintrag[] = []
let naechsteId = 1
let wirte = 0
const hoerer = new Set<() => void>()
const melden = () => hoerer.forEach(h => h())

/** Der Dialog meldet sich an; Rückgabe meldet ihn wieder ab (offene Rückfragen gelten dann als abgebrochen) */
export function wirtAnmelden(): () => void {
  wirte++
  return () => {
    wirte = Math.max(0, wirte - 1)
    if (wirte === 0 && schlange.length > 0) {
      const alt = schlange
      schlange = []
      alt.forEach(e => e.antworte(false))
      melden()
    }
  }
}

/**
 * Rückfrage stellen: true = bestätigt, false = abgebrochen (Knopf, Esc). Mehrere Rückfragen warten hintereinander.
 * Ohne angemeldeten Dialog (nur in Tests bzw. außerhalb der App denkbar) gilt sie als abgebrochen – nie still bestätigt.
 */
export function rueckfrage(o: RueckfrageOptionen): Promise<boolean> {
  if (wirte === 0) return Promise.resolve(false)
  return new Promise<boolean>(antworte => {
    schlange = [...schlange, {
      frage: {
        id: naechsteId++,
        titel: o.titel.trim(),
        text: o.text?.trim() ? o.text.trim() : null,
        bestaetigen: o.bestaetigen?.trim() || 'Fortfahren',
        abbrechen: o.abbrechen?.trim() || 'Abbrechen',
        gefaehrlich: o.gefaehrlich === true,
      },
      antworte,
    }]
    melden()
  })
}

/** Für Komponenten, die lieber einen Hook verwenden – liefert dieselbe Funktion */
export function useRueckfrage(): (o: RueckfrageOptionen) => Promise<boolean> {
  return rueckfrage
}

/** Die angezeigte (erste offene) Rückfrage oder null – stabile Referenz für useSyncExternalStore */
export function offeneRueckfrage(): OffeneRueckfrage | null {
  return schlange[0]?.frage ?? null
}

/** Antwort auf eine Rückfrage (unbekannte bzw. schon beantwortete id: ohne Wirkung) */
export function beantworte(id: number, ok: boolean): void {
  const e = schlange.find(x => x.frage.id === id)
  if (!e) return
  schlange = schlange.filter(x => x !== e)
  e.antworte(ok)
  melden()
}

export function abonniereRueckfragen(fn: () => void): () => void {
  hoerer.add(fn)
  return () => { hoerer.delete(fn) }
}

/** Antwort auf eine Taste: Esc = abbrechen (false), sonst keine (null) – Enter löst der fokussierte Knopf aus */
export function antwortAufTaste(taste: string): boolean | null {
  return taste === 'Escape' || taste === 'Esc' ? false : null
}

/** Welcher Knopf beim Öffnen den Fokus bekommt: bei gefährlichen Aktionen „Abbrechen“ (Enter löst nichts Schlimmes aus) */
export function startFokus(f: Pick<OffeneRueckfrage, 'gefaehrlich'>): 'abbrechen' | 'bestaetigen' {
  return f.gefaehrlich ? 'abbrechen' : 'bestaetigen'
}
