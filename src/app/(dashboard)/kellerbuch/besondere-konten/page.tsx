// behoerdenmeldung: besondere-konten, bki-besondere-konten
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import DruckFormatKnopf from '@/components/DruckFormatKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { fmtNum } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { kontoauszug, weinwirtschaftsjahr } from '@/lib/kellerbuch/stoffkonto'
import { ladeKontoBuchungen, ladeStoffe } from '@/lib/behoerden/besondereKonten'
import { Kontoauszug, KontoBuchen, StoffAktiv, StoffAnlegen, StoffArtWahl } from './StoffkontoClient'
import { STOFF_ART_LABEL } from '@/lib/kellerbuch/stoffkonto'
import { rund } from '@/lib/zahl/runden'

export const metadata: Metadata = { title: 'Besondere Konten – software:112' }
export const dynamic = 'force-dynamic'

// ── Besondere Konten – Stoffkonto (KAN-107, 07.10.2026) ──
// Stoffe (Saccharose, RTK, Säuerungs- und Entsäuerungsmittel …) mit Kontoauszug und laufendem Saldo; Verwendung bucht
// die Kellerbehandlung. CSV „besondere-konten“ je Weinwirtschaftsjahr (01.08.–31.07.), dieselbe Rechnung.

export default async function BesondereKontenPage({ searchParams }: { searchParams: Promise<{ stoff?: string; jahr?: string }> }) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()
  const role = await getCurrentUserRole()
  const schreiben = canWrite(role, 'kellerbuch') && !(await schreibSperre(membership))
  const supabase = await createSupabaseServerClient()

  const stoffe = await ladeStoffe(supabase, tenantId)
  const alleBuchungen = await ladeKontoBuchungen(supabase, tenantId, null)
  const saldoJe = new Map<string, number>()
  for (const b of alleBuchungen) saldoJe.set(b.kellermittel_id, rund(((saldoJe.get(b.kellermittel_id) ?? 0) + b.menge), 3))
  const gewaehlt = stoffe.find(s => s.id === sp.stoff) ?? stoffe.find(s => s.aktiv) ?? stoffe[0] ?? null
  const auszug = gewaehlt ? kontoauszug(alleBuchungen.filter(b => b.kellermittel_id === gewaehlt.id)) : null
  const wwjHeute = weinwirtschaftsjahr(wienHeute())
  const jahrStart = /^\d{4}$/.test(sp.jahr ?? '') ? Number(sp.jahr) : Number(wwjHeute.von.slice(0, 4))
  const jahre = Array.from({ length: 4 }, (_, i) => Number(wwjHeute.von.slice(0, 4)) - i)

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link><span>/</span>
        <span className="text-s112-text-1 font-medium">Besondere Konten</span>
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Besondere Konten – Stoffkonto</h1>
          <p className="text-sm text-s112-muted">Zucker, RTK, Säuerungs- und Entsäuerungsmittel … – Zugänge, Verwendung aus den Kellerbehandlungen, Inventur.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <form method="get" className="flex items-center gap-1">
            {gewaehlt && <input type="hidden" name="stoff" value={gewaehlt.id} />}
            <select name="jahr" defaultValue={String(jahrStart)} aria-label="Weinwirtschaftsjahr" className="form-input text-sm">
              {jahre.map(j => <option key={j} value={j}>{weinwirtschaftsjahr(`${j}-08-01`).label}</option>)}
            </select>
            <button className="px-2 py-1.5 rounded-lg text-xs border border-s112-border">OK</button>
          </form>
          <CsvExportKnopf href={csvPfad('besondere-konten', { jahr: String(jahrStart) })} />
          {/* KAN-45: dasselbe Weinwirtschaftsjahr im Format der BKI-Schnittstelle (je Buchung, Anfangsstand, Empfangscharge) */}
          <CsvExportKnopf href={csvPfad('bki-besondere-konten', { von: weinwirtschaftsjahr(`${jahrStart}-08-01`).von, bis: weinwirtschaftsjahr(`${jahrStart}-08-01`).bis })} label="CSV (BKI-Schnittstelle)" ariaLabel="CSV exportieren: Besondere Konten im Format der BKI-Schnittstelle" />
          <DruckFormatKnopf klein />
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold text-s112-text">Stoffe</h2>
        {stoffe.length === 0 ? <p className="text-sm text-s112-muted">Noch kein Stoff angelegt.</p> : (
          <div className="flex flex-wrap gap-2">
            {stoffe.map(s => (
              <span key={s.id} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${s.id === gewaehlt?.id ? 'border-s112-teal bg-s112-teal/5' : 'border-s112-border'} ${s.aktiv ? '' : 'opacity-60'}`}>
                <Link href={`/kellerbuch/besondere-konten?stoff=${s.id}`} className="font-medium text-s112-text hover:underline">{s.name}</Link>
                <span className={`tabular-nums ${(saldoJe.get(s.id) ?? 0) < 0 ? 'text-s112-err-fg font-semibold' : 'text-s112-text-2'}`}>{fmtNum(saldoJe.get(s.id) ?? 0, { max: 3 })} {s.einheit}</span>
                {schreiben ? <StoffArtWahl id={s.id} art={s.art} name={s.name} /> : <span className="text-xs text-s112-muted">{STOFF_ART_LABEL[s.art]}</span>}
                {!s.aktiv && <span className="text-xs text-s112-muted">inaktiv</span>}
                {schreiben && <StoffAktiv id={s.id} aktiv={s.aktiv} />}
              </span>
            ))}
          </div>
        )}
        {schreiben && <div className="print:hidden"><StoffAnlegen /></div>}
      </section>

      {gewaehlt && auszug && (
        <section className="space-y-3">
          <h2 className="font-semibold text-s112-text">Kontoauszug {gewaehlt.name} · Saldo {fmtNum(auszug.saldo, { max: 3 })} {gewaehlt.einheit}</h2>
          {auszug.warnungen.map(w => <p key={w} role="alert" className="text-sm bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-lg px-3 py-2">{w}</p>)}
          {schreiben && gewaehlt.aktiv && <div className="print:hidden"><KontoBuchen kellermittelId={gewaehlt.id} einheit={gewaehlt.einheit} /></div>}
          <Kontoauszug zeilen={auszug.zeilen} einheit={gewaehlt.einheit} schreiben={schreiben} />
          <p className="text-xs text-s112-muted">Verwendungen entstehen beim Erfassen einer Kellerbehandlung (Stoff und Menge). Buchungen sind nicht änderbar – Korrektur über Storno (Gegenbuchung) oder Inventur.</p>
        </section>
      )}
    </div>
  )
}
