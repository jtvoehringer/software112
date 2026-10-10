import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Warehouse, FlaskConical, Droplets } from 'lucide-react'
import { DashHeader, Tile, Note, fmtNum } from '../_shared/ui'
import { getCtx, ladeKeller, ladeEinstellungen } from '../_shared/data'
import { canWrite } from '@/lib/auth/roles'
import ChargenKanban from './ChargenKanban'
import { journalAbweichungenAnzahl } from '@/lib/kellerbuch/journal'

export const metadata: Metadata = { title: 'Kellerbuch – Übersicht – software:112' }
export const dynamic = 'force-dynamic'

// ── Sicht "Kellerbuch" (Dashboard-Relaunch 27.8.2026) ────────────────────────
// Chargen-Pipeline als Kanban über die weinausbau-Phasen (ernte → gaerung →
// ausbau → abfuellung), Klick auf eine Charge öffnet ein Detail-Modal mit
// letzter Analyse, letzter Kellerbehandlung und bot:112-Aktionen.

export default async function KellerbuchSichtPage() {
  const ctx = await getCtx()
  const einst = await ladeEinstellungen(ctx)
  const [keller, abweichungen] = await Promise.all([
    ladeKeller(ctx, einst.messintervallTage),
    // KAN-51: Konsistenz Ist ↔ Bewegungsjournal (journal_konsistenz) – Grundlage von BSM und BKI-Schnittstelle
    ctx.tenantId ? journalAbweichungenAnzahl(ctx.supabase, ctx.tenantId) : Promise.resolve(null),
  ])

  return (
    <div className="space-y-6">
      <DashHeader
        title="Kellerbuch"
        sub={<>Alle Chargen im Fluss – von der Übernahme bis zur Füllung. <b className="font-semibold text-s112-text">Auf eine Charge klicken</b> öffnet Details{einst.assistentAktiv ? ' mit KI-Unterstützung durch bot:112' : ''}.</>}
        right={<Link href="/kellerbuch" className="text-[12.5px] text-s112-blue-700 hover:underline whitespace-nowrap">Zum Kellerbuch (Behälter) →</Link>}
      />

      {abweichungen !== null && abweichungen > 0 && (
        <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-lg px-4 py-3 text-[12.5px]">
          Das Bewegungsjournal weicht bei <b className="font-semibold">{abweichungen} Posten</b> vom Ist-Bestand ab – Bestandsmeldung und BKI-Schnittstelle rechnen mit dem Journal.{' '}
          <Link href="/kellerbuch/journal" className="underline">Abweichungen ansehen →</Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <Tile label="Gebinde belegt" icon={Warehouse} href="/kellerbuch"
          value={`${keller.behaelterBelegt} / ${keller.behaelterGesamt}`}
          sub={`Kapazität ${fmtNum(keller.kapazitaet)} L · ${fmtNum(keller.gesamtLiter)} L im Keller`} />
        <Tile label="Aktive Gärungen" icon={FlaskConical}
          value={fmtNum(keller.gaerungen)}
          sub={keller.messungFaellig > 0 ? `${keller.messungFaellig} Messung${keller.messungFaellig === 1 ? '' : 'en'} fällig (≥ ${einst.messintervallTage} Tage)` : keller.gaerungen > 0 ? 'Alle Messungen aktuell' : 'Keine Gärung aktiv'}
          tone={keller.messungFaellig > 0 ? 'warn' : keller.gaerungen > 0 ? 'ok' : undefined} />
        <Tile label="Füllfertig" icon={Droplets}
          value={fmtNum(keller.fuellfertig)}
          sub={keller.fuellfertig > 0 ? `${fmtNum(keller.chargen.filter(c => c.status === 'abfuellung').reduce((s, c) => s + c.menge_liter, 0))} L bereit zur Abfüllung` : 'Keine Charge in Abfüllung'} />
      </div>

      <div>
        <h2 className="font-display font-semibold text-[15px] text-s112-text mb-3">Chargen-Pipeline</h2>
        <ChargenKanban chargen={keller.chargen} assistentAktiv={einst.assistentAktiv && canWrite(ctx.role, 'kellerbuch')} />
      </div>

      <Note>
        Regel „Messung fällig“: Charge in Gärung ohne Analyse seit {einst.messintervallTage} Tagen – einstellbar unter <Link href="/betrieb/einstellungen" className="underline">Mein Betrieb</Link>.
        Die Phasen entsprechen dem Status im Kellerbuch – Statuswechsel erfolgen dort, das Kanban ist eine Sicht.
      </Note>
    </div>
  )
}
