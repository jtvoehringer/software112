import { createSupabaseServerClient } from '@/lib/supabase/server'
import { gezaehlt } from '@/lib/supabase/geladen'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { Users, Building2, Wine, ShoppingCart, type LucideIcon, FileText } from 'lucide-react'

export const metadata: Metadata = { title: 'Datenexport – software:112' }
export const dynamic = 'force-dynamic'

export default async function ExportPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Zähler für Info
  const [kontakteRes, firmenRes, fuellungenRes, verkaufRes] = await Promise.all([
    tf((supabase.from('kontakte') as any).select('*', { count: 'exact', head: true }).eq('aktiv', true)),
    tf((supabase.from('firmen') as any).select('*', { count: 'exact', head: true }).eq('aktiv', true)),
    tf((supabase.from('fuellungen') as any).select('*', { count: 'exact', head: true }).eq('aktiv', true)),
    tf((supabase.from('verkaufsposten') as any).select('*', { count: 'exact', head: true }).eq('aktiv', true)),
  ])
  // Sweep 90 (KAN-282): Lesefehler wirft (Fehlergrenze) statt „0 Datensätze“
  const kontakteCount = gezaehlt(kontakteRes, 'Kontakte')
  const firmenCount = gezaehlt(firmenRes, 'Firmen')
  const fuellungenCount = gezaehlt(fuellungenRes, 'Füllungen')
  const verkaufCount = gezaehlt(verkaufRes, 'Verkäufe')

  const exports: {
    title: string
    beschreibung: string
    anzahl: number
    einheit: string
    href: string
    icon: LucideIcon
    format: string
  }[] = [
    {
      title: 'Kontakte',
      beschreibung: 'Alle aktiven Kontakte mit Adresse, Telefon, Segment, Lead-Status, Sonderrabatt',
      anzahl: kontakteCount ?? 0,
      einheit: 'Kontakte',
      href: '/api/export/kontakte',
      icon: Users,
      format: 'CSV',
    },
    {
      title: 'Firmen',
      beschreibung: 'Alle aktiven Firmen mit Adresse, Ansprechpartner, Zahlungsziel, Segment',
      anzahl: firmenCount ?? 0,
      einheit: 'Firmen',
      href: '/api/export/firmen',
      icon: Building2,
      format: 'CSV',
    },
    {
      title: 'Lagerbestand',
      beschreibung: 'Aktuelle Füllungen mit Bestand, Jahrgang, Rebsorte, VK-Preis und Lagerwert',
      anzahl: fuellungenCount ?? 0,
      einheit: 'Artikel',
      href: '/api/export/lager',
      icon: Wine,
      format: 'CSV',
    },
    {
      title: 'Produktdatenblätter (Händler)',
      beschreibung: 'Aktive Füllungen mit Sorte, Herkunft, Qualität, Alkohol, Restzucker, Säure, Flaschengröße, Prüfnummer und E-Label-Link',
      anzahl: fuellungenCount ?? 0,
      einheit: 'Artikel',
      href: '/api/export/datenblaetter',
      icon: FileText,
      format: 'CSV',
    },
    {
      title: 'Verkaufshistorie',
      beschreibung: 'Alle Verkaufsposten mit Positionen, Kundenzuordnung, Rechnungsnummer, Betrag',
      anzahl: verkaufCount ?? 0,
      einheit: 'Vorgänge',
      href: '/api/export/verkauf',
      icon: ShoppingCart,
      format: 'CSV',
    },
  ]

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Datenexport</h1>
        <p className="text-sm text-s112-muted mt-1">CSV-Exporte für Excel, Steuerberater und externe Systeme</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {exports.map(exp => (
          // wie Controlling › Datenexport: CsvExportKnopf zeigt Fehler und X-Warnungen der Route an
          <div key={exp.href} className="card p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <exp.icon className="w-6 h-6 text-s112-blue-700" />
                <div>
                  <p className="font-semibold text-s112-text">{exp.title}</p>
                  <p className="text-xs text-s112-muted">{exp.anzahl} {exp.einheit}</p>
                </div>
              </div>
              <span className="text-xs bg-s112-bg border border-s112-border px-2 py-0.5 rounded-sm font-mono text-s112-text-2">{exp.format}</span>
            </div>
            <p className="text-xs text-s112-text-2 leading-relaxed">{exp.beschreibung}</p>
            <CsvExportKnopf href={exp.href} label="Herunterladen" ariaLabel={`${exp.title} als CSV herunterladen`} className="mt-auto" />
          </div>
        ))}
      </div>

      <div className="text-xs text-s112-muted">
        Alle Exporte sind Excel-kompatibel (BOM-kodiert, Semikolon-getrennt) und enthalten eine Kopfzeile.
      </div>
    </div>
  )
}
