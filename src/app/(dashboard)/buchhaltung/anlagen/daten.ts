// Datenzugriff für das Anlagenverzeichnis (Server), Rechenlogik in @/lib/ea/anlagen.
import type { Ctx, R } from '@/app/(dashboard)/dashboard/_shared/data'
import type { Anlage, AfaBuchungRoh } from '@/lib/ea/anlagen'

/** Kontonummer der Klasse 0 vierstellig (660 → 0660) */
export const kontoText = (n: number | null) => n === null ? '–' : String(n).padStart(4, '0')

export type BuchungsKandidat = { id: string; datum: string; beschreibung: string; betrag_netto: number; kategorie: string }

export function zuAnlage(r: R): Anlage {
  return {
    id: r.id, name: r.name, gruppe: r.gruppe ?? null, konto_nr: r.konto_nr === null || r.konto_nr === undefined ? null : Number(r.konto_nr),
    anschaffung_am: String(r.anschaffung_am).slice(0, 10), ak_netto: Number(r.ak_netto), nutzungsdauer_jahre: Number(r.nutzungsdauer_jahre),
    methode: r.methode, degressiv_satz: r.degressiv_satz === null || r.degressiv_satz === undefined ? null : Number(r.degressiv_satz),
    restwert: Number(r.restwert ?? 0), abgang_am: r.abgang_am ? String(r.abgang_am).slice(0, 10) : null,
    veraeusserungserloes: r.veraeusserungserloes === null || r.veraeusserungserloes === undefined ? null : Number(r.veraeusserungserloes),
  }
}

export async function ladeAnlagen(ctx: Ctx): Promise<(Anlage & { transaktion_id: string | null; notizen: string | null })[]> {
  const { data } = await ctx.tf(ctx.q('ea_anlagen').select('*').order('anschaffung_am', { ascending: false }).order('name'))
  return ((data ?? []) as R[]).map(r => ({ ...zuAnlage(r), transaktion_id: r.transaktion_id ?? null, notizen: r.notizen ?? null }))
}

/** Gebuchte AfA (ea_transaktionen mit anlage_id) eines Jahres */
export async function ladeAfaBuchungen(ctx: Ctx, jahr: number): Promise<AfaBuchungRoh[]> {
  const { data } = await ctx.tf(ctx.q('ea_transaktionen').select('id, anlage_id, betrag_netto, datum, is_locked')
    .not('anlage_id', 'is', null).gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`))
  return ((data ?? []) as R[]).map(b => ({ id: b.id, anlage_id: b.anlage_id, betrag_netto: Number(b.betrag_netto), datum: String(b.datum).slice(0, 10), is_locked: !!b.is_locked }))
}

/**
 * Anschaffungsbuchungen, die sich mit einer Anlage verknüpfen lassen: Ausgaben
 * in Kategorien der Kontenklasse 0 (konto_nr < 1000) ohne Zuordnung - bzw. die
 * Buchung der gerade bearbeiteten Anlage.
 */
export async function ladeKandidaten(ctx: Ctx, eigeneTransaktionId: string | null = null): Promise<BuchungsKandidat[]> {
  const [{ data: buchungen }, { data: belegt }] = await Promise.all([
    ctx.tf(ctx.q('ea_transaktionen').select('id, datum, beschreibung, betrag_netto, ea_kategorien!kategorie_id!inner(name, konto_nr)')
      .eq('typ', 'ausgabe').is('anlage_id', null).lt('ea_kategorien.konto_nr', 1000).order('datum', { ascending: false }).limit(200)),
    ctx.tf(ctx.q('ea_anlagen').select('transaktion_id').not('transaktion_id', 'is', null)),
  ])
  const vergeben = new Set(((belegt ?? []) as R[]).map(a => a.transaktion_id as string))
  if (eigeneTransaktionId) vergeben.delete(eigeneTransaktionId)
  return ((buchungen ?? []) as R[])
    .filter(b => !vergeben.has(b.id))
    .map(b => ({ id: b.id, datum: String(b.datum).slice(0, 10), beschreibung: b.beschreibung ?? '', betrag_netto: Number(b.betrag_netto), kategorie: b.ea_kategorien?.name ?? '' }))
}

/** Jahre für den Jahreswähler: aktuelles Jahr plus alle Zugangs-/Abgangsjahre (+1 Jahr für die Halbjahresregel) */
export function anlagenJahre(anlagen: Anlage[], aktJahr: number): number[] {
  const s = new Set<number>([aktJahr])
  for (const a of anlagen) {
    const von = Number(a.anschaffung_am.slice(0, 4))
    const bis = a.abgang_am ? Number(a.abgang_am.slice(0, 4)) : Math.min(aktJahr + 1, von + a.nutzungsdauer_jahre + 1)
    for (let j = von; j <= Math.max(von, bis); j++) s.add(j)
  }
  return [...s].sort((a, b) => a - b)
}
