import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { verwerfeBeleg } from '../actions'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'
import BelegUpload from './BelegUpload'
import { AlertTriangle, FileText, Image as ImageIcon, Trash2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null | undefined) {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function BelegePage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')

  const { data: belegeRaw } = await (supabase.from('ea_belege') as any)
    .select('id, dateiname, dateityp, status, erkannte_daten, fehler_details, hochgeladen_am')
    .eq('tenant_id', tenantId)
    .order('hochgeladen_am', { ascending: false })
    .limit(150)

  const belege   = (belegeRaw ?? []) as R[]
  const offen    = belege.filter(b => b.status !== 'verbucht')
  const verbucht = belege.filter(b => b.status === 'verbucht').slice(0, 25)

  function BelegZeile({ b, zeigeVerwerfen }: { b: R; zeigeVerwerfen: boolean }) {
    const e = (b.erkannte_daten ?? {}) as R
    const istBild = (b.dateityp as string)?.startsWith('image/')
    const verwerfenWithId = verwerfeBeleg.bind(null, b.id)

    return (
      <div className="flex items-center gap-4 px-4 py-3 border-b border-s112-border/50 hover:bg-s112-bg/50">
        <div className="flex-shrink-0 text-s112-muted">
          {istBild ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <Link href={`/buchhaltung/belege/${b.id}`} className="font-medium text-gray-800 hover:text-s112-teal truncate block">
            {e.beschreibung || b.dateiname}
          </Link>
          <p className="text-xs text-s112-muted truncate">
            {b.dateiname} · hochgeladen {new Date(b.hochgeladen_am).toLocaleDateString('de-AT')}
            {e.datum ? ` · Belegdatum ${new Date(e.datum).toLocaleDateString('de-AT')}` : ''}
          </p>
          {b.status === 'fehler' && (
            <p className="text-xs text-amber-700 flex items-center gap-1 mt-0.5">
              <AlertTriangle className="w-3 h-3" /> Erkennung fehlgeschlagen – bitte manuell buchen
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          {e.betrag_brutto != null && (
            <p className={`font-mono font-semibold ${e.typ === 'einnahme' ? 'text-green-600' : 'text-red-500'}`}>
              € {fmt(e.betrag_brutto)}
            </p>
          )}
          {e.konfidenz && e.konfidenz !== 'hoch' && (
            <p className="text-xs text-amber-600">Erkennung: {e.konfidenz}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {b.status === 'verbucht' ? (
            <span className="text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">Verbucht</span>
          ) : (
            <Link
              href={`/buchhaltung/belege/${b.id}`}
              className="bg-s112-teal text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-opacity-90"
            >
              Buchen
            </Link>
          )}
          {zeigeVerwerfen && (
            <ConfirmDeleteForm
              action={verwerfenWithId}
              message="Beleg verwerfen? Die Datei wird endgültig gelöscht, es entsteht keine Buchung."
              label={<Trash2 size={16} />}
              title="Verwerfen"
              className="text-red-400 hover:text-red-600"
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung" className="hover:text-s112-teal transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Belege</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Belege</h1>
          <p className="text-sm text-s112-muted">Foto oder PDF hochladen – Claude liest Datum, Betrag, USt-Satz und eine passende Kategorie automatisch aus.</p>
        </div>
      </div>

      <div className="mb-6">
        <BelegUpload />
      </div>

      <div className="bg-white rounded-2xl border border-s112-border overflow-hidden mb-8">
        <div className="px-4 py-3 bg-s112-bg border-b border-s112-border">
          <h2 className="text-sm font-semibold text-gray-700">
            Zu verbuchen {offen.length > 0 && <span className="text-s112-muted font-normal">({offen.length})</span>}
          </h2>
        </div>
        {offen.length === 0 ? (
          <p className="text-center py-10 text-s112-muted text-sm">Keine offenen Belege – alles verbucht.</p>
        ) : (
          offen.map(b => <BelegZeile key={b.id} b={b} zeigeVerwerfen />)
        )}
      </div>

      {verbucht.length > 0 && (
        <div className="bg-white rounded-2xl border border-s112-border overflow-hidden">
          <div className="px-4 py-3 bg-s112-bg border-b border-s112-border">
            <h2 className="text-sm font-semibold text-gray-700">Zuletzt verbucht</h2>
          </div>
          {verbucht.map(b => <BelegZeile key={b.id} b={b} zeigeVerwerfen={false} />)}
        </div>
      )}
    </div>
  )
}
