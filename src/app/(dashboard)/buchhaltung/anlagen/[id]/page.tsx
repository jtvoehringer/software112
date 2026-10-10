import type { Metadata } from 'next'
import { geladen } from '@/lib/supabase/geladen'
import Link from '@/components/ui/Link'
import { notFound, redirect } from 'next/navigation'
import { canWrite } from '@/lib/auth/roles'
import { fmtNum } from '@/lib/format'
import { DashHeader } from '@/app/(dashboard)/dashboard/_shared/ui'
import { getCtx, ladeEinstellungen, type R } from '@/app/(dashboard)/dashboard/_shared/data'
import AnlageForm, { type AnlageInput } from '../AnlageForm'
import { ladeKandidaten, kontoText } from '../daten'

export const metadata: Metadata = { title: 'Anlage – software:112' }
export const dynamic = 'force-dynamic'

export default async function AnlagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getCtx()
  if (!ctx.tenantId) redirect('/login')
  const einst = await ladeEinstellungen(ctx)
  if (!einst.modulEa) redirect('/dashboard')

  const aRaw = geladen(await ctx.tf(ctx.q('ea_anlagen').select('*').eq('id', id)).maybeSingle(), 'Anlagen')
  const a = aRaw as R | null
  if (!a) notFound()

  const betrag = (n: unknown) => n === null || n === undefined ? '' : fmtNum(Number(n), 2)
  const kandidaten = await ladeKandidaten(ctx, a.transaktion_id ?? null)
  const initial: AnlageInput = {
    id: a.id, transaktion_id: a.transaktion_id ?? '', name: a.name, gruppe: a.gruppe ?? '',
    konto_nr: a.konto_nr === null || a.konto_nr === undefined ? '' : kontoText(Number(a.konto_nr)),
    anschaffung_am: String(a.anschaffung_am).slice(0, 10), ak_netto: betrag(a.ak_netto),
    nutzungsdauer_jahre: String(a.nutzungsdauer_jahre), methode: a.methode,
    degressiv_satz: a.degressiv_satz === null || a.degressiv_satz === undefined ? '30' : String(a.degressiv_satz),
    restwert: betrag(a.restwert), abgang_am: a.abgang_am ? String(a.abgang_am).slice(0, 10) : '',
    veraeusserungserloes: betrag(a.veraeusserungserloes), notizen: a.notizen ?? '',
  }

  return (
    <div className="space-y-6">
      <DashHeader title={a.name} sub={a.gruppe ? `${a.gruppe} · angeschafft ${new Date(String(a.anschaffung_am)).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}` : `angeschafft ${new Date(String(a.anschaffung_am)).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}`} />
      <p className="text-[11.5px] text-s112-tertiary -mt-3">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700">{einst.doppik ? 'Belege & BMD' : 'E&A-Rechnung'}</Link> · <Link href="/buchhaltung/anlagen" className="hover:text-s112-blue-700">Anlagen & AfA</Link> · {a.name}
      </p>
      <AnlageForm initial={initial} buchungen={kandidaten} darfSchreiben={canWrite(ctx.role, 'ea')} />
    </div>
  )
}
