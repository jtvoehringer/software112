// Löschen mit Rückfall auf Deaktivieren (KAN-150 F1) – für Client-Komponenten: Die Lösch-Action meldet bei Bezug
// { error, deaktivierbar: true }; dann wird „Stattdessen deaktivieren?“ angeboten.
// KAN-359 (22.10.2026): Rückfrage und Fehlermeldung kommen vom Aufrufer (Meldungskonzept, docs/Meldungskonzept.md):
// `frage` = rueckfrage aus src/lib/ui/rueckfrage.ts, `fehler` setzt die Meldung am Formular bzw. an der Liste
// (role="alert") – keine Browser-Dialoge mehr.

import type { RueckfrageOptionen } from '../ui/rueckfrage'

export type LoeschErgebnis = { error?: string; deaktivierbar?: boolean } | void | undefined

export type LoeschMeldungen = {
  frage: (o: RueckfrageOptionen) => Promise<boolean>
  fehler: (text: string) => void
}

export async function loeschenOderDeaktivieren(
  loeschen: () => Promise<LoeschErgebnis>,
  deaktivieren: () => Promise<{ error?: string } | void>,
  m: LoeschMeldungen,
): Promise<'geloescht' | 'deaktiviert' | 'abgebrochen' | 'fehler'> {
  let r: LoeschErgebnis
  try {
    r = await loeschen()
  } catch (err) {
    m.fehler(`Fehler beim Löschen: ${err instanceof Error ? err.message : String(err)}`)
    return 'fehler'
  }
  if (!r || !r.error) return 'geloescht'
  if (!r.deaktivierbar) {
    m.fehler(`Fehler beim Löschen: ${r.error}`)
    return 'fehler'
  }
  if (!(await m.frage({ titel: 'Stattdessen deaktivieren?', text: r.error, bestaetigen: 'Deaktivieren' }))) return 'abgebrochen'
  const d = await deaktivieren()
  if (d && d.error) {
    m.fehler(d.error)
    return 'fehler'
  }
  return 'deaktiviert'
}
