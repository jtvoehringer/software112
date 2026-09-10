import { NextResponse } from 'next/server'
import { getCtx, ladeEinstellungen, ladeFristen, ladeKeller } from '@/app/(dashboard)/dashboard/_shared/data'
import { ladeMorgenbericht } from '@/lib/morgenbericht/erstellen'

export const dynamic = 'force-dynamic'

// ── Hinweise für die Benachrichtigungs-Glocke (Topbar) ───────────────────────
// Liefert die dringenden Punkte des aktiven Betriebs: überfällige und in den
// nächsten X Tagen fällige Fristen (X = Vorwarnung aus "Mein Betrieb") sowie
// fällige Gärkontrollen (Sicht "Kellerbuch"). Wird vom Topbar-Client beim
// Laden und danach alle 5 Minuten abgefragt – bewusst eine eigene Route, damit
// das Layout nicht bei jedem Seitenaufruf alle Dashboard-Abfragen ausführt.

export type Hinweis = { key: string; titel: string; detail: string; tone: 'err' | 'warn'; href: string }

export async function GET() {
  const ctx = await getCtx()
  if (!ctx.tenantId) return NextResponse.json({ hinweise: [] })

  const einst = await ladeEinstellungen(ctx)
  const [fristen, keller, bericht] = await Promise.all([
    ladeFristen(ctx, { modulEa: einst.modulEa, uvaZeitraum: einst.uvaZeitraum, vorwarnungTage: einst.vorwarnungTage, betriebsbeginn: einst.betriebsbeginn, doppik: einst.doppik }),
    ladeKeller(ctx, einst.messintervallTage),
    ladeMorgenbericht(ctx.supabase, ctx.tenantId),
  ])

  const hinweise: Hinweis[] = []
  for (const f of fristen.filter(f => f.status === 'ueberfaellig' || f.status === 'faellig')) {
    hinweise.push({
      key: f.key, titel: f.bezeichnung, detail: f.statusText,
      tone: f.status === 'ueberfaellig' ? 'err' : 'warn', href: f.href ?? '/dashboard/fristen',
    })
  }
  for (const c of keller.chargen.filter(c => c.messungFaellig)) {
    hinweise.push({
      key: `mess:${c.id}`, titel: `Gärkontrolle – ${c.name}`,
      detail: c.tageSeitMessung === null ? 'noch keine Analyse erfasst' : `letzte Messung vor ${c.tageSeitMessung} Tagen`,
      tone: 'warn', href: '/dashboard/kellerbuch',
    })
  }
  // Morgenbericht (Migration 201): dringende Befunde von heute, die nicht schon
  // als Frist/Gärkontrolle oben stehen (Wetter je Ried, Bestände, Abo …)
  if (bericht && bericht.datum === ctx.heuteStr) {
    const vorhanden = new Set(hinweise.map(h => h.key))
    for (const b of bericht.befunde.filter(b => b.stufe === 'hoch' && !vorhanden.has(b.key))) {
      hinweise.push({ key: `mb:${b.key}`, titel: b.titel, detail: b.detail, tone: 'err', href: b.href && !b.href.startsWith('http') ? b.href : '/dashboard/morgenbericht' })
    }
  }
  return NextResponse.json({ hinweise })
}
