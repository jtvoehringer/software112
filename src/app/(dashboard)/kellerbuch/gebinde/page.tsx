import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import GebindeClient from '@/components/kellerbuch/GebindeClient'
import LoeschenButton from '@/components/kellerbuch/LoeschenButton'
import { createBehaelter, updateBehaelter } from '../actions'
import { createEroeffnungsbestand, deleteEroeffnungsbestand, createUmzug, deleteUmzug } from '../gebinde-actions'

export const metadata: Metadata = { title: 'Gebinde – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const QUALITAETEN = [
  { value: 'qualitaetswein',       label: 'Qualitätswein' },
  { value: 'kabinett',             label: 'Kabinett' },
  { value: 'spaetlese',            label: 'Spätlese' },
  { value: 'auslese',              label: 'Auslese' },
  { value: 'beerenauslese',        label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese', label: 'Trockenbeerenauslese (TBA)' },
  { value: 'eiswein',              label: 'Eiswein' },
  { value: 'strohwein',            label: 'Strohwein / Schilfwein' },
  { value: 'dac',                  label: 'DAC' },
  { value: 'reserve',              label: 'Reservé / Reserve' },
  { value: 'erste_lage',           label: 'Erste Lage (ÖTW)' },
  { value: 'grosses_gewachs',      label: 'Großes Gewächs' },
  { value: 'landwein',             label: 'Landwein' },
  { value: 'sekt',                 label: 'Sekt b.A.' },
  { value: 'perlwein',             label: 'Perlwein' },
  { value: 'sonstiges',            label: 'Sonstiges' },
]

export default async function GebindePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string }>
}) {
  const { tab = 'gebinde', err } = await searchParams
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [
    { data: gebindeRaw },
    { data: chargenRaw },
    { data: eroeffnungRaw },
    { data: umzuegeRaw },
  ] = await Promise.all([
    (supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter, standort, aktiv')
      .order('name'),
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, menge_liter, behaelter_id, aktiv')
      .eq('aktiv', true)
      .order('name'),
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, kmw, menge_liter, qualitaetsstufe, behaelter_id, behaelter:behaelter_id(name), notizen, aktiv')
      .eq('ist_eroeffnungsbestand', true)
      .eq('aktiv', true)
      .order('jahrgang', { ascending: false }),
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, schwund_liter, notizen, von_weinausbau:von_weinausbau_id(name, jahrgang), nach_behaelter:nach_behaelter_id(name)')
      .order('datum', { ascending: false })
      .limit(100),
  ])

  const gebinde      = (gebindeRaw   ?? []) as R[]
  const chargen      = (chargenRaw   ?? []) as R[]
  const eroeffnungen = (eroeffnungRaw ?? []) as R[]
  const umzuege      = (umzuegeRaw   ?? []) as R[]

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  const TABS = [
    { key: 'gebinde',            label: 'Gebinde' },
    { key: 'eroeffnungsbestand', label: 'Eröffnungsbestand' },
    { key: 'umziehen',           label: 'Umziehen' },
    { key: 'kellerplan',         label: 'Kellerplan' },
  ]

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Gebinde</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">Gebinde</h1>

      <div className="flex gap-1 border-b border-s112-border">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/kellerbuch/gebinde?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
              ${tab === t.key
                ? 'bg-white border border-b-white border-s112-border text-s112-teal -mb-px'
                : 'text-s112-muted hover:text-s112-teal'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* TAB: Gebinde */}
      {tab === 'gebinde' && (
        <div className="space-y-6">
          {writeOk && (
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold text-sm text-gray-800 select-none">
                + Neues Gebinde anlegen
              </summary>
              <form action={createBehaelter} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Bezeichnung *</label>
                  <input name="name" required placeholder="z.B. Stahltank 1" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Typ</label>
                  <select name="typ" className={inputCls}>
                    <option value="">– kein –</option>
                    <option value="stahltank">Stahltank</option>
                    <option value="holzfass">Holzfass</option>
                    <option value="betonei">Betonei</option>
                    <option value="amphore">Amphore</option>
                    <option value="sonstiges">Sonstiges</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Fassungsvermögen (Liter)</label>
                  <input name="volumen_liter" type="number" step="0.01" min={0} placeholder="z.B. 5000" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Standort</label>
                  <input name="standort" placeholder="z.B. Keller 1, Reihe A" className={inputCls} />
                </div>
                <div className="sm:col-span-2 flex gap-3">
                  <button type="submit" className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
                    Gebinde anlegen
                  </button>
                </div>
              </form>
            </details>
          )}

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Bezeichnung</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Typ</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Volumen</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Standort</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Inhalt</th>
                  {writeOk && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {gebinde.map((g: R, i: number) => {
                  const inhalt = chargen.filter((c: R) => c.behaelter_id === g.id)
                  const inhaltLiter = inhalt.reduce((s: number, c: R) => s + (parseFloat(c.menge_liter) || 0), 0)
                  return (
                    <tr key={g.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''} ${!g.aktiv ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{g.name}</td>
                      <td className="px-4 py-2.5 text-gray-600 capitalize">{g.typ ?? '–'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                        {g.volumen_liter ? `${parseFloat(g.volumen_liter).toLocaleString('de-AT')} L` : '–'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{g.standort ?? '–'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-s112-teal font-medium">
                        {inhaltLiter > 0 ? `${inhaltLiter.toLocaleString('de-AT')} L` : '–'}
                      </td>
                      {writeOk && (
                        <td className="px-4 py-2.5 text-right">
                          <GebindeClient gebinde={g} action={updateBehaelter.bind(null, g.id)} inputCls={inputCls} labelCls={labelCls} />
                        </td>
                      )}
                    </tr>
                  )
                })}
                {gebinde.length === 0 && (
                  <tr><td colSpan={writeOk ? 6 : 5} className="px-4 py-6 text-center text-xs text-s112-muted italic">Noch keine Gebinde angelegt</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Eröffnungsbestand */}
      {tab === 'eroeffnungsbestand' && (
        <div className="space-y-6">
          <p className="text-sm text-s112-muted">
            Bestände aus dem Altsystem werden auf den 1.1. des laufenden Jahres eingebucht.
          </p>

          {err && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              <strong>Fehler beim Speichern:</strong> {err}
            </div>
          )}

          {writeOk && (
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold text-sm text-gray-800 select-none">
                + Eröffnungsbestand erfassen
              </summary>
              <form action={createEroeffnungsbestand} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Weinbezeichnung *</label>
                  <input name="name" required placeholder="z.B. Grüner Veltliner Ried Hohenberg" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Gebinde</label>
                  <select name="behaelter_id" className={inputCls}>
                    <option value="">– kein –</option>
                    {gebinde.filter((g: R) => g.aktiv).map((g: R) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Jahrgang</label>
                  <input name="jahrgang" type="number" min={1900} max={2100}
                    defaultValue={new Date().getFullYear() - 1} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>KMW (°KMW)</label>
                  <input name="kmw" type="number" step="0.1" min={0} max={50}
                    placeholder="z.B. 17.5" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Menge (Liter) *</label>
                  <input name="menge_liter" type="number" step="0.01" min={0}
                    required placeholder="z.B. 3000" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Qualitätsstufe</label>
                  <select name="qualitaetsstufe" className={inputCls}>
                    <option value="">– keine –</option>
                    {QUALITAETEN.map(q => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Notizen</label>
                  <input name="notizen" placeholder="z.B. Herkunft Altsystem …" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <button type="submit" className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
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
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Wein</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">JG</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">KMW</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Menge</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Gebinde</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Qualität</th>
                  {writeOk && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {eroeffnungen.map((e: R, i: number) => (
                  <tr key={e.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{e.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{e.jahrgang ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                      {e.kmw ? `${parseFloat(e.kmw).toLocaleString('de-AT')} °KMW` : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-teal font-medium">
                      {parseFloat(e.menge_liter).toLocaleString('de-AT')} L
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{(e.behaelter as R | null)?.name ?? '–'}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{e.qualitaetsstufe ?? '–'}</td>
                    {writeOk && (
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Link href={`/kellerbuch/eroeffnungsbestand/${e.id}/edit`}
                          className="text-xs text-s112-teal hover:underline mr-3">Bearbeiten</Link>
                        <LoeschenButton
                          action={deleteEroeffnungsbestand.bind(null, e.id)}
                          bestaetigung="Eröffnungsbestand wirklich löschen?" />
                      </td>
                    )}
                  </tr>
                ))}
                {eroeffnungen.length === 0 && (
                  <tr><td colSpan={writeOk ? 7 : 6} className="px-4 py-6 text-center text-xs text-s112-muted italic">Noch keine Eröffnungsbestände erfasst</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Umziehen */}
      {tab === 'umziehen' && (
        <div className="space-y-6">
          {writeOk && (
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold text-sm text-gray-800 select-none">
                + Neuen Umzug erfassen
              </summary>
              <form action={createUmzug} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Datum *</label>
                  <input name="datum" type="date" required
                    defaultValue={new Date().toISOString().split('T')[0]} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Wein-Charge (von) *</label>
                  <select name="von_weinausbau_id" required className={inputCls}>
                    <option value="">– Charge wählen –</option>
                    {chargen.map((c: R) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{c.menge_liter ? ` · ${parseFloat(c.menge_liter).toLocaleString('de-AT')} L` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Ziel-Gebinde *</label>
                  <select name="nach_behaelter_id" required className={inputCls}>
                    <option value="">– Gebinde wählen –</option>
                    {gebinde.filter((g: R) => g.aktiv).map((g: R) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Menge (Liter) *</label>
                  <input name="menge_liter" type="number" step="0.01" min={0}
                    required placeholder="z.B. 500" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Schwund (Liter)</label>
                  <input name="schwund_liter" type="number" step="0.01" min={0}
                    defaultValue={0} className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Notizen</label>
                  <input name="notizen" placeholder="z.B. Abstich, Filtration …" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <button type="submit" className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
                    Umzug speichern
                  </button>
                </div>
              </form>
            </details>
          )}

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Datum</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Charge</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Ziel-Gebinde</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Menge</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Schwund</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Notizen</th>
                  {writeOk && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {umzuege.map((u: R, i: number) => (
                  <tr key={u.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800">
                      {(u.von_weinausbau as R | null)?.name ?? '–'}
                      {(u.von_weinausbau as R | null)?.jahrgang ? ` (${(u.von_weinausbau as R).jahrgang})` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{(u.nach_behaelter as R | null)?.name ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-teal font-medium">
                      {parseFloat(u.menge_liter).toLocaleString('de-AT')} L
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {parseFloat(u.schwund_liter || '0') > 0
                        ? `${parseFloat(u.schwund_liter).toLocaleString('de-AT')} L` : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{u.notizen ?? '–'}</td>
                    {writeOk && (
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Link href={`/kellerbuch/umzug/${u.id}/edit`}
                          className="text-xs text-s112-teal hover:underline mr-3">Bearbeiten</Link>
                        <LoeschenButton
                          action={deleteUmzug.bind(null, u.id)}
                          bestaetigung="Umzug wirklich löschen? Der Bestand wird wiederhergestellt." />
                      </td>
                    )}
                  </tr>
                ))}
                {umzuege.length === 0 && (
                  <tr><td colSpan={writeOk ? 7 : 6} className="px-4 py-6 text-center text-xs text-s112-muted italic">Noch keine Umzüge erfasst</td></tr>
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
            className="inline-block text-s112-teal font-medium hover:underline">
            Zum Kellerplan →
          </Link>
        </div>
      )}
    </div>
  )
}
