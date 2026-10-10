import { createSupabaseServerClient } from '@/lib/supabase/server'
import { gezaehlt } from '@/lib/supabase/geladen'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { Users, Building2, Package, ShoppingCart, type LucideIcon } from 'lucide-react'

export const metadata: Metadata = { title: 'Datenexport – software:112' }
export const dynamic = 'force-dynamic'

// Tooltip des Knopfs (statt des Hinweises auf KG-Nr./BBCH der Behördenmeldungen)
const DATENEXPORT_TIPP = 'CSV für Excel (Semikolon, UTF-8). Werte mit + am Anfang (Vorwahl „+43“) stehen mit Apostroph davor (Formelschutz).'

export default async function ExportPage() {
  const supabase = await createSupabaseServerClient()
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
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

  // format: Seit KAN-54 (25.09.2026) erzeugen alle vier /api/export-Routen die CSV über den
  // CSV-Baustein (lib/csv, PROFIL_EXCEL_AT): Semikolon, UTF-8 mit BOM, CRLF, Kopfzeile.
  const exports: { title: string; beschreibung: string; anzahl: number; einheit: string; href: string; icon: LucideIcon; format: string }[] = [
    {
      title: 'Kontakte',
      beschreibung: 'Alle aktiven Kontakte mit Adresse, Telefon, Segment, Lead-Status, Sonderrabatt',
      anzahl: kontakteCount ?? 0,
      einheit: 'Kontakte',
      href: '/api/export/kontakte',
      icon: Users,
      format: 'CSV · Semikolon',
    },
    {
      title: 'Firmen',
      beschreibung: 'Alle aktiven Firmen mit Adresse, Ansprechpartner, Zahlungsziel, Segment',
      anzahl: firmenCount ?? 0,
      einheit: 'Firmen',
      href: '/api/export/firmen',
      icon: Building2,
      format: 'CSV · Semikolon',
    },
    {
      title: 'Lagerbestand',
      beschreibung: 'Aktuelle Füllungen mit Bestand, Jahrgang, Rebsorte, VK-Preis und Lagerwert',
      anzahl: fuellungenCount ?? 0,
      einheit: 'Artikel',
      href: '/api/export/lager',
      icon: Package,
      format: 'CSV · Semikolon',
    },
    {
      title: 'Verkaufshistorie',
      beschreibung: 'Alle Verkaufsposten mit Positionen, Kundenzuordnung, Rechnungsnummer, Betrag',
      anzahl: verkaufCount ?? 0,
      einheit: 'Vorgänge',
      href: '/api/export/verkauf',
      icon: ShoppingCart,
      format: 'CSV · Semikolon',
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
          // Download per CsvExportKnopf statt <a download>: zeigt Fehler (401/403/500 als JSON) und die
          // X-Warnungen der Route (z. B. ungültige Werte, die leer gelassen wurden) an
          <div key={exp.href} className="card p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <exp.icon size={22} className="text-s112-blue-700 shrink-0" />
                <div>
                  <p className="font-semibold text-s112-text">{exp.title}</p>
                  <p className="text-xs text-s112-muted">{exp.anzahl} {exp.einheit}</p>
                </div>
              </div>
              <span className="text-xs bg-s112-bg border border-s112-border px-2 py-0.5 rounded-sm font-mono text-s112-text-2">{exp.format}</span>
            </div>
            <p className="text-xs text-s112-text-2 leading-relaxed">{exp.beschreibung}</p>
            <CsvExportKnopf href={exp.href} label="Herunterladen" ariaLabel={`${exp.title} als CSV herunterladen`}
              hinweis={DATENEXPORT_TIPP} className="mt-auto" />
          </div>
        ))}
      </div>

      <div className="text-xs text-s112-muted space-y-1">
        <p>
          Alle Exporte sind UTF-8 mit BOM (Umlaute stimmen in Excel), Semikolon-getrennt mit Dezimalkomma und
          Datum als TT.MM.JJJJ und enthalten eine Kopfzeile – sie öffnen in Excel (Region Deutsch/Österreich) per
          Doppelklick. Postleitzahlen und Telefonnummern mit führender Null bleiben nur exakt, wenn du die Datei
          in Excel über „Daten › Aus Text/CSV“ öffnest und die Spalte als Text importierst.
        </p>
        <p>
          Werte, die mit =, +, - oder @ beginnen – etwa die Vorwahl „+43“ –, stehen zum Schutz vor Formeln mit
          vorangestelltem Apostroph in der Datei („&apos;+43“). Liest ein anderes Programm die Datei ein, das
          Apostroph dort gegebenenfalls entfernen. Nach dem Download nennt der Knopf die Zahl der Zeilen und
          Hinweise zum Prüfen, z. B. ungültige Werte, die leer gelassen wurden.
        </p>
        <p>
          Behördenmeldungen (Erntemeldung, Pflanzenschutz, Kellerbuch, UVA …) exportierst du im selben Format
          auf ihrer Seite bzw. unter{' '}
          <Link href="/dashboard/fristen" className="text-s112-blue-700 hover:underline">Übersicht › Meldungen & Fristen</Link>.
        </p>
      </div>
    </div>
  )
}
