/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { fmtNum } from '@/lib/format'
import { datumAT } from '@/lib/behoerden/ernte_hilfen'
import { maischeNummer } from '@/lib/wein/maische'
import { ernteAnteile, ernteNummer, type MostZeile, type TraubenZeile } from '@/lib/kellerbuch/chargeErnten'
import { AktionsFehler } from '@/lib/fehler'
import { alle, inBloecken } from '@/lib/supabase/alle'

// KAN-477 (BKI-Sitzung 16.11.2026): Ernten, aus denen die Charge entstanden ist – mit Nummer („2027/1-03“), Ried,
// Grundstück und kg-Anteil. Der Anteil folgt dem Most: kg der Traubenzeile × Liter dieser Charge ÷ Liter aller
// Mostzeilen der Pressung. Die Karte erscheint nur, wenn mindestens eine Traubenzeile einer Ernte zugeordnet ist
// (Pressungen seit KAN-477); ältere Pressungen zeigen ihre Herkunft wie bisher über die Rieden.

type R = Record<string, any>
const zahl = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }

export default async function ErntenKarte({ supabase, tenantId, chargeId }: { supabase: any; tenantId: string; chargeId: string }) {
  // Mostzeilen der Charge → ihre Pressungen (nur des eigenen Betriebs). Vollständig und in Blöcken geladen
  // (alle()/inBloecken, CLAUDE.md „Vollständige Mengen seitenweise“) – ein Teilergebnis ergäbe falsche Anteile.
  const eigene = await alle<R>((supabase.from('pressung_behaelter') as any)
    .select('id, pressung_id').eq('weinausbau_id', chargeId).is('storniert_am', null).order('id'))
  if (eigene.error) throw new AktionsFehler(`Pressungen der Charge konnten nicht geladen werden (${eigene.error.message})`)
  const kandidaten = [...new Set(eigene.data.map(z => String(z.pressung_id)))]
  if (kandidaten.length === 0) return null
  const pr = await inBloecken<R>(kandidaten, bl => (supabase.from('pressungen') as any)
    .select('id, datum, maische_nr, maische_beginn, jahrgang:jahrgang_id(jahrgang)').in('id', bl).eq('tenant_id', tenantId).is('storniert_am', null).order('id'))
  if (pr.error) throw new AktionsFehler(`Pressungen der Charge konnten nicht geladen werden (${pr.error.message})`)
  const pressungen = pr.data.map(p => String(p.id))
  // KAN-480: Der Most kam über eine Maische (Ernten gemeinsam gemaischt, später abgepresst)
  const maischen = pr.data.filter(p => p.maische_beginn).map(p => ({
    nummer: maischeNummer((p.jahrgang as R | null)?.jahrgang ?? null, p.maische_nr as number | null),
    beginn: String(p.maische_beginn).slice(0, 10), abgepresst: String(p.datum).slice(0, 10),
  }))
  if (pressungen.length === 0) return null

  const [mostRes, traubenRes] = await Promise.all([
    inBloecken<R>(pressungen, bl => (supabase.from('pressung_behaelter') as any)
      .select('id, pressung_id, weinausbau_id, menge_liter').in('pressung_id', bl).is('storniert_am', null).order('id')),
    inBloecken<R>(pressungen, bl => (supabase.from('pressung_weingaerten') as any)
      .select('id, pressung_id, trauben_kg, ernte_parzelle_id, weingarten:weingarten_id(name), grundstueck:grundstueck_id(gst_nr), ernte:ernte_parzellen!pressung_weingaerten_ernte_parzelle_id_fkey(id, lfd_nr, ernte_datum, storniert_am, lese:lesen!ernte_parzellen_lese_fkey(lfd_nr, jahrgang:weinjahrgaenge!lesen_jahrgang_fkey(jahrgang)))')
      .in('pressung_id', bl).is('storniert_am', null).order('id')),
  ])
  if (mostRes.error) throw new AktionsFehler(`Mostzeilen konnten nicht geladen werden (${mostRes.error.message})`)
  if (traubenRes.error) throw new AktionsFehler(`Traubenzeilen konnten nicht geladen werden (${traubenRes.error.message})`)

  const most: MostZeile[] = mostRes.data.map(m => ({ pressungId: String(m.pressung_id), chargeId: m.weinausbau_id ? String(m.weinausbau_id) : null, liter: zahl(m.menge_liter) }))
  const traubenRoh = traubenRes.data
  const trauben: TraubenZeile[] = traubenRoh.map(t => ({ pressungId: String(t.pressung_id), ernteId: t.ernte_parzelle_id ? String(t.ernte_parzelle_id) : null, kg: zahl(t.trauben_kg) }))
  const ergebnis = ernteAnteile(chargeId, most, trauben)
  if (ergebnis.anteile.length === 0) return null

  const info = new Map<string, R>()
  for (const t of traubenRoh) if (t.ernte_parzelle_id && !info.has(String(t.ernte_parzelle_id))) info.set(String(t.ernte_parzelle_id), t)

  return (
    <section aria-labelledby="ernten-der-charge" className="card p-5">
      <h2 id="ernten-der-charge" className="text-sm font-semibold text-s112-text mb-1">Ernten dieser Charge</h2>
      <p className="text-xs text-s112-text-2 mb-3">
        Aus welchen Ernten der Most stammt – Anteil nach den Litern, die aus der Pressung in diese Charge gingen.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-s112-text-2 border-b border-s112-border">
              <th scope="col" className="py-1.5 pr-3 font-semibold">Ernte</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Ried</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Grundstück</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Erntedatum</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold text-right">Trauben (kg)</th>
              <th scope="col" className="py-1.5 font-semibold text-right">Anteil</th>
            </tr>
          </thead>
          <tbody>
            {ergebnis.anteile.map(a => {
              const t = info.get(a.ernteId)
              const e = (t?.ernte ?? null) as R | null
              const lese = (e?.lese ?? null) as R | null
              return (
                <tr key={a.ernteId} className="border-b border-s112-border/40 last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-s112-text">{ernteNummer((lese?.jahrgang as R | null)?.jahrgang, lese?.lfd_nr, e?.lfd_nr) ?? '–'}</td>
                  <td className="py-1.5 pr-3">{(t?.weingarten as R | null)?.name ?? '–'}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-s112-text-2">{(t?.grundstueck as R | null)?.gst_nr ?? '–'}</td>
                  <td className="py-1.5 pr-3 text-xs text-s112-text-2 whitespace-nowrap">{e?.ernte_datum ? datumAT(String(e.ernte_datum)) : '–'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmtNum(a.kg, { max: 1 })}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(a.prozent, { min: 1, max: 1 })} %</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {maischen.length > 0 && (
        <p className="text-xs text-s112-text-2 mt-2">
          Gemeinsam gemaischt: {maischen.map(m => `Maische ${m.nummer ?? ''} (angesetzt ${datumAT(m.beginn)}, abgepresst ${datumAT(m.abgepresst)})`).join('; ')}.
        </p>
      )}
      {ergebnis.ohneErnteKg > 0 && (
        <p className="text-xs text-s112-text-2 mt-2">
          Weitere {fmtNum(ergebnis.ohneErnteKg, { max: 1 })} kg ohne zugeordnete Ernte (Zukauf bzw. Pressung vor der Einführung der Ernte-Nummer).
        </p>
      )}
    </section>
  )
}
