'use server'

// KAN-89 (05.10.2026): Sammelkorrektur auf der Prüfseite „Rebsorten ohne Kürzel“ – ersetzt einen Freitextwert in allen
// Zeilen einer Tabelle des Betriebs durch eine Sorte der BKI-Kürzelliste (oder leert ihn). Rieden und Grundstücke in
// einem Schritt; Chargen je Zeile, weil eine Charge mit laufendem Prüfnummernantrag gesperrt ist (Freeze, KAN-204) –
// gesperrte bzw. stornierte Chargen bleiben unverändert und werden gemeldet. Jede Änderung steht im Änderungsprotokoll.

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { korrekturZielFehler, rebsortenTabelle } from '@/lib/wein/rebsortenPruefung'

export type KorrekturErgebnis = { geaendert: number; uebersprungen: number; hinweis: string | null }

export async function rebsorteErsetzen(tabelle: string, alt: string, neu: string): Promise<KorrekturErgebnis> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  const t = rebsortenTabelle(tabelle)
  if (!t || !t.korrigierbar) throw new AktionsFehler('Für diese Tabelle gibt es keine Sammelkorrektur – bitte am Datensatz korrigieren.')
  if (!canWrite(membership, t.modul)) throw new AktionsFehler('Keine Berechtigung: Für diese Korrektur fehlt das Schreibrecht im Modul.')
  const vorher = (alt ?? '').trim()
  if (!vorher) throw new AktionsFehler('Bitte den zu ersetzenden Wert angeben.')
  const fehler = korrekturZielFehler(neu ?? '')
  if (fehler) throw new AktionsFehler(fehler)
  const ziel = (neu ?? '').trim() || null
  if (ziel === vorher) return { geaendert: 0, uebersprungen: 0, hinweis: null }

  const supabase = await createSupabaseServerClient()
  const tenantId = membership.tenantId
  let geaendert = 0
  let uebersprungen = 0
  let hinweis: string | null = null

  if (t.tabelle === 'weinausbau') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await alle<{ id: string }>((supabase.from('weinausbau') as any)
      .select('id').eq('tenant_id', tenantId).eq('rebsorte', vorher).is('storniert_am', null).order('id'))
    if (error) throw new AktionsFehler(dbFehlerText(error))
    for (const c of data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: z, error: e } = await (supabase.from('weinausbau') as any)
        .update({ rebsorte: ziel }).eq('id', c.id).eq('tenant_id', tenantId).select('id')
      if (e || ((z ?? []) as unknown[]).length !== 1) uebersprungen++
      else geaendert++
    }
    if (uebersprungen > 0) hinweis = `${uebersprungen} ${uebersprungen === 1 ? 'Charge ist' : 'Chargen sind'} gesperrt (z. B. laufender Prüfnummernantrag) und blieben unverändert – bitte dort über die Betriebsleitung korrigieren.`
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(t.tabelle) as any)
      .update({ rebsorte: ziel }).eq('tenant_id', tenantId).eq('rebsorte', vorher).select('id')
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Korrektur fehlgeschlagen'))
    geaendert = ((data ?? []) as unknown[]).length
  }

  revalidatePath('/weingarten/rebsorten')
  revalidatePath('/weingarten')
  revalidatePath('/kellerbuch')
  return { geaendert, uebersprungen, hinweis }
}
