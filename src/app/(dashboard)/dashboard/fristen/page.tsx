import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { DashHeader, Card, Badge, Note } from '../_shared/ui'
import { getCtx, ladeFristen, ladeEinstellungen } from '../_shared/data'
import { canWrite } from '@/lib/auth/roles'
import FristenClient from './FristenClient'
import BehoerdenUebersicht from '@/components/behoerden/BehoerdenUebersicht'
import { behoerdenUebersicht } from '@/lib/behoerden/uebersicht'

export const metadata: Metadata = { title: 'Meldungen & Fristen – software:112' }
export const dynamic = 'force-dynamic'

// ── Sicht "Meldungen & Fristen" (Dashboard-Relaunch 27.8.2026) ───────────────
// Ampel über betriebseigene Fristen (Tabelle fristen) und automatisch aus den
// Fachtabellen abgeleitete Fristen (UVA, Erntemeldung, Prüfnummernanträge,
// Wartefristen). Dazu Portale/Zugänge und Aufbewahrungsfristen.
// Karte „Behördenmeldungen (Drucken & CSV)“ (24.09.2026): alle Meldungen aus dem Katalog
// (lib/behoerden), die die Rolle abrufen darf – Betriebsleiter sehen die Pflichtmeldungen
// auch ohne Modul Controlling (gleiche Prüfung wie die CSV-Route /meldungen/<id>/csv).

export default async function FristenSichtPage() {
  const ctx = await getCtx()
  const einst = await ladeEinstellungen(ctx)
  const [fristen, behoerden] = await Promise.all([
    ladeFristen(ctx, { modulEa: einst.modulEa, uvaZeitraum: einst.uvaZeitraum, vorwarnungTage: einst.vorwarnungTage, betriebsbeginn: einst.betriebsbeginn, doppik: einst.doppik }),
    behoerdenUebersicht(),
  ])
  // behoerden = null: Übersicht nicht ladbar (protokolliert) – die Fristen bleiben sichtbar
  const anzahlMeldungen = (behoerden ?? []).reduce((n, g) => n + g.eintraege.length, 0)
  const ueberfaellig = fristen.filter(f => f.status === 'ueberfaellig').length
  const faellig = fristen.filter(f => f.status === 'faellig').length

  return (
    <div className="space-y-6">
      <DashHeader
        title="Meldungen & Fristen"
        sub="Was zu melden und aufzubewahren ist – als überwachte Regeln mit Ampel statt Kopfwissen und Kalenderzettel."
        right={<div className="flex gap-2">{ueberfaellig > 0 && <Badge tone="err">{ueberfaellig} überfällig</Badge>}{faellig > 0 && <Badge tone="warn">{faellig} fällig</Badge>}</div>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5">
        <Card title="Überwachte Fristen">
          <FristenClient fristen={fristen} darfSchreiben={canWrite(ctx.role, 'betrieb')} vorwarnungTage={einst.vorwarnungTage} />
        </Card>

        <div className="space-y-5">
          <Card title="Portale & Zugänge">
            <div className="grid grid-cols-[minmax(150px,45%)_1fr] text-[13px]">
              <Zeile k="bawb.at (Weinkontrolle)">{einst.bawbKennung ? <Badge tone="ok">✓ Kennung hinterlegt</Badge> : <Link href="/betrieb/einstellungen"><Badge tone="gray">Kennung hinterlegen</Badge></Link>}</Zeile>
              <Zeile k="eAMA (Erntemeldung, MFA)"><Badge tone="gray">manuell</Badge></Zeile>
              <Zeile k="FinanzOnline (UVA)">{einst.modulEa ? <Link href="/buchhaltung/uva"><Badge tone="info">Kennzahlen: Druck & CSV</Badge></Link> : <Badge tone="gray">E&A-Modul inaktiv</Badge>}</Zeile>
              <Zeile k="Microsoft 365">{einst.m365Aktiv ? <Badge tone="ok">verbunden</Badge> : <Badge tone="gray">nicht verbunden</Badge>}</Zeile>
            </div>
          </Card>

          <Card title="Aufbewahrung & Nachweise">
            <div className="grid grid-cols-[minmax(150px,45%)_1fr] text-[13px]">
              <Zeile k="Belege / Buchhaltung"><span className="font-mono text-[12.5px] font-semibold">7 Jahre (BAO)</span></Zeile>
              <Zeile k="Kellerbuch-Aufzeichnungen"><span className="font-mono text-[12.5px] font-semibold">lt. Weingesetz · <Link href="/reports/weinbuecher-sammlung" className="text-s112-blue-700 hover:underline">Druck & CSV</Link></span></Zeile>
              <Zeile k="PSM-Aufzeichnungen"><span className="font-mono text-[12.5px] font-semibold">lt. Vorgabe · <Link href="/behandlungen/berichte" className="text-s112-blue-700 hover:underline">Berichte & CSV</Link></span></Zeile>
              <Zeile k="Rückverfolgbarkeit"><span className="font-mono text-[12.5px] font-semibold"><Link href="/kellerbuch/rueckverfolgung" className="text-s112-blue-700 hover:underline">Charge → Ried lückenlos</Link></span></Zeile>
            </div>
            <Note className="mt-3">Fristen und Aufbewahrungsdauern sind Betriebs-Stammdaten bzw. fachliche Annahmen – bitte mit Steuerberatung/Weinbauverband prüfen. Keine Rechtsberatung.</Note>
          </Card>
        </div>
      </div>

      <Card
        title="Behördenmeldungen (Drucken & CSV)"
        right={anzahlMeldungen > 0 ? <span className="font-mono text-[11.5px] text-s112-text-2">{anzahlMeldungen} Meldungen</span> : undefined}
      >
        <BehoerdenUebersicht gruppen={behoerden} />
        <Note className="mt-4">
          Jede Meldung gibt es als CSV für Excel (Semikolon, UTF-8, Dezimalkomma, Datum TT.MM.JJJJ), die meisten
          zusätzlich als Ausdruck auf ihrer Seite. „CSV exportieren“ hier nimmt die Standardauswahl der Seite (z. B. laufendes Jahr, ab 1. Jänner bzw. alle Jahrgänge – wie „Öffnen“) – für einen anderen
          Jahrgang, Zeitraum oder einen einzelnen Beleg die Seite öffnen. Codes mit führenden Nullen (KG-Nr., BBCH) exakt
          übernehmen: in Excel „Daten › Aus Text/CSV“ und die Spalte als Text importieren. Die Weinbestandsmeldung rechnet den
          Bestand zum Stichtag (Standard 31. Juli) zurück – einen anderen Stichtag auf ihrer Seite wählen.
        </Note>
      </Card>
    </div>
  )
}

function Zeile({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <div className="py-2 border-b border-s112-line text-s112-text-2">{k}</div>
      <div className="py-2 border-b border-s112-line flex items-center gap-2 flex-wrap font-medium">{children}</div>
    </>
  )
}
