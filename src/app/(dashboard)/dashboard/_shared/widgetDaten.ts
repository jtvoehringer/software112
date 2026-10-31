import { geladen, gezaehlt } from '@/lib/supabase/geladen'
import { ladeFinanzen } from '@/lib/finanzen/uebersicht'
import { ladeMorgenbericht } from '@/lib/morgenbericht/erstellen'
import { ladeUmsatzRechnungen } from '@/lib/verkauf/umsatz'
import type { WidgetQuelle } from '@/lib/dashboard/widgets'
import { ladeKeller, ladeFlaschenlager, ladeOffenePosten, ladeFristen, ladeAufgabenTermine, ladeWeingarten, ladeEinstellungen, type Ctx, type R } from './data'
import { umsatzFenster } from './bausteine'

// KAN-387: Daten der Übersicht je Quelle – geladen werden nur die Quellen der sichtbaren Widgets
// (benoetigteQuellen in lib/dashboard/widgets.ts), alle parallel wie bisher in der Seite.

export type Einstellungen = Awaited<ReturnType<typeof ladeEinstellungen>>

export type WidgetDaten = {
  keller?: Awaited<ReturnType<typeof ladeKeller>>
  flaschen?: Awaited<ReturnType<typeof ladeFlaschenlager>>
  offenePosten?: Awaited<ReturnType<typeof ladeOffenePosten>>
  fristen?: Awaited<ReturnType<typeof ladeFristen>>
  checklisten?: number | null
  weingarten?: Awaited<ReturnType<typeof ladeWeingarten>>
  finanzen?: Awaited<ReturnType<typeof ladeFinanzen>> | null
  morgenbericht?: Awaited<ReturnType<typeof ladeMorgenbericht>> | null
  aufgabenTermine?: Awaited<ReturnType<typeof ladeAufgabenTermine>>
  /** KAN-389: Rechnungen der letzten 12 Monate (Umsatz-Trend, Top-Kunden) – dasselbe Fenster wie die Sicht Verkauf */
  umsatz?: { rechnungen: R[]; monate: string[] }
}

export async function ladeWidgetDaten(ctx: Ctx, einst: Einstellungen, quellen: Set<WidgetQuelle>): Promise<WidgetDaten> {
  const jahr = ctx.heute.getFullYear()
  const wenn = <T,>(q: WidgetQuelle, f: () => Promise<T>): Promise<T | undefined> => (quellen.has(q) ? f() : Promise.resolve(undefined))
  const [keller, flaschen, offenePosten, fristen, aufgabenTermine, weingarten, checklisten, finanzen, morgenbericht, umsatz] = await Promise.all([
    wenn('keller', () => ladeKeller(ctx, einst.messintervallTage)),
    wenn('flaschen', () => ladeFlaschenlager(ctx)),
    wenn('offenePosten', () => ladeOffenePosten(ctx)),
    wenn('fristen', () => ladeFristen(ctx, { modulEa: einst.modulEa, uvaZeitraum: einst.uvaZeitraum, vorwarnungTage: einst.vorwarnungTage, betriebsbeginn: einst.betriebsbeginn, doppik: einst.doppik, psmFristH: einst.psmFristH })),
    wenn('aufgabenTermine', () => ladeAufgabenTermine(ctx)),
    wenn('weingarten', () => ladeWeingarten(ctx)),
    wenn('checklisten', async () => gezaehlt(await ctx.tf(ctx.q('checklisten_punkte').select('id, checkliste:checkliste_id!inner(jahr, typ)', { count: 'exact', head: true }).eq('erledigt', false).eq('checkliste.jahr', jahr)), 'Checklisten-Punkte')),
    // Finanzübersicht-Kachel (Rückmeldung 8.9.2026): "wo stehe ich" auf einen Klick
    wenn('finanzen', () => einst.modulEa ? ladeFinanzen(ctx, { art: einst.doppik ? 'doppik' : 'ea', uvaZeitraum: einst.uvaZeitraum }) : Promise.resolve(null)),
    // Morgenbericht (Migration 201): jüngster gespeicherter Bericht
    wenn('morgenbericht', () => ctx.tenantId ? ladeMorgenbericht(ctx.supabase, ctx.tenantId) : Promise.resolve(null)),
    // KAN-389: Umsatz netto nach Rechnungsdatum (zentral, KAN-346) – Lesefehler werfen wie in der Sicht Verkauf
    wenn('umsatz', async () => {
      const { von, bis, monate } = umsatzFenster(ctx.heute)
      const rechnungen = ctx.tenantId ? geladen(await ladeUmsatzRechnungen(ctx.supabase, ctx.tenantId, von, bis), 'Umsatzreihe') : []
      return { rechnungen, monate }
    }),
  ])
  return { keller, flaschen, offenePosten, fristen, aufgabenTermine, weingarten, checklisten, finanzen, morgenbericht, umsatz }
}
