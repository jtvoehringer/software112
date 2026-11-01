import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import { ladeErnteSperren, MASSNAHME_ERNTE_GRUND } from '@/lib/behandlungen/ernteSperre'
import GesperrtHinweis from '@/components/GesperrtHinweis'
import FreezeKorrektur from '@/components/FreezeKorrektur'
import { KORREKTUR_FELDER } from '@/lib/freeze/korrektur'
import { hatModul } from '@/lib/auth/modul'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import BehandlungEditForm from './BehandlungEditForm'
import { anwendungKontext } from '@/lib/behandlungen/anwendungKontext'
import type { BmMassnahmeOption } from '../../neu/BetriebsmittelFeld'
import { ladeRiedOptionen } from '../../neu/riedOptionen'
import type { BehandlungEdit, PSMOption, DuengemittelOption, BestehenderKostenEintrag } from './BehandlungEditForm'
import type { KostenartOption } from '../../neu/page'
import { summeFlaecheHa } from '@/lib/behandlungen/massnahmeMengen'

export const metadata: Metadata = { title: 'Maßnahme bearbeiten' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function BehandlungEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()

  if (!canWrite(role, 'rieden')) redirect('/behandlungen')

  // Tenant + Bio-Status (steuert Warn-/Sperrlogik bei der Mittelwahl, siehe Neu-Formular)
  // Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen
  // Mitgliedschaft – sonst können bei Mehrfach-Mitgliedschaft Daten eines anderen
  // Betriebs angezeigt/bearbeitet werden.
  const membership = await getCurrentMembership()
  if (!membership) notFound()
  const tenantId = membership.tenantId
  let bioStatus: string = 'konventionell'
  if (tenantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantRow = geladen(await (supabase.from('tenants') as any)
      .select('bio_status').eq('id', tenantId).maybeSingle(), 'Betrieb')
    bioStatus = (tenantRow as AR | null)?.bio_status ?? 'konventionell'
  }

  const [rawBRes, rawPsmRes, rawDuengerRes, rawKostenartenRes, rawKERes] = await Promise.all([
    // storno-sichtbar: Einzelsatz – eine stornierte Maßnahme leitet die Seite zur Liste um (KAN-88)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('behandlungen') as any)
      .select(`
        id, datum, datum_bis, art, psm_id, duengemittel_id, betriebsmittel_id, aufwandmenge, aufwandmenge_einheit,
        menge_gesamt, menge_einheit, konzentration, wasseraufwand_l_ha,
        bbch_stadium, schaderreger, witterung, temperatur_c, notizen,
        bearbeitungstiefe_cm, bearbeitungsgeraet, schnittart, laubarbeit_art,
        einarbeitung, einarbeitung_zeitpunkt,
        uhrzeit_von, uhrzeit_bis, durchgefuehrt_von, anwender_name, art_verwendung, storniert_am, tankmischung_id,
        bienenschutz_bestaetigt_am, bienenschutz_bestaetigt_von_name,
        weingarten_id, menge_gesamt, behandelte_flaeche_ha,
        weingarten:weingarten_id(name),
        psm:psm_id(wartezeit_tage),
        behandlung_grundstuecke(grundstueck_id, flaeche_ha, grundstueck:grundstueck_id(flaeche_ha, weingarten_id))
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pflanzenschutzmittel') as any)
      .select('id, name, handelsname, oeko_zugelassen, cu_gehalt_pct, wirkstoff, wirkstoffgehalt_pct, wartezeit_tage, bienengefaehrlich')
      .eq('aktiv', true)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('name'),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('duengemittel') as any)
      .select('id, name, handelsname, typ, wartezeit_tage, oeko_zugelassen, einheit')
      .eq('aktiv', true)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('name'),

    // Kostenarten (für die Kosten-Sektion im Bearbeiten-Formular, Punkte 6, 9)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kostenarten') as any)
      .select('id, name, kategorie')
      .eq('aktiv', true)
      .eq('tenant_id', tenantId)
      .order('name'),

    // Bestehender Kosteneintrag dieser Maßnahme, falls vorhanden (Migration 139)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kosteneintraege') as any)
      .select('id, kostenart_id, betrag, beschreibung')
      .eq('behandlung_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  const rawB = geladen(rawBRes, 'Maßnahmen')
  const rawPsm = geladen(rawPsmRes, 'Pflanzenschutzmittel')
  const rawDuenger = geladen(rawDuengerRes, 'Düngemittel')
  const rawKostenarten = geladen(rawKostenartenRes, 'Kostenarten')
  const rawKE = geladen(rawKERes, 'Kosteneinträge')

  if (!rawB) notFound()
  // KAN-88: stornierte Maßnahmen sind unveränderlich (DB: s112_storno_schutz) – zurück zur Liste
  if ((rawB as AR).storniert_am) redirect('/behandlungen')

  const b = rawB as AR
  const behandlung: BehandlungEdit = {
    id:                   b.id,
    datum:                b.datum,
    datum_bis:            b.datum_bis ?? null,
    art:                  b.art ?? 'spritzung',
    psm_id:               b.psm_id ?? null,
    duengemittel_id:      b.duengemittel_id ?? null,
    betriebsmittel_id:    b.betriebsmittel_id ?? null,
    aufwandmenge:         b.aufwandmenge ?? null,
    aufwandmenge_einheit: b.aufwandmenge_einheit ?? null,
    menge_gesamt:         b.menge_gesamt ?? null,
    menge_einheit:        b.menge_einheit ?? null,
    konzentration:        b.konzentration ?? null,
    wasseraufwand_l_ha:   b.wasseraufwand_l_ha ?? null,
    bbch_stadium:         b.bbch_stadium ?? null,
    schaderreger:         b.schaderreger ?? null,
    witterung:            b.witterung ?? null,
    temperatur_c:         b.temperatur_c ?? null,
    notizen:              b.notizen ?? null,
    bearbeitungstiefe_cm: b.bearbeitungstiefe_cm ?? null,
    bearbeitungsgeraet:   b.bearbeitungsgeraet ?? null,
    schnittart:           b.schnittart ?? null,
    laubarbeit_art:       b.laubarbeit_art ?? null,
    einarbeitung:         b.einarbeitung ?? null,
    einarbeitung_zeitpunkt: b.einarbeitung_zeitpunkt ?? null,
    wartezeit_tage:       b.psm?.wartezeit_tage ?? null,
    weingarten_name:      b.weingarten?.name ?? null,
    uhrzeit_von:          b.uhrzeit_von ?? null,
    uhrzeit_bis:          b.uhrzeit_bis ?? null,
    durchgefuehrt_von:    b.durchgefuehrt_von ?? null,
    anwender_name:        b.anwender_name ?? null,
    art_verwendung:       b.art_verwendung ?? null,
    bienenschutz_bestaetigt_am:       b.bienenschutz_bestaetigt_am ?? null,   // KAN-325
    bienenschutz_bestaetigt_von_name: b.bienenschutz_bestaetigt_von_name ?? null,
  }

  // Behandelte Fläche = Σ Grundstücke der Maßnahme (ha, je GST und gesamt 4 Stellen) – dieselbe Funktion,
  // mit der updateBehandlung Spritzbrühe ↔ Wasseraufwand und Reinkupfer rechnet (KAN-133)
  const flaecheHa = summeFlaecheHa(((b.behandlung_grundstuecke ?? []) as AR[]).map(bg => bg.flaeche_ha ?? bg.grundstueck?.flaeche_ha))

  // Rieden änderbar (Rückmeldung 30.09.2026): bisherige Auswahl – ganze Ried, wenn alle ihre WI-GST dabei sind
  const { weingaerten, gstByWeingarten } = await ladeRiedOptionen(supabase, tenantId, String(b.datum ?? '').slice(0, 10) || undefined)
  const bisherGst = new Map<string, string>()
  for (const bg of ((b.behandlung_grundstuecke ?? []) as AR[])) {
    if (bg.grundstueck_id && bg.grundstueck?.weingarten_id) bisherGst.set(String(bg.grundstueck_id), String(bg.grundstueck.weingarten_id))
  }
  const startWGs: string[] = []
  for (const [wgId, gsts] of Object.entries(gstByWeingarten)) {
    if (gsts.length > 0 && gsts.every(g => bisherGst.has(g.id))) {
      startWGs.push(wgId)
      for (const g of gsts) bisherGst.delete(g.id)
    }
  }
  const startGSTs: [string, string][] = [...bisherGst.entries()]

  const psm: PSMOption[] = ((rawPsm ?? []) as AR[]).map(p => ({
    id:              p.id,
    name:            p.name,
    handelsname:     p.handelsname ?? null,
    oeko_zugelassen: p.oeko_zugelassen ?? false,
    cu_gehalt_pct:   p.cu_gehalt_pct ?? null,
    wirkstoff:       p.wirkstoff ?? null,
    wirkstoffgehalt_pct: p.wirkstoffgehalt_pct ?? null,
    wartezeit_tage:  p.wartezeit_tage ?? null,
    bienengefaehrlich: p.bienengefaehrlich ?? null,
  }))

  const duengemittel: DuengemittelOption[] = ((rawDuenger ?? []) as AR[]).map(d => ({
    id:              d.id,
    name:            d.name,
    handelsname:     d.handelsname ?? null,
    typ:             d.typ ?? null,
    wartezeit_tage:  d.wartezeit_tage ?? null,
    oeko_zugelassen: d.oeko_zugelassen ?? false,
    einheit:         d.einheit ?? null,
  }))

  // KAN-167: Betriebsmittel (aktiv, eigener Betrieb) für Sonstiges und Laubarbeit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBm = geladen(await (supabase.from('betriebsmittel') as any)
    .select('id, name, gruppe, einheit, preis_pro_einheit')
    .eq('tenant_id', tenantId)
    // die gespeicherte Auswahl auch dann, wenn das Mittel inzwischen deaktiviert ist (Speichern verlangt ein aktives)
    .or(`aktiv.eq.true${b.betriebsmittel_id ? `,id.eq.${b.betriebsmittel_id}` : ''}`).order('name'), 'Betriebsmittel')
  const betriebsmittel: BmMassnahmeOption[] = ((rawBm ?? []) as AR[]).map(m => ({
    id: m.id, name: m.name, gruppe: m.gruppe, einheit: m.einheit,
    preis_pro_einheit: m.preis_pro_einheit == null ? null : Number(m.preis_pro_einheit),
  }))

  const kostenarten: KostenartOption[] = ((rawKostenarten ?? []) as AR[]).map(k => ({
    id: k.id, name: k.name, kategorie: k.kategorie ?? null,
  }))

  const ke = rawKE as AR | null
  const bestehenderKostenEintrag: BestehenderKostenEintrag | null = ke
    ? { kostenart_id: ke.kostenart_id ?? null, betrag: ke.betrag, beschreibung: ke.beschreibung ?? null }
    : null

  // KAN-169: Ried nach der Maßnahme gelesen → gesperrt (Trigger a_freeze_ernte); Korrektur nur durch die Betriebsleitung
  const b0 = rawB as AR
  const ernteRieden = [...new Set([...(b0.weingarten_id ? [b0.weingarten_id as string] : []),
    ...((b0.behandlung_grundstuecke ?? []) as AR[]).map(bg => bg.grundstueck?.weingarten_id as string | undefined).filter((x): x is string => !!x)])]
  const ernteGesperrt = (await ladeErnteSperren(supabase, tenantId, [{ id, datum: b0.datum, rieden: ernteRieden }])).get(id) ?? null
  if (ernteGesperrt) {
    const betriebsleitung = canAdmin(membership.role)
    return (
      <div className="max-w-2xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/behandlungen" className="hover:text-s112-blue-700 transition-colors">Maßnahmen</Link>
          <span>/</span>
          <span className="text-s112-text-1 font-medium">Gesperrt</span>
        </div>
        <h1 className="text-2xl font-semibold text-s112-text">Maßnahme vom {new Date(b0.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}</h1>
        <GesperrtHinweis grund={MASSNAHME_ERNTE_GRUND} seit={new Date(ernteGesperrt).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })} betriebsleitung={betriebsleitung} />
        {betriebsleitung && (
          <FreezeKorrektur tabelle="behandlungen" id={id} felder={KORREKTUR_FELDER.behandlungen} werte={b0}
            hinweis="Nur für die Betriebsleitung – z. B. Tippfehler in Datum oder Aufwandmenge. Ried, Mittel und Grundstücke bleiben (Storno der Lese gibt die Maßnahme frei). Alt/Neu, Benutzer und Grund stehen im Änderungsprotokoll." />
        )}
      </div>
    )
  }

  // KAN-398: Tankmischung – die übrigen Mittel desselben Tanks (gemeinsame Felder gelten beim Speichern für alle)
  let mischung: string[] = []
  if (b0.tankmischung_id) {
    // storno-sichtbar: nur zur Anzeige; stornierte Mittel der Mischung bleiben außen vor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const andere = geladen(await (supabase.from('behandlungen') as any)
      .select('id, psm:psm_id(name)')
      .eq('tenant_id', tenantId).eq('tankmischung_id', b0.tankmischung_id).neq('id', id).is('storniert_am', null)
      .order('id')
      .limit(50), 'Tankmischung')   // alle-ausnahme: Mittel einer einzigen Tankmischung (höchstens sechs)
    mischung = ((andere ?? []) as AR[]).map(a => (a.psm?.name as string | undefined) ?? 'Mittel')
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/behandlungen" className="hover:text-s112-blue-700 transition-colors">Maßnahmen</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Bearbeiten</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Maßnahme bearbeiten</h1>
        <p className="text-sm text-s112-muted mt-0.5">Daten korrigieren oder ergänzen</p>
      </div>
      {mischung.length > 0 && (
        <p role="note" className="mb-4 rounded-xl border border-s112-border bg-s112-bg px-4 py-3 text-sm text-s112-text-1">
          Teil einer Tankmischung mit {mischung.join(', ')}. Datum, Uhrzeit, Witterung, Temperatur, BBCH-Stadium und Anwender
          gelten beim Speichern für alle Mittel des Tanks; Mittel, Aufwandmenge, Spritzbrühe und Rieden nur für dieses Mittel.
        </p>
      )}
      <BehandlungEditForm
        behandlung={behandlung} psm={psm} duengemittel={duengemittel} bioStatus={bioStatus}
        kostenarten={kostenarten} bestehenderKostenEintrag={bestehenderKostenEintrag}
        flaecheHa={flaecheHa} betriebsmittel={betriebsmittel} kostenModul={await hatModul('modul_controlling')}
        weingaerten={weingaerten} gstByWeingarten={gstByWeingarten} startWGs={startWGs} startGSTs={startGSTs}
        {...await anwendungKontext(supabase, tenantId)}
      />
    </div>
  )
}
