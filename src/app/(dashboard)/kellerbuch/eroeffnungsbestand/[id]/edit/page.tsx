import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import { updateEroeffnungsbestand } from '../../../gebinde-actions'
import { folgebuchungenDerCharge, folgebuchungenText, type Folgebuchung } from '@/lib/kellerbuch/folgebuchungen'
import { OHNE_MENGENWIRKUNG, GEBINDEWECHSEL_OHNE } from '@/lib/kellerbuch/storno'
import { fmtNum } from '@/lib/format'
import { KORREKTUR_NACH_OBEN_HINWEIS } from '@/lib/kellerbuch/hinweise'
import { QUALITAET_OPTS, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import { normalisiereQualitaet } from '@/lib/wein/qualitaetsrang'
import ZusatzErzeugnisFelder from '@/components/wein/ZusatzErzeugnisFelder'
import { Info } from 'lucide-react'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import { eroeffnungsTag, stichtagText } from '@/lib/kellerbuch/eroeffnungsStichtag'
import type { Metadata } from 'next'
import { EB_NOTIZEN_HINWEIS } from '@/lib/kellerbuch/chargeRegeln'

export const metadata: Metadata = { title: 'Eröffnungsbestand bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Eröffnungsbestand = Kellerbuch-Charge (weinausbau): zentrale Chargen-Liste QUALITAET_OPTS (KAN-73)

export default async function EroeffnungsbestandEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params
  const { err } = await searchParams
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'kellerbuch')) redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')

  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: rowRaw }, gebindeRows] = await Promise.all([
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, kmw, oechsle, mostgewicht_einheit, menge_liter, anfangsbestand_liter, qualitaetsstufe, zusatzbezeichnung, erzeugnis, behaelter_id, notizen, einstandspreis_pro_liter, referenz_altsystem, created_at')
      .eq('id', id).eq('ist_eroeffnungsbestand', true).limit(1)),
    // Ziele: eigene + freigegebene Gebinde, fremd belegte ausgenommen (Migration 203)
    ladeBehaelter(supabase, tenantId, { alsZiel: true }),
  ])

  const eintrag = (((rowRaw ?? []) as R[])[0] ?? null) as R | null
  if (!eintrag) notFound()
  const angabe = normalisiereQualitaet(eintrag)   // KAN-186: Altwerte (reserve, sekt …) → Stufe + Zusatz/Erzeugnis

  // KAN-35: Die Menge ist der Anfangsbestand (ändert anfangsbestand_liter und menge_liter
  // gemeinsam) – nur ohne Mengenbewegungen und solange der Bestand noch dem Anfangsbestand
  // entspricht; das Gebinde nur ohne Folgebuchungen. Der Server prüft dasselbe.
  const bestand = parseFloat(eintrag.menge_liter) || 0
  const anfang  = eintrag.anfangsbestand_liter != null ? (parseFloat(eintrag.anfangsbestand_liter) || 0) : bestand
  let folge: Folgebuchung[] | null = null
  try {
    folge = await folgebuchungenDerCharge(supabase, id)
  } catch {
    folge = null   // nicht prüfbar → beides sperren (sichere Richtung)
  }
  const text = (f: Folgebuchung[]) => `An der Charge ${f.length === 1 && f[0].anzahl === 1 ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(f)}.`
  const mengenFolge   = folge?.filter(f => !OHNE_MENGENWIRKUNG.includes(f.art)) ?? []
  const gebindeFolge  = folge?.filter(f => !GEBINDEWECHSEL_OHNE.includes(f.art)) ?? []
  const nichtPruefbar = 'Folgebuchungen konnten nicht geprüft werden – bitte die Seite neu laden.'
  const mengeSperre: string | null = folge === null
    ? nichtPruefbar
    : mengenFolge.length > 0
      ? text(mengenFolge)
      : Math.abs(bestand - anfang) > 0.01
        ? `Der aktuelle Bestand (${fmtNum(bestand, 2)} L) weicht bereits vom Anfangsbestand (${fmtNum(anfang, 2)} L) ab.`
        : null
  const gebindeSperre: string | null = folge === null
    ? nichtPruefbar
    : gebindeFolge.length > 0 ? text(gebindeFolge) : null

  // Das aktuell zugeordnete Gebinde bleibt wählbar, auch wenn es inzwischen gesperrt wäre
  const gebinde = gebindeRows.map(b => ({ id: b.id, name: b.anzeigeName })) as R[]
  const rdOnly = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm bg-s112-bg text-s112-text-2 cursor-not-allowed'
  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch/gebinde?tab=eroeffnungsbestand" className="hover:text-s112-blue-700">Eröffnungsbestand</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Bearbeiten</span>
      </div>

      <h1 className="text-2xl font-semibold text-s112-text">Eröffnungsbestand bearbeiten</h1>
      {/* KAN-42: Stichtag (created_at, Wiener Zeit) – nicht änderbar; bei falschem Stichtag stornieren und neu erfassen */}
      <p className="text-sm text-s112-muted -mt-4">
        Stichtag: <span className="font-medium text-s112-text-1">{(() => { const t = eroeffnungsTag(eintrag.created_at); return t ? stichtagText(t) : '–' })()}</span>
        {' '}– nicht änderbar; bei falschem Stichtag stornieren und neu erfassen.
      </p>

      {err && (
        <div role="alert" className="rounded-lg border border-s112-err/30 bg-s112-err-bg px-4 py-3 text-sm text-s112-err-fg">
          <strong>Fehler beim Speichern:</strong> {err}
        </div>
      )}

      {(mengeSperre || gebindeSperre) && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-s112-warn/30 bg-s112-warn-bg px-4 py-3 text-sm text-s112-warn-fg">
          <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {mengeSperre && <>Die Menge kann nicht mehr geändert werden: {mengeSperre} Eine Korrektur nach unten bitte über „Schwund buchen“ auf der <Link href={`/kellerbuch/weinausbau/${id}`} className="underline hover:no-underline">Chargen-Seite</Link> erfassen. {KORREKTUR_NACH_OBEN_HINWEIS} </>}
            {gebindeSperre && <>Das Gebinde kann nicht mehr direkt geändert werden: {gebindeSperre} Einen Gebindewechsel bitte als Umzug buchen.</>}
          </span>
        </div>
      )}

      <form action={updateEroeffnungsbestand.bind(null, id)} className="card p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Weinbezeichnung *</label>
            <input aria-label="Weinbezeichnung" name="name" required defaultValue={eintrag.name} className={inputCls} />
          </div>
          <div>
            <p id="eb-gebinde-label" className={labelCls}>Gebinde</p>
            {gebindeSperre ? (
              // Kein Feld behaelter_id → der Server lässt das Gebinde unverändert
              <div role="textbox" aria-readonly="true" aria-labelledby="eb-gebinde-label" className={rdOnly}>{gebinde.find((g: R) => g.id === eintrag.behaelter_id)?.name ?? '–'}</div>
            ) : (
              <select aria-labelledby="eb-gebinde-label" name="behaelter_id" defaultValue={eintrag.behaelter_id ?? ''} className={inputCls}>
                <option value="">– kein –</option>
                {gebinde.map((g: R) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className={labelCls}>Jahrgang</label>
            <input aria-label="Jahrgang" name="jahrgang" type="number" min={1900} max={2100}
              defaultValue={eintrag.jahrgang ?? ''} className={inputCls} />
          </div>
          <div>
            {/* KAN-130 Etappe 3 (02.10.2026): gespeicherter Messwert samt Einheit, nichts neu gerechnet;
                die Qualitätsstufe bleibt, wie gewählt (Rechenregel 6) */}
            <MostgewichtEingabe name="mostgewicht"
              startwert={{ kmw: eintrag.kmw, oechsle: eintrag.oechsle, einheit: eintrag.mostgewicht_einheit }} />
          </div>
          <div>
            <p id="eb-menge-label" className={labelCls}>Menge / Anfangsbestand (Liter){mengeSperre ? '' : ' *'}</p>
            {mengeSperre ? (
              // Kein Feld menge_liter → der Server lässt Anfangsbestand und Bestand unverändert
              <div role="textbox" aria-readonly="true" aria-labelledby="eb-menge-label" className={rdOnly}>{fmtNum(anfang, 2)}</div>
            ) : (
              <input aria-labelledby="eb-menge-label" name="menge_liter" type="number" step="0.01" min={0.01}
                required defaultValue={eintrag.anfangsbestand_liter ?? eintrag.menge_liter ?? ''} className={inputCls} />
            )}
          </div>
          <div>
            <label className={labelCls}>Einstandspreis pro Liter (€)</label>
            <input aria-label="Einstandspreis pro Liter (€)" name="einstandspreis_pro_liter" type="text" inputMode="decimal"
              defaultValue={eintrag.einstandspreis_pro_liter != null
                ? String(eintrag.einstandspreis_pro_liter).replace('.', ',') : ''}
              placeholder="z.B. 1,50" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Qualitätsstufe</label>
            <select aria-label="Qualitätsstufe" name="qualitaetsstufe" required defaultValue={angabe.stufe ?? ''} className={inputCls}>
              <option value="">– bitte wählen –</option>
              {mitGespeichertemWert(QUALITAET_OPTS, angabe.stufe).map(q => (
                <option key={q.value} value={q.value}>{q.label}</option>
              ))}
            </select>
          </div>
          {/* KAN-186: Zusatzbezeichnung und Erzeugnis (Altwerte im Qualitätsfeld normalisiert) */}
          <ZusatzErzeugnisFelder zusatz={angabe.zusatz} erzeugnis={angabe.erzeugnis} feldKlasse={inputCls} labelKlasse={labelCls} />
          <div>
            <label className={labelCls}>Referenz Altsystem</label>
            <input aria-label="Referenz Altsystem" name="referenz_altsystem" defaultValue={eintrag.referenz_altsystem ?? ''} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Notizen</label>
            <input aria-label="Notizen" name="notizen" defaultValue={eintrag.notizen ?? ''} className={inputCls} />
                  {/* KAN-204: Mischbestand ohne Jahrgang/Rebsorte/Weinart/Herkunft – Angaben in den Notizen festhalten */}
                  <p className="text-xs text-s112-muted mt-1">{EB_NOTIZEN_HINWEIS}</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit"
            className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
            Speichern
          </button>
          <Link href="/kellerbuch/gebinde?tab=eroeffnungsbestand"
            className="px-6 py-2 rounded-xl text-sm text-s112-text-2 hover:text-s112-text transition-colors">
            Abbrechen
          </Link>
        </div>
      </form>
    </div>
  )
}
