import type { Ctx, Frist } from '../_shared/data'
import type { Einstellungen, WidgetDaten } from '../_shared/widgetDaten'

// KAN-387: gemeinsame Eingaben aller Widgets der Übersicht

export type WidgetProps = {
  ctx: Ctx
  einst: Einstellungen
  d: WidgetDaten
  /** Schnellaktionen am Handy vorhanden – dann ersetzen sie dort den Schnellzugriff */
  mitSchnellaktionen: boolean
}

/** Überfällige und fällige Fristen – zählen als offene Aufgabe und stehen unter „Nächste Schritte“ */
export function fristenDringend(fristen: Frist[]): Frist[] {
  return fristen.filter(f => f.status === 'ueberfaellig' || f.status === 'faellig')
}
