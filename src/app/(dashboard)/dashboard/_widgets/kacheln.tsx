import { Wine, Package, ReceiptText, ListChecks } from 'lucide-react'
import { Tile, fmtEur, fmtNum } from '../_shared/ui'
import { fristenDringend, type WidgetProps } from './typen'

// KAN-387: die vier Kennzahlen der Übersicht als eigene Widgets (Inhalt unverändert aus dashboard/page.tsx)

export function KellerbestandWidget({ ctx, d }: WidgetProps) {
  const keller = d.keller
  if (!keller) return null
  const jahr = ctx.heute.getFullYear()
  return (
    <Tile label="Kellerbestand" icon={Wine} href="/dashboard/kellerbuch"
      value={`${fmtNum(keller.gesamtLiter)} L`}
      sub={keller.jungweinLiter > 0 ? `davon ${fmtNum(keller.jungweinLiter)} L Jahrgang ${jahr}` : `${keller.behaelterBelegt} von ${keller.behaelterGesamt} Gebinden belegt`} />
  )
}

export function FlaschenlagerWidget({ d }: WidgetProps) {
  const flaschen = d.flaschen
  if (!flaschen) return null
  return (
    <Tile label="Flaschenlager" icon={Package} href="/weinhandel"
      value={`${fmtNum(flaschen.bestand)} Fl.`}
      sub={flaschen.abgefuelltWoche > 0 ? `+${fmtNum(flaschen.abgefuelltWoche)} abgefüllt diese Woche` : `${flaschen.nachRebsorte.length} Rebsorten am Lager`}
      tone={flaschen.abgefuelltWoche > 0 ? 'ok' : undefined} />
  )
}

export function OffenePostenWidget({ d }: WidgetProps) {
  const offen = d.offenePosten
  if (!offen) return null
  return (
    <Tile label="Offene Posten" icon={ReceiptText} href="/weinhandel/offene-posten"
      value={fmtEur(offen.summe)}
      sub={offen.anzahl === 0 ? 'Keine offenen Posten' : offen.ueberfaellig > 0 ? `${offen.ueberfaellig} überfällig · ${fmtEur(offen.ueberfaelligSumme)}` : `${offen.anzahl} offen · Ø ${offen.avgAlterTage} Tage seit Rechnung`}
      tone={offen.ueberfaellig > 0 ? 'err' : undefined} />
  )
}

export function OffeneAufgabenWidget({ einst, d }: WidgetProps) {
  const { keller, fristen } = d
  if (!keller || !fristen) return null
  const dringend = fristenDringend(fristen)
  const aufgaben = dringend.length + keller.messungFaellig + (d.checklisten ?? 0)
  return (
    <Tile label="Offene Aufgaben" icon={ListChecks} href="/dashboard/fristen"
      value={fmtNum(aufgaben)}
      sub={dringend.length > 0 ? `${dringend.length} Meldefrist${dringend.length === 1 ? '' : 'en'} < ${einst.vorwarnungTage} Tage` : keller.messungFaellig > 0 ? `${keller.messungFaellig} Gärkontrolle${keller.messungFaellig === 1 ? '' : 'n'} fällig` : 'Nichts Dringendes'}
      tone={dringend.some(f => f.status === 'ueberfaellig') ? 'err' : dringend.length > 0 || keller.messungFaellig > 0 ? 'warn' : undefined} />
  )
}
