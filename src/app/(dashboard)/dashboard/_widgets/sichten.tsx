import {
  umsatzReihe, ueberfaelligeRechnungen, UmsatzTrendKarte, UeberfaelligeRechnungenKarte, TopKundenKarte,
  GebindeBelegtKachel, AktiveGaerungenKachel, FuellfertigKachel, GaerkontrolleKarte, WartefristenKarte, MeldefristenKarte,
} from '../_shared/bausteine'
import { umsatzJeKunde } from '@/lib/verkauf/umsatz'
import type { WidgetProps } from './typen'

// KAN-389: weitere Widgets aus den Sichten Verkauf, Kellerbuch, Weingarten und Fristen – dieselben Bausteine
// (_shared/bausteine.tsx) und Ladefunktionen wie die Sicht, daher dieselben Zahlen. Nicht im Standard.

export function UmsatzTrendWidget({ d }: WidgetProps) {
  if (!d.umsatz) return null
  return <UmsatzTrendKarte reihe={umsatzReihe(d.umsatz.rechnungen, d.umsatz.monate)} />
}

export function TopKundenWidget({ d }: WidgetProps) {
  if (!d.umsatz) return null
  return <TopKundenKarte kunden={umsatzJeKunde(d.umsatz.rechnungen)} />
}

export function UeberfaelligeRechnungenWidget({ d }: WidgetProps) {
  if (!d.offenePosten) return null
  return <UeberfaelligeRechnungenKarte belege={ueberfaelligeRechnungen(d.offenePosten.liste)} />
}

export function GebindeBelegtWidget({ d }: WidgetProps) {
  return d.keller ? <GebindeBelegtKachel keller={d.keller} /> : null
}

export function AktiveGaerungenWidget({ einst, d }: WidgetProps) {
  return d.keller ? <AktiveGaerungenKachel keller={d.keller} messintervallTage={einst.messintervallTage} href="/dashboard/kellerbuch" /> : null
}

export function FuellfertigWidget({ d }: WidgetProps) {
  return d.keller ? <FuellfertigKachel keller={d.keller} href="/dashboard/kellerbuch" /> : null
}

export function GaerkontrolleWidget({ einst, d }: WidgetProps) {
  return d.keller ? <GaerkontrolleKarte keller={d.keller} messintervallTage={einst.messintervallTage} /> : null
}

export function WartefristenWidget({ d }: WidgetProps) {
  return d.weingarten ? <WartefristenKarte wartefristen={d.weingarten.wartefristen} /> : null
}

export function MeldefristenWidget({ d }: WidgetProps) {
  return d.fristen ? <MeldefristenKarte fristen={d.fristen} /> : null
}
