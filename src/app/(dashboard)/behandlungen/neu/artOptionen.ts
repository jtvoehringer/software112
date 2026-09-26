// Auswahl „Art“ im Maßnahmenformular (Anlegen und Bearbeiten): Wert, Bezeichnung und Symbol je Art.
// Werte und Bezeichnungen aus lib/behandlungen/arten.ts. Jede Art hat ein eigenes Symbol – Laubschneiden
// (KAN-143) den Strauch (Shrub), nicht Schere (Schnitt) oder Blatt (Laubarbeit).

import { SprayCan, Sprout, Layers, Scissors, Leaf, Shrub, MoreHorizontal, type LucideIcon } from 'lucide-react'
import { MASSNAHMEN_ARTEN, MASSNAHMEN_ART_LABEL, type MassnahmenArt } from '@/lib/behandlungen/arten'

export const ART_SYMBOL: Readonly<Record<MassnahmenArt, LucideIcon>> = {
  spritzung:        SprayCan,
  duengung:         Sprout,
  bodenbearbeitung: Layers,
  schnitt:          Scissors,
  laubarbeit:       Leaf,
  laubschneiden:    Shrub,
  sonstiges:        MoreHorizontal,
}

export const ART_OPTIONS: readonly { value: MassnahmenArt; label: string; icon: LucideIcon }[] =
  MASSNAHMEN_ARTEN.map(value => ({ value, label: MASSNAHMEN_ART_LABEL[value], icon: ART_SYMBOL[value] }))
