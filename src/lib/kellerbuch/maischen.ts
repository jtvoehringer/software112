// ── Maischen des Betriebs laden (KAN-480) ───────────────────────────────────────────────────────────────────────────
//
// Eine Maische ist eine Pressung in zwei Schritten (src/lib/wein/maische.ts): angesetzt = Traubenzeilen ohne Mostzeilen,
// maische_offen bis zum Abpressen. Geladen werden alle nicht stornierten Maischen des Betriebs (auch abgepresste – die
// Bestandsmeldung braucht den Stand am Stichtag) mit Nummer, Gebinde und kg aus den Traubenzeilen.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle, inBloecken } from '@/lib/supabase/alle'
import { AktionsFehler } from '@/lib/fehler'
import { rund } from '@/lib/zahl/runden'
import { maischeNummer, maischeOffen, maischeOffenAm } from '@/lib/wein/maische'

type R = Record<string, any>

export type Maische = {
  id: string
  /** „M 2027/1“ */
  nummer: string | null
  jahrgangId: string
  jahrgang: number | null
  beginn: string
  /** Pressdatum (bei offener Maische = Beginn) */
  datum: string
  offen: boolean
  behaelterId: string | null
  behaelterName: string | null
  /** Trauben der Maische (kg), ohne stornierte Zeilen */
  kg: number
}

/** Alle nicht stornierten Maischen des Betriebs, neueste zuerst */
export async function ladeMaischen(supabase: any, tenantId: string): Promise<Maische[]> {
  const kopf = await alle<R>((supabase.from('pressungen') as any)
    .select('id, jahrgang_id, datum, maische_nr, maische_beginn, maische_offen, maische_behaelter_id, storniert_am, jahrgang:jahrgang_id(jahrgang), maische_behaelter:behaelter!pressungen_maische_behaelter_id_fkey(name)')
    .eq('tenant_id', tenantId).not('maische_beginn', 'is', null).is('storniert_am', null)
    .order('maische_beginn', { ascending: false }).order('erstellt_am', { ascending: false }).order('id'))
  if (kopf.error) throw new AktionsFehler(`Maischen konnten nicht geladen werden (${kopf.error.message})`)
  if (kopf.data.length === 0) return []
  // Traubenzeilen der Maischen (pressung_weingaerten hat keine tenant_id – die Pressungen oben gehören zum Betrieb)
  const zeilen = await inBloecken<R>(kopf.data.map(p => String(p.id)), bl => (supabase.from('pressung_weingaerten') as any)
    .select('id, pressung_id, trauben_kg').in('pressung_id', bl).is('storniert_am', null).order('id'))
  if (zeilen.error) throw new AktionsFehler(`Traubenzeilen der Maischen konnten nicht geladen werden (${zeilen.error.message})`)
  const kg = new Map<string, number>()
  for (const z of zeilen.data) kg.set(String(z.pressung_id), (kg.get(String(z.pressung_id)) ?? 0) + (Number(z.trauben_kg) || 0))
  return kopf.data.map(p => {
    const jahrgang = (p.jahrgang as R | null)?.jahrgang ?? null
    return {
      id: String(p.id),
      nummer: maischeNummer(jahrgang, p.maische_nr as number | null),
      jahrgangId: String(p.jahrgang_id),
      jahrgang: jahrgang == null ? null : Number(jahrgang),
      beginn: String(p.maische_beginn).slice(0, 10),
      datum: String(p.datum).slice(0, 10),
      offen: maischeOffen(p),
      behaelterId: (p.maische_behaelter_id as string | null) ?? null,
      behaelterName: ((p.maische_behaelter as R | null)?.name as string | null) ?? null,
      kg: rund(kg.get(String(p.id)) ?? 0, 1),
    }
  })
}

/** Offene Maischen je Gebinde (ein Gebinde hält höchstens eine offene Maische – das sichert die Datenbank) */
export function offeneMaischeJeGebinde(maischen: readonly Maische[]): Map<string, Maische> {
  const m = new Map<string, Maische>()
  for (const x of maischen) if (x.offen && x.behaelterId) m.set(x.behaelterId, x)
  return m
}

/** Maischen, die am Stichtag (Ende des Tages) noch unverpresst im Keller lagen */
export function maischenOffenAm(maischen: readonly Maische[], stichtag: string): Maische[] {
  return maischen.filter(m => maischeOffenAm({ maische_beginn: m.beginn, maische_offen: m.offen, datum: m.datum }, stichtag))
}
