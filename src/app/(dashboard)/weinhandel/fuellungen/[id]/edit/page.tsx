import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Wine } from 'lucide-react'
import { updateFuellung } from '../../../actions'
import { KN_CODES } from '@/lib/wein/zolltarif'
import { HERKUNFT_ORDER, HERKUNFT_LABEL, istNiedrigerAls as istHerkunftNiedriger } from '@/lib/herkunft'
import { QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { FUELLUNG_QUALITAETEN, fuellungsStufenFuer, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import { ladeCustomWeinbaugebiete } from '../../../../weinbaugebiete/actions'
import HerkunftCodeSelect from '@/components/weinbaugebiete/HerkunftCodeSelect'
import { fmtNum } from '@/lib/format'
import { folgebuchungenDerFuellung, folgebuchungenFuellungText, heuteOrtsdatum, datumDe } from '../../folgebuchungen'
import { bewegungsartLabel } from '../../bewegungsarten'
import FuellungEditFormular from './FuellungEditFormular'
import SchwundAusbuchenKnopf from './SchwundAusbuchenKnopf'
import BestandKorrigierenForm from './BestandKorrigierenForm'

export const metadata: Metadata = { title: 'Füllung bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-73: zentrale Liste der Füllung (FUELLUNG_QUALITAETEN = CHECK fuellungen_qualitaet_check,
// alle 18 Stufen inkl. „Wein“ und „Ausbruch“), mit Charge über fuellungsStufenFuer()

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

  const [{ data: raw }, { data: waRaw }] = await Promise.all([
    tf((supabase.from('fuellungen') as any).select('*').eq('id', id)).single(),
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, status')
      .order('jahrgang', { ascending: false })),
  ])

  if (!raw) redirect('/weinhandel')
  const f = raw as R
  const chargen = (waRaw ?? []) as R[]

  // Eigene, vom Mandanten selbst angelegte Weinbaugebiete (Herkunft-Code-Selbstverwaltung)
  const customWeinbaugebiete = await ladeCustomWeinbaugebiete()

  // Restmenge der verknüpften Charge laden
  let waRestmenge: number | null = null
  let waName: string | null = null
  let waCeilingQualitaet: string | null = null
  let waCeilingHerkunft: string | null = null
  if (f.weinausbau_id) {
    const { data: waAktuell } = await tf((supabase.from('weinausbau') as any)
      .select('name, menge_liter, status, qualitaetsstufe, herkunft_code').eq('id', f.weinausbau_id)).single()
    const wa = waAktuell as R | null
    if (wa && wa.status !== 'abgeschlossen') {
      waRestmenge = parseFloat(wa.menge_liter ?? '0') || 0
    }
    waName             = wa?.name ?? null
    waCeilingQualitaet = wa?.qualitaetsstufe ?? null
    waCeilingHerkunft  = wa?.herkunft_code ?? null
  }

  // KAN-35: Verkäufe und Bestandsbuchungen dieser Füllung – bestimmen, was noch änderbar ist;
  // fuellung_chargen = die Füllmenge wurde beim Abfüllen von der Charge abgebucht
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
  // Anzahl/Größe/Füllmenge: gesperrt, sobald verkauft oder Bestand gebucht wurde
  const mengenGesperrt = folge.verkaeufe > 0 || folge.bewegungen > 0
  // Von der Charge abgebucht (fuellung_chargen) → Größe/Füllmenge (und die Charge) fest; die
  // Anzahl nur, wenn die Füllmenge sonst aus Anzahl × Größe berechnet würde. Eine nachträglich
  // zugeordnete Charge wurde nie gemindert – sie bleibt wählbar.
  const literGesperrt  = !!f.weinausbau_id && abgebucht
  const anzahlGesperrt = mengenGesperrt || (literGesperrt && f.menge_liter_gefuellt == null)
  const heute = heuteOrtsdatum()
  const abfuelldatum = f.datum ? String(f.datum).slice(0, 10) : null
  const fuellmenge = f.menge_liter_gefuellt != null
    ? Number(f.menge_liter_gefuellt) || 0
    : ((Number(f.anzahl_flaschen) || 0) * (Number(f.flaschengroesse_ml) || 750)) / 1000

  // Aktuell verknüpfte Charge immer einschließen (auch wenn abgeschlossen)
  const chargeInListe = !f.weinausbau_id || chargen.find((c: R) => c.id === f.weinausbau_id)
  let chargenListe = chargen
  if (!chargeInListe && f.weinausbau_id) {
    const { data: extra } = await tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, status').eq('id', f.weinausbau_id)).single()
    if (extra) chargenListe = [extra as R, ...chargen]
  }

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  // Bind updateFuellung with id
  const updateWithId = updateFuellung.bind(null, id)

  // Nur Abstufung erlaubt, keine Aufstufung: Dropdowns auf die aktuelle Stufe
  // der verknüpften Charge + niedrigere Stufen beschränken. Der bereits auf
  // dieser Füllung gespeicherte Wert bleibt immer wählbar, auch falls er durch
  // eine spätere Änderung an der Charge nicht mehr in der erlaubten Liste wäre
  // (verhindert Datenverlust beim Speichern).
  // KAN-73: fuellungsStufenFuer wie beim Anlegen (Eiswein/Strohwein nur bis Beerenauslese,
  // DAC & Co. auch als Qualitätswein, ab Qualitätswein auch DAC & Co. und Sekt);
  // updateFuellung lässt den unveränderten Wert zu.
  const qualitaetOptionsEdit = (() => {
    const basis = fuellungsStufenFuer(waCeilingQualitaet)
    if (f.qualitaet && !basis.some(q => q.value === f.qualitaet)) {
      const bestehend = FUELLUNG_QUALITAETEN.find(q => q.value === f.qualitaet)
      if (bestehend) return [bestehend, ...basis]
    }
    // KAN-73: auch ein Wert außerhalb der Liste bleibt sichtbar (statt still die erste Option)
    return mitGespeichertemWert(basis, f.qualitaet)
  })()

  // Ein eigenes (nicht in HERKUNFT_ORDER geführtes) Weinbaugebiet liegt außerhalb der
  // Rangfolge und schränkt die fixen Stufen daher nicht ein (siehe Migration 140).
  const herkunftOptionsEdit = (() => {
    const aktuellIstRanking = !!waCeilingHerkunft && (HERKUNFT_ORDER as readonly string[]).includes(waCeilingHerkunft)
    const codes = aktuellIstRanking
      ? HERKUNFT_ORDER.filter(code => code === waCeilingHerkunft || istHerkunftNiedriger(code, waCeilingHerkunft as string))
      : HERKUNFT_ORDER
    return codes.map(code => ({ value: code, label: HERKUNFT_LABEL[code] }))
  })()

  // Bereits gespeicherter eigener Wert bleibt wählbar, auch falls das Weinbaugebiet
  // zwischenzeitlich deaktiviert wurde (kein Datenverlust beim Speichern).
  const herkunftCustomOptionsEdit = (() => {
    if (f.herkunft_code
      && !(HERKUNFT_ORDER as readonly string[]).includes(f.herkunft_code)
      && !customWeinbaugebiete.some(w => w.name === f.herkunft_code)
    ) {
      return [{ id: `__bestehend__${f.herkunft_code}`, name: f.herkunft_code as string }, ...customWeinbaugebiete]
    }
    return customWeinbaugebiete
  })()

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

        {/* Kellerbuch-Charge */}
        <div className="card p-5 space-y-2">
          <h2 className="font-semibold text-s112-text text-sm">Kellerbuch-Charge</h2>
          {!f.weinausbau_id && (
            <p className="text-xs text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2">
              Keine Charge verknüpft – Rückverfolgung nur bis zur Abfüllung möglich. Bitte hier nachträglich zuordnen.
              Die nachträgliche Zuordnung dient nur der Rückverfolgung – von der Charge wird dabei nichts abgebucht.
            </p>
          )}
          {literGesperrt ? (
            <div>
              <p id="charge-label" className={labelCls}>Weinausbau-Charge</p>
              <input type="hidden" name="weinausbau_id" value={f.weinausbau_id} />
              <div role="textbox" aria-readonly="true" aria-labelledby="charge-label" className={`${inputCls} bg-s112-bg text-s112-text-1`}>
                {(() => {
                  const c = chargenListe.find((x: R) => x.id === f.weinausbau_id)
                  return c
                    ? `${c.name}${c.jahrgang ? ` (${c.jahrgang})` : ''}${c.status === 'abgeschlossen' ? ' · abgeschlossen' : ''}`
                    : (waName ?? 'verknüpfte Charge')
                })()}
              </div>
              <p className="text-xs text-s112-muted mt-1">
                Fest verknüpft: Die Füllmenge wurde beim Abfüllen von dieser Charge abgebucht. Falsche Charge? Füllung löschen
                (bucht die Liter zurück, nur ohne Verkäufe und Bestandsbuchungen) und neu anlegen.
              </p>
            </div>
          ) : (
            <div>
              <label className={labelCls}>Weinausbau-Charge</label>
              <select aria-label="Weinausbau-Charge" name="weinausbau_id" defaultValue={f.weinausbau_id ?? ''} className={inputCls}>
                <option value="">– keine Verknüpfung –</option>
                {chargenListe.map((c: R) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{c.status === 'abgeschlossen' ? ' · abgeschlossen' : ''}
                  </option>
                ))}
              </select>
              {f.weinausbau_id && (
                <p className="text-xs text-s112-muted mt-1">
                  Nachträglich zugeordnet – von dieser Charge wurde nichts abgebucht. Die Zuordnung (Rückverfolgung, Weinpass)
                  lässt sich deshalb noch ändern; bitte die richtige Charge sorgfältig wählen.
                </p>
              )}
            </div>
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
            <div>
              <label className={labelCls}>Jahrgang</label>
              <input aria-label="Jahrgang" name="jahrgang" type="number" min={1900} max={2100} defaultValue={f.jahrgang ?? ''} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Rebsorte</label>
              <input aria-label="Rebsorte" name="rebsorte" defaultValue={f.rebsorte ?? ''} placeholder="z.B. Grüner Veltliner" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Qualitätsbezeichnung *</label>
              <select aria-label="Qualitätsbezeichnung" name="qualitaet" defaultValue={f.qualitaet} required className={inputCls}>
                {qualitaetOptionsEdit.map(q => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
              {waCeilingQualitaet && (
                <p className="text-xs text-s112-muted mt-1">
                  Charge aktuell: <strong>{QUALITAET_LABEL[waCeilingQualitaet] ?? waCeilingQualitaet}</strong> – nur Abstufung möglich, keine Aufstufung
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Herkunft-Code (BKI)</label>
              <HerkunftCodeSelect
                name="herkunft_code"
                defaultValue={f.herkunft_code ?? ''}
                builtinOptions={herkunftOptionsEdit}
                customOptions={herkunftCustomOptionsEdit}
                className={inputCls}
              />
              {waCeilingHerkunft && (
                <p className="text-xs text-s112-muted mt-1">
                  Charge aktuell: <strong>{HERKUNFT_LABEL[waCeilingHerkunft] ?? waCeilingHerkunft}</strong> – nur Abstufung möglich, keine Aufstufung
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Anbaugebiet</label>
              <input aria-label="Anbaugebiet" name="anbaugebiet" defaultValue={f.anbaugebiet ?? ''} placeholder="z.B. Traisental …" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Subbezeichnung / Ried (optional)</label>
              <input aria-label="Subbezeichnung / Ried (optional)" name="bezeichnung" defaultValue={f.bezeichnung ?? ''} placeholder="z.B. Ried Hohenberg · Reserve" className={inputCls} />
            </div>
          </div>
        </div>

        {/* ── Abfüllung ── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text text-sm">Abfüllung</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Abfülldatum *</label>
              <input aria-label="Abfülldatum"
                name="datum"
                type="date"
                defaultValue={f.datum ? f.datum.split('T')[0] : ''}
                required
                className={inputCls}
              />
            </div>
            <div>
              <p id="flaschengroesse-label" className={labelCls}>Flaschengröße{mengenGesperrt || literGesperrt ? '' : ' *'}</p>
              {mengenGesperrt || literGesperrt ? (
                <>
                  <input type="hidden" name="flaschengroesse_ml" value={f.flaschengroesse_ml} />
                  <div role="textbox" aria-readonly="true" aria-labelledby="flaschengroesse-label" className={`${inputCls} bg-s112-bg text-s112-text-1`}>
                    {FLASCHENGROESSEN.find(fl => fl.value === Number(f.flaschengroesse_ml))?.label ?? `${f.flaschengroesse_ml} ml`}
                  </div>
                </>
              ) : (
                <select aria-labelledby="flaschengroesse-label" name="flaschengroesse_ml" defaultValue={f.flaschengroesse_ml} required className={inputCls}>
                  {FLASCHENGROESSEN.map(fl => (
                    <option key={fl.value} value={fl.value}>{fl.label}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className={labelCls}>Anzahl abgefüllt (gesamt)</label>
              <input aria-label="Anzahl abgefüllt (gesamt)" name="anzahl_flaschen" type="number" min={1} defaultValue={f.anzahl_flaschen} required
                readOnly={anzahlGesperrt}
                className={anzahlGesperrt ? `${inputCls} bg-s112-bg text-s112-text-1` : inputCls} />
              {!anzahlGesperrt && (
                <p className="text-xs text-s112-muted mt-1">Eine Korrektur ändert den Lagerbestand um dieselbe Differenz.</p>
              )}
            </div>
            <div>
              <p className={labelCls}>Aktueller Lagerbestand</p>
              <div className={`${inputCls} bg-s112-bg text-s112-text-1 tabular-nums`}>{fmtNum(bestand, 0)} Flaschen</div>
              <p className="text-xs text-s112-muted mt-1">
                Ändert sich durch Verkäufe und über <a href="#bestand" className="text-s112-blue-700 hover:underline">„Bestand korrigieren“</a> (unten).
              </p>
            </div>
            <div>
              <label className={labelCls}>Tatsächlich gefüllt (Liter)</label>
              <input aria-label="Tatsächlich gefüllt (Liter)" name="menge_liter_gefuellt" type="number" step="0.01" defaultValue={f.menge_liter_gefuellt ?? ''}
                readOnly={mengenGesperrt || literGesperrt}
                className={mengenGesperrt || literGesperrt ? `${inputCls} bg-s112-bg text-s112-text-1` : inputCls} />
            </div>
          </div>

          {mengenGesperrt ? (
            <p className="text-xs text-s112-text-1 bg-s112-bg border border-s112-border rounded-lg px-3 py-2">
              Anzahl, Flaschengröße und Füllmenge sind gesperrt, weil es zu dieser Füllung bereits {folgebuchungenFuellungText(folge)} gibt.
              Abweichungen im Flaschenbestand bitte über <a href="#bestand" className="text-s112-blue-700 hover:underline">„Bestand korrigieren“</a> buchen.
            </p>
          ) : literGesperrt ? (
            <p className="text-xs text-s112-text-1 bg-s112-bg border border-s112-border rounded-lg px-3 py-2">
              {anzahlGesperrt ? 'Anzahl, Flaschengröße und Füllmenge' : 'Flaschengröße und Füllmenge'} sind gesperrt, weil die Füllmenge bereits
              von der Charge abgebucht wurde. Falsch erfasst? Füllung löschen (bucht die Liter zurück) und neu anlegen.
            </p>
          ) : null}
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
