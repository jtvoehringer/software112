import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { deleteEaTransaktion } from './actions'
import CsvExportButton from './CsvExportButton'
import { Trash2, Link2, Lock } from 'lucide-react'
import { fmtNum } from '@/lib/format'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null | undefined) {
  return fmtNum((n ?? 0), 2)
}

export default async function BuchhaltungPage({
  searchParams,
}: {
  searchParams: { jahr?: string; typ?: string; q?: string }
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
  const jahr     = parseInt(sp.jahr ?? '') || new Date().getFullYear()
  const typFilter = sp.typ ?? ''
  const q        = sp.q ?? ''

  // Buchungen laden
  let query = (supabase.from('ea_transaktionen') as any)
    .select('*, ea_kategorien(name, konto_nr), verkaufsposten(rechnungsnummer, kontakt:kontakte!kontakt_id(accountnummer), firma:firmen(debitor_nr, accountnummer))')
    // abzugsfaehig_pct/betrag_abzugsfaehig kommen bereits über '*' mit (Migration 168)
    .eq('tenant_id', tenantId)
    .gte('datum', `${jahr}-01-01`)
    .lte('datum', `${jahr}-12-31`)
    .order('datum', { ascending: false })

  if (typFilter) query = query.eq('typ', typFilter)
  if (q)         query = query.ilike('beschreibung', `%${q}%`)

  const { data: buchungen } = await query
  // Anlagenverzeichnis (Migration 200): welche Anschaffungsbuchungen sind schon eine Anlage?
  const { data: anlagenRaw } = await (supabase.from('ea_anlagen') as any).select('id, transaktion_id').eq('tenant_id', tenantId).not('transaktion_id', 'is', null)
  const anlageZuBuchung = new Map<string, string>(((anlagenRaw ?? []) as R[]).map(a => [a.transaktion_id as string, a.id as string]))

  // Summen berechnen
  const einnahmen = (buchungen as R[])?.filter(b => b.typ === 'einnahme')
    .reduce((s: number, b: R) => s + (b.betrag_brutto ?? 0), 0) ?? 0
  const ausgaben = (buchungen as R[])?.filter(b => b.typ === 'ausgabe')
    .reduce((s: number, b: R) => s + (b.betrag_brutto ?? 0), 0) ?? 0

  // Migration 168 - nicht abzugsfähiger Anteil bei eingeschränkt abzugsfähigen
  // Ausgaben (z.B. 50% Bewirtung/Repräsentation gem. § 20 EStG). Nur ein
  // Info-Wert zur Abstimmung mit dem Steuerberater - ersetzt keine
  // vollständige steuerliche Gewinnermittlung (AfA, GWG, Privatanteile etc.).
  const nichtAbzugsfaehig = (buchungen as R[])?.filter(b => b.typ === 'ausgabe')
    .reduce((s: number, b: R) => s + Math.max(0, (b.betrag_netto ?? 0) - (b.betrag_abzugsfaehig ?? b.betrag_netto ?? 0)), 0) ?? 0

  const jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

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
          <select name="jahr" defaultValue={String(jahr)}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {jahre.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Typ</label>
          <select name="typ" defaultValue={typFilter}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            <option value="">Alle</option>
            <option value="einnahme">Einnahmen</option>
            <option value="ausgabe">Ausgaben</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Suche</label>
          <input name="q" defaultValue={q} placeholder="Bezeichnung…"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        </div>
        <button type="submit"
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm">Filtern</button>
      </form>

      {/* Quick-Links */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2 text-sm">
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
        </div>
        {buchungen && buchungen.length > 0 && (
          <CsvExportButton buchungen={buchungen as R[]} jahr={jahr} />
        )}
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
            {(!buchungen || buchungen.length === 0) && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-s112-muted">
                  Keine Buchungen für {jahr}
                  {typFilter ? ` (${typFilter === 'einnahme' ? 'Einnahmen' : 'Ausgaben'})` : ''}
                </td>
              </tr>
            )}
            {(buchungen as R[])?.map((b: R) => (
              <tr key={b.id} className="border-b border-s112-border/50 hover:bg-s112-bg/50">
                <td className="px-4 py-3 text-s112-text-2 whitespace-nowrap">
                  {new Date(b.datum).toLocaleDateString('de-AT')}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${b.typ === 'einnahme' ? 'bg-s112-ok' : 'bg-s112-err'}`} />
                  {b.beschreibung}
                  {b.is_locked && (
                    <span title="Zeitraum gesperrt (Monatsabschluss oder UVA übermittelt)">
                      <Lock className="inline-block w-3 h-3 text-s112-tertiary ml-1.5 -mt-0.5" />
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-s112-text-2 text-xs">
                  {b.ea_kategorien?.name ?? '–'}
                  {b.anlage_id && (
                    <Link href={`/buchhaltung/anlagen/${b.anlage_id}`} className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-s112-blue-50 text-s112-blue-700 hover:underline" title="AfA-Buchung aus dem Anlagenverzeichnis – zurücknehmen unter Anlagen & AfA">
                      AfA
                    </Link>
                  )}
                  {!b.anlage_id && b.typ === 'ausgabe' && b.ea_kategorien?.konto_nr != null && Number(b.ea_kategorien.konto_nr) < 1000 && (
                    anlageZuBuchung.has(b.id)
                      ? <Link href={`/buchhaltung/anlagen/${anlageZuBuchung.get(b.id)}`} className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#F2F3F5] text-s112-text-1 hover:underline" title="Als Anlage erfasst">Anlage</Link>
                      : <Link href={`/buchhaltung/anlagen/neu?buchung=${b.id}`} className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-s112-warn-bg text-s112-warn-fg hover:underline" title="Anschaffung noch nicht im Anlagenverzeichnis">Anlage anlegen</Link>
                  )}
                  {Number(b.abzugsfaehig_pct ?? 100) < 100 && (
                    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-s112-warn-bg text-s112-warn-fg"
                      title="Eingeschränkt abzugsfähig">
                      {b.abzugsfaehig_pct}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-s112-text-2">{b.ust_satz}%</td>
                <td className="px-4 py-3 text-right font-mono">€ {fmt(b.betrag_netto)}</td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${b.typ === 'einnahme' ? 'text-s112-ok-fg' : 'text-s112-err'}`}>
                  € {fmt(b.betrag_brutto)}
                </td>
                <td className="px-4 py-3 text-right">
                  {b.verkaufsposten_id ? (
                    <Link
                      href={`/weinhandel/verkauf/${b.verkaufsposten_id}`}
                      className="inline-flex items-center gap-1 text-xs text-s112-tertiary hover:text-s112-blue-700"
                      title={`Automatisch aus Zahlungseingang${b.verkaufsposten?.rechnungsnummer ? ` (${b.verkaufsposten.rechnungsnummer})` : ''} – zur Löschung Zahlung stornieren`}
                    >
                      <Link2 className="w-3.5 h-3.5" /> Verkauf
                    </Link>
                  ) : b.anlage_id ? null : !b.is_locked && (
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
