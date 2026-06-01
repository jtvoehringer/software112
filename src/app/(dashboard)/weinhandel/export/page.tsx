import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Export – software:112' }
export const dynamic = 'force-dynamic'

export default async function ExportPage() {
  const supabase = await createSupabaseServerClient()

  // Zähler für Info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ count: kontakteCount }, { count: firmenCount }, { count: fuellungenCount }, { count: verkaufCount }] = await Promise.all([
    (supabase.from('kontakte') as any).select('*', { count: 'exact', head: true }).eq('aktiv', true),
    (supabase.from('firmen') as any).select('*', { count: 'exact', head: true }).eq('aktiv', true),
    (supabase.from('fuellungen') as any).select('*', { count: 'exact', head: true }).eq('aktiv', true),
    (supabase.from('verkaufsposten') as any).select('*', { count: 'exact', head: true }).eq('aktiv', true),
  ])

  const exports = [
    {
      title: 'Kontakte',
      beschreibung: 'Alle aktiven Kontakte mit Adresse, Telefon, Segment, Lead-Status, Sonderrabatt',
      anzahl: kontakteCount ?? 0,
      einheit: 'Kontakte',
      href: '/api/export/kontakte',
      icon: '👤',
      format: 'CSV',
    },
    {
      title: 'Firmen',
      beschreibung: 'Alle aktiven Firmen mit Adresse, Ansprechpartner, Zahlungsziel, Segment',
      anzahl: firmenCount ?? 0,
      einheit: 'Firmen',
      href: '/api/export/firmen',
      icon: '🏢',
      format: 'CSV',
    },
    {
      title: 'Lagerbestand',
      beschreibung: 'Aktuelle Füllungen mit Bestand, Jahrgang, Rebsorte, VK-Preis und Lagerwert',
      anzahl: fuellungenCount ?? 0,
      einheit: 'Artikel',
      href: '/api/export/lager',
      icon: '🍾',
      format: 'CSV',
    },
    {
      title: 'Verkaufshistorie',
      beschreibung: 'Alle Verkaufsposten mit Positionen, Kundenzuordnung, Rechnungsnummer, Betrag',
      anzahl: verkaufCount ?? 0,
      einheit: 'Vorgänge',
      href: '/api/export/verkauf',
      icon: '🛒',
      format: 'CSV',
    },
  ]

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Datenexport</h1>
        <p className="text-sm text-s112-muted mt-1">CSV-Exporte für Excel, Steuerberater und externe Systeme</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {exports.map(exp => (
          <a key={exp.href} href={exp.href} download
            className="card p-5 hover:border-s112-teal hover:shadow-md transition-all group flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{exp.icon}</span>
                <div>
                  <p className="font-semibold text-gray-900 group-hover:text-s112-teal">{exp.title}</p>
                  <p className="text-xs text-s112-muted">{exp.anzahl} {exp.einheit}</p>
                </div>
              </div>
              <span className="text-xs bg-s112-bg border border-s112-border px-2 py-0.5 rounded font-mono text-gray-500">{exp.format}</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{exp.beschreibung}</p>
            <div className="flex items-center gap-1.5 text-xs text-s112-teal font-medium mt-auto">
              ⬇ Herunterladen
            </div>
          </a>
        ))}
      </div>

      <div className="text-xs text-s112-muted">
        Alle Exporte sind Excel-kompatibel (BOM-kodiert, Semikolon-getrennt) und enthalten eine Kopfzeile.
      </div>
    </div>
  )
}
