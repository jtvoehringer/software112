import { AbbrechenKnopf, ZurueckFeld } from '@/components/navigation/Abbrechen'
import { geladen } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import UmziehenFormClient from '@/components/kellerbuch/UmziehenFormClient'
import { updateUmzugBatch } from '../../../gebinde-actions'
import { ladeUmzugZeilen, planeUmzugStorno, umzugAlsEingabe, umzugSperrMeldung, nurNotizenAenderbar } from '@/lib/kellerbuch/storno'
import AktionsFormular from '@/components/ui/AktionsFormular'
import { Info } from 'lucide-react'
import type { Metadata } from 'next'
import SendenKnopf from '@/components/ui/SendenKnopf'

export const metadata: Metadata = { title: 'Umzug bearbeiten' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function UmzugEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'kellerbuch')) redirect('/kellerbuch/gebinde?tab=umziehen')

  const supabase = await createSupabaseServerClient()

  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt/bearbeitet werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()
  const tf = (query: any) => query.eq('tenant_id', tenantId)

  // Alle Zeilen der Buchung (Batch) laden
  const zeilen = await ladeUmzugZeilen(supabase, tenantId, id)
  if (!zeilen) notFound()

  // Defaults aus den Batch-Zeilen (dieselbe Umrechnung prüft updateUmzugBatch beim Speichern)
  const eingabe = umzugAlsEingabe(zeilen)

  // KAN-35: Mengen, Gebinde und Datum nur änderbar, solange die Buchung stornierbar ist
  // (Ziel-Charge seither nicht weiterbewegt, Rückbuchung vollständig möglich). Bei einer
  // Schwundbuchung nie – nur die Notizen (falsch erfasst: stornieren und neu erfassen).
  const plan = await planeUmzugStorno(supabase, tenantId, zeilen)

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  const kopf = (
    <div className="flex items-center gap-2 text-sm text-s112-muted">
      <Link href="/kellerbuch/gebinde?tab=umziehen" className="hover:text-s112-blue-700 transition-colors">
        Umziehen
      </Link>
      <span>/</span>
      <span className="text-s112-text-1 font-medium">Bearbeiten</span>
    </div>
  )

  if (nurNotizenAenderbar(plan)) {
    return (
      <div className="max-w-2xl space-y-6">
        {kopf}
        <h1 className="text-2xl font-semibold text-s112-text">{plan.istSchwund ? 'Schwundbuchung bearbeiten' : 'Umzug bearbeiten'}</h1>

        <div className="flex items-start gap-2 rounded-lg border border-s112-warn/30 bg-s112-warn-bg px-4 py-3 text-sm text-s112-warn-fg">
          <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>{umzugSperrMeldung(plan, 'aendern')}</span>
        </div>

        {/* Nur Notizen: Quellen, Ziele und Datum gehen unverändert mit, updateUmzugBatch erkennt
            daran, dass sich höchstens die Notizen ändern */}
        <AktionsFormular action={updateUmzugBatch.bind(null, eingabe.ersteId)} className="card p-6 space-y-4">
          <ZurueckFeld standard="/kellerbuch/gebinde?tab=umziehen" />
          <input type="hidden" name="quellen_json" value={JSON.stringify(eingabe.quellen)} />
          <input type="hidden" name="ziele_json" value={JSON.stringify(eingabe.ziele)} />
          <input type="hidden" name="datum" value={eingabe.datum} />
          <div>
            <label htmlFor="umzug-notizen" className={labelCls}>Notizen</label>
            <input id="umzug-notizen" name="notizen" defaultValue={eingabe.notizen} className={inputCls} />
          </div>
          <SendenKnopf
            className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
            Notizen speichern
          </SendenKnopf>
        </AktionsFormular>

        <AbbrechenKnopf standard="/kellerbuch/gebinde?tab=umziehen"
          className="inline-block text-sm text-s112-text-2 hover:text-s112-text-1 transition-colors">← Abbrechen</AbbrechenKnopf>
      </div>
    )
  }

  // Gebinde + Chargen laden
  const [gebindeRows, chargenRawRes] = await Promise.all([
    // Ziele: eigene + freigegebene Gebinde, fremd belegte ausgenommen (Migration 203)
    ladeBehaelter(supabase, tenantId, { alsZiel: true }),
    alle(tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, menge_liter, behaelter_id, aktiv, behaelter:behaelter_id(name)')
      .eq('aktiv', true).order('name').order('id'))),
  ])
  const chargenRaw = geladen(chargenRawRes, 'Chargen')

  const gebinde = gebindeRows.map(b => ({ id: b.id, name: b.anzeigeName, aktiv: b.aktiv, volumen_liter: b.volumen_liter })) as R[]
  const chargen = (chargenRaw ?? []) as R[]

  return (
    <div className="max-w-2xl space-y-6">
      {kopf}

      <h1 className="text-2xl font-semibold text-s112-text">Umzug bearbeiten</h1>

      <p className="text-sm text-s112-muted">
        Ändern sich Mengen, Gebinde oder Datum, wird die bestehende Buchung storniert und neu angelegt – die
        Bestände werden entsprechend angepasst. Das ist nur möglich, solange die Ziel-Charge seither nicht
        weiterbewegt wurde. Ändern sich nur die Notizen, bleibt die Buchung bestehen.
      </p>

      <div className="card p-6">
        <UmziehenFormClient
          gebinde={gebinde}
          chargen={chargen}
          action={updateUmzugBatch.bind(null, eingabe.ersteId)}
          inputCls={inputCls}
          labelCls={labelCls}
          defaultQuellen={eingabe.quellen}
          defaultZiele={eingabe.ziele}
          defaultDatum={eingabe.datum}
          defaultNotizen={eingabe.notizen}
          submitLabel="Speichern"
        />
      </div>

      <AbbrechenKnopf standard="/kellerbuch/gebinde?tab=umziehen"
        className="inline-block text-sm text-s112-text-2 hover:text-s112-text-1 transition-colors">← Abbrechen</AbbrechenKnopf>
    </div>
  )
}
