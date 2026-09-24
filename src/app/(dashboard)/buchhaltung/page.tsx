// behoerdenmeldung: ea-journal
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { deleteEaTransaktion } from './actions'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { Trash2, Link2, Lock } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeEaJournal } from '@/lib/behoerden/ea-journal'
import { datumText, summe } from '@/lib/behoerden/buchhaltung-gemeinsam'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null | undefined) {
  return fmtNum((n ?? 0), 2)
}

// Behördenmeldung „ea-journal“ (24.09.2026): Die Buchungsliste kommt aus ladeEaJournal()
// (lib/behoerden/ea-journal.ts) – dieselbe Ladefunktion liefert die CSV
// (/meldungen/ea-journal/csv?jahr=&typ=&q=, gleicher Filter wie die Seite, ohne 1.000er-Deckel).

export default async function BuchhaltungPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string; typ?: string; q?: string }>
}) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  // Modul-Check
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')

  const sp       = await searchParams
  const aktJahr  = Number(wienHeute().slice(0, 4))
  const jahr     = parseInt(sp.jahr ?? '') || aktJahr
  const typFilter = sp.typ === 'einnahme' || sp.typ === 'ausgabe' ? sp.typ : ''
  const q        = (sp.q ?? '').trim().slice(0, 200)

  // Buchungen laden – chronologisch aus der Ladefunktion, hier neueste zuerst
  const { zeilen } = await ladeEaJournal(supabase, tenantId, { jahr, typ: typFilter || null, q: q || null })
  const buchungen = [...zeilen].reverse()
  // Anlagenverzeichnis (Migration 200): welche Anschaffungsbuchungen sind schon eine Anlage?
  const { data: anlagenRaw } = await (supabase.from('ea_anlagen') as any).select('id, transaktion_id').eq('tenant_id', tenantId).not('transaktion_id', 'is', null)
  const anlageZuBuchung = new Map<string, string>(((anlagenRaw ?? []) as R[]).map(a => [a.transaktion_id as string, a.id as string]))

  // Summen aus den (gerundeten) Zeilenwerten – wie in der CSV
  const einnahmen = summe(buchungen.filter(b => b.typ === 'einnahme').map(b => b.brutto))
  const ausgaben = summe(buchungen.filter(b => b.typ === 'ausgabe').map(b => b.brutto))

  // Migration 168 - nicht abzugsfähiger Anteil bei eingeschränkt abzugsfähigen
  // Ausgaben (z.B. 50% Bewirtung/Repräsentation gem. § 20 EStG). Nur ein
  // Info-Wert zur Abstimmung mit dem Steuerberater - ersetzt keine
  // vollständige steuerliche Gewinnermittlung (AfA, GWG, Privatanteile etc.).
  const nichtAbzugsfaehig = summe(buchungen.map(b => b.nichtAbzugsfaehig))

  const jahre = Array.from({ length: 5 }, (_, i) => aktJahr - i)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">E&A-Rechnung</h1>
          <p className="text-sm text-s112-muted">Einnahmen-Ausgaben-Rechner · § 4 Abs. 3 EStG</p>
        </div>
        <Link href="/buchhaltung/neu"
          className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          + Buchung
        </Link>
      </div>

      {/* KPI-Karten */}
      <div className={`grid gap-4 mb-6 ${nichtAbzugsfaehig > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <div className="bg-white rounded-xl border border-s112-border p-4">
          <p className="text-xs text-s112-muted mb-1">Einnahmen (Brutto)</p>
          <p className="text-2xl font-semibold text-s112-ok-fg">€ {fmt(einnahmen)}</p>
        </div>
        <div className="bg-white rounded-xl border border-s112-border p-4">
          <p className="text-xs text-s112-muted mb-1">Ausgaben (Brutto)</p>
          <p className="text-2xl font-semibold text-s112-err">€ {fmt(ausgaben)}</p>
        </div>
        <div className="bg-white rounded-xl border border-s112-border p-4">
          <p className="text-xs text-s112-muted mb-1">Überschuss</p>
          <p className={`text-2xl font-semibold ${einnahmen - ausgaben >= 0 ? 'text-s112-blue-700' : 'text-s112-err-fg'}`}>
            € {fmt(einnahmen - ausgaben)}
          </p>
        </div>
        {nichtAbzugsfaehig > 0 && (
          <div className="bg-white rounded-xl border border-s112-warn/30 p-4">
            <p className="text-xs text-s112-muted mb-1" title="Anteil gebuchter Ausgaben, der laut hinterlegter Kategorie steuerlich nicht abzugsfähig ist (z.B. 50% Bewirtung/Repräsentation gem. § 20 EStG). Info-Wert zur Abstimmung mit dem Steuerberater - keine vollständige steuerliche Gewinnermittlung.">
              davon nicht abzugsfähig ⓘ
            </p>
            <p className="text-2xl font-semibold text-s112-warn-fg">€ {fmt(nichtAbzugsfaehig)}</p>
          </div>
        )}
      </div>

      {/* Filter */}
      <form method="GET" className="bg-white rounded-xl border border-s112-border p-4 mb-4 flex gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Jahr</label>
          <select aria-label="Jahr" name="jahr" defaultValue={String(jahr)}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {jahre.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Typ</label>
          <select aria-label="Typ" name="typ" defaultValue={typFilter}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            <option value="">Alle</option>
            <option value="einnahme">Einnahmen</option>
            <option value="ausgabe">Ausgaben</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Suche</label>
          <input aria-label="Suche" name="q" defaultValue={q} placeholder="Bezeichnung…"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        </div>
        <button type="submit"
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm">Filtern</button>
      </form>

      {/* Quick-Links */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-x-2 gap-y-1 text-sm pt-1">
          <Link href="/buchhaltung/belege" className="text-s112-blue-700 hover:underline">Belege</Link>
          <span className="text-s112-tertiary">·</span>
          <Link href="/buchhaltung/uva" className="text-s112-blue-700 hover:underline">UVA-Meldung</Link>
          <span className="text-s112-tertiary">·</span>
          <Link href="/buchhaltung/kategorien" className="text-s112-blue-700 hover:underline">Kategorien</Link>
          <span className="text-s112-tertiary">·</span>
          <Link href="/buchhaltung/dauerauftraege" className="text-s112-blue-700 hover:underline">Daueraufträge</Link>
          <span className="text-s112-tertiary">·</span>
          <Link href="/buchhaltung/monatsabschluss" className="text-s112-blue-700 hover:underline">Monatsabschluss</Link>
          <span className="text-s112-tertiary">·</span>
          <Link href="/buchhaltung/anlagen" className="text-s112-blue-700 hover:underline">Anlagen & AfA</Link>
          <span className="text-s112-tertiary">·</span>
          <Link href="/buchhaltung/rechnungsjournal" className="text-s112-blue-700 hover:underline">Rechnungsjournal</Link>
          <span className="text-s112-tertiary">·</span>
          <Link href="/buchhaltung/kassabuch" className="text-s112-blue-700 hover:underline">Kassabuch</Link>
        </div>
        <CsvExportKnopf href={csvPfad('ea-journal', { jahr, typ: typFilter, q })} />
      </div>

      {/* Tabelle */}
      <div className="bg-white rounded-xl border border-s112-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border bg-s112-bg">
              <th className="text-left px-4 py-3 font-medium text-s112-text-2">Datum</th>
              <th className="text-left px-4 py-3 font-medium text-s112-text-2">Bezeichnung</th>
              <th className="text-left px-4 py-3 font-medium text-s112-text-2">Kategorie</th>
              <th className="text-left px-4 py-3 font-medium text-s112-text-2">USt</th>
              <th className="text-right px-4 py-3 font-medium text-s112-text-2">Netto</th>
              <th className="text-right px-4 py-3 font-medium text-s112-text-2">Brutto</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {buchungen.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-s112-muted">
                  Keine Buchungen für {jahr}
                  {typFilter ? ` (${typFilter === 'einnahme' ? 'Einnahmen' : 'Ausgaben'})` : ''}
                </td>
              </tr>
            )}
            {buchungen.map(b => (
              <tr key={b.id} className="border-b border-s112-border/50 hover:bg-s112-bg/50">
                <td className="px-4 py-3 text-s112-text-2 whitespace-nowrap">
                  {datumText(b.datum)}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${b.typ === 'einnahme' ? 'bg-s112-ok' : 'bg-s112-err'}`} />
                  {b.bezeichnung}
                  {b.gesperrt && (
                    <span title="Zeitraum gesperrt (Monatsabschluss oder UVA übermittelt)">
                      <Lock className="inline-block w-3 h-3 text-s112-tertiary ml-1.5 -mt-0.5" />
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-s112-text-2 text-xs">
                  {b.kategorie ?? '–'}
                  {b.anlageId && (
                    <Link href={`/buchhaltung/anlagen/${b.anlageId}`} className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-s112-blue-50 text-s112-blue-700 hover:underline" title="AfA-Buchung aus dem Anlagenverzeichnis – zurücknehmen unter Anlagen & AfA">
                      AfA
                    </Link>
                  )}
                  {!b.anlageId && b.typ === 'ausgabe' && b.kategorieKontoNr !== null && b.kategorieKontoNr < 1000 && (
                    anlageZuBuchung.has(b.id)
                      ? <Link href={`/buchhaltung/anlagen/${anlageZuBuchung.get(b.id)}`} className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F2F3F5] text-s112-text-1 hover:underline" title="Als Anlage erfasst">Anlage</Link>
                      : <Link href={`/buchhaltung/anlagen/neu?buchung=${b.id}`} className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-s112-warn-bg text-s112-warn-fg hover:underline" title="Anschaffung noch nicht im Anlagenverzeichnis">Anlage anlegen</Link>
                  )}
                  {(b.abzugsfaehigPct ?? 100) < 100 && (
                    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-s112-warn-bg text-s112-warn-fg"
                      title="Eingeschränkt abzugsfähig">
                      {b.abzugsfaehigPct}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-s112-text-2">{b.ustSatz === null ? '–' : `${b.ustSatz}%`}</td>
                <td className="px-4 py-3 text-right font-mono">€ {fmt(b.netto)}</td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${b.typ === 'einnahme' ? 'text-s112-ok-fg' : 'text-s112-err'}`}>
                  € {fmt(b.brutto)}
                </td>
                <td className="px-4 py-3 text-right">
                  {b.verkaufspostenId ? (
                    <Link
                      href={`/weinhandel/verkauf/${b.verkaufspostenId}`}
                      className="inline-flex items-center gap-1 text-xs text-s112-tertiary hover:text-s112-blue-700"
                      title={`Automatisch aus Zahlungseingang${b.rechnungsnummer ? ` (${b.rechnungsnummer})` : ''} – zur Löschung Zahlung stornieren`}
                    >
                      <Link2 className="w-3.5 h-3.5" /> Verkauf
                    </Link>
                  ) : b.anlageId ? null : !b.gesperrt && (
                    <form action={async () => {
                      'use server'
                      await deleteEaTransaktion(b.id)
                    }}>
                      <button type="submit"
                        className="text-xs text-s112-err hover:text-s112-err-fg"
                        title="Buchung löschen">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
