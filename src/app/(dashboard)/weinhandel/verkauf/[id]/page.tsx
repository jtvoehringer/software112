import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { deactivateVerkauf } from '../actions'
import PrintButton from '@/app/(dashboard)/kellerbuch/kellerplan/[id]/PrintButton'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('verkaufsposten') as any)
    .select('rechnungsnummer, datum')
    .eq('id', id)
    .single()
  const d = data as R | null
  const label = d?.rechnungsnummer
    ? `Beleg ${d.rechnungsnummer}`
    : d?.datum ? `Verkauf ${new Date(d.datum).toLocaleDateString('de-AT')}` : 'Verkauf'
  return { title: `${label} – software:112` }
}

// ── Tenant-Einstellungen für Transportschein ──────────────────────────────────
async function getTenantSettings(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  try {
    const { data } = await (supabase.from('tenant_settings') as any)
      .select('betrieb_name, betrieb_adresse, betrieb_ort, betrieb_telefon, betrieb_email')
      .limit(1)
      .single()
    return (data as R | null) ?? {}
  } catch {
    return {}
  }
}

export default async function VerkaufDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }   = await params
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [{ data: postenRaw }, settings] = await Promise.all([
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, notizen, erstellt_am,
        kontakt:kontakte(id, vorname, nachname, email, telefon),
        firma:firmen(id, name, email, telefon),
        positionen:verkauf_positionen(
          id, typ, name, menge, einheit, preis_brutto,
          fuellung:fuellungen(id, name, jahrgang, flaschengroesse_ml),
          weinausbau:weinausbau(id, name)
        )
      `)
      .eq('id', id)
      .eq('aktiv', true)
      .single(),
    getTenantSettings(supabase),
  ])

  if (!postenRaw) notFound()

  const posten    = postenRaw as R
  const positionen = (posten.positionen ?? []) as R[]
  const hasTank   = positionen.some((p: R) => p.typ === 'tank')
  const tankPos   = positionen.filter((p: R) => p.typ === 'tank')

  const gesamt = positionen.reduce((s: number, p: R) => {
    return s + (p.preis_brutto != null ? Number(p.preis_brutto) * Number(p.menge) : 0)
  }, 0)

  function kundenName(p: R): string {
    if (p.kontakt) {
      const k = p.kontakt as R
      return [k.vorname, k.nachname].filter(Boolean).join(' ')
    }
    if (p.firma) return (p.firma as R).name
    return '–'
  }

  function kundenInfo(p: R): { email?: string; telefon?: string } {
    if (p.kontakt) return { email: p.kontakt.email, telefon: p.kontakt.telefon }
    if (p.firma)   return { email: p.firma.email,   telefon: p.firma.telefon }
    return {}
  }

  const deactivateWithId = deactivateVerkauf.bind(null, id)
  const info = kundenInfo(posten)

  const FLASCHEN_LABEL: Record<number, string> = {
    187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
    1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Print-Styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          aside, nav, header { display: none !important; }
          .print-only { display: block !important; }
          .print-page-break { page-break-before: always; }
        }
        @media screen { .print-only { display: none !important; } }
      `}</style>

      {/* Breadcrumb */}
      <div className="flex items-center justify-between no-print">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weinhandel/verkauf" className="hover:text-s112-teal">Verkauf</Link>
          <span>/</span>
          <span className="text-gray-800 font-medium">
            {posten.rechnungsnummer ?? new Date(posten.datum).toLocaleDateString('de-AT')}
          </span>
        </nav>
        <div className="flex items-center gap-2">
          <PrintButton />
          {writeOk && (
            <form action={deactivateWithId} style={{ display: 'inline' }}>
              <button
                type="submit"
                className="text-xs text-red-500 hover:text-red-700 hover:underline"
                onClick={e => { if (!confirm('Verkauf wirklich löschen?')) e.preventDefault() }}
              >
                Löschen
              </button>
            </form>
          )}
        </div>
      </div>

      {/* ── RECHNUNG / LIEFERSCHEIN ─────────────────────────────────────────── */}

      {/* Print-Kopf (Absender) */}
      <div className="print-only px-0 pt-0">
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="font-bold text-lg">{(settings as R).betrieb_name ?? 'Weingut'}</p>
            {(settings as R).betrieb_adresse && <p className="text-sm">{(settings as R).betrieb_adresse}</p>}
            {(settings as R).betrieb_ort     && <p className="text-sm">{(settings as R).betrieb_ort}</p>}
            {(settings as R).betrieb_telefon && <p className="text-sm">Tel: {(settings as R).betrieb_telefon}</p>}
            {(settings as R).betrieb_email   && <p className="text-sm">{(settings as R).betrieb_email}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">Lieferschein</p>
            {posten.rechnungsnummer && <p className="text-sm">Nr. {posten.rechnungsnummer}</p>}
            <p className="text-sm">{new Date(posten.datum).toLocaleDateString('de-AT')}</p>
          </div>
        </div>
        {/* Empfänger */}
        <div className="mb-8">
          <p className="font-semibold">{kundenName(posten)}</p>
          {info.email   && <p className="text-sm">{info.email}</p>}
          {info.telefon && <p className="text-sm">{info.telefon}</p>}
        </div>
      </div>

      {/* Kopfkarte (Screen) */}
      <div className="card p-5 no-print">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {posten.rechnungsnummer
                ? <>Beleg <span className="font-mono">{posten.rechnungsnummer}</span></>
                : 'Verkauf'}
            </h1>
            <p className="text-sm text-s112-muted mt-0.5">
              {new Date(posten.datum).toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          {hasTank && (
            <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full font-medium">
              Enthält Tankverkauf
            </span>
          )}
        </div>
        {kundenName(posten) !== '–' && (
          <div className="mt-3 pt-3 border-t border-s112-border text-sm">
            <span className="text-s112-muted">Kunde:</span>{' '}
            <span className="font-medium text-gray-800">{kundenName(posten)}</span>
            {info.email   && <span className="text-s112-muted ml-3">✉ {info.email}</span>}
            {info.telefon && <span className="text-s112-muted ml-3">📞 {info.telefon}</span>}
          </div>
        )}
        {posten.notizen && (
          <p className="text-sm text-s112-muted mt-2 italic">{posten.notizen}</p>
        )}
      </div>

      {/* Positionen-Tabelle */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border">
              <th className="text-left px-4 py-3 font-semibold text-gray-700">Bezeichnung</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700">Menge</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700">Einheit</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700">Preis/Einh.</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700">Summe</th>
            </tr>
          </thead>
          <tbody>
            {positionen.map((pos: R, i: number) => {
              const summe = pos.preis_brutto != null
                ? Number(pos.preis_brutto) * Number(pos.menge)
                : null
              const sub: string[] = []
              if (pos.fuellung?.jahrgang) sub.push(String(pos.fuellung.jahrgang))
              if (pos.fuellung?.flaschengroesse_ml) {
                sub.push(FLASCHEN_LABEL[pos.fuellung.flaschengroesse_ml] ?? `${pos.fuellung.flaschengroesse_ml} ml`)
              }
              if (pos.typ === 'tank') sub.push('Tankverkauf')
              return (
                <tr key={pos.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{pos.name}</div>
                    {sub.length > 0 && (
                      <div className="text-xs text-s112-muted mt-0.5">{sub.join(' · ')}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{Number(pos.menge).toLocaleString('de-AT')}</td>
                  <td className="px-4 py-3 text-s112-muted">{pos.einheit}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {pos.preis_brutto != null
                      ? Number(pos.preis_brutto).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                      : <span className="text-s112-muted">–</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-s112-teal tabular-nums">
                    {summe != null
                      ? summe.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                      : <span className="text-s112-muted font-normal">–</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-s112-border bg-s112-bg">
              <td colSpan={4} className="px-4 py-3 text-right font-semibold text-gray-700">Gesamt brutto</td>
              <td className="px-4 py-3 text-right font-bold text-lg text-s112-teal tabular-nums">
                {gesamt.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* MwSt-Hinweis */}
        <div className="px-4 py-3 text-xs text-gray-400 text-right border-t border-s112-border">
          Alle Preise inkl. MwSt.
        </div>
      </div>

      {/* ── TRANSPORTSCHEIN (nur bei Tank-Positionen) ─────────────────────── */}
      {hasTank && (
        <div className="card p-5 border-2 border-blue-200 space-y-4">
          {/* Print-Seitenumbruch */}
          <div className="print-page-break print-only" />

          {/* Screen-Header */}
          <div className="flex items-center justify-between no-print">
            <h2 className="font-semibold text-gray-700">
              🚛 Transportschein (Tankverkauf)
            </h2>
            <span className="text-xs text-s112-muted">Wird beim Drucken ausgegeben</span>
          </div>

          {/* Print-Header */}
          <div className="print-only">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="font-bold text-lg">{(settings as R).betrieb_name ?? 'Weingut'}</p>
                {(settings as R).betrieb_adresse && <p className="text-sm">{(settings as R).betrieb_adresse}</p>}
                {(settings as R).betrieb_ort     && <p className="text-sm">{(settings as R).betrieb_ort}</p>}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">Transportschein</p>
                {posten.rechnungsnummer && <p className="text-sm">Beleg Nr. {posten.rechnungsnummer}</p>}
                <p className="text-sm">{new Date(posten.datum).toLocaleDateString('de-AT')}</p>
              </div>
            </div>
          </div>

          {/* Inhalt */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-s112-muted mb-0.5">Absender</p>
                <p className="font-medium">{(settings as R).betrieb_name ?? '–'}</p>
                {(settings as R).betrieb_adresse && <p className="text-xs text-gray-600">{(settings as R).betrieb_adresse}</p>}
                {(settings as R).betrieb_ort     && <p className="text-xs text-gray-600">{(settings as R).betrieb_ort}</p>}
              </div>
              <div>
                <p className="text-xs text-s112-muted mb-0.5">Empfänger</p>
                <p className="font-medium">{kundenName(posten)}</p>
                {info.email   && <p className="text-xs text-gray-600">{info.email}</p>}
                {info.telefon && <p className="text-xs text-gray-600">{info.telefon}</p>}
              </div>
            </div>

            {/* Transportierte Ware */}
            <table className="w-full text-sm border border-s112-border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-blue-50 border-b border-s112-border">
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Produkt</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-700">Menge (L)</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Behälter</th>
                </tr>
              </thead>
              <tbody>
                {tankPos.map((pos: R) => (
                  <tr key={pos.id} className="border-b border-s112-border last:border-0">
                    <td className="px-3 py-2 font-medium">{pos.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(pos.menge).toLocaleString('de-AT')} L</td>
                    <td className="px-3 py-2 text-s112-muted text-xs">{pos.weinausbau?.name ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Unterschriften */}
            <div className="grid grid-cols-2 gap-8 pt-4 mt-4 border-t border-dashed border-gray-300">
              <div>
                <div className="h-12 border-b border-gray-400" />
                <p className="text-xs text-gray-500 mt-1">Unterschrift Absender / Datum</p>
              </div>
              <div>
                <div className="h-12 border-b border-gray-400" />
                <p className="text-xs text-gray-500 mt-1">Unterschrift Empfänger / Datum</p>
              </div>
            </div>

            <p className="text-xs text-gray-400 pt-1">
              Begleitdokument gemäß Weingesetz. Der Empfänger bestätigt den einwandfreien Erhalt der oben angeführten Ware.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
