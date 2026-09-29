// behoerdenmeldung: gebindeverzeichnis, aenderungsprotokoll
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fmtLiter, fmtNum } from '@/lib/format'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Pencil } from 'lucide-react'
import GebindeClient from '@/components/kellerbuch/GebindeClient'
import LoeschenButton from '@/components/kellerbuch/LoeschenButton'
import { createBehaelter, updateBehaelter, deleteBehaelter } from '../actions'
import { createEroeffnungsbestand, deleteEroeffnungsbestand, deleteUmzug } from '../gebinde-actions'
import { ladeKellergemeinschaft } from '@/lib/keller/behaelter'
import { Users } from 'lucide-react'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeGebindeverzeichnis } from '@/lib/behoerden/gebindeverzeichnis'
import DruckKnopf from '../_behoerden/DruckKnopf'
import ZeitraumCsvKnopf from '../_behoerden/ZeitraumCsvKnopf'
import { QUALITAET_OPTS, qualitaetLabel } from '@/lib/wein/qualitaet'

export const metadata: Metadata = { title: 'Gebinde – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Eröffnungsbestand = Kellerbuch-Charge (weinausbau): zentrale Chargen-Liste (KAN-73)
const QUALITAETEN = QUALITAET_OPTS

export default async function GebindePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string }>
}) {
  const { tab = 'gebinde', err } = await searchParams
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role, 'kellerbuch')
  const adminOk  = canAdmin(role)

  // Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
  // beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
  // Daten eines anderen Betriebs als des gerade ausgewählten angezeigt werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    verzeichnis,
    gemeinschaft,
    { data: eroeffnungRaw },
    { data: umzuegeRaw },
  ] = await Promise.all([
    // Eigene + freigegebene Gebinde (Kellergemeinschaft, Migration 203) samt fremder
    // Belegung und den aktiven eigenen Chargen – dieselbe Ladefunktion wie die CSV
    // „gebindeverzeichnis“ (lib/behoerden/gebindeverzeichnis.ts). Chargen anderer
    // Betriebe bleiben unsichtbar.
    tenantId ? ladeGebindeverzeichnis(supabase, tenantId) : Promise.resolve({ eintraege: [], zeilen: [], warnungen: [] }),
    ladeKellergemeinschaft(supabase, tenantId),
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, kmw, menge_liter, qualitaetsstufe, behaelter_id, behaelter:behaelter_id(name), notizen, einstandspreis_pro_liter, referenz_altsystem, transaktions_nr, aktiv')
      .eq('ist_eroeffnungsbestand', true)
      .eq('aktiv', true)
      .order('jahrgang', { ascending: false })),
    tf((supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, schwund_liter, brutto_liter, umzug_batch_id, zeilen_typ, umzug_typ, notizen, transaktions_nr, von_weinausbau:von_weinausbau_id(name, jahrgang), von_behaelter:von_behaelter_id(name), nach_behaelter:nach_behaelter_id(name)')
      .order('datum', { ascending: false })
      .limit(200)),
  ])

  const gebinde      = verzeichnis.eintraege.map(e => e.gebinde)
  const istEigentuemer = gemeinschaft.alsEigentuemer.length > 0
  const istNutzer      = gemeinschaft.alsNutzer.length > 0
  const eroeffnungen = (eroeffnungRaw ?? []) as R[]
  const umzuegeFlat  = (umzuegeRaw   ?? []) as R[]

  // Umzüge nach Batch gruppieren (n:n-Unterstützung)
  type UmzugGruppe = {
    key: string
    datum: string
    quellenNames: string[]   // Quell-Gebinde-Bezeichnungen (oder Chargenname als Fallback)
    ziele: { gebinde: string; menge: number }[]
    brutto: number
    schwund: number
    notizen: string | null
    transaktions_nr: string | null
    ersteId: string
    /** Schwundbuchung (umzug_typ 'schwund') – nicht stornierbar (KAN-35) */
    istSchwund?: boolean
  }
  const umzuege: UmzugGruppe[] = []
  const seenBatches = new Set<string>()

  for (const u of umzuegeFlat) {
    const batchId = u.umzug_batch_id as string | null
    if (batchId && seenBatches.has(batchId)) continue

    if (batchId) {
      seenBatches.add(batchId)
      const batch = umzuegeFlat.filter((r: R) => r.umzug_batch_id === batchId)
      const isNewFormat = batch.some((r: R) => r.zeilen_typ === 'quelle' || r.zeilen_typ === 'ziel')

      if (isNewFormat) {
        const quelleRecs = batch.filter((r: R) => r.zeilen_typ === 'quelle')
        const zielRecs   = batch.filter((r: R) => r.zeilen_typ === 'ziel')
        const sumBrutto  = quelleRecs.reduce((s: number, r: R) => s + (parseFloat(r.brutto_liter) || 0), 0)
        const sumNetto   = zielRecs.reduce((s: number, r: R) => s + (parseFloat(r.menge_liter) || 0), 0)
        umzuege.push({
          key:          batchId,
          datum:        quelleRecs[0]?.datum ?? batch[0].datum,
          quellenNames: quelleRecs.map((r: R) =>
            (r.von_behaelter as R | null)?.name ?? (r.von_weinausbau as R | null)?.name ?? '?'
          ),
          ziele:        zielRecs.map((r: R) => ({ gebinde: (r.nach_behaelter as R | null)?.name ?? '–', menge: parseFloat(r.menge_liter) || 0 })),
          brutto:       sumBrutto,
          schwund:      Math.max(0, sumBrutto - sumNetto),
          notizen:      quelleRecs[0]?.notizen ?? null,
          transaktions_nr: quelleRecs[0]?.transaktions_nr ?? null,
          ersteId:      quelleRecs[0]?.id ?? batch[0].id,
        })
      } else {
        // Altes Format (transfer)
        const haupt = batch.find((r: R) => r.brutto_liter != null) ?? batch[0]
        const bruttoVal = parseFloat(haupt.brutto_liter) || batch.reduce((s: number, r: R) =>
          s + (parseFloat(r.menge_liter) || 0) + (parseFloat(r.schwund_liter) || 0), 0)
        umzuege.push({
          key:          batchId,
          datum:        haupt.datum,
          quellenNames: [(haupt.von_behaelter as R | null)?.name ?? (haupt.von_weinausbau as R | null)?.name ?? '–'],
          ziele:        batch.map((r: R) => ({ gebinde: (r.nach_behaelter as R | null)?.name ?? '–', menge: parseFloat(r.menge_liter) || 0 })),
          brutto:       bruttoVal,
          schwund:      batch.reduce((s: number, r: R) => s + (parseFloat(r.schwund_liter) || 0), 0),
          notizen:      haupt.notizen ?? null,
          transaktions_nr: haupt.transaktions_nr ?? null,
          ersteId:      batch[0].id,
        })
      }
    } else {
      const bruttoVal = parseFloat(u.brutto_liter) || ((parseFloat(u.menge_liter) || 0) + (parseFloat(u.schwund_liter) || 0))
      umzuege.push({
        key:          u.id,
        datum:        u.datum,
        quellenNames: [(u.von_behaelter as R | null)?.name ?? (u.von_weinausbau as R | null)?.name ?? '–'],
        ziele:        [{ gebinde: (u.nach_behaelter as R | null)?.name ?? '–', menge: parseFloat(u.menge_liter) || 0 }],
        brutto:       bruttoVal,
        schwund:      parseFloat(u.schwund_liter) || 0,
        notizen:      u.notizen ?? null,
        transaktions_nr: u.transaktions_nr ?? null,
        ersteId:      u.id,
        istSchwund:   u.umzug_typ === 'schwund',
      })
    }
  }

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  const TABS = [
    { key: 'gebinde',            label: 'Gebinde' },
    { key: 'eroeffnungsbestand', label: 'Eröffnungsbestand' },
    { key: 'umziehen',           label: 'Umziehen' },
    { key: 'kellerplan',         label: 'Kellerplan' },
  ]

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Gebinde</span>
      </div>

      <h1 className="text-2xl font-semibold text-s112-text">Gebinde</h1>

      <div className="flex gap-1 border-b border-s112-border print:hidden">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/kellerbuch/gebinde?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
              ${tab === t.key
                ? 'bg-white border border-b-white border-s112-border text-s112-blue-700 -mb-px'
                : 'text-s112-muted hover:text-s112-blue-700'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* TAB: Gebinde */}
      {tab === 'gebinde' && (
        <div className="space-y-6">
          {writeOk && (
            <details className="card p-5 print:hidden">
              <summary className="cursor-pointer font-semibold text-sm text-s112-text select-none">
                + Neues Gebinde anlegen
              </summary>
              <form action={createBehaelter} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Bezeichnung *</label>
                  <input aria-label="Bezeichnung" name="name" required placeholder="z.B. Tanknummer" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Typ</label>
                  <select aria-label="Typ" name="typ" className={inputCls}>
                    <option value="">– kein –</option>
                    <option value="amphore">Amphore</option>
                    <option value="barrique">Barrique</option>
                    <option value="betonei">Betonei</option>
                    <option value="bottich">Bottich</option>
                    <option value="doppelbarrique">Doppel-Barrique</option>
                    <option value="gaerstaender">Gärständer</option>
                    <option value="holzfass">Holzfass</option>
                    <option value="immervolltank">Immervoll-Tank</option>
                    <option value="lagertank">Lagertank</option>
                    <option value="stahltank">Stahltank</option>
                    <option value="presse">Presse</option>
                    <option value="zisterne">Zisterne</option>
                    <option value="sonstiges">Sonstiges</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Fassungsvermögen (Liter)</label>
                  <input aria-label="Fassungsvermögen (Liter)" name="volumen_liter" type="number" step="0.01" min={0} placeholder="z.B. 5000" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Standort</label>
                  <input aria-label="Standort" name="standort" placeholder="z.B. Keller 1, Reihe A" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Notizen</label>
                  <input aria-label="Notizen" name="notizen" placeholder="z.B. geliehen, Besonderheiten" className={inputCls} />
                </div>
                <div className="sm:col-span-2 flex flex-wrap gap-5 text-sm text-s112-text">
                  <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" name="stapler" value="true" className="accent-[var(--s112-teal)]" /> mit Stapler versetzbar</label>
                  {istEigentuemer && (
                    <label className="inline-flex items-center gap-2 cursor-pointer"><input type="hidden" name="gemeinsam_sichtbar" value="1" /><input type="checkbox" name="gemeinsam" value="true" defaultChecked className="accent-[var(--s112-teal)]" /> für Partnerbetriebe freigegeben ({gemeinschaft.alsEigentuemer.map(p => p.name).join(', ')})</label>
                  )}
                </div>
                <div className="sm:col-span-2 flex gap-3">
                  <button type="submit" className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
                    Gebinde anlegen
                  </button>
                </div>
              </form>
            </details>
          )}

          {(istEigentuemer || istNutzer) && (
            <div className="rounded-lg border border-s112-line bg-s112-bg px-4 py-3 text-xs text-s112-text-2 flex items-start gap-2">
              <Users className="w-4 h-4 text-s112-tertiary shrink-0 mt-0.5" />
              <span>
                Kellergemeinschaft: {istEigentuemer && <>Deine freigegebenen Gebinde können von <b className="text-s112-text">{gemeinschaft.alsEigentuemer.map(p => p.name).join(', ')}</b> genutzt werden. </>}
                {istNutzer && <>Du siehst zusätzlich die Gebinde von <b className="text-s112-text">{gemeinschaft.alsNutzer.map(p => p.name).join(', ')}</b>. </>}
                Vom Wein anderer Betriebe ist nur „belegt“ samt Litern sichtbar; ein fremd belegtes Gebinde kann nicht als Ziel gewählt werden.
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-semibold text-s112-text text-sm">Gebindeverzeichnis</h2>
            <div className="flex items-start gap-2 print:hidden">
              <DruckKnopf />
              <CsvExportKnopf href={csvPfad('gebindeverzeichnis')} />
            </div>
          </div>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Bezeichnung</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Typ</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Volumen</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Standort</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Inhalt</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Füllstand</th>
                  {writeOk && <th className="px-4 py-2.5 print:hidden" />}
                </tr>
              </thead>
              <tbody>
                {verzeichnis.eintraege.map(({ gebinde: g, eigenLiter, fuellPct }, i: number) => {
                  // Füllstand: eigener Wein + fremd belegte Liter (Details des Partners bleiben verborgen)
                  const volumen = g.volumen_liter
                  const barColor = fuellPct == null ? ''
                    : fuellPct > 100 ? 'bg-s112-err'
                    : fuellPct > 85  ? 'bg-s112-warn'
                    : 'bg-s112-ok'
                  return (
                    <tr key={g.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''} ${!g.aktiv ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-s112-text">
                        {g.name}
                        {g.fremd && <span title={`Gebinde von ${g.eigentuemer_name}`} className="ml-1.5 align-middle inline-block text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded bg-s112-blue-50 text-s112-blue-700">{g.eigentuemer_name}</span>}
                        {!g.fremd && istEigentuemer && !g.gemeinsam && <span title="Nicht für Partnerbetriebe freigegeben" className="ml-1.5 align-middle inline-block text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded bg-s112-bg text-s112-text-2 border border-s112-line">nur eigen</span>}
                        {g.stapler && <span title="mit Stapler versetzbar" className="ml-1.5 align-middle inline-block text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded bg-s112-bg text-s112-text-2 border border-s112-line">Stapler</span>}
                      </td>
                      <td className="px-4 py-2.5 text-s112-text-2 capitalize">{g.typ ?? '–'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-2">
                        {volumen ? fmtLiter(volumen) : '–'}
                      </td>
                      <td className="px-4 py-2.5 text-s112-text-2">{g.standort ?? '–'}{g.notizen ? <span className="block text-[11px] text-s112-tertiary">{g.notizen}</span> : null}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {g.gesperrt
                          ? <span className="text-s112-warn-fg" title={`Belegt durch ${g.fremd_betrieb ?? 'anderen Betrieb'} – kein Ziel für Umzüge`}>belegt · {g.fremd_betrieb ?? 'Partner'}{eigenLiter > 0 ? '' : ` · ${fmtLiter(g.fremd_liter)}`}</span>
                          : <span className="text-s112-blue-700">{eigenLiter > 0 ? fmtLiter(eigenLiter) : '–'}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {fuellPct != null ? (
                          <div className="flex items-center gap-2 min-w-[100px]">
                            <div className="flex-1 bg-s112-line rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-2 rounded-full transition-all ${barColor}`}
                                style={{ width: `${Math.min(fuellPct, 100).toFixed(0)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-medium tabular-nums shrink-0 ${fuellPct > 100 ? 'text-s112-err-fg' : fuellPct > 85 ? 'text-s112-warn-fg' : 'text-s112-ok-fg'}`}>
                              {fuellPct.toFixed(0)} %
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-s112-tertiary">–</span>
                        )}
                      </td>
                      {writeOk && (
                        <td className="px-4 py-2.5 text-right print:hidden">
                          {!g.fremd && <GebindeClient gebinde={g} action={updateBehaelter.bind(null, g.id)} inputCls={inputCls} labelCls={labelCls} partner={istEigentuemer ? gemeinschaft.alsEigentuemer.map(p => p.name).join(', ') : null} />}
                          {adminOk && !g.fremd && (
                            <LoeschenButton
                              action={deleteBehaelter.bind(null, g.id)}
                              bestaetigung={`Gebinde "${g.name}" wirklich löschen?`}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
                {gebinde.length === 0 && (
                  <tr><td colSpan={writeOk ? 7 : 6} className="px-4 py-6 text-center text-xs text-s112-muted italic">Noch keine Gebinde angelegt</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* KAN-35-Bestandsprotokoll als Aufzeichnung für die Weinaufsicht – lesen dürfen es
              nur Betriebs-Manager und Super-Admins (RLS), daher nur für sie sichtbar */}
          {adminOk && (
            <div className="card p-5 space-y-3 print:hidden">
              <div>
                <h2 className="font-semibold text-s112-text text-sm">Änderungs- und Löschprotokoll</h2>
                <p className="text-xs text-s112-muted mt-0.5">
                  Nachträgliche Änderungen und Löschungen in Kellerbuch, Lese und Verkauf (seit 24.09.2026 lückenlos
                  protokolliert) – mit Zeitpunkt, alten und neuen Werten und Benutzer. Nur für Betriebs-Manager.
                </p>
              </div>
              <ZeitraumCsvKnopf meldung="aenderungsprotokoll" label="Protokoll als CSV" />
            </div>
          )}
        </div>
      )}

      {/* TAB: Eröffnungsbestand */}
      {tab === 'eroeffnungsbestand' && (
        <div className="space-y-6">
          <p className="text-sm text-s112-muted">
            Bestände aus dem Altsystem werden auf den 1.1. des laufenden Jahres eingebucht.
          </p>

          {err && (
            <div className="rounded-lg border border-s112-err/30 bg-s112-err-bg px-4 py-3 text-sm text-s112-err-fg">
              <strong>Fehler beim Speichern:</strong> {err}
            </div>
          )}

          {writeOk && (
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold text-sm text-s112-text select-none">
                + Eröffnungsbestand erfassen
              </summary>
              <form action={createEroeffnungsbestand} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Weinbezeichnung *</label>
                  <input aria-label="Weinbezeichnung" name="name" required placeholder="z.B. Grüner Veltliner Ried Hohenberg" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Gebinde</label>
                  <select aria-label="Gebinde" name="behaelter_id" className={inputCls}>
                    <option value="">– kein –</option>
                    {gebinde.filter(g => g.aktiv && !g.gesperrt).map(g => (
                      <option key={g.id} value={g.id}>{g.anzeigeName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Jahrgang</label>
                  <input aria-label="Jahrgang" name="jahrgang" type="number" min={1900} max={2100}
                    defaultValue={new Date().getFullYear() - 1} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>KMW (°KMW)</label>
                  <input aria-label="KMW (°KMW)" name="kmw" type="number" step="0.1" min={0} max={50}
                    placeholder="z.B. 17.5" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Menge (Liter) *</label>
                  <input aria-label="Menge (Liter)" name="menge_liter" type="number" step="0.01" min={0.01}
                    required placeholder="z.B. 3000" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Einstandspreis pro Liter (€)</label>
                  <input aria-label="Einstandspreis pro Liter (€)" name="einstandspreis_pro_liter" type="text" inputMode="decimal"
                    placeholder="z.B. 1,50" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Qualitätsstufe</label>
                  <select aria-label="Qualitätsstufe" name="qualitaetsstufe" className={inputCls}>
                    <option value="">– keine –</option>
                    {QUALITAETEN.map(q => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Referenz Altsystem</label>
                  <input aria-label="Referenz Altsystem" name="referenz_altsystem" placeholder="z.B. Chargen-Nr. Altsystem" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Notizen</label>
                  <input aria-label="Notizen" name="notizen" placeholder="z.B. Herkunft Altsystem …" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <button type="submit" className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
                    Eröffnungsbestand speichern
                  </button>
                </div>
              </form>
            </details>
          )}

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">TXN</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Wein</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">JG</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">KMW</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Menge</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Einstand/L</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Gebinde</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Qualität</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Referenz Altsystem</th>
                  {writeOk && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {eroeffnungen.map((e: R, i: number) => (
                  <tr key={e.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 text-xs font-mono text-s112-muted whitespace-nowrap">{e.transaktions_nr ?? '–'}</td>
                    <td className="px-4 py-2.5 font-medium text-s112-text">{e.name}</td>
                    <td className="px-4 py-2.5 text-s112-text-2">{e.jahrgang ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-2">
                      {e.kmw ? `${fmtNum(parseFloat(e.kmw))} °KMW` : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-blue-700 font-medium">
                      {fmtLiter(parseFloat(e.menge_liter))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-2">
                      {e.einstandspreis_pro_liter != null
                        ? `€ ${fmtNum(parseFloat(e.einstandspreis_pro_liter), { min: 2, max: 4 })}`
                        : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-s112-text-2">{(e.behaelter as R | null)?.name ?? '–'}</td>
                    <td className="px-4 py-2.5 text-s112-text-2 text-xs">{qualitaetLabel(e.qualitaetsstufe)}</td>
                    <td className="px-4 py-2.5 text-s112-text-2 text-xs">{e.referenz_altsystem ?? '–'}</td>
                    {writeOk && (
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {parseFloat(e.menge_liter) > 0.01 && (
                          <Link href={`/weinhandel/fuellungen/neu?charge=${e.id}`}
                            className="text-xs text-s112-blue-700 border border-s112-teal/30 rounded-full px-2 py-0.5 hover:bg-s112-teal hover:text-s112-yellow transition-colors whitespace-nowrap mr-2">
                            Abfüllen
                          </Link>
                        )}
                        <Link href={`/kellerbuch/eroeffnungsbestand/${e.id}/edit`}
                          title="Bearbeiten" aria-label="Bearbeiten"
                          className="text-s112-blue-700 hover:text-s112-blue-700/70 mr-3 inline-flex"><Pencil className="w-4 h-4" /></Link>
                        <LoeschenButton
                          label="Eröffnungsbestand löschen"
                          action={deleteEroeffnungsbestand.bind(null, e.id)}
                          bestaetigung="Eröffnungsbestand wirklich löschen? Anfangsbestand und Bestand werden auf 0 gesetzt – nur möglich, solange an der Charge keine Folgebuchungen hängen." />
                      </td>
                    )}
                  </tr>
                ))}
                {eroeffnungen.length === 0 && (
                  <tr><td colSpan={writeOk ? 10 : 9} className="px-4 py-6 text-center text-xs text-s112-muted italic">Noch keine Eröffnungsbestände erfasst</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Umziehen */}
      {tab === 'umziehen' && (
        <div className="space-y-6">
          <p className="text-sm text-s112-muted">
            Quell-Gebinde wählen, Brutto-Menge eingeben und beliebig viele Ziel-Gebinde mit Netto-Litern angeben. Schwund wird automatisch berechnet.
          </p>

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">TXN</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Quell-Gebinde</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Ziel-Gebinde (netto)</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Brutto</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Schwund</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Notizen</th>
                  {writeOk && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {umzuege.map((u, i) => (
                  <tr key={u.key} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 text-xs font-mono text-s112-muted whitespace-nowrap">{u.transaktions_nr ?? '–'}</td>
                    <td className="px-4 py-2.5 text-s112-text-2 whitespace-nowrap">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5 text-s112-text">
                      {u.quellenNames.join(' · ')}
                      {u.istSchwund && (
                        <span className="ml-1.5 text-xs bg-s112-warn-bg text-s112-warn-fg px-1.5 py-0.5 rounded-full">Schwund</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-s112-text-2">
                      {u.ziele.map((z, zi) => (
                        <span key={zi}>
                          {zi > 0 && <span className="text-s112-tertiary mx-1">·</span>}
                          {z.gebinde}
                          <span className="text-s112-blue-700 font-medium ml-1 text-xs">
                            {fmtLiter(z.menge)}
                          </span>
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-1 font-medium">
                      {fmtLiter(u.brutto)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-2">
                      {u.schwund > 0
                        ? fmtLiter(u.schwund) : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-s112-text-2 text-xs">{u.notizen ?? '–'}</td>
                    {writeOk && (
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {/* KAN-35: Umzüge nur stornierbar, solange die Ziel-Charge nicht weiterbewegt
                            wurde; Schwundbuchungen nur durch Betriebs-Manager (Menge/Datum nie änderbar) */}
                        <Link href={`/kellerbuch/umzug/${u.ersteId}/edit`}
                          title={u.istSchwund ? 'Notizen bearbeiten' : 'Bearbeiten'} aria-label="Bearbeiten"
                          className="text-s112-blue-700 hover:text-s112-blue-700/70 mr-3 inline-flex"><Pencil className="w-4 h-4" /></Link>
                        {(!u.istSchwund || adminOk) && (
                          <LoeschenButton
                            label="Stornieren"
                            action={deleteUmzug.bind(null, u.ersteId)}
                            bestaetigung={u.istSchwund
                              ? 'Schwundbuchung stornieren? Die Menge wird auf die Charge zurückgebucht und die Buchung gelöscht – nur möglich, wenn sie den Bestand gemindert hat und an der Charge seither nichts gebucht wurde.'
                              : 'Umzug stornieren? Quelle und Ziel werden zurückgebucht und die Buchung gelöscht – nur möglich, solange die Ziel-Charge seither nicht weiterbewegt wurde.'} />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {umzuege.length === 0 && (
                  <tr><td colSpan={writeOk ? 8 : 7} className="px-4 py-6 text-center text-xs text-s112-muted italic">Noch keine Umzüge erfasst</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Kellerplan */}
      {tab === 'kellerplan' && (
        <div className="card p-8 text-center text-s112-muted text-sm">
          <p className="mb-2">Der Kellerplan zeigt die visuelle Anordnung aller Gebinde.</p>
          <Link href="/kellerbuch/kellerplan"
            className="inline-block text-s112-blue-700 font-medium hover:underline">
            Zum Kellerplan →
          </Link>
        </div>
      )}
    </div>
  )
}
