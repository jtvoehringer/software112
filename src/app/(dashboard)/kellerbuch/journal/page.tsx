import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { fmtNum } from '@/lib/format'
import { datumAT } from '@/lib/behoerden/ernte_hilfen'
import { KAT_BUCHUNGSART } from '@/lib/katalog/bki'
import {
  JOURNAL_QUELLE_LABEL, journalMenge, ladeJournalAbweichungen, ladeJournalBeginn, ladeJournalZeilen,
  type JournalAbweichung, type JournalBuchung,
} from '@/lib/kellerbuch/journal'

// KAN-40 Etappe E1: Bewegungsjournal (nur lesen) – Status, Journal-Konsistenz (Ist ↔ Journal-Saldo) und die letzten Buchungen.
// Geschrieben wird das Journal ausschließlich von der Datenbank (Trigger); Eröffnen und Abgleichen laufen über die RPCs
// journal_eroeffnen/journal_abgleichen (Betriebsleitung bzw. Wartung).

export const metadata: Metadata = { title: 'Bewegungsjournal – software:112' }
export const dynamic = 'force-dynamic'

const ART_LABEL = new Map(KAT_BUCHUNGSART.map(b => [b.code, b.bezeichnung]))

function Menge({ z }: { z: Pick<JournalBuchung, 'bestand' | 'menge_liter' | 'menge_stk'> }) {
  const m = journalMenge(z)
  return (
    <span className={m.wert < 0 ? 'text-red-700' : 'text-s112-text'}>
      {m.wert > 0 ? '+' : ''}{fmtNum(m.wert, m.einheit === 'Stk' ? 0 : 2)} {m.einheit}
    </span>
  )
}

function Abweichungen({ liste }: { liste: JournalAbweichung[] }) {
  if (liste.length === 0) {
    return <p className="text-sm text-s112-muted">Keine Abweichungen – jeder Bestand stimmt mit dem Journal-Saldo überein.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-s112-muted border-b border-s112-border">
            <th className="py-2 pr-3">Art</th>
            <th className="py-2 pr-3">Bezeichnung</th>
            <th className="py-2 pr-3 text-right">Ist</th>
            <th className="py-2 pr-3 text-right">Journal</th>
            <th className="py-2 pr-3 text-right">Differenz</th>
            <th className="py-2">Letzte Änderung</th>
          </tr>
        </thead>
        <tbody>
          {liste.map(a => {
            const st = a.einheit === 'Stk' ? 0 : 2
            return (
              <tr key={`${a.art}-${a.id}`} className="border-b border-s112-border/60">
                <td className="py-2 pr-3">{a.art === 'charge' ? 'Charge' : 'Füllung'}</td>
                <td className="py-2 pr-3">{a.bezeichnung ?? '–'}</td>
                <td className="py-2 pr-3 text-right">{fmtNum(a.ist, st)} {a.einheit}</td>
                <td className="py-2 pr-3 text-right">{fmtNum(a.journal, st)} {a.einheit}</td>
                <td className="py-2 pr-3 text-right font-medium">{a.differenz > 0 ? '+' : ''}{fmtNum(a.differenz, st)} {a.einheit}</td>
                <td className="py-2">{a.letzte_aenderung ? new Date(a.letzte_aenderung).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }) : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-s112-muted mt-2">
        Kurz nach einer Buchung kann eine Abweichung zu sehen sein, bis alle Teile des Vorgangs gespeichert sind. Bleibt sie,
        wurde der Bestand ohne Bewegung geändert – der Abgleich bucht sie als Bestandskorrektur (Inventur + bzw. −).
      </p>
    </div>
  )
}

export default async function JournalPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) {
    return <p className="text-sm text-s112-muted">Kein Betrieb ausgewählt.</p>
  }
  const tenantId = membership.tenantId
  const beginn = await ladeJournalBeginn(supabase, tenantId)
  const [abweichungen, zeilen] = beginn
    ? await Promise.all([ladeJournalAbweichungen(supabase, tenantId), ladeJournalZeilen(supabase, tenantId, 200)])
    : [[] as JournalAbweichung[], [] as JournalBuchung[]]

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text">Bewegungsjournal</span>
      </nav>

      <div className="card p-5 space-y-2">
        <h1 className="text-lg font-semibold text-s112-text">Bewegungsjournal</h1>
        {beginn ? (
          <p className="text-sm text-s112-text-2">
            Das Journal läuft seit dem <strong>{datumAT(beginn)}</strong>: Jede Mengenbewegung (Ernte, Zukauf, Umzug, Verschnitt,
            Füllung, Verkauf, Schwund, Storno, Umstufung) steht hier unveränderlich mit den Merkmalen zum Buchungszeitpunkt.
          </p>
        ) : (
          <p className="text-sm text-s112-text-2">
            Das Bewegungsjournal ist für diesen Betrieb noch nicht eröffnet. Eröffnet wird es mit dem Ist-Bestand an einem
            Stichtag (Betriebsleitung bzw. Support).
          </p>
        )}
      </div>

      {beginn && (
        <>
          <div className="card p-5 space-y-3">
            <h2 className="text-sm font-semibold text-s112-text">Journal-Konsistenz (Bestand ↔ Journal-Saldo)</h2>
            <Abweichungen liste={abweichungen} />
          </div>

          <div className="card p-5 space-y-3">
            <h2 className="text-sm font-semibold text-s112-text">Letzte Buchungen</h2>
            {zeilen.length === 0 ? (
              <p className="text-sm text-s112-muted">Noch keine Buchungen.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-s112-muted border-b border-s112-border">
                      <th className="py-2 pr-3">Beleg</th>
                      <th className="py-2 pr-3">Datum</th>
                      <th className="py-2 pr-3">Buchungsart</th>
                      <th className="py-2 pr-3">Charge / Füllung</th>
                      <th className="py-2 pr-3 text-right">Menge</th>
                      <th className="py-2 pr-3">Merkmale</th>
                      <th className="py-2 pr-3">Vorgang</th>
                      <th className="py-2">Hinweis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zeilen.map(z => (
                      <tr key={z.id} className="border-b border-s112-border/60 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{z.beleg_nr}/{z.pos}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{datumAT(z.datum)}</td>
                        <td className="py-2 pr-3">
                          <span className="font-mono text-xs">{z.buchungsart_code}</span>
                          <span className="block text-xs text-s112-muted">{ART_LABEL.get(z.buchungsart_code) ?? ''}{z.storno_von_id ? ' · Gegenbuchung' : ''}</span>
                        </td>
                        <td className="py-2 pr-3">{z.bestand === 'flasche' ? z.fuellung_name : z.charge_name}</td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap"><Menge z={z} /></td>
                        <td className="py-2 pr-3 text-xs text-s112-text-2">
                          {[z.qualitaetsstufe, z.zusatzbezeichnung, z.erzeugnis, z.weinart, z.rebsorte, z.jahrgang, z.land_iso].filter(v => v != null && v !== '').join(' · ') || '–'}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {JOURNAL_QUELLE_LABEL[z.quelle_tabelle] ?? z.quelle_tabelle}
                          {z.partner_name ? <span className="block text-s112-muted">{z.partner_name}{z.partner_land ? ` (${z.partner_land})` : ''}</span> : null}
                        </td>
                        <td className="py-2 text-xs text-s112-muted">{[z.rekonstruiert ? 'rekonstruiert' : null, z.hinweis].filter(Boolean).join(' · ') || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {zeilen.length >= 200 && <p className="text-xs text-s112-muted mt-2">Angezeigt werden die letzten 200 Buchungen.</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
