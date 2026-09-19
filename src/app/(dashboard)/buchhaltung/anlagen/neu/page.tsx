import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { redirect } from 'next/navigation'
import { canWrite } from '@/lib/auth/roles'
import { fmtNum } from '@/lib/format'
import { DashHeader } from '@/app/(dashboard)/dashboard/_shared/ui'
import { getCtx, ladeEinstellungen } from '@/app/(dashboard)/dashboard/_shared/data'
import AnlageForm, { type AnlageInput } from '../AnlageForm'
import { ladeKandidaten } from '../daten'

export const metadata: Metadata = { title: 'Anlage erfassen – software:112' }
export const dynamic = 'force-dynamic'

export default async function NeueAnlagePage({ searchParams }: { searchParams: Promise<{ buchung?: string }> }) {
  const ctx = await getCtx()
  if (!ctx.tenantId) redirect('/login')
  const einst = await ladeEinstellungen(ctx)
  if (!einst.modulEa) redirect('/dashboard')
  if (!canWrite(ctx.role, 'ea')) redirect('/buchhaltung/anlagen')

  const { buchung } = await searchParams
  const kandidaten = await ladeKandidaten(ctx)
  const vorlage = buchung ? kandidaten.find(k => k.id === buchung) : undefined
  const initial: AnlageInput | undefined = vorlage ? {
    transaktion_id: vorlage.id, name: vorlage.beschreibung, gruppe: '', konto_nr: '',
    anschaffung_am: vorlage.datum, ak_netto: fmtNum(vorlage.betrag_netto, 2),
    nutzungsdauer_jahre: '5', methode: vorlage.betrag_netto <= 1000 ? 'gwg' : 'linear', degressiv_satz: '30', restwert: '0',
    abgang_am: '', veraeusserungserloes: '', notizen: '',
  } : undefined

  return (
    <div className="space-y-6">
      <DashHeader title="Anlage erfassen" sub="Anschaffung, Nutzungsdauer und Abschreibungsmethode – der AfA-Plan erscheint beim Tippen rechts." />
      <p className="text-[11.5px] text-s112-tertiary -mt-3">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700">{einst.doppik ? 'Belege & BMD' : 'E&A-Rechnung'}</Link> · <Link href="/buchhaltung/anlagen" className="hover:text-s112-blue-700">Anlagen & AfA</Link> · Neu
      </p>
      <AnlageForm initial={initial} buchungen={kandidaten} darfSchreiben />
    </div>
  )
}
