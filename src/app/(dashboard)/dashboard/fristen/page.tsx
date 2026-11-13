import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { DashHeader, Card, Badge, Note } from '../_shared/ui'
import { getCtx, ladeFristen, ladeEinstellungen } from '../_shared/data'
import { canWrite } from '@/lib/auth/roles'
import FristenClient from './FristenClient'
import BehoerdenUebersicht from '@/components/behoerden/BehoerdenUebersicht'
import { behoerdenUebersicht } from '@/lib/behoerden/uebersicht'
import { geladen } from '@/lib/supabase/geladen'
import { ladeOffeneNachweise } from '@/lib/export/nachweisLaden'

export const metadata: Metadata = { title: 'Meldungen & Fristen' }
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
    ladeFristen(ctx, { modulEa: einst.modulEa, uvaZeitraum: einst.uvaZeitraum, vorwarnungTage: einst.vorwarnungTage, betriebsbeginn: einst.betriebsbeginn, doppik: einst.doppik, psmFristH: einst.psmFristH }),
    behoerdenUebersicht(),
  ])
  // KAN-440 Teil 2: Exportaufträge mit offenem Ausfuhr- bzw. Gelangensnachweis (nur mit dem Modul Exportaufträge)
  const exportEinst = ctx.tenantId
    ? geladen(await ctx.q('tenant_einstellungen').select('modul_export').eq('tenant_id', ctx.tenantId).maybeSingle(), 'Einstellungen')
    : null
  const offeneNachweise = exportEinst?.modul_export && ctx.tenantId ? await ladeOffeneNachweise(ctx.supabase, ctx.tenantId, ctx.heuteStr) : []
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
          {offeneNachweise.length > 0 && (
            <Card title="Weinexport: Nachweise offen" right={<Badge tone={offeneNachweise.some(o => o.frist.stufe === 'ueberfaellig') ? 'err' : offeneNachweise.some(o => o.frist.stufe === 'warnung' || o.frist.stufe === 'hinweis') ? 'warn' : 'info'}>{offeneNachweise.length}</Badge>}>
              <ul className="text-[13px] divide-y divide-s112-line" data-export-nachweise-offen>
                {offeneNachweise.slice(0, 8).map(o => (
                  <li key={o.id} className="py-2 flex items-start justify-between gap-3">
                    <Link href={`/weinexport/${o.id}`} className="font-medium text-s112-blue-700 hover:underline whitespace-nowrap">{o.referenz ?? 'Exportauftrag'}</Link>
                    <span className={o.frist.stufe === 'ueberfaellig' ? 'text-s112-err-fg text-right' : 'text-s112-text-2 text-right'}>{o.frist.text}</span>
                  </li>
                ))}
              </ul>
              {offeneNachweise.length > 8 && <p className="text-[12.5px] text-s112-text-2 mt-2">und {offeneNachweise.length - 8} weitere – siehe <Link href="/weinexport" className="text-s112-blue-700 hover:underline">Weinexport</Link>.</p>}
              <Note className="mt-3">Ausfuhrnachweis binnen 6 Monaten nach der Lieferung; für den Gelangensnachweis (EU) gilt hier dieselbe Staffel als betriebliche Vorgabe. Keine Rechtsberatung.</Note>
            </Card>
          )}
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
