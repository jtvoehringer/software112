// behoerdenmeldung: rueckverfolgung-vorwaerts
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import DruckFormatKnopf from '@/components/DruckFormatKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { fmtNum } from '@/lib/format'
import { ladeRueckruf, type RueckrufStart } from '@/lib/behoerden/rueckruf'

export const metadata: Metadata = { title: 'Rückverfolgung vorwärts – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// ── Rückverfolgung vorwärts – Rückruf-Liste (KAN-109, 07.10.2026) ──
// Einstieg per Los-Nr., Füllung, Charge oder Pressung; dieselbe Ladefunktion wie die CSV „rueckverfolgung-vorwaerts“.
// Zugriff: alle Mitglieder des Betriebs (Entscheidung Jörgen 06.10.2026).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const datum = (d: string | null) => (d ? d.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3.$2.$1') : '–')

export default async function RueckrufPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()
  const supabase = await createSupabaseServerClient()
  const tf = (q: AR) => q.eq('tenant_id', tenantId)

  // Auswahllisten (bewusst begrenzt: die jüngsten Einträge; ältere über die Los-Nr.)
  const [{ data: fl }, { data: ch }, { data: pr }] = await Promise.all([
    // alle-ausnahme: Auswahlliste der jüngsten 300 Füllungen – ältere per Los-Nr. suchen
    tf((supabase.from('fuellungen') as AR).select('id, name, chargennummer, datum').is('storniert_am', null).order('datum', { ascending: false }).order('id').limit(300)),
    // alle-ausnahme: Auswahlliste der jüngsten 300 Chargen – ältere über Los bzw. Pressung
    tf((supabase.from('weinausbau') as AR).select('id, name, jahrgang').is('storniert_am', null).order('created_at', { ascending: false }).order('id').limit(300)),
    // alle-ausnahme: Auswahlliste der jüngsten 200 Pressungen
    tf((supabase.from('pressungen') as AR).select('id, datum, weinbezeichnung').is('storniert_am', null).order('datum', { ascending: false }).order('id').limit(200)),
  ])

  // Startpunkt: Los-Nr. → Füllung; sonst fuellung | charge | pressung
  let start: RueckrufStart | null = null
  let losFehler: string | null = null
  const los = (sp.los ?? '').trim()
  if (los) {
    // alle-ausnahme: Suche nach einer Los-Nr. (eindeutig je Betrieb, KAN-92)
    const { data: treffer } = await tf((supabase.from('fuellungen') as AR).select('id').eq('chargennummer', los).is('storniert_am', null).limit(2))
    const t = (treffer ?? []) as AR[]
    if (t.length === 1) start = { art: 'fuellung', id: t[0].id }
    else losFehler = t.length === 0 ? `Keine Füllung mit der Los-Nr. „${los}“.` : `Los-Nr. „${los}“ ist nicht eindeutig.`
  } else if (sp.fuellung && UUID_RE.test(sp.fuellung)) start = { art: 'fuellung', id: sp.fuellung }
  else if (sp.charge && UUID_RE.test(sp.charge)) start = { art: 'charge', id: sp.charge }
  else if (sp.pressung && UUID_RE.test(sp.pressung)) start = { art: 'pressung', id: sp.pressung }

  const r = start ? await ladeRueckruf(supabase, tenantId, start) : null
  const csvParam = start ? { [start.art]: start.id } : {}
  const sel = 'form-input text-sm'
  const th = 'px-3 py-2 text-left text-xs font-medium text-s112-text-2'
  const td = 'px-3 py-1.5 text-sm align-top'

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link><span>/</span>
        <Link href="/kellerbuch/rueckverfolgung" className="hover:text-s112-blue-700">Rückverfolgung</Link><span>/</span>
        <span className="text-s112-text-1 font-medium">Vorwärts (Rückruf-Liste)</span>
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Rückverfolgung vorwärts – Rückruf-Liste</h1>
          <p className="text-sm text-s112-muted">Von einem Los, einer Charge oder einer Pressung über Umzüge und Verschnitte bis zu den Abnehmern.</p>
        </div>
        {r && (
          <div className="flex items-center gap-2 flex-wrap">
            <CsvExportKnopf href={csvPfad('rueckverfolgung-vorwaerts', csvParam)} />
            <DruckFormatKnopf standard="quer" klein />
          </div>
        )}
      </div>

      {/* Startpunkt wählen */}
      <div className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-3 print:hidden">
        <form method="get" className="flex gap-2 md:col-span-1">
          <input name="los" defaultValue={los} placeholder="Los-Nr." aria-label="Los-Nr." className={`${sel} flex-1`} />
          <button className="px-3 py-1.5 rounded-lg text-sm border border-s112-border">Los</button>
        </form>
        <form method="get" className="flex gap-2">
          <select name="fuellung" defaultValue={start?.art === 'fuellung' ? start.id : ''} aria-label="Füllung" className={`${sel} flex-1 min-w-0`}>
            <option value="">Füllung wählen</option>
            {((fl ?? []) as AR[]).map(f => <option key={f.id} value={f.id}>{f.name}{f.chargennummer ? ` · Los ${f.chargennummer}` : ''} · {datum(f.datum)}</option>)}
          </select>
          <button className="px-3 py-1.5 rounded-lg text-sm border border-s112-border">OK</button>
        </form>
        <form method="get" className="flex gap-2">
          <select name="charge" defaultValue={start?.art === 'charge' ? start.id : ''} aria-label="Charge" className={`${sel} flex-1 min-w-0`}>
            <option value="">Charge wählen</option>
            {((ch ?? []) as AR[]).map(c => <option key={c.id} value={c.id}>{c.name}{c.jahrgang ? ` ${c.jahrgang}` : ''}</option>)}
          </select>
          <button className="px-3 py-1.5 rounded-lg text-sm border border-s112-border">OK</button>
        </form>
        <form method="get" className="flex gap-2">
          <select name="pressung" defaultValue={start?.art === 'pressung' ? start.id : ''} aria-label="Pressung" className={`${sel} flex-1 min-w-0`}>
            <option value="">Pressung wählen</option>
            {((pr ?? []) as AR[]).map(p => <option key={p.id} value={p.id}>{datum(p.datum)}{p.weinbezeichnung ? ` · ${p.weinbezeichnung}` : ''}</option>)}
          </select>
          <button className="px-3 py-1.5 rounded-lg text-sm border border-s112-border">OK</button>
        </form>
      </div>
      {losFehler && <p role="alert" className="text-sm text-s112-err-fg">{losFehler}</p>}
      {start && !r && <p role="alert" className="text-sm text-s112-err-fg">Startpunkt nicht gefunden.</p>}

      {r && (
        <>
          <section className="space-y-1">
            <h2 className="font-semibold text-s112-text">Start: {r.start.name}</h2>
            <p className="text-xs text-s112-muted">
              {r.chargen.length} Charge{r.chargen.length === 1 ? '' : 'n'} enthalten Wein daraus: {r.chargen.map(c => c.name).join(', ') || '–'}
            </p>
          </section>
          {r.warnungen.length > 0 && (
            <ul className="text-sm bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-lg px-4 py-2 list-disc list-inside space-y-0.5">
              {r.warnungen.map(w => <li key={w}>{w}</li>)}
            </ul>
          )}
          <section className="space-y-2">
            <h2 className="font-semibold text-s112-text">Abnehmer ({r.zeilen.length})</h2>
            {r.zeilen.length === 0 ? <p className="text-sm text-s112-muted">Noch keine Abgänge – der Wein ist vollständig im Betrieb.</p> : (
              <div className="card p-0 overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-s112-border">
                    <th className={th}>Los</th><th className={th}>Produkt</th><th className={th}>Art</th><th className={th}>Datum</th>
                    <th className={th}>Beleg</th><th className={th}>Abnehmer</th><th className={th}>Adresse</th><th className={th}>Betriebsnr.</th>
                    <th className={`${th} text-right`}>Menge</th>
                  </tr></thead>
                  <tbody>
                    {r.zeilen.map((z, i) => (
                      <tr key={i} className="border-b border-s112-border/60">
                        <td className={td}>{z.los ?? '–'}</td><td className={td}>{z.produkt}</td><td className={td}>{z.art}</td>
                        <td className={`${td} whitespace-nowrap`}>{datum(z.datum)}</td><td className={td}>{z.beleg ?? '–'}</td>
                        <td className={`${td} font-medium`}>{z.abnehmer}</td><td className={td}>{z.adresse ?? '–'}</td><td className={td}>{z.betriebNr ?? '–'}</td>
                        <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{fmtNum(z.menge, { max: 2 })} {z.einheit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {r.abgleich.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold text-s112-text">Abgleich je Füllung (Flaschen)</h2>
              <div className="card p-0 overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-s112-border">
                    <th className={th}>Los</th><th className={th}>Produkt</th><th className={`${th} text-right`}>abgefüllt</th>
                    <th className={`${th} text-right`}>verkauft</th><th className={`${th} text-right`}>exportiert</th>
                    <th className={`${th} text-right`}>Bestand</th><th className={`${th} text-right`}>Differenz</th>
                  </tr></thead>
                  <tbody>
                    {r.abgleich.map(a => (
                      <tr key={a.fuellungId} className="border-b border-s112-border/60">
                        <td className={td}>{a.los ?? '–'}</td>
                        <td className={td}><Link href={`/weinhandel/fuellungen/${a.fuellungId}/edit`} className="text-s112-blue-700 hover:underline">{a.produkt}</Link></td>
                        <td className={`${td} text-right tabular-nums`}>{fmtNum(a.abgefuellt, 0)}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtNum(a.verkauft, { max: 2 })}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtNum(a.exportiert, { max: 2 })}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtNum(a.bestand, 0)}</td>
                        <td className={`${td} text-right tabular-nums ${Math.abs(a.differenz) > 0.001 ? 'text-s112-warn-fg font-semibold' : ''}`}>{fmtNum(a.differenz, { max: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-s112-muted">Differenz = abgefüllt − verkauft − exportiert − Bestand (Bruch, Proben, Eigenverbrauch oder fehlende Buchung).</p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
