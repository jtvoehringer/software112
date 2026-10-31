import type { ComponentType } from 'react'
import type { WidgetId } from '@/lib/dashboard/widgets'
import type { WidgetProps } from './typen'
import { KellerbestandWidget, FlaschenlagerWidget, OffenePostenWidget, OffeneAufgabenWidget } from './kacheln'
import { FinanzenWidget, NaechsteSchritteWidget, MorgenberichtWidget, AufgabenTermineWidget } from './karten'
import { SchnellaktionenWidget, SchnellzugriffWidget } from './schnell'

// KAN-387: Darstellung je Widget des Registers (lib/dashboard/widgets.ts) – der Typ erzwingt eine Komponente je id
export const WIDGET_KOMPONENTEN: Record<WidgetId, ComponentType<WidgetProps>> = {
  'schnellaktionen': SchnellaktionenWidget,
  'kellerbestand': KellerbestandWidget,
  'flaschenlager': FlaschenlagerWidget,
  'offene-posten': OffenePostenWidget,
  'offene-aufgaben': OffeneAufgabenWidget,
  'finanzen': FinanzenWidget,
  'naechste-schritte': NaechsteSchritteWidget,
  'morgenbericht': MorgenberichtWidget,
  'aufgaben-termine': AufgabenTermineWidget,
  'schnellzugriff': SchnellzugriffWidget,
}

export type { WidgetProps } from './typen'
export { schnellaktionenFuer } from './schnell'
