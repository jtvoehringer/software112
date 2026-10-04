import 'server-only'
import { ladeZusammensetzungCharge } from '@/lib/wein/blendKomposition'
import type { GruppenMenge } from '@/lib/wein/sortenangabe'
import { kgSchluessel, type HerkunftsTeil } from '@/lib/wein/herkunftRegel'
import { getKgBezeichnung } from '@/lib/wein/katastralgemeinden'

// KAN-93 (02.10.2026): Rebsorten- und Jahrgangsanteile eines Verschnitts aus den tatsächlichen Herkunftsanteilen
// (Rechenkern KAN-76) – Ziel-Charge mit ihrem ganzen Bestand, jede Quelle mit der verschnittenen Menge (anteilig an
// ihrer Zusammensetzung). Wo der Kern nichts weiß (Altbestand ohne Bewegungen, Herkunft ohne Rebsorte/Jahrgang,
// Ladefehler), zählen Rebsorte und Jahrgang der Charge selbst – so ist das Ergebnis nie schlechter als bisher.
// KAN-110 (04.10.2026): dazu die Herkunftsteile für ermittleHerkunft – Herkunft-Code der Charge mit Ried (amtliche Ried
// der Lage) und Gemeinde (KG-Nr. des Grundstücks) je Ursprung; ohne bekannten Ursprung beides unbekannt.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v)) || 0

export async function verschnittGruppen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  teile: readonly { charge: R; liter: number }[],
): Promise<{ sorten: GruppenMenge[]; jahrgaenge: GruppenMenge[]; herkunft: HerkunftsTeil[] }> {
  const sorten = new Map<string, number>()
  const jahrgaenge = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, l: number) => { if (l > 0) m.set(k, (m.get(k) ?? 0) + l) }
  const herkunft = new Map<string, HerkunftsTeil>()
  const herkunftDazu = (code: string | null, ried: string | null, kg: string | null, l: number) => {
    if (!(l > 0)) return
    const ort = kgSchluessel(kg)
    const key = `${code ?? ''}|${ried ?? ''}|${ort ?? ''}`
    const t = herkunft.get(key)
    if (t) t.liter += l
    else herkunft.set(key, { liter: l, code, ried, ort, ortName: ort ? getKgBezeichnung(ort) ?? `KG ${ort}` : null })
  }
  const sorteVon = (r: unknown, c: R) => (typeof r === 'string' && r.trim()) || (c.rebsorte as string | null)?.trim() || 'unbekannt'
  const jahrVon = (j: unknown, c: R) => (j != null && j !== '' ? String(j) : c.jahrgang != null ? String(c.jahrgang) : 'unbekannt')

  for (const { charge, liter } of teile) {
    if (!(liter > 0) || !charge) continue
    const bestand = num(charge.menge_liter)
    const code = (charge.herkunft_code as string | null) ?? null
    let anteile: { rebsorte: string | null; jahrgang: number | null; liter: number; ried?: string | null; katastralgemeinde?: string | null }[] = []
    try {
      anteile = (await ladeZusammensetzungCharge(supabase, tenantId, charge.id as string)).anteile
    } catch {
      anteile = []
    }
    const summe = anteile.reduce((s, a) => s + num(a.liter), 0)
    const faktor = bestand > 0 ? liter / bestand : 0
    if (summe > 0 && faktor > 0) {
      for (const a of anteile) {
        add(sorten, sorteVon(a.rebsorte, charge), num(a.liter) * faktor)
        add(jahrgaenge, jahrVon(a.jahrgang, charge), num(a.liter) * faktor)
        herkunftDazu(code, a.ried ?? null, a.katastralgemeinde ?? null, num(a.liter) * faktor)
      }
    }
    // Rest ohne bekannte Herkunft (bzw. alles, wenn der Kern nichts liefert): Angaben der Charge
    const rest = liter - (summe > 0 && faktor > 0 ? summe * faktor : 0)
    if (rest > 0.005) {
      add(sorten, sorteVon(null, charge), rest)
      add(jahrgaenge, jahrVon(null, charge), rest)
      herkunftDazu(code, null, null, rest)
    }
  }
  const liste = (m: Map<string, number>) => [...m.entries()].map(([wert, l]) => ({ wert, liter: l }))
  return { sorten: liste(sorten), jahrgaenge: liste(jahrgaenge), herkunft: [...herkunft.values()] }
}
