import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Wine } from 'lucide-react'
import { updateFuellung } from '../../../actions'
import { KN_CODES } from '@/lib/wein/zolltarif'
import { HERKUNFT_LABEL } from '@/lib/herkunft'
import { qualitaetText } from '@/lib/weinqualitaet'
import { normalisiereQualitaet } from '@/lib/wein/qualitaetsrang'
import { WEINART_LABEL } from '@/lib/keller/weinart'
import { landAnzeige } from '@/lib/katalog/laender'
import { pnTag, pruefnummerNachtragPruefen, type PnChargeDaten } from '@/lib/kellerbuch/pruefnummer'
import { ladePruefnummerDaten } from '@/lib/kellerbuch/pruefnummerLaden'
import { fmtNum } from '@/lib/format'
import { folgebuchungenDerFuellung, heuteOrtsdatum, datumDe } from '../../folgebuchungen'
import { bewegungsartLabel } from '../../bewegungsarten'
import FuellungEditFormular from './FuellungEditFormular'
import SchwundAusbuchenKnopf from './SchwundAusbuchenKnopf'
import BestandKorrigierenForm from './BestandKorrigierenForm'

export const metadata: Metadata = { title: 'Füllung bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const FLASCHENGROESSEN = [
  { value: 375,  label: '0,375 L – Halbflasche' },
  { value: 750,  label: '0,75 L – Normalflasche (Standard)' },
  { value: 1000, label: '1,0 L' },
  { value: 1500, label: '1,5 L – Magnum' },
  { value: 3000, label: '3,0 L – Doppelmagnum' },
  { value: 6000, label: '6,0 L – Imperiale' },
  { value: 187,  label: '0,187 L – Piccolo' },
  { value: 500,  label: '0,500 L' },
]

const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

/** KAN-84: feste Angabe der Füllung – nur Anzeige, kein Formularfeld (updateFuellung lehnt Änderungen ab) */
function Anzeige({ label, wert, breit = false }: { label: string; wert: string | null | undefined; breit?: boolean }) {
  return (
    <div className={breit ? 'sm:col-span-2' : undefined}>
      <p className={labelCls}>{label}</p>
      <div role="textbox" aria-readonly="true" aria-label={label} className={`${inputCls} bg-s112-bg text-s112-text-1`}>
        {wert || '–'}
      </div>
    </div>
  )
}

// KAN-84 (04.10.2026): Nach der Anlage sind nur Produktname, Preise, KN-Code und Notizen änderbar; die Prüfnummer
// lässt sich einmal aus dem DAC-Antrag der Charge nachtragen. Weinmerkmale, Abfülldatum, Los, Charge und Mengen
// zeigt die Seite nur an – Korrekturen: Füllung stornieren (bucht die Liter zurück) und neu anlegen.
export default async function EditFuellungPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'warenwirtschaft')) redirect('/weinhandel')

  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const { data: raw } = await tf((supabase.from('fuellungen') as any).select('*').eq('id', id)).single()
  if (!raw) redirect('/weinhandel')
  const f = raw as R

  // Verknüpfte Charge: Name und Restmenge (Schwund ausbuchen)
  let waRestmenge: number | null = null
  let waName: string | null = null
  let waJahrgang: number | null = null
  if (f.weinausbau_id) {
    const { data: waAktuell } = await tf((supabase.from('weinausbau') as any)
      .select('name, jahrgang, menge_liter, status').eq('id', f.weinausbau_id)).single()
    const wa = waAktuell as R | null
    if (wa && wa.status !== 'abgeschlossen') {
      waRestmenge = parseFloat(wa.menge_liter ?? '0') || 0
    }
    waName     = wa?.name ?? null
    waJahrgang = wa?.jahrgang ?? null
  }

  // KAN-35: Verkäufe und Bestandsbuchungen dieser Füllung; fuellung_chargen = die Füllmenge wurde beim
  // Abfüllen von der Charge abgebucht (nur dann gibt es „Schwund ausbuchen“)
  const [folge, { data: bewRaw, error: bewErr }, { data: fcRaw, error: fcErr }] = await Promise.all([
    folgebuchungenDerFuellung(supabase, tenantId ?? f.tenant_id, id),
    tf((supabase.from('fuellung_bewegungen') as any)
      .select('id, datum, art, menge_stk, bestand_vorher, bestand_nachher, grund, erstellt_am')
      .eq('fuellung_id', id)
      .order('datum', { ascending: false })
      .order('erstellt_am', { ascending: false })),
    f.weinausbau_id
      ? tf((supabase.from('fuellung_chargen') as any)
          .select('anteil_liter')
          .eq('fuellung_id', id)
          .eq('weinausbau_id', f.weinausbau_id))
      : Promise.resolve({ data: [], error: null }),
  ])
  if (bewErr) throw new Error(`Bestandsbuchungen konnten nicht geladen werden: ${(bewErr as R).message}`)
  if (fcErr) throw new Error(`Chargen-Verknüpfung konnte nicht geladen werden: ${(fcErr as R).message}`)
  const abgebucht = ((fcRaw ?? []) as R[]).length > 0
  const bewegungen = (bewRaw ?? []) as R[]
  const summeBewegungen = bewegungen.reduce((s, b) => s + (Number(b.menge_stk) || 0), 0)
  const bestand   = Number(f.bestand_flaschen) || 0
  const sollBestand = (Number(f.anzahl_flaschen) || 0) - folge.flaschenVerkauft + summeBewegungen
  const heute = heuteOrtsdatum()
  const abfuelldatum = f.datum ? String(f.datum).slice(0, 10) : null
  const fuellmenge = f.menge_liter_gefuellt != null
    ? Number(f.menge_liter_gefuellt) || 0
    : ((Number(f.anzahl_flaschen) || 0) * (Number(f.flaschengroesse_ml) || 750)) / 1000

  // KAN-84: Prüfnummer nachtragen (einmal) – nur Anträge der Charge, deren Nummer für diese Abfüllung gilt
  // (dieselbe Regel wie updateFuellung: pruefnummerNachtragPruefen am Abfülldatum)
  let pnAntraege: { id: string; text: string }[] = []
  let pnHinweis: string | null = null
  const tag = pnTag(f.datum)
  if (!f.pruefnummer && f.weinausbau_id && tenantId && tag) {
    const daten: PnChargeDaten | null = (await ladePruefnummerDaten(supabase, tenantId, [f.weinausbau_id])).get(f.weinausbau_id) ?? null
    const fuellungAntrag = (f.dac_antrag_id as string | null) ?? null
    pnAntraege = (daten?.antraege ?? [])
      .filter(a => pruefnummerNachtragPruefen(daten, a.id, tag, fuellungAntrag).ok)
      .map(a => ({ id: a.id, text: `${a.pruefnummer ?? ''}${a.bezeichnung ? ` · ${a.bezeichnung}` : ''}` }))
    if (pnAntraege.length === 0 && fuellungAntrag) {
      const r = pruefnummerNachtragPruefen(daten, fuellungAntrag, tag, fuellungAntrag)
      if (!r.ok) pnHinweis = r.fehler
    }
  }

  // Bind updateFuellung with id
  const updateWithId = updateFuellung.bind(null, id)

  // KAN-186: gespeicherte Angabe der Füllung normalisiert (Altwerte reserve, sekt … → Stufe + Zusatz/Erzeugnis)
  const fAngabe = normalisiereQualitaet(f)
  const groesseText = FLASCHENGROESSEN.find(fl => fl.value === Number(f.flaschengroesse_ml))?.label ?? `${f.flaschengroesse_ml} ml`

  return (
    <div className="max-w-2xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weinhandel" className="hover:text-s112-blue-700">Weinhandel</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Füllung bearbeiten</span>
      </nav>

      <h1 className="text-2xl font-semibold text-s112-text mb-1">Füllung bearbeiten</h1>
      <p className="text-sm text-s112-muted mb-6">{f.name}</p>

      {/* ── Weinpass / QR-Code ── */}
      {f.chargennummer && (
        <div className="card p-5 flex gap-5 items-start mb-2">
          {/* QR-Code via qrserver.com */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(`https://software112.icp-consultants.at/w/${encodeURIComponent(f.chargennummer)}`)}`}
            alt="QR-Code Weinpass"
            width={120} height={120}
            className="rounded-xl border border-s112-border shrink-0"
          />
          <div className="space-y-2 min-w-0">
            <p className="text-sm font-semibold text-s112-text flex items-center gap-1.5"><Wine className="w-4 h-4 text-s112-blue-700" /> Weinpass</p>
            <p className="text-xs text-s112-muted">Chargennummer: <span className="font-mono text-s112-text-1">{f.chargennummer}</span></p>
            <a
              href={`/w/${encodeURIComponent(f.chargennummer)}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-s112-blue-700 hover:underline break-all">
              /w/{f.chargennummer} ↗
            </a>
            <div className="flex gap-2 pt-1">
              <a
                href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(`https://software112.icp-consultants.at/w/${encodeURIComponent(f.chargennummer)}`)}`}
                download={`weinpass-${f.chargennummer}.png`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs border border-s112-border px-3 py-1 rounded-lg text-s112-text-2 hover:bg-s112-bg">
                QR laden
              </a>
              <a
                href={`/kellerbuch/rueckverfolgung?q=${encodeURIComponent(f.chargennummer)}`}
                className="text-xs border border-s112-border px-3 py-1 rounded-lg text-s112-text-2 hover:bg-s112-bg">
                Rückverfolgung
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Schwund-Ausbuchen (eigenes Bedienelement, nicht mehr im Bearbeiten-Formular verschachtelt) ── */}
      {abgebucht && waRestmenge !== null && waRestmenge > 0.01 && (
        <div className="card p-5 border-s112-warn/30 bg-s112-warn-bg space-y-3 mb-6">
          <div>
            <p className="text-sm font-semibold text-s112-warn-fg">Weinausbau-Charge nicht abgeschlossen</p>
            <p className="text-xs text-s112-warn-fg mt-0.5">
              Die verknüpfte Charge{waName ? ` „${waName}“` : ''} hat noch{' '}
              <strong>{fmtNum(waRestmenge, 2)} L</strong> Bestand.
              Ist die Charge vollständig abgefüllt, kann der Rest hier als Schwund ausgebucht werden
              (datierte Buchung im Bewegungsbuch, Datum der Abfüllung). Wurde nur teilweise abgefüllt,
              bitte nichts tun – der Rest bleibt im Tank.
            </p>
          </div>
          <SchwundAusbuchenKnopf
            fuellungId={id}
            liter={waRestmenge}
            chargeName={waName ?? 'Charge'}
            fuellmenge={fuellmenge}
          />
        </div>
      )}


      <FuellungEditFormular action={updateWithId}>

        {/* Kellerbuch-Charge – fest (KAN-84) */}
        <div className="card p-5 space-y-2">
          <h2 className="font-semibold text-s112-text text-sm">Kellerbuch-Charge</h2>
          {f.weinausbau_id ? (
            <>
              <Anzeige label="Weinausbau-Charge" wert={`${waName ?? 'verknüpfte Charge'}${waJahrgang ? ` (${waJahrgang})` : ''}`} />
              <p className="text-xs text-s112-muted">
                Fest verknüpft. Falsche Charge? Füllung stornieren (bucht die Liter zurück, nur ohne Verkäufe und
                Bestandsbuchungen) und neu anlegen.
              </p>
            </>
          ) : (
            <p className="text-xs text-s112-text-1 bg-s112-bg border border-s112-border rounded-lg px-3 py-2">
              Keine Charge verknüpft – Flaschen-Eröffnungsbestand bzw. Altbestand aus dem Datenimport.
            </p>
          )}
        </div>

        {/* ── Produktbezeichnung ── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text text-sm">Produktbezeichnung</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Produktname *</label>
              <input aria-label="Produktname" name="name" defaultValue={f.name} required className={inputCls} />
            </div>
            <Anzeige label="Jahrgang" wert={f.jahrgang != null ? String(f.jahrgang) : null} />
            <Anzeige label="Rebsorte" wert={f.rebsorte} />
            <Anzeige label="Weinart" wert={f.weinart ? (WEINART_LABEL[f.weinart] ?? f.weinart) : null} />
            <Anzeige label="Land" wert={landAnzeige(f.land_iso ?? 'AT')} />
            <Anzeige label="Qualitätsbezeichnung" wert={qualitaetText(fAngabe)} />
            <Anzeige label="Herkunft-Code (BKI)" wert={f.herkunft_code ? (HERKUNFT_LABEL[f.herkunft_code] ?? f.herkunft_code) : null} />
            <Anzeige label="Anbaugebiet" wert={f.anbaugebiet} />
            <Anzeige label="Subbezeichnung / Ried" wert={f.bezeichnung} />
          </div>
          <p className="text-xs text-s112-muted">
            Weinmerkmale stammen aus der Charge bzw. wurden bei der Anlage festgelegt und sind nicht mehr änderbar.
          </p>
        </div>

        {/* ── Abfüllung ── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text text-sm">Abfüllung</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Anzeige label="Abfülldatum" wert={abfuelldatum ? datumDe(abfuelldatum) : null} />
            <Anzeige label="Los (Chargennummer)" wert={f.chargennummer} />
            <Anzeige label="Flaschengröße" wert={groesseText} />
            <Anzeige label="Anzahl abgefüllt (gesamt)" wert={fmtNum(Number(f.anzahl_flaschen) || 0, 0)} />
            <Anzeige label="Tatsächlich gefüllt (Liter)" wert={f.menge_liter_gefuellt != null ? fmtNum(Number(f.menge_liter_gefuellt), 2) : null} />
            <div>
              <p className={labelCls}>Aktueller Lagerbestand</p>
              <div className={`${inputCls} bg-s112-bg text-s112-text-1 tabular-nums`}>{fmtNum(bestand, 0)} Flaschen</div>
              <p className="text-xs text-s112-muted mt-1">
                Ändert sich durch Verkäufe und über <a href="#bestand" className="text-s112-blue-700 hover:underline">„Bestand korrigieren“</a> (unten).
              </p>
            </div>

            {/* Prüfnummer: einmal nachtragbar, nur aus dem DAC-Antrag der Charge (KAN-84) */}
            <div className="sm:col-span-2">
              {f.pruefnummer ? (
                <Anzeige label="Prüfnummer" wert={f.pruefnummer} />
              ) : pnAntraege.length > 0 ? (
                <>
                  <label className={labelCls}>Prüfnummer nachtragen</label>
                  <select aria-label="Prüfnummer nachtragen" name="pn_antrag_id" defaultValue="" className={inputCls}>
                    <option value="">– noch keine Prüfnummer –</option>
                    {pnAntraege.map(a => <option key={a.id} value={a.id}>{a.text}</option>)}
                  </select>
                  <p className="text-xs text-s112-muted mt-1">
                    Nur aus dem DAC-Antrag der Charge, wenn die Nummer für diese Abfüllung gilt – einmal eingetragen, ist sie nicht mehr änderbar.
                  </p>
                </>
              ) : (
                <>
                  <Anzeige label="Prüfnummer" wert={null} />
                  <p className="text-xs text-s112-muted mt-1">
                    {f.weinausbau_id
                      ? (pnHinweis ?? 'Kein DAC-Antrag der Charge mit einer für diese Abfüllung gültigen Prüfnummer – nachtragen ist möglich, sobald der Antrag genehmigt und die Nummer eingetragen ist.')
                      : 'Ohne Kellerbuch-Charge lässt sich keine Prüfnummer nachtragen.'}
                  </p>
                </>
              )}
            </div>
          </div>

          <p className="text-xs text-s112-text-1 bg-s112-bg border border-s112-border rounded-lg px-3 py-2">
            Abfülldatum, Los und Mengen sind fest. Abweichungen im Flaschenbestand bitte über{' '}
            <a href="#bestand" className="text-s112-blue-700 hover:underline">„Bestand korrigieren“</a> buchen; ist die Füllung
            falsch erfasst, sie stornieren (bucht die Liter auf die Charge zurück – nur ohne Verkäufe und Bestandsbuchungen) und neu anlegen.
          </p>
        </div>

        {/* ── Preise ── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text text-sm">Preise</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>VK-Preis brutto pro Flasche (€)</label>
              <input aria-label="VK-Preis brutto pro Flasche (€)"
                name="vk_preis_brutto"
                type="number"
                step="0.01"
                min={0}
                defaultValue={f.vk_preis_brutto ?? ''}
                placeholder="z.B. 12.90"
                className={inputCls}
              />
              <p className="text-xs text-s112-muted mt-1">Verkaufspreis inkl. MwSt.</p>
            </div>
            <div>
              <label className={labelCls}>Einstandspreis pro Flasche (€)</label>
              <input aria-label="Einstandspreis pro Flasche (€)"
                name="einstandspreis"
                type="number"
                step="0.01"
                min={0}
                defaultValue={f.einstandspreis ?? ''}
                placeholder="z.B. 4.20"
                className={inputCls}
              />
              <p className="text-xs text-s112-muted mt-1">Kalkulationskosten / Lagerwert – netto, intern</p>
            </div>
          </div>
        </div>

        {/* ── Export / Zoll ── */}
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-s112-text text-sm">Export (intern)</h2>
          <div>
            <label className={labelCls}>
              KN-Code / Zolltarifnummer{' '}
              <span className="text-s112-muted font-normal">– nur für Exportdokumente, wird nicht gedruckt</span>
            </label>
            <select name="zolltarifnummer" defaultValue={f.zolltarifnummer ?? ''} className={inputCls}>
              <option value="">– kein KN-Code –</option>
              {Array.from(new Set(KN_CODES.map(k => k.gruppe))).map(gruppe => (
                <optgroup key={gruppe} label={gruppe}>
                  {KN_CODES.filter(k => k.gruppe === gruppe).map(k => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {/* ── Notizen ── */}
        <div className="card p-5">
          <label className={labelCls}>Notizen</label>
          <textarea aria-label="Notizen"
            name="notizen"
            rows={3}
            defaultValue={f.notizen ?? ''}
            placeholder="Abfüllungsprotokoll, Besonderheiten …"
            className={inputCls + ' resize-none'}
          />
        </div>

        {/* Aktionen (Speichern/Abbrechen) und Fehlermeldung rendert FuellungEditFormular */}
      </FuellungEditFormular>

      {/* ── Flaschenbestand (KAN-35): eigenes Formular AUSSERHALB des Bearbeiten-Formulars ── */}
      <section id="bestand" className="card p-5 space-y-4 mt-6 scroll-mt-24">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-s112-text text-sm">Flaschenbestand</h2>
          <p className="text-sm text-s112-text">
            Aktuell <strong className="tabular-nums">{fmtNum(bestand, 0)}</strong> Flaschen
          </p>
        </div>
        <p className="text-xs text-s112-muted tabular-nums">
          Abgefüllt {fmtNum(Number(f.anzahl_flaschen) || 0, 0)}
          {' '}· verkauft {fmtNum(folge.flaschenVerkauft, 0)}
          {' '}· Bestandsbuchungen {summeBewegungen > 0 ? '+' : summeBewegungen < 0 ? '−' : '±'}{fmtNum(Math.abs(summeBewegungen), 0)}
        </p>
        {sollBestand !== bestand && (
          <p className="text-xs text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2">
            Der Lagerbestand weicht um {fmtNum(Math.abs(bestand - sollBestand), 0)} Flaschen von „abgefüllt − verkauft ± Bestandsbuchungen“
            ({fmtNum(sollBestand, 0)}) ab – vermutlich eine Änderung aus der Zeit vor den Bestandsbuchungen.
            Nach einer Inventur bitte den gezählten Bestand buchen.
          </p>
        )}

        <div className="border-t border-s112-border pt-4">
          <h3 className="text-sm font-semibold text-s112-text mb-1">Bestand korrigieren</h3>
          <p className="text-xs text-s112-muted mb-3">
            Inventur, Bruch, Eigenverbrauch oder Korrektur als datierte Buchung – der Bestand wird nicht mehr überschrieben.
            Verkäufe und Stornos buchen den Bestand weiterhin selbst.
          </p>
          <BestandKorrigierenForm
            fuellungId={id}
            bestand={bestand}
            heute={heute}
            abfuelldatum={abfuelldatum}
          />
        </div>

        <div className="border-t border-s112-border pt-4">
          <h3 className="text-sm font-semibold text-s112-text mb-2">Bisherige Bestandsbuchungen</h3>
          {bewegungen.length === 0 ? (
            <p className="text-xs text-s112-muted">Noch keine Bestandsbuchungen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-s112-text-2 border-b border-s112-border">
                    <th className="py-2 pr-3 font-medium">Datum</th>
                    <th className="py-2 pr-3 font-medium">Art</th>
                    <th className="py-2 pr-3 font-medium text-right">± Stück</th>
                    <th className="py-2 pr-3 font-medium text-right">Bestand vorher → nachher</th>
                    <th className="py-2 font-medium">Grund</th>
                  </tr>
                </thead>
                <tbody>
                  {bewegungen.map(b => {
                    const m = Number(b.menge_stk) || 0
                    return (
                      <tr key={b.id} className="border-b border-s112-border last:border-0 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{datumDe(String(b.datum ?? ''))}</td>
                        <td className="py-2 pr-3">{bewegungsartLabel(String(b.art ?? ''))}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums font-medium ${m < 0 ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                          {m > 0 ? '+' : '−'}{fmtNum(Math.abs(m), 0)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                          {b.bestand_vorher != null ? fmtNum(Number(b.bestand_vorher), 0) : '–'} → {b.bestand_nachher != null ? fmtNum(Number(b.bestand_nachher), 0) : '–'}
                        </td>
                        <td className="py-2 text-s112-text-1 break-words">{b.grund ?? '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
