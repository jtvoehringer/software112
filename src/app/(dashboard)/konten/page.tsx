import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { Landmark, CreditCard, Wallet, Circle, type LucideIcon } from 'lucide-react'
import { fmtEur } from '@/lib/format'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number) {
  return fmtEur(n)
}

const TYP_ICON: Record<string, LucideIcon> = { giro: Landmark, kreditkarte: CreditCard, kassa: Wallet, sonstiges: Circle }
const TYP_LABEL: Record<string, string> = { giro: 'Girokonto', kreditkarte: 'Kreditkarte', kassa: 'Kassa', sonstiges: 'Sonstiges' }

async function berechneSaldo(supabase: R, tenantId: string, konto: R): Promise<number> {
  let saldo = Number(konto.eroeffnungssaldo ?? 0)

  const zahlungenRaw = geladen(await (supabase.from('zahlungen') as any)
    .select('betrag, datum').eq('tenant_id', tenantId).eq('konto_id', konto.id)
    .gt('datum', konto.eroeffnungsdatum)
    .is('storniert_am', null), 'Zahlungen')   // KAN-149 D2b: stornierte Zahlungen zählen nicht
  saldo += ((zahlungenRaw ?? []) as R[]).reduce((s, z) => s + Number(z.betrag ?? 0), 0)

  const txRaw = geladen(await (supabase.from('ea_transaktionen') as any)
    .select('typ, betrag_brutto, datum').eq('tenant_id', tenantId).eq('konto_id', konto.id)
    .gt('datum', konto.eroeffnungsdatum), 'Buchungen')
  saldo += ((txRaw ?? []) as R[]).reduce((s, t) => s + (t.typ === 'einnahme' ? 1 : -1) * Number(t.betrag_brutto ?? 0), 0)

  const umbVonRaw = geladen(await (supabase.from('konto_umbuchungen') as any)
    .select('betrag, datum').eq('tenant_id', tenantId).eq('von_konto_id', konto.id)
    .gt('datum', konto.eroeffnungsdatum)
    .is('storniert_am', null), 'Umbuchungen')
  saldo -= ((umbVonRaw ?? []) as R[]).reduce((s, u) => s + Number(u.betrag ?? 0), 0)

  const umbNachRaw = geladen(await (supabase.from('konto_umbuchungen') as any)
    .select('betrag, datum').eq('tenant_id', tenantId).eq('nach_konto_id', konto.id)
    .gt('datum', konto.eroeffnungsdatum)
    .is('storniert_am', null), 'Umbuchungen')
  saldo += ((umbNachRaw ?? []) as R[]).reduce((s, u) => s + Number(u.betrag ?? 0), 0)

  return saldo
}

export default async function KontenPage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const adminOk  = canAdmin(membership.role)

  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_ea) redirect('/dashboard')

  const kontenRaw = geladen(await (supabase.from('konten') as any)
    .select('*').eq('tenant_id', tenantId).eq('aktiv', true).order('sortierung').order('name'), 'Konten')
  const konten = (kontenRaw ?? []) as R[]

  const kontenMitSaldo: (R & { saldo: number })[] = await Promise.all(
    konten.map(async (k): Promise<R & { saldo: number }> => {
      const saldo = await berechneSaldo(supabase, tenantId, k)
      return { ...k, saldo }
    })
  )

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Konten</h1>
          <p className="text-sm text-s112-muted">Bankkonten &amp; Kassen · Kontoabstimmung</p>
        </div>
        {adminOk && (
          <Link href="/konten/neu"
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
            + Konto
          </Link>
        )}
      </div>

      {kontenMitSaldo.length === 0 ? (
        <div className="bg-white rounded-xl border border-s112-border p-10 text-center text-s112-muted">
          Noch keine Konten angelegt.
          {adminOk && <> <Link href="/konten/neu" className="text-s112-blue-700 hover:underline">Erstes Konto anlegen →</Link></>}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-s112-border overflow-hidden">
          {kontenMitSaldo.map(k => {
            const Icon = TYP_ICON[k.typ] ?? Circle
            return (
              <Link key={k.id} href={`/konten/${k.id}/abstimmung`}
                className="flex items-center justify-between px-5 py-4 border-b border-s112-border/60 last:border-0 hover:bg-s112-bg/50 transition-colors">
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-s112-blue-700" />
                  <div>
                    <p className="text-sm font-semibold text-s112-text">{k.name}</p>
                    <p className="text-xs text-s112-muted">{TYP_LABEL[k.typ] ?? k.typ}{k.iban ? ` · ${k.iban}` : ''}</p>
                  </div>
                </div>
                <p className={`text-lg font-semibold tabular-nums ${k.saldo >= 0 ? 'text-s112-blue-700' : 'text-s112-err-fg'}`}>
                  {fmt(k.saldo)}
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
