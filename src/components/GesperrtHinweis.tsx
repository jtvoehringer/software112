// ── „Gesperrt mit Grund“ (KAN-96, 04.10.2026) ──────────────────────────────────────────────────────────
// Hinweis über einem Formular, dessen Datensatz die Datenbank per Freeze-Trigger (s112_freeze) sperrt – z. B.
// Prüfnummernantrag ab „Eingereicht“ (KAN-97) oder Füllung nach dem Speichern (KAN-101). Ob gesperrt ist, weiß die
// aufrufende Seite (dieselbe Bedingung wie der Trigger); erlaubte Felder bleiben im Formular bearbeitbar.

import { Lock } from 'lucide-react'
import { sperrTitel } from '@/lib/freeze/sperre'

export default function GesperrtHinweis({ grund, seit, erlaubt, betriebsleitung = false }: {
  grund: string
  /** TT.MM.JJJJ */
  seit?: string | null
  /** Felder, die trotz Sperre änderbar bleiben (Anzeigenamen) */
  erlaubt?: string[]
  /** true: der Benutzer darf als Betriebsleitung mit Grund korrigieren */
  betriebsleitung?: boolean
}) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-s112-border bg-s112-bg px-3 py-2 text-sm text-s112-text-1">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-s112-muted" aria-hidden="true" />
      <div>
        <p className="font-medium">{sperrTitel({ grund, seit: seit ?? null })}</p>
        <p className="text-s112-muted">
          {erlaubt && erlaubt.length > 0 ? `Änderbar sind nur noch: ${erlaubt.join(', ')}. ` : 'Der Datensatz ist nicht mehr änderbar. '}
          {betriebsleitung
            ? 'Als Betriebsleitung kannst du mit Grund korrigieren – die Korrektur wird protokolliert.'
            : 'Korrekturen nur durch die Betriebsleitung (mit Grund, protokolliert).'}
        </p>
      </div>
    </div>
  )
}
