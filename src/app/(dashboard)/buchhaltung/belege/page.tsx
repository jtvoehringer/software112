import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { verwerfeBeleg } from '../actions'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'
import BelegUpload from './BelegUpload'
import { AlertTriangle, FileText, Image as ImageIcon, Trash2, Info } from 'lucide-react'
import { fmtNum } from '@/lib/format'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null | undefined) {
  if (n == null) return '–'
  return fmtNum(n, 2)
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
          <Link href={`/buchhaltung/belege/${b.id}`} className="font-medium text-s112-text hover:text-s112-blue-700 truncate block">
            {e.beschreibung || b.dateiname}
          </Link>
          <p className="text-xs text-s112-muted truncate">
            {b.dateiname} · hochgeladen {new Date(b.hochgeladen_am).toLocaleDateString('de-AT')}
            {e.datum ? ` · Belegdatum ${new Date(e.datum).toLocaleDateString('de-AT')}` : ''}
          </p>
          {b.status === 'fehler' && (
            <p className="text-xs text-s112-warn-fg flex items-center gap-1 mt-0.5">
              <AlertTriangle className="w-3 h-3" /> Erkennung fehlgeschlagen – bitte manuell buchen
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          {e.betrag_brutto != null && (
            <p className={`font-mono font-semibold ${e.typ === 'einnahme' ? 'text-s112-ok-fg' : 'text-s112-err'}`}>
              € {fmt(e.betrag_brutto)}
            </p>
          )}
          {e.konfidenz && e.konfidenz !== 'hoch' && (
            <p className="text-xs text-s112-warn-fg">Erkennung: {e.konfidenz}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {b.status === 'verbucht' ? (
            <span className="text-xs font-medium bg-s112-ok-bg text-s112-ok-fg px-2.5 py-1 rounded-full">Verbucht</span>
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
              className="text-s112-err hover:text-s112-err-fg"
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Belege</span>
      </div>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Belege</h1>
          <p className="text-sm text-s112-muted">Foto oder PDF hochladen – Claude liest Datum, Betrag, USt-Satz und eine passende Kategorie automatisch aus.</p>
        </div>
        <Link href="/buchhaltung/belege/verzeichnis"
          className="shrink-0 text-xs bg-[#F2F3F5] hover:bg-s112-line text-s112-text-2 font-medium px-3 py-1.5 rounded-lg transition-colors">
          Belegverzeichnis (Druck &amp; CSV)
        </Link>
      </div>

      <div className="flex items-start gap-2.5 bg-s112-blue-50 border border-s112-blue-100 rounded-xl p-4 mb-6">
        <Info className="w-4 h-4 text-s112-blue-700 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-s112-blue-700">
          <p className="font-semibold mb-1">Wie es funktioniert</p>
          <p className="text-s112-blue-700">
            Foto oder Scan hochladen (JPG, PNG, PDF) → KI erkennt automatisch Datum, Betrag, USt-Satz,
            Kategorie und – bei Eingangsrechnungen – den Lieferanten (wird mit einer bestehenden Firma
            im CRM verknüpft, oder Sie legen sie direkt neu an) → Daten prüfen und ggf. korrigieren →
            „Buchung anlegen" erstellt die Buchung und verknüpft den Beleg. Belege werden verschlüsselt
            und mandantengetrennt in der Cloud gespeichert.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <BelegUpload />
      </div>

      <div className="bg-white rounded-xl border border-s112-border overflow-hidden mb-8">
        <div className="px-4 py-3 bg-s112-bg border-b border-s112-border">
          <h2 className="text-sm font-semibold text-s112-text-1">
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
        <div className="bg-white rounded-xl border border-s112-border overflow-hidden">
          <div className="px-4 py-3 bg-s112-bg border-b border-s112-border">
            <h2 className="text-sm font-semibold text-s112-text-1">Zuletzt verbucht</h2>
          </div>
          {verbucht.map(b => <BelegZeile key={b.id} b={b} zeigeVerwerfen={false} />)}
        </div>
      )}
    </div>
  )
}
