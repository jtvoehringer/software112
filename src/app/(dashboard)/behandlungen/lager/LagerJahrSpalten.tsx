// KAN-173 (01.10.2026): Spalten „Anfangsbestand | Zukäufe | Verbräuche | Saldo“ (laufendes Geschäftsjahr) rechts in
// den Stammdaten-Tabellen der Betriebsmittel-Lagerverwaltung (PSM, Düngemittel, Weinbehandlungs- und Produktionsmittel).
// Die Zahlen rechnet page.tsx mit lagerKonto() bzw. bmKonto() (lib/behandlungen/lagerJahr.ts) – dieselben Mengen wie
// die Lagerkarten unter „Bestand & Bewegungen“. Am Handy (unter md) bleibt nur der Saldo, damit nichts seitlich scrollt.

import { fmtNum } from '@/lib/format'
import type { JahresBewegung } from '@/lib/behandlungen/lagerJahr'

/** Jahressicht eines Mittels in der Lager-Einheit; null = weder Buchung noch Verbrauch */
export type StammLager = JahresBewegung & { einheit: string; hinweise: number }

const th = 'text-right text-xs text-s112-muted font-semibold py-2 pr-3 whitespace-nowrap'
const td = 'py-2.5 pr-3 text-right tabular-nums text-xs whitespace-nowrap'
const breit = 'hidden md:table-cell'

const zahl = (n: number) => fmtNum(n, { max: 3 })

// Nachtrag KAN-173 (02.10.2026, Jörgen): Inventurkorrekturen in Zukäufen/Verbräuchen kenntlich machen –
// klein unter der Summe, nur wenn ≠ 0
function DavonKorrektur({ menge, vorzeichen }: { menge: number; vorzeichen: '+' | '−' }) {
  if (!menge) return null
  return <span className="block text-[10px] leading-tight text-s112-tertiary">davon Inventurkorrektur {vorzeichen}{zahl(menge)}</span>
}

// Nachtrag KAN-173 (02.10.2026, Jörgen): unterjährig gebuchte Anfangsbestände außerhalb des Startjahrs des Betriebs
// zählen als Zukauf – klein unter der Summe, nur wenn ≠ 0
function DavonAnfangsbestand({ menge }: { menge: number }) {
  if (!menge) return null
  return <span className="block text-[10px] leading-tight text-s112-tertiary">davon Anfangsbestand {menge < 0 ? '−' : '+'}{zahl(Math.abs(menge))}</span>
}

export function LagerJahrKopf({ jahr, klasse = th }: { jahr: number; klasse?: string }) {
  return (
    <>
      <th className={`${klasse} ${breit} border-l border-s112-border/60`} title={`Bestand zum 1.1.${jahr} (im Startjahr des Betriebs plus im Jahr gebuchte Anfangsbestände)`}>Anfangsbestand</th>
      <th className={`${klasse} ${breit}`} title={`Einkäufe, Inventurkorrekturen nach oben und unterjährige Anfangsbestände seit 1.1.${jahr}`}>Zukäufe</th>
      <th className={`${klasse} ${breit}`} title={`Verbrauch aus Maßnahmen und Inventurkorrekturen nach unten seit 1.1.${jahr}`}>Verbräuche</th>
      <th className={klasse} title="Aktueller Bestand">Saldo</th>
    </>
  )
}

export function LagerJahrZellen({ lager, klasse = td }: { lager: StammLager | null | undefined; klasse?: string }) {
  if (!lager) {
    return (
      <>
        <td className={`${klasse} ${breit} border-l border-s112-border/40 text-s112-tertiary`}>–</td>
        <td className={`${klasse} ${breit} text-s112-tertiary`}>–</td>
        <td className={`${klasse} ${breit} text-s112-tertiary`}>–</td>
        <td className={`${klasse} text-s112-tertiary`} title="Keine Lagerbuchung und kein Verbrauch">–</td>
      </>
    )
  }
  return (
    <>
      <td className={`${klasse} ${breit} border-l border-s112-border/40 text-s112-muted`}>{zahl(lager.anfangsbestand)}</td>
      <td className={`${klasse} ${breit} text-s112-muted`}>
        {lager.zukauf ? `+${zahl(lager.zukauf)}` : '0'}
        <DavonKorrektur menge={lager.korrekturPlus} vorzeichen="+" />
        <DavonAnfangsbestand menge={lager.anfangsbestandUnterjaehrig} />
      </td>
      <td className={`${klasse} ${breit} text-s112-muted`}>
        {lager.verbrauch ? `−${zahl(lager.verbrauch)}` : '0'}
        <DavonKorrektur menge={lager.korrekturMinus} vorzeichen="−" />
      </td>
      <td className={`${klasse} font-semibold ${lager.saldo < 0 ? 'text-s112-err-fg' : 'text-s112-text'}`}
        title={lager.hinweise > 0 ? `${lager.hinweise} Hinweis(e) – nicht berücksichtigte Buchungen bzw. Maßnahmen, siehe „Bestand & Bewegungen“` : undefined}>
        {zahl(lager.saldo)} {lager.einheit}
        {lager.hinweise > 0 && <span className="ml-1 text-s112-warn-fg" aria-label={`${lager.hinweise} Hinweise`}>!</span>}
      </td>
    </>
  )
}

/** Fußnote unter der Tabelle */
export function LagerJahrHinweis({ jahr }: { jahr: number }) {
  return (
    <p className="mt-2 text-xs text-s112-muted">
      Lagerbewegung im Geschäftsjahr {jahr} (seit 1.1.) in der Lager-Einheit; Saldo = aktueller Bestand wie unter „Bestand &amp; Bewegungen“.
      Zukäufe und Verbräuche enthalten Inventurkorrekturen nach oben bzw. unten – ausgewiesen als „davon Inventurkorrektur“.
      Ein Anfangsbestand gilt nur zum 1.1. bzw. im Startjahr des Betriebs – nach dem 1.1. gebuchte Anfangsbestände zählen
      sonst als Zukauf („davon Anfangsbestand“).
      <span className="md:hidden"> Anfangsbestand, Zukäufe und Verbräuche auf breiteren Bildschirmen.</span>
    </p>
  )
}

/** Jahressicht aus einem Lagerkonto (lagerKonto/bmKonto mit Jahr); null ohne Buchung und Verbrauch */
export function stammLager(konto: { einheit: string; jahr?: JahresBewegung; hinweise: unknown[] } | null | undefined): StammLager | null {
  if (!konto?.jahr) return null
  return { ...konto.jahr, einheit: konto.einheit, hinweise: konto.hinweise.length }
}
