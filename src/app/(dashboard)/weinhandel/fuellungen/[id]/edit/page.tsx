import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Wine } from 'lucide-react'
import { updateFuellung, schwundAusbuchen } from '../../../actions'
import { KN_CODES } from '@/lib/wein/zolltarif'
import { HERKUNFT_ORDER, HERKUNFT_LABEL } from '@/lib/herkunft'
import { QUALITAET_LABEL } from '@/lib/weinqualitaet'

export const metadata: Metadata = { title: 'Füllung bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const QUALITAETEN = [
  { value: 'qualitaetswein',        label: 'Qualitätswein' },
  { value: 'kabinett',              label: 'Kabinett' },
  { value: 'spaetlese',             label: 'Spätlese' },
  { value: 'auslese',               label: 'Auslese' },
  { value: 'beerenauslese',         label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese',  label: 'Trockenbeerenauslese (TBA)' },
  { value: 'eiswein',               label: 'Eiswein' },
  { value: 'strohwein',             label: 'Strohwein / Schilfwein' },
  { value: 'dac',                   label: 'DAC (Districtus Austriae Controllatus)' },
  { value: 'reserve',               label: 'Reservé / Reserve' },
  { value: 'erste_lage',            label: 'Erste Lage (ÖTW)' },
  { value: 'grosses_gewachs',       label: 'Großes Gewächs' },
  { value: 'landwein',              label: 'Landwein' },
  { value: 'sekt',                  label: 'Sekt b.A.' },
  { value: 'perlwein',              label: 'Perlwein' },
  { value: 'sonstiges',             label: 'Sonstiges' },
]

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
  if (!canWrite(role)) redirect('/weinhandel')

  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [{ data: raw }, { data: waRaw }] = await Promise.all([
    (supabase.from('fuellungen') as any).select('*').eq('id', id).single(),
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, status')
      .order('jahrgang', { ascending: false }),
  ])

  if (!raw) redirect('/weinhandel')
  const f = raw as R
  const chargen = (waRaw ?? []) as R[]

  // Restmenge der verknüpften Charge laden
  let waRestmenge: number | null = null
  let waCeilingQualitaet: string | null = null
  let waCeilingHerkunft: string | null = null
  if (f.weinausbau_id) {
    const { data: waAktuell } = await (supabase.from('weinausbau') as any)
      .select('menge_liter, status, qualitaetsstufe, herkunft_code').eq('id', f.weinausbau_id).single()
    const wa = waAktuell as R | null
    if (wa && wa.status !== 'abgeschlossen') {
      waRestmenge = parseFloat(wa.menge_liter ?? '0') || 0
    }
    waCeilingQualitaet = wa?.qualitaetsstufe ?? null
    waCeilingHerkunft  = wa?.herkunft_code ?? null
  }
  // Aktuell verknüpfte Charge immer einschließen (auch wenn abgeschlossen)
  const chargeInListe = !f.weinausbau_id || chargen.find((c: R) => c.id === f.weinausbau_id)
  let chargenListe = chargen
  if (!chargeInListe && f.weinausbau_id) {
    const { data: extra } = await (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, status').eq('id', f.weinausbau_id).single()
    if (extra) chargenListe = [extra as R, ...chargen]
  }

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  // Bind updateFuellung with id
  const updateWithId = updateFuellung.bind(null, id)

  return (
    <div className="max-w-2xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weinhandel" className="hover:text-s112-teal">Weinhandel</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Füllung bearbeiten</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Füllung bearbeiten</h1>
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
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Wine className="w-4 h-4 text-s112-teal" /> Weinpass</p>
            <p className="text-xs text-s112-muted">Chargennummer: <span className="font-mono text-gray-700">{f.chargennummer}</span></p>
            <a
              href={`/w/${encodeURIComponent(f.chargennummer)}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-s112-teal hover:underline break-all">
              /w/{f.chargennummer} ↗
            </a>
            <div className="flex gap-2 pt-1">
              <a
                href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(`https://software112.icp-consultants.at/w/${encodeURIComponent(f.chargennummer)}`)}`}
                download={`weinpass-${f.chargennummer}.png`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs border border-s112-border px-3 py-1 rounded-lg text-gray-600 hover:bg-s112-bg">
                QR laden
              </a>
              <a
                href={`/kellerbuch/rueckverfolgung?q=${encodeURIComponent(f.chargennummer)}`}
                className="text-xs border border-s112-border px-3 py-1 rounded-lg text-gray-600 hover:bg-s112-bg">
                Rückverfolgung
              </a>
            </div>
          </div>
        </div>
      )}

      <form action={updateWithId} className="space-y-6">

        {/* Kellerbuch-Charge */}
        <div className="card p-5 space-y-2">
          <h2 className="font-semibold text-gray-800 text-sm">Kellerbuch-Charge</h2>
          {!f.weinausbau_id && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Keine Charge verknüpft – Rückverfolgung nur bis zur Abfüllung möglich. Bitte hier nachträglich zuordnen.
            </p>
          )}
          <div>
            <label className={labelCls}>Weinausbau-Charge</label>
            <select name="weinausbau_id" defaultValue={f.weinausbau_id ?? ''} className={inputCls}>
              <option value="">– keine Verknüpfung –</option>
              {chargenListe.map((c: R) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{c.status === 'abgeschlossen' ? ' · abgeschlossen' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Schwund-Ausbuchen ── */}
        {waRestmenge !== null && waRestmenge > 0.01 && (
          <div className="card p-5 border-amber-200 bg-amber-50 space-y-3">
            <div className="flex items-start gap-2">
              <div>
                <p className="text-sm font-semibold text-amber-800">Weinausbau-Charge nicht abgeschlossen</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Die verknüpfte Charge hat noch{' '}
                  <strong>{waRestmenge.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L</strong>{' '}
                  Restbestand. Diese wurden beim Abfüllen nicht als Schwund ausgebucht.
                </p>
              </div>
            </div>
            <form action={schwundAusbuchen.bind(null, id)}>
              <button
                type="submit"
                className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700 transition-colors"
              >
                {waRestmenge.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L als Schwund ausbuchen & Charge abschließen
              </button>
            </form>
          </div>
        )}

        {/* ── Produktbezeichnung ── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 text-sm">Produktbezeichnung</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Produktname *</label>
              <input name="name" defaultValue={f.name} required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Jahrgang</label>
              <input name="jahrgang" type="number" min={1900} max={2100} defaultValue={f.jahrgang ?? ''} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Rebsorte</label>
              <input name="rebsorte" defaultValue={f.rebsorte ?? ''} placeholder="z.B. Grüner Veltliner" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Qualitätsbezeichnung *</label>
              <select name="qualitaet" defaultValue={f.qualitaet} required className={inputCls}>
                {QUALITAETEN.map(q => (
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
              <select name="herkunft_code" defaultValue={f.herkunft_code ?? ''} className={inputCls}>
                <option value="">– keine Angabe –</option>
                {HERKUNFT_ORDER.map(code => (
                  <option key={code} value={code}>{HERKUNFT_LABEL[code]}</option>
                ))}
              </select>
              {waCeilingHerkunft && (
                <p className="text-xs text-s112-muted mt-1">
                  Charge aktuell: <strong>{HERKUNFT_LABEL[waCeilingHerkunft] ?? waCeilingHerkunft}</strong> – nur Abstufung möglich, keine Aufstufung
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Anbaugebiet</label>
              <input name="anbaugebiet" defaultValue={f.anbaugebiet ?? ''} placeholder="z.B. Traisental …" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Subbezeichnung / Ried (optional)</label>
              <input name="bezeichnung" defaultValue={f.bezeichnung ?? ''} placeholder="z.B. Ried Hohenberg · Reserve" className={inputCls} />
            </div>
          </div>
        </div>

        {/* ── Abfüllung ── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 text-sm">Abfüllung</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Abfülldatum *</label>
              <input
                name="datum"
                type="date"
                defaultValue={f.datum ? f.datum.split('T')[0] : ''}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Flaschengrösse *</label>
              <select name="flaschengroesse_ml" defaultValue={f.flaschengroesse_ml} required className={inputCls}>
                {FLASCHENGROESSEN.map(fl => (
                  <option key={fl.value} value={fl.value}>{fl.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Anzahl abgefüllt (gesamt)</label>
              <input name="anzahl_flaschen" type="number" min={1} defaultValue={f.anzahl_flaschen} required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Aktueller Lagerbestand *</label>
              <input name="bestand_flaschen" type="number" min={0} defaultValue={f.bestand_flaschen} required className={inputCls} />
              <p className="text-xs text-s112-muted mt-1">Anzahl Flaschen, die aktuell auf Lager sind</p>
            </div>
            <div>
              <label className={labelCls}>Tatsächlich gefüllt (Liter)</label>
              <input name="menge_liter_gefuellt" type="number" step="0.01" defaultValue={f.menge_liter_gefuellt ?? ''} className={inputCls} />
            </div>
          </div>
        </div>

        {/* ── Preise ── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 text-sm">Preise</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>VK-Preis brutto pro Flasche (€)</label>
              <input
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
              <input
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
          <h2 className="font-semibold text-gray-800 text-sm">Export (intern)</h2>
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
          <textarea
            name="notizen"
            rows={3}
            defaultValue={f.notizen ?? ''}
            placeholder="Abfüllungsprotokoll, Besonderheiten …"
            className={inputCls + ' resize-none'}
          />
        </div>

        {/* ── Aktionen ── */}
        <div className="flex gap-3">
          <button
            type="submit"
            className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Änderungen speichern
          </button>
          <Link href="/weinhandel" className="px-6 py-2 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
            Abbrechen
          </Link>
        </div>
      </form>
    </div>
  )
}
