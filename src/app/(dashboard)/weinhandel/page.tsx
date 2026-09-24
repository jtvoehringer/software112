import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import FuellungLoeschen from './FuellungLoeschen'
import { Package, Truck, Grape, Search, Pencil } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtEur, fmtNum } from '@/lib/format'

export const metadata: Metadata = { title: 'Warenwirtschaft – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L Magnum', 3000: '3,0 L', 6000: '6,0 L',
}

const STATUS_VERKAUF: Record<string, { label: string; color: string }> = {
  ernte:    { label: 'Ernte',   color: 'bg-s112-warn-bg text-s112-warn-fg' },
  gaerung:  { label: 'Gärung', color: 'bg-s112-warn-bg text-s112-warn-fg' },
  ausbau:   { label: 'Ausbau', color: 'bg-s112-blue-100 text-s112-blue-700'   },
  abfuellung:{ label: 'Abfüllung', color: 'bg-[#F2F3F5] text-s112-text-1' },
}

const ART_LABEL: Record<string, string> = { wein: 'Wein', trauben: 'Trauben', most: 'Most' }

export default async function WeinhandelPage({ searchParams }: { searchParams: Promise<{ ausverkauft?: string }> }) {
  const sp = await searchParams
  // KAN-35: Füllungen werden nicht mehr gelöscht, sobald verkauft wurde – ausverkaufte
  // (Bestand 0) standardmäßig ausblenden, damit die Liste nicht Jahr für Jahr wächst
  const ausverkaufteZeigen = sp?.ausverkauft === '1'
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'warenwirtschaft')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    { data: fuellungenRaw },
    { data: tanksRaw },
    { data: zukaufRaw },
    { data: direktTankRaw },
    { data: tvRaw },
  ] = await Promise.all([
    tf((supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, rebsorte, qualitaet, anbaugebiet, bezeichnung, datum, flaschengroesse_ml, anzahl_flaschen, bestand_flaschen, vk_preis_brutto, einstandspreis, aktiv')
      .eq('aktiv', true)
      .order('datum', { ascending: false })),
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, status, behaelter_id, einstandspreis_pro_liter, behaelter:behaelter_id(name)')
      .eq('aktiv', true)
      .in('status', ['ausbau', 'abfuellung'])
      .order('jahrgang', { ascending: false })),
    tf((supabase.from('zukauf_posten') as any)
      .select('id, art, datum, menge, einheit, rebsorte, jahrgang, notizen, preis_gesamt, lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname), lieferant_firma:firmen!lieferant_firma_id(name)')
      .eq('aktiv', true)
      .gt('menge', 0)
      // Zukäufe, die bereits einem Gebinde zugeordnet wurden, laufen ab dann über die
      // Kellerbuch-Charge (weinausbau.menge_liter, siehe "Kellerbuch-Chargen" oben).
      // zukauf_posten.menge ist die Beleg-/Zugangsmenge und wird nie verändert (KAN-35) –
      // hier stehen nur Zukäufe, die noch keinem Gebinde zugeordnet sind.
      .is('ziel_weinausbau_id', null)
      .order('datum', { ascending: false })),
    // Direktbefüllungen aus der Pressung ohne Kellerbuch-Charge (nur Hinweis, nicht verkaufbar).
    // pressung_behaelter hat keine tenant_id – Mandantenfilter über die Pressung (!inner).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, behaelter:behaelter_id(name), pressung:pressung_id!inner(datum, weinbezeichnung, kmw_grad, jahrgang_id, tenant_id, jahrgang:jahrgang_id(jahrgang))')
      .eq('pressung.tenant_id', tenantId ?? '')
      .is('weinausbau_id', null)
      .gt('menge_liter', 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('traubenverkauf') as any)
      .select('id, datum, menge_kg, preis_per_kg, liefernummer, weingarten:weingarten_id(name), firma:firma_id(name), kontakt:kontakt_id(vorname, nachname)')
      .order('datum', { ascending: false })
      .limit(5)),
  ])

  const alleFuellungen = (fuellungenRaw ?? []) as R[]
  const ausverkaufteAnzahl = alleFuellungen.filter(f => (Number(f.bestand_flaschen) || 0) <= 0).length
  const fuellungen  = ausverkaufteZeigen ? alleFuellungen : alleFuellungen.filter(f => (Number(f.bestand_flaschen) || 0) > 0)
  const tanks       = (tanksRaw      ?? []) as R[]
  const zukauf      = (zukaufRaw     ?? []) as R[]
  const direktTank  = (direktTankRaw ?? []) as R[]
  const tvListe     = (tvRaw         ?? []) as R[]

  // Löschen nur ohne Verkäufe/Bestandsbuchungen (deactivateFuellung prüft dasselbe) – Knopf vorab sperren
  const loeschSperre = new Map<string, string>()
  if (writeOk && fuellungen.length > 0) {
    const ids = fuellungen.map(f => f.id as string)
    const [{ data: vkRaw }, { data: bwRaw }] = await Promise.all([
      tf((supabase.from('verkauf_positionen') as any)
        .select('fuellung_id, verkaufsposten!inner(storniert)')
        .in('fuellung_id', ids)
        .eq('typ', 'flasche')
        .eq('verkaufsposten.storniert', false)),
      tf((supabase.from('fuellung_bewegungen') as any)
        .select('fuellung_id')
        .in('fuellung_id', ids)),
    ])
    for (const v of (vkRaw ?? []) as R[]) loeschSperre.set(v.fuellung_id, 'Nicht löschbar: Zu dieser Füllung gibt es bereits Verkäufe – sie bleibt als Historie erhalten.')
    for (const b of (bwRaw ?? []) as R[]) {
      if (!loeschSperre.has(b.fuellung_id)) loeschSperre.set(b.fuellung_id, 'Nicht löschbar: Zu dieser Füllung gibt es bereits Bestandsbuchungen – sie bleibt als Historie erhalten.')
    }
  }

  const gesamtFlaschen  = alleFuellungen.reduce((s: number, f: R) => s + (f.bestand_flaschen ?? 0), 0)
  const gesamtWert      = alleFuellungen.reduce((s: number, f: R) =>
    s + ((f.bestand_flaschen ?? 0) * (f.einstandspreis ?? 0)), 0)
  // „Liter im Tank (Direktverkauf)“ = verkaufbarer offener Wein. Seit KAN-35 (24.09.2026)
  // wird offener Wein nur noch aus Kellerbuch-Chargen verkauft – Zukäufe ohne Gebinde und
  // Pressungs-Direktbefüllungen zählen daher nicht mehr mit (erst nach Zuordnung zu einer Charge).
  const gesamtLiterTank = tanks.reduce((s: number, t: R) => s + (Number(t.menge_liter) || 0), 0)
  const tankLagerwert   = tanks.reduce((s: number, t: R) =>
    s + (Number(t.menge_liter) || 0) * (Number(t.einstandspreis_pro_liter) || 0), 0)
  const zukaufLagerwert = zukauf.reduce((s: number, z: R) => {
    const ep = z.preis_gesamt && z.menge ? Number(z.preis_gesamt) / Number(z.menge) : 0
    return s + (Number(z.menge) || 0) * ep
  }, 0)
  const gesamtWertGesamt = gesamtWert + tankLagerwert + zukaufLagerwert

  return (
    <div className="space-y-8">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Lager</h1>
          <p className="text-sm text-s112-muted mt-0.5">Bestand &amp; Verkauf</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Link href="/weinhandel" className="card text-center p-4 hover:shadow-sm hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-3xl font-semibold text-s112-blue-700">{fmtNum(gesamtFlaschen)}</p>
          <p className="text-xs text-s112-muted mt-1">Flaschen auf Lager</p>
          <p className="text-[11px] text-s112-blue-700/60 mt-1">→ Warenlager</p>
        </Link>
        <Link href="/weinhandel/verkauf" className="card text-center p-4 hover:shadow-sm hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-3xl font-semibold text-s112-blue-700">
            {gesamtWertGesamt > 0
              ? fmtEur(gesamtWertGesamt)
              : '–'}
          </p>
          <p className="text-xs text-s112-muted mt-1">Lagerwert gesamt (Einstandspreis)</p>
          <p className="text-[11px] text-s112-blue-700/60 mt-1">→ Verkauf</p>
        </Link>
        <Link href="/weinhandel" className="card text-center p-4 hover:shadow-sm hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-3xl font-semibold text-s112-blue-700">
            {gesamtLiterTank > 0 ? `${fmtNum(gesamtLiterTank)} L` : '–'}
          </p>
          <p className="text-xs text-s112-muted mt-1">Liter im Tank (Direktverkauf)</p>
          <p className="text-[11px] text-s112-blue-700/60 mt-1">→ Warenlager</p>
        </Link>
      </div>

      {/* Flaschenbestand */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="font-semibold text-s112-text flex items-center gap-2"><Package size={18} /> Flaschenbestand</h2>
          {ausverkaufteAnzahl > 0 && (
            <Link href={ausverkaufteZeigen ? '/weinhandel' : '/weinhandel?ausverkauft=1'} className="text-xs text-s112-blue-700 hover:underline">
              {ausverkaufteZeigen
                ? `Ausverkaufte Füllungen ausblenden (${fmtNum(ausverkaufteAnzahl)})`
                : `Ausverkaufte Füllungen einblenden (${fmtNum(ausverkaufteAnzahl)})`}
            </Link>
          )}
        </div>
        {fuellungen.length === 0 && ausverkaufteAnzahl > 0 ? (
          <div className="card text-center py-8">
            <p className="text-sm text-s112-muted">
              Alle Füllungen sind ausverkauft ({fmtNum(ausverkaufteAnzahl)}) – über „Ausverkaufte Füllungen einblenden“ lassen sie sich anzeigen.
            </p>
          </div>
        ) : fuellungen.length === 0 ? (
          <div className="card text-center py-10">
            <Package size={32} className="mx-auto mb-2 text-s112-muted" />
            <p className="text-sm text-s112-muted mb-1">Noch keine Füllungen angelegt.</p>
            <p className="text-xs text-s112-muted">
              Füllungen werden im Kellerbuch unter{' '}
              <Link href="/weinhandel/fuellungen/neu" className="text-s112-blue-700 hover:underline">Neue Füllung</Link>{' '}
              angelegt.
            </p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Produkt</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Qualität</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Größe</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Bestand</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Einstand</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">VK brutto</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Lagerwert</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Abgefüllt</th>
                  {writeOk && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {fuellungen.map((f: R, i: number) => {
                  const bestand    = f.bestand_flaschen ?? 0
                  const gesamt     = f.anzahl_flaschen  ?? 0
                  const vkPreis    = f.vk_preis_brutto  ?? null
                  const einstand   = f.einstandspreis != null ? Number(f.einstandspreis) : null
                  const lagerwert  = einstand != null ? bestand * einstand : null
                  const pct        = gesamt > 0 ? Math.round((bestand / gesamt) * 100) : 0
                  const bestandClr = pct > 50 ? 'text-s112-ok-fg' : pct > 20 ? 'text-s112-warn-fg' : 'text-s112-err-fg'
                  return (
                    <tr key={f.id}
                      className={`border-b border-s112-border last:border-0 hover:bg-s112-bg/50 transition-colors ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                      <td className="px-4 py-3">
                        <Link
                          href={`/kellerbuch/rueckverfolgung?fuellung_id=${f.id}`}
                          title="Rückverfolgung anzeigen (Weinbuch, Analysen, Prüfnummer, Herkunft)"
                          className="font-medium text-s112-text hover:text-s112-blue-700 hover:underline transition-colors inline-flex items-center gap-1.5"
                        >
                          {f.name}{f.bezeichnung ? ` – ${f.bezeichnung}` : ''}
                          <Search size={12} />
                        </Link>
                        <div className="text-xs text-s112-muted mt-0.5 flex gap-2">
                          {f.jahrgang    && <span>{f.jahrgang}</span>}
                          {f.rebsorte    && <span>{formatRebsorteMitKuerzel(f.rebsorte)}</span>}
                          {f.anbaugebiet && <span>{f.anbaugebiet}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-s112-muted">{qualitaetLabel(f.qualitaet)}</td>
                      <td className="px-4 py-3 text-s112-muted whitespace-nowrap">
                        {FLASCHEN_LABEL[f.flaschengroesse_ml] ?? `${f.flaschengroesse_ml} ml`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold tabular-nums ${bestandClr}`}>{fmtNum(bestand)}</span>
                        <span className="text-xs text-s112-muted ml-1">/ {fmtNum(gesamt)}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {einstand != null
                          ? fmtEur(einstand)
                          : <span className="text-s112-muted">–</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {vkPreis != null
                          ? fmtEur(vkPreis)
                          : <span className="text-s112-muted">–</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-s112-blue-700 font-semibold">
                        {lagerwert != null
                          ? fmtEur(lagerwert)
                          : <span className="text-s112-muted font-normal">–</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-s112-muted whitespace-nowrap">
                        {new Date(f.datum).toLocaleDateString('de-AT')}
                      </td>
                      {writeOk && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/weinhandel/fuellungen/${f.id}/edit`}
                              title="Bearbeiten" aria-label="Bearbeiten"
                              className="text-s112-blue-700 hover:text-s112-blue-700/70">
                              <Pencil size={15} />
                            </Link>
                            <FuellungLoeschen id={f.id} name={f.name} gesperrt={loeschSperre.get(f.id) ?? null} />
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tankverkauf */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-semibold text-s112-text flex items-center gap-2"><Truck size={18} /> Tankverkauf (Direktverkauf ab Keller)</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">Transportschein erforderlich</span>
        </div>
        <p className="text-xs text-s112-muted mb-4">
          Ungefüllter Wein kann direkt ab Tank verkauft werden – immer aus einer Kellerbuch-Charge.
          Zukäufe ohne Gebinde und Direktbefüllungen aus der Pressung zuerst einem Gebinde bzw. einer Charge zuordnen.
        </p>

        <h3 className="text-xs font-semibold text-s112-text-2 uppercase tracking-wide mb-2">Kellerbuch-Chargen</h3>
        {tanks.length === 0 ? (
          <div className="card text-center py-6 mb-5">
            <p className="text-sm text-s112-muted">Keine Chargen im Status „Ausbau“ oder „Abfüllung“ vorhanden.</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Charge</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">JG</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Rebsorte</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Behälter</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Liter</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Einstand/L</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Lagerwert</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1"></th>
                </tr>
              </thead>
              <tbody>
                {tanks.map((t: R, i: number) => {
                  const st = STATUS_VERKAUF[t.status] ?? { label: t.status, color: 'bg-[#F2F3F5] text-s112-text-2' }
                  return (
                    <tr key={t.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                      <td className="px-4 py-3 font-medium text-s112-text">{t.name}</td>
                      <td className="px-4 py-3 text-s112-muted">{t.jahrgang ?? '–'}</td>
                      <td className="px-4 py-3 text-s112-muted">{formatRebsorteMitKuerzel(t.rebsorte)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3 text-s112-muted">{(t.behaelter as R | null)?.name ?? '–'}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-s112-blue-700">
                        {t.menge_liter ? fmtNum(Number(t.menge_liter)) : '–'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-s112-muted text-sm">
                        {t.einstandspreis_pro_liter != null
                          ? fmtEur(Number(t.einstandspreis_pro_liter), { min: 2, max: 4 })
                          : <span className="text-xs text-s112-warn-fg">nicht gesetzt</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-s112-blue-700">
                        {t.einstandspreis_pro_liter != null && t.menge_liter
                          ? fmtEur((Number(t.menge_liter) * Number(t.einstandspreis_pro_liter)))
                          : '–'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {writeOk && (
                          <Link href="/weinhandel/verkauf/neu" className="text-xs text-s112-blue-700 hover:underline font-medium">Verkauf →</Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {direktTank.length > 0 && (
          <>
            <h3 className="text-xs font-semibold text-s112-text-2 uppercase tracking-wide mb-2 mt-5">Direktabfüllungen (ohne Weinausbau-Charge)</h3>
            <p className="text-xs text-s112-muted mb-2">
              Nicht direkt verkaufbar – verkauft wird nur aus einer Kellerbuch-Charge. Eine Charge entsteht, wenn die Behälterzeile in der Pressung entfernt und neu eingetragen wird (Erntemeldung › Pressung bearbeiten); bei Fragen bitte den Support kontaktieren.
            </p>
            <div className="card p-0 overflow-hidden mb-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-s112-bg border-b border-s112-border">
                    <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Behälter</th>
                    <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Pressung</th>
                    <th className="text-left px-4 py-3 font-semibold text-s112-text-1">JG</th>
                    <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Liter</th>
                    <th className="text-right px-4 py-3 font-semibold text-s112-text-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {direktTank.map((d: R) => (
                    <tr key={d.id} className="border-b border-s112-border last:border-0 hover:bg-s112-bg/30">
                      <td className="px-4 py-3 font-medium text-s112-text">{(d.behaelter as R | null)?.name ?? '–'}</td>
                      <td className="px-4 py-3 text-s112-muted text-xs">{(d.pressung as R | null)?.weinbezeichnung ?? new Date((d.pressung as R)?.datum ?? '').toLocaleDateString('de-AT')}</td>
                      <td className="px-4 py-3 text-s112-muted text-xs">{((d.pressung as R | null)?.jahrgang as R | null)?.jahrgang ?? '–'}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-s112-blue-700">{fmtNum(Number(d.menge_liter))} L</td>
                      <td className="px-4 py-3 text-right">
                        {writeOk && (
                          <Link
                            href={(d.pressung as R | null)?.jahrgang_id ? `/erntemeldung/${(d.pressung as R).jahrgang_id}` : '/erntemeldung'}
                            className="text-xs text-s112-blue-700 hover:underline font-medium whitespace-nowrap">
                            Pressung bearbeiten →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h3 className="text-xs font-semibold text-s112-text-2 uppercase tracking-wide mb-2 mt-5">Zukäufe ohne Gebinde (nicht eingelagert)</h3>
        {zukauf.length === 0 ? (
          <div className="card text-center py-6">
            <p className="text-sm text-s112-muted mb-2">Keine Zukäufe ohne Gebinde vorhanden.</p>
            {writeOk && (
              <Link href="/weinhandel/zukauf/neu" className="text-sm text-s112-blue-700 hover:underline font-medium">Zukauf erfassen →</Link>
            )}
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Art</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Rebsorte / JG</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Lieferant</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Notizen</th>
                  <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Datum</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Menge (lt. Beleg)</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Einstand/Einh.</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Lagerwert</th>
                  <th className="text-right px-4 py-3 font-semibold text-s112-text-1"></th>
                </tr>
              </thead>
              <tbody>
                {zukauf.map((z: R, i: number) => {
                  const lieferant = z.lieferant_kontakt
                    ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
                    : (z.lieferant_firma as R | null)?.name ?? '–'
                  const rebInfo = [z.rebsorte ? formatRebsorteMitKuerzel(z.rebsorte) : null, z.jahrgang].filter(Boolean).join(' ') || '–'
                  return (
                    <tr key={z.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap">{ART_LABEL[z.art] ?? z.art}</td>
                      <td className="px-4 py-3 text-s112-muted text-xs">{rebInfo}</td>
                      <td className="px-4 py-3 text-s112-muted text-xs">{lieferant}</td>
                      <td className="px-4 py-3 text-s112-muted text-xs max-w-xs truncate">{z.notizen ?? '–'}</td>
                      <td className="px-4 py-3 text-s112-muted text-xs whitespace-nowrap">
                        {new Date(z.datum).toLocaleDateString('de-AT')}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-s112-blue-700 whitespace-nowrap">
                        {fmtNum(Number(z.menge))} {z.einheit}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-s112-muted text-sm whitespace-nowrap">
                        {z.preis_gesamt && z.menge
                          ? fmtEur((Number(z.preis_gesamt) / Number(z.menge)), { min: 2, max: 4 })
                          : '–'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-s112-blue-700 whitespace-nowrap">
                        {z.preis_gesamt
                          ? fmtEur(Number(z.preis_gesamt))
                          : '–'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* KAN-35: kein Verkauf direkt aus dem Zukauf – Wein/Most erst einem Gebinde
                            zuordnen (legt die Kellerbuch-Charge an), Trauben laufen über den Traubenverkauf */}
                        {writeOk && (z.art === 'trauben' ? (
                          <Link href="/weinhandel/traubenverkauf" className="text-xs text-s112-blue-700 hover:underline font-medium whitespace-nowrap">Traubenverkauf →</Link>
                        ) : (
                          <Link href={`/weinhandel/zukauf/${z.id}/edit`} className="text-xs text-s112-blue-700 hover:underline font-medium whitespace-nowrap">Gebinde zuordnen →</Link>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>


      {/* Traubenverkauf → jetzt über Standard-Verkaufsformular */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-s112-text flex items-center gap-2"><Grape size={18} /> Traubenverkauf</h2>
            <p className="text-xs text-s112-muted">Verkauf von Weintrauben (§ 3 Weingesetz-Formularverordnung) – BKI-Liefernummer wird automatisch vergeben</p>
          </div>
          <Link href="/weinhandel/traubenverkauf"
            className="text-xs text-s112-muted hover:text-s112-blue-700 px-3 py-1.5 rounded-lg transition-colors">
            BKI-Übersicht →
          </Link>
        </div>
        <div className="card p-5 flex items-center gap-4">
          <Grape size={30} className="text-s112-blue-700 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-s112-text-1 font-medium">Traubenverkäufe laufen über das Standard-Verkaufsformular</p>
            <p className="text-xs text-s112-muted mt-0.5">
              Positionstyp &ldquo;Weintrauben (kg)&rdquo; auswählen → BKI-Felder (Weingarten, KMW, Gesundheit, Liefernummer) werden automatisch befüllt.
            </p>
          </div>
          {writeOk && (
            <Link href="/weinhandel/verkauf/neu"
              className="text-sm bg-s112-teal text-white px-4 py-2 rounded-xl font-medium hover:bg-opacity-90 transition-colors whitespace-nowrap flex-shrink-0">
              ＋ Verkauf anlegen
            </Link>
          )}
        </div>
        {tvListe.length > 0 && (
          <div className="mt-3 text-xs text-s112-muted text-right">
            <Link href="/weinhandel/traubenverkauf" className="hover:text-s112-blue-700">
              {tvListe.length} BKI-Lieferschein{tvListe.length !== 1 ? 'e' : ''} gesamt →
            </Link>
          </div>
        )}
      </section>

    </div>
  )
}
