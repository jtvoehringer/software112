import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { fmtLiter } from '@/lib/format'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { mitZurueck } from '@/lib/navigation/zurueck'
import { notFound } from 'next/navigation'
import WeinausbauForm from '@/components/kellerbuch/WeinausbauForm'
import { updateWeinausbau, schwundBuchen } from '../../actions'
import { kmwZuQualitaet, minQualitaet } from '@/lib/weinqualitaet'
import { folgebuchungenDerCharge, folgebuchungenText } from '@/lib/kellerbuch/folgebuchungen'
import { GEBINDEWECHSEL_OHNE } from '@/lib/kellerbuch/storno'
import VerschneidungWidget from './VerschneidungWidget'
import { ladeBewegungsgraph } from '@/lib/wein/blendKomposition'
import { bestandNachEreignis, sortenAnteile, zusammensetzung } from '@/lib/wein/mischungsrechnung'
import { PN_OFFENE_ANTRAGS_STATUS, pnStatusLabel } from '@/lib/dac/workflow'
import { gebindeText, quellGebindeDesVerschnitts, quellGebindeSchluessel, type Quellgebinde } from '@/lib/kellerbuch/quellGebinde'
import HerkunftJournalKarte from './HerkunftJournalKarte'
import { chargePnSperre } from '@/lib/kellerbuch/chargeRegeln'
import SchwundBuchenForm from './SchwundBuchenForm'
import MostgewichtAnzeige from '@/components/wein/MostgewichtAnzeige'
import UmziehenWidget from '@/components/kellerbuch/UmziehenWidget'
import { umziehen } from '../../umziehen/actions'
import FreezeKorrektur from '@/components/FreezeKorrektur'
import { KORREKTUR_FELDER } from '@/lib/freeze/korrektur'
import { Wine, ArrowLeftRight, GitMerge, BookOpen, Microscope, Award, TrendingDown, ArrowDownWideNarrow, Factory, PlusCircle, Sparkles } from 'lucide-react'
import { rund } from '@/lib/zahl/runden'
import { bestandsAbweichungDerCharge, ladeBewegungenCharge } from '@/lib/behoerden/bewegungsbuch'
import { PRODUKTION_ART_LABEL, type ProduktionArt } from '@/lib/kellerbuch/produktion'
import StornoButton from '@/components/StornoButton'
import { produktionStornieren } from '../../produktion/actions'
import { schreibSperre } from '@/lib/auth/sperren'

export const metadata: Metadata = { title: 'Charge bearbeiten' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:        { label: 'Ernte',         color: 'bg-s112-warn-bg text-s112-warn-fg' },
  gaerung:      { label: 'Gärung',        color: 'bg-s112-warn-bg text-s112-warn-fg' },
  ausbau:       { label: 'Ausbau',        color: 'bg-s112-blue-100 text-s112-blue-700' },
  abfuellung:   { label: 'Abfüllung',     color: 'bg-[#F2F3F5] text-s112-text-1' },
  abgeschlossen:{ label: 'Abgeschlossen', color: 'bg-s112-ok-bg text-s112-ok-fg' },
}

export default async function WeinausbauDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ form?: string; quelle?: string; menge?: string; abstufung?: string }> }) {
  const { id } = await params
  const { form: openForm, quelle: initialQuelleId, menge: initialQuelleMenge, abstufung: abstufungParam } = await searchParams
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'kellerbuch')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden (inkl. Zugriff auf
  // fremde Chargen per ID-Ratespiel auf dieser [id]-Detailseite).
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    rowsRes,
    wgRawRes,
    bhRows,
    pressungenRawRes,
    wawRawRes,
    alleChargenRawRes,
    verschnEinRawRes,
  ] = await Promise.all([
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, anfangsbestand_liter, ist_eroeffnungsbestand, status, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, weinart, notizen, aktiv, einstandspreis_pro_liter, kmw, oechsle, mostgewicht_einheit, behaelter:behaelter_id(name)')
      .eq('id', id).limit(1)),
    tf((supabase.from('weingarten') as any).select('id, name').eq('aktiv', true).order('name')),
    // Gebinde als Umzugsziele: eigene + freigegebene, fremd belegte ausgenommen (Migration 203).
    // Das eigene aktuelle Gebinde der Charge wird unten wieder ergänzt (Volumen-Lookup).
    ladeBehaelter(supabase, tenantId, { nurAktiv: true }),
    // KAN-342: Umzüge, Füllungen, Tankverkäufe, Zukäufe und ausgehende Verschnitte lädt das zentrale Bewegungsbuch
    // (ladeBewegungenCharge, unten) – hier nur noch, was die Seite darüber hinaus braucht
    // Pressungen (höchste Qualitätsstufe aus dem Mostgewicht, Gebindewechsel)
    // storno-sichtbar: die Chargen-Seite zeigt die Herkunft auch einer stornierten Pressungs-Charge (KAN-148 C1c)
    (supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, notizen, storniert_am, pressung:pressung_id(datum, notizen, kmw_grad, storniert_am)')
      .eq('weinausbau_id', id)
      .order('id', { ascending: true }),
    // Verknüpfte Rieden / Weingärten
    tf((supabase.from('weinausbau_weingaerten') as any)
      .select('weingarten_id')
      .eq('weinausbau_id', id)),

    // Alle anderen aktiven Chargen (für Verschneidungs- und Umziehen-Formular)
    alle(tf((supabase.from('weinausbau') as any)
      .select('id, name, menge_liter, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, behaelter_id, rebsorte, weinart')
      .eq('aktiv', true)
      .neq('id', id)
      .order('name').order('id'))),

    // Verschneidungen: diese Charge als Ziel – KAN-77: mit Quell-Charge (Quellgebinde) und Qualität für das Badge
    tf((supabase.from('verschneidungen') as any)
      .select('id, datum, notizen, ziel_weinausbau_id, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter, anteil_pct, quell_behaelter_id, gebinde_rekonstruiert, quelle:quell_weinausbau_id(id, name, rebsorte, qualitaetsstufe, zusatzbezeichnung, erzeugnis))')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('ziel_weinausbau_id', id)
      .order('datum', { ascending: false })),
  ])
  // Sweep 87 (KAN-279): ein Lesefehler wirft (Fehlergrenze) statt „Charge nicht gefunden“ bzw. fehlender Bewegungen
  const rows = geladen(rowsRes, 'Charge')
  const wgRaw = geladen(wgRawRes, 'Rieden')
  const pressungenRaw = geladen(pressungenRawRes, 'Pressungen')
  const wawRaw = geladen(wawRawRes, 'Rieden der Charge')
  const alleChargenRaw = geladen(alleChargenRawRes, 'Chargen')
  const verschnEinRaw = geladen(verschnEinRawRes, 'Verschnitte')

  type WeinausbauRow = {
    id: string; name: string; jahrgang: number | null; rebsorte: string | null; weinart: string | null
    weingarten_id: string | null; behaelter_id: string | null; menge_liter: number | null
    anfangsbestand_liter: number | null; ist_eroeffnungsbestand: boolean | null; status: string; qualitaetsstufe: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null; herkunft_code: string | null
    notizen: string | null; aktiv: boolean; einstandspreis_pro_liter: number | null
    kmw: number | string | null; oechsle: number | string | null; mostgewicht_einheit: string | null
    behaelter: { name: string } | null
  }
  type NameRow = { id: string; name: string }

  const weinausbau = (((rows ?? []) as R[])[0] ?? null) as WeinausbauRow | null
  if (!weinausbau) notFound()

  const weingaerten = (wgRaw ?? []) as NameRow[]
  const behaelter   = bhRows.filter(b => !b.gesperrt).map(b => ({ id: b.id, name: b.anzeigeName, volumen_liter: b.volumen_liter })) as (NameRow & { volumen_liter: number | null })[]
  const selectedWeingaertenIds = ((wawRaw ?? []) as R[]).map(r => r.weingarten_id as string)

  const alleChargen = (alleChargenRaw ?? []) as { id: string; name: string; menge_liter: number | null; qualitaetsstufe: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null; herkunft_code?: string | null; behaelter_id: string | null; rebsorte?: string | null; weinart?: string | null }[]
  const verschneidungenEin = (verschnEinRaw ?? []) as R[]
  // KAN-77: Quellgebinde je Verschnitt-Quelle am Tag des Verschnitts (nicht das heutige Gebinde der Quelle)
  const quellGebinde: Map<string, Quellgebinde> = tenantId && verschneidungenEin.length > 0
    ? await quellGebindeDesVerschnitts(supabase, tenantId, verschneidungenEin.map(v => ({
      id: v.id, datum: v.datum ?? null, ziel_weinausbau_id: v.ziel_weinausbau_id ?? id,
      // KAN-112: Momentaufnahme des Gebindes am Verschnitt (Vorrang vor der Regel)
      quellen: ((v.quellen ?? []) as R[]).map(q => ({ quell_weinausbau_id: q.quell_weinausbau_id ?? (q.quelle as R | null)?.id ?? null, quell_behaelter_id: q.quell_behaelter_id ?? null, gebinde_rekonstruiert: q.gebinde_rekonstruiert ?? null })),
    })))
    : new Map()
  const quellGebindeVon = (v: R, q: R): Quellgebinde | null => {
    const qid = q.quell_weinausbau_id ?? (q.quelle as R | null)?.id
    return qid ? quellGebinde.get(quellGebindeSchluessel(v.id, qid)) ?? null : null
  }
  // KAN-112: nachträglich ermitteltes Gebinde mit Hinweis „(Gebinde rekonstruiert)“
  const gebindeDerQuelle = (v: R, q: R): string | null => { const g = quellGebindeVon(v, q); return gebindeText(g?.name, g?.rekonstruiert) }

  const aktuell          = parseFloat(String(weinausbau.menge_liter ?? 0)) || 0
  // KAN-232: Charge beim Versekter (offene Lohnversektung) – Hinweis und Rückkehr
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lvRaw = geladen(await (supabase.from('lohnversektungen') as any)
    .select('id, datum, firma:firmen!firma_id(name)').eq('tenant_id', tenantId).eq('weinausbau_id', weinausbau.id)
    .is('storniert_am', null).is('abgeschlossen_am', null).maybeSingle(), 'Lohnversektung')
  const lvOffen = lvRaw as R | null
  // KAN-342: Bewegungen der Charge aus dem zentralen Bewegungsbuch (alle Arten, auch Verarbeitung, Volumenzugang einer
  // Kellerbehandlung, Produktion und Lohnversektung) – vorher rechnete die Seite selbst und kannte diese nicht, die
  // Abweichung „Bestand und Bewegungsbuch stimmen nicht überein“ war dann falsch. Ein Eröffnungsbestand kommt als eigene
  // Zeile „Anfangsbestand“ (nur bei ist_eroeffnungsbestand, wie bisher – Bugreport 5.8.2026, „Partywein Kängaru“).
  const bewegungenMitSaldo = tenantId ? await ladeBewegungenCharge(supabase, tenantId, weinausbau.id) : []

  // Maximale Qualitätsstufe aus verlinkten Pressungen (KMW-Ableitung)
  const maxQualitaetsstufe: string | null = (() => {
    const kmwWerte = ((pressungenRaw ?? []) as R[])
      .map(p => {
        const kmw = parseFloat((p.pressung as R | null)?.kmw_grad)
        return isNaN(kmw) ? null : kmwZuQualitaet(kmw)
      })
      .filter((q): q is string => q !== null)
    if (kmwWerte.length === 0) return null
    return minQualitaet(kmwWerte)
  })()

  // Saldo laut Bewegungsbuch (Kontrollwert). Maßgeblicher Bestand ist seit KAN-35 der
  // gebuchte Bestand der Charge (weinausbau.menge_liter) – ihn prüfen und ändern alle
  // Buchungen (Umzug, Verschnitt, Füllung, Verkauf, Schwund, Verarbeitung …).
  const berechneterSaldoRoh = bewegungenMitSaldo.length > 0
    ? bewegungenMitSaldo[bewegungenMitSaldo.length - 1].saldo
    : aktuell

  // Ein negativer Saldo bedeutet, dass laut Bewegungsbuch mehr aus der Charge
  // entnommen wurde, als je vorhanden war (z.B. ein Tank-Verkauf, der trotz
  // bereits leerem Bestand durchging, siehe Bugreport 6.8.2026). Der Saldo wird
  // in der Tabelle bei 0 gekappt angezeigt und die Unstimmigkeit sichtbar gemacht.
  const bestandsUnstimmigkeit = berechneterSaldoRoh < -0.01
  const berechneterSaldo = Math.max(0, berechneterSaldoRoh)

  // KAN-35 (24.09.2026): Der frühere Auto-Sync (menge_liter = Saldo bei Abweichung > 1 L)
  // ist entfernt – ein Seitenaufruf änderte damit Mengen ohne datierte Zeile. Stattdessen nur ein Hinweis.
  // KAN-342: dieselbe Rechnung wie das Bewegungsbuch (bestandsAbweichungDerCharge), Toleranz 1 L
  const bestandsAbweichung = !bestandsUnstimmigkeit && bestandsAbweichungDerCharge(bewegungenMitSaldo, aktuell) !== null

  // Gebindewechsel im Formular nur ohne Folgebuchungen (Server prüft dasselbe)
  const vonPressung = ((pressungenRaw ?? []) as R[]).length > 0
  let gebindeSperre: string | null = null
  // KAN-150 F1d: mit Folgebuchungen braucht eine Änderung der Rieden einen Grund (Server prüft dasselbe)
  let herkunftGrundNoetig: string | null = null
  if (writeOk) {
    try {
      const alle = await folgebuchungenDerCharge(supabase, id)
      if (alle.length > 0) {
        const einzeln = alle.length === 1 && alle[0].anzahl === 1
        herkunftGrundNoetig = `${einzeln ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(alle)}`
      }
    } catch {
      herkunftGrundNoetig = 'hängen möglicherweise Folgebuchungen (Prüfung fehlgeschlagen)'
    }
  }
  if (writeOk && !vonPressung) {
    try {
      const f = await folgebuchungenDerCharge(supabase, id, { ohne: GEBINDEWECHSEL_OHNE })
      if (f.length > 0) {
        const einzeln = f.length === 1 && f[0].anzahl === 1
        gebindeSperre = `An der Charge ${einzeln ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(f)} – einen Gebindewechsel bitte als Umzug buchen.`
      }
    } catch {
      gebindeSperre = 'Folgebuchungen konnten nicht geprüft werden – einen Gebindewechsel bitte als Umzug buchen.'
    }
  }

  const st = STATUS_LABELS[weinausbau.status] ?? { label: weinausbau.status, color: 'bg-[#F2F3F5] text-s112-text-2' }

  // KAN-98: Prüfnummernanträge der Charge (Badge, offener Antrag statt eines zweiten)
  const pnRaw = geladen(await tf((supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, status, pruefnummer, status_seit')
    .eq('weinausbau_id', weinausbau.id).is('storniert_am', null)
    .order('created_at', { ascending: false })), 'Prüfnummernanträge')
  const pnAntraege = (pnRaw ?? []) as R[]
  const pnOffen = pnAntraege.find(a => (PN_OFFENE_ANTRAGS_STATUS as readonly string[]).includes(a.status)) ?? null
  // KAN-99: Gültigkeit je Charge (auch per Umzug weitergegeben) – „PN … gültig“ bzw. „für Tankbestand erloschen am …“
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pncRaw = geladen(await tf((supabase.from('pruefnummer_chargen') as any)
    .select('id, dac_antrag_id, gueltig_ab, gueltig_bis, ende_grund, quelle_vorgang, antrag:dac_antrag_id(pruefnummer, status, storniert_am)')
    .eq('weinausbau_id', weinausbau.id)
    .order('gueltig_ab', { ascending: false })), 'Prüfnummern der Charge')
  const pnGueltigkeit = ((pncRaw ?? []) as R[]).filter(g => (g.antrag as R | null)?.pruefnummer && !(g.antrag as R | null)?.storniert_am)
  const pnGilt = pnGueltigkeit.find(g => !g.gueltig_bis && (g.antrag as R).status === 'genehmigt') ?? null
  const pnErloschen = pnGilt ? null : (pnGueltigkeit.find(g => g.gueltig_bis) ?? null)
  // KAN-204: Sperrstufe für das Bearbeiten (dieselbe Regel wie updateWeinausbau und der Trigger a_freeze)
  const pnSperre = chargePnSperre(pnAntraege as { status: string | null }[], (pncRaw ?? []) as { gueltig_bis: string | null }[])
  const pnZugeteilt = pnGilt
    ? { id: pnGilt.dac_antrag_id, pruefnummer: (pnGilt.antrag as R).pruefnummer, geerbt: !!pnGilt.quelle_vorgang }
    : null

  // KAN-76: „Besteht aus“ aus dem zeitrichtigen Rechenkern (Rebsorten je Liter im heutigen Bestand) statt
  // „Bestand − Summe der Verschnitte“ – nur wenn die Charge Verschnitte hat, wie bisher
  const graph = tenantId && verschneidungenEin.length > 0 ? await ladeBewegungsgraph(supabase, tenantId, [weinausbau.id]) : null
  const bestehtAus = graph
    ? sortenAnteile(zusammensetzung(graph.ereignisse, weinausbau.id, { gebuchterBestand: aktuell, name: weinausbau.name }).anteile)
    : null
  // KAN-77: Anteil jeder Quelle am ERGEBNIS des Verschnitts (Quell-Liter / Bestand der Charge unmittelbar danach,
  // Rechenkern KAN-76) statt am Verschnitt allein („48 L (100 %)“); dazu das Quellgebinde für die Anzeige
  const verschneidungenAnzeige = verschneidungenEin.map(v => {
    const ergebnis = graph ? bestandNachEreignis(graph.ereignisse, weinausbau.id, `vs:${v.id}`) : null
    return {
      ...v,
      quellen: ((v.quellen ?? []) as R[]).map(q => {
        const l = parseFloat(q.menge_liter) || 0
        return { ...q, gebinde: gebindeDerQuelle(v, q), anteil_ergebnis_pct: ergebnis && ergebnis > 0.005 ? rund(l / ergebnis * 100, 1) : null }
      }),
    }
  })

  // KAN-118 / UAT 23.10.2026 (Testfall 4.20): Ist die Charge durch eine Produktion entstanden, steht der Storno hier –
  // vorher nur in der Liste /kellerbuch/produktion, die über keinen Menüpunkt erreichbar war
  const produktionRows = tenantId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? geladen(await (supabase.from('produktionen') as any)
      .select('id, datum, art')
      .eq('tenant_id', tenantId).eq('ziel_weinausbau_id', weinausbau.id).is('storniert_am', null)
      .order('id').limit(1), 'Produktion der Charge')
    : []
  const entstandenDurch = ((produktionRows ?? []) as R[])[0] ?? null
  const produktionStornoErlaubt = !!entstandenDurch && writeOk && !!membership && !(await schreibSperre(membership))

  return (
    <div className="max-w-4xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <Link href="/kellerbuch/weinausbau" className="hover:text-s112-blue-700 transition-colors">Weinausbau</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{weinausbau.name}</span>
      </div>

      {entstandenDurch && (
        <div className="card px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3" data-print="hide">
          <p className="text-s112-text-2">
            Entstanden durch Produktion „{PRODUKTION_ART_LABEL[entstandenDurch.art as ProduktionArt] ?? entstandenDurch.art}“ vom{' '}
            {new Date(`${entstandenDurch.datum}T00:00:00Z`).toLocaleDateString('de-AT', { timeZone: 'UTC' })}.{' '}
            <Link href="/kellerbuch/produktion" className="text-s112-blue-700 hover:underline">Alle Produktionen</Link>
          </p>
          {produktionStornoErlaubt && (
            <StornoButton action={produktionStornieren.bind(null, String(entstandenDurch.id))}
              hinweis="Die Quell-Chargen bekommen ihre Menge zurück, diese Charge wird abgeschlossen. Nur möglich, solange sie unverändert ist." />
          )}
        </div>
      )}

      {bestandsUnstimmigkeit && (
        <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-4 py-3 rounded-lg text-sm">
          <p className="font-semibold">Unstimmigkeit im Bewegungsbuch</p>
          <p className="mt-0.5">
            Laut Bewegungsbuch wurde mehr aus dieser Charge entnommen, als je vorhanden war
            (berechneter Saldo: {fmtLiter(berechneterSaldoRoh)}, gebuchter Bestand: {fmtLiter(aktuell)}).
            Der Saldo wird unten bei 0 L gekappt angezeigt – bitte die Bewegungen (insbesondere
            Tank-Verkäufe und Zugänge) prüfen. Fehlt ein Zugang, bucht ihn die Betriebsleitung über
            „Zugang korrigieren“ (Menge, Datum und Grund). Bitte hier KEINEN Schwund buchen – das mindert Bestand
            und Saldo gleichermaßen und behebt die Abweichung nicht.
          </p>
        </div>
      )}

      {bestandsAbweichung && (
        <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg px-4 py-3 rounded-lg text-sm">
          <p className="font-semibold">Bestand und Bewegungsbuch stimmen nicht überein</p>
          {/* KAN-342: neutral – keine pauschale Aufforderung mehr, Schwund nachzubuchen */}
          <p className="mt-0.5">
            Gebuchter Bestand der Charge: {fmtLiter(aktuell)} · Saldo laut Bewegungsbuch: {fmtLiter(berechneterSaldoRoh)}.{' '}
            Bitte die Buchungen der Charge prüfen. Der Bestand wird nicht automatisch angeglichen.
          </p>
          <a href="#bewegungsbuch" className="mt-1.5 inline-block text-xs font-medium underline hover:no-underline">
            Zum Bewegungsbuch der Charge ↓
          </a>
          {weinausbau.behaelter_id && (
            <Link href={`/kellerbuch/behaelter/${weinausbau.behaelter_id}/bewegungen`}
              className="mt-1.5 ml-4 inline-block text-xs font-medium underline hover:no-underline">
              Bewegungsbuch des Gebindes →
            </Link>
          )}
        </div>
      )}

      {/* Header */}
      {/* KAN-335: Titel nimmt den Platz, die Knöpfe rechts brechen um (vorher shrink-0 ohne Breitengrenze: alle Knöpfe in
          einer Zeile, der Titel brach Wort für Wort um, waagrechte Scrollleiste) */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div className="min-w-0 sm:flex-1">
          <h1 className="text-2xl font-semibold text-s112-text break-words">{weinausbau.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
            {weinausbau.jahrgang && <span className="text-xs text-s112-muted">Jahrgang {weinausbau.jahrgang}</span>}
            {weinausbau.behaelter && <span className="text-xs text-s112-muted">in {weinausbau.behaelter.name}</span>}
            {/* KAN-232: außer Haus beim Versekter */}
            {lvOffen && (
              <Link href="/kellerbuch/lohnversektung" className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg hover:underline">
                in Lohnversektung{lvOffen.firma?.name ? ` bei ${lvOffen.firma.name}` : ''} seit {new Date(`${lvOffen.datum}T00:00:00`).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
              </Link>
            )}
            {/* KAN-131: Mostgewicht der Charge (Pressung, Zukauf, Eröffnungsbestand bzw. Umzug) */}
            {(weinausbau.kmw != null || weinausbau.oechsle != null) && (
              <span className="text-xs text-s112-muted">Mostgewicht <MostgewichtAnzeige wert={{ kmw: weinausbau.kmw, oechsle: weinausbau.oechsle, einheit: weinausbau.mostgewicht_einheit }} /></span>
            )}
            {pnZugeteilt && (
              <Link href={`/dac/${pnZugeteilt.id}`} className="text-xs font-mono bg-s112-ok-bg text-s112-ok-fg px-2 py-0.5 rounded-full hover:underline"
                title={pnZugeteilt.geerbt ? 'Per Umzug aus der Antrags-Charge übernommen' : undefined}>
                PN {pnZugeteilt.pruefnummer} gültig{pnZugeteilt.geerbt ? ' (übernommen)' : ''}
              </Link>
            )}
            {pnErloschen && (
              <Link href={`/dac/${pnErloschen.dac_antrag_id}`} className="text-xs bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full hover:underline">
                PN {(pnErloschen.antrag as R).pruefnummer} – für Tankbestand erloschen am {new Date(pnErloschen.gueltig_bis).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
              </Link>
            )}
            {pnOffen && (
              <Link href={`/dac/${pnOffen.id}`} className="text-xs bg-s112-blue-100 text-s112-blue-700 px-2 py-0.5 rounded-full hover:underline">
                Prüfnummernantrag: {pnStatusLabel(pnOffen.status)}
              </Link>
            )}
          </div>
        </div>
        <div className="sm:text-right sm:max-w-[50%] lg:max-w-[55%]">
          <p className="text-2xl font-semibold text-s112-blue-700 tabular-nums">{fmtLiter(aktuell)}</p>
          <p className="text-xs text-s112-muted mt-0.5">verfügbarer Bestand</p>
          {/* KAN-181: am Handy als umbrechende Knopfzeile; ab sm wie bisher (Block, mt der Knöpfe gilt) */}
          <div className="flex flex-wrap gap-2 mt-2 sm:block sm:mt-0 max-sm:*:mt-0">
          {writeOk && aktuell > 0.01 && (
            <Link href={mitZurueck(`/weinhandel/fuellungen/neu?charge=${weinausbau.id}`, `/kellerbuch/weinausbau/${weinausbau.id}`)}   // KAN-334: nach dem Abfüllen zurück zur Charge
              className="mt-2 inline-flex items-center gap-1 text-xs bg-s112-teal text-s112-yellow px-3 py-1 rounded-lg hover:bg-s112-teal/90 transition-colors">
              <Wine size={13} strokeWidth={1.75} />Abfüllen
            </Link>
          )}
          {writeOk && aktuell > 0.01 && (
            <Link href={`/kellerbuch/weinausbau/${weinausbau.id}?form=umziehen`}
              className="mt-1 inline-flex items-center gap-1 text-xs bg-s112-teal text-s112-yellow px-3 py-1 rounded-lg hover:bg-s112-teal/90 transition-colors">
              <ArrowLeftRight size={13} strokeWidth={1.75} />Umziehen
            </Link>
          )}
          {writeOk && (
            <Link href={`/kellerbuch/weinausbau/${weinausbau.id}?form=verschneiden`}
              className="mt-1 inline-flex items-center gap-1 text-xs bg-s112-grey text-white px-3 py-1 rounded-lg hover:bg-s112-grey/90 transition-colors">
              <GitMerge size={13} strokeWidth={1.75} />Verschneiden
            </Link>
          )}
          {writeOk && aktuell > 0.01 && (
            <Link href={`/kellerbuch/weinausbau/${weinausbau.id}/abstufen`}
              className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
              <ArrowDownWideNarrow size={13} strokeWidth={1.75} />Abstufen
            </Link>
          )}
          {/* KAN-41 Paket 3a: Abgang durch Verarbeitung (Traubensaft, Essig, Brennerei …) */}
          {writeOk && aktuell > 0.01 && (
            <Link href={`/kellerbuch/weinausbau/${weinausbau.id}/verarbeiten`}
              className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
              <Factory size={13} strokeWidth={1.75} />Verarbeiten
            </Link>
          )}
          {/* KAN-118: Produktion (Spritzer, Perlwein, Schaumwein, PetNat) mit dieser Charge als Quelle */}
          {writeOk && aktuell > 0.01 && (
            <Link href={`/kellerbuch/produktion/neu?quelle=${weinausbau.id}`}
              className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
              <Sparkles size={13} strokeWidth={1.75} />Produktion
            </Link>
          )}
          {/* KAN-232: Lohnversektung – ganze Charge zum Versekter (nur mit Gebinde, d. h. nicht schon außer Haus) */}
          {writeOk && aktuell > 0.01 && weinausbau.behaelter_id && (
            <Link href={`/kellerbuch/lohnversektung/neu?charge=${weinausbau.id}`}
              className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
              <Sparkles size={13} strokeWidth={1.75} />Lohnversektung
            </Link>
          )}
          {/* KAN-53: Zugangskorrektur (Mehrmenge, Inventur-Plus) – nur Betriebsleitung */}
          {writeOk && role && canAdmin(role) && (
            <Link href={`/kellerbuch/weinausbau/${weinausbau.id}/zugang`}
              className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
              <PlusCircle size={13} strokeWidth={1.75} />Zugang korrigieren
            </Link>
          )}
          <Link href={`/kellerbuch/weinausbau/${weinausbau.id}/buch`}
            className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
            <BookOpen size={13} strokeWidth={1.75} />Weinbuch
          </Link>
          <Link href={`/kellerbuch/weinausbau/${weinausbau.id}/analysen`}
            className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
            <Microscope size={13} strokeWidth={1.75} />Analysen
          </Link>
          {writeOk && (
            <Link href={pnOffen ? `/dac/${pnOffen.id}` : `/dac/neu?charge=${weinausbau.id}`}
              className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
              <Award size={13} strokeWidth={1.75} />{pnOffen ? 'Prüfnummernantrag' : 'Prüfnummer'}
            </Link>
          )}
          </div>
        </div>
      </div>

      {/* Abstufungs-Hinweis nach Umziehen */}
      {abstufungParam && (
        <div className="flex items-start gap-3 bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-sm text-s112-warn-fg">
          <TrendingDown size={18} strokeWidth={1.75} className="mt-0.5 text-s112-warn-fg shrink-0" />
          <div>
            <p className="font-semibold">Qualitätsabstufung durch Zusammenführung</p>
            <p className="text-xs mt-0.5">
              Beim Umziehen wurde die Qualitätsstufe automatisch abgestuft:
              {' '}<strong>{decodeURIComponent(abstufungParam).replace('→', ' → ')}</strong>.
              Der Hinweis wurde in den Notizen der Charge gespeichert.
            </p>
          </div>
        </div>
      )}

      {/* KAN-192 B: Herkunft laut Bewegungsjournal (nur bei eröffnetem Journal) */}
      {tenantId && <HerkunftJournalKarte supabase={supabase} tenantId={tenantId} chargeId={weinausbau.id} />}

      {/* Bewegungsbuch – KAN-342: Zeilen aus dem zentralen Bewegungsbuch (ladeBewegungenCharge), Anfangsbestand als eigene Zeile */}
      <section id="bewegungsbuch" className="scroll-mt-20">
        <h2 className="font-semibold text-s112-text mb-3">Bewegungsbuch</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Vorgang</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {bewegungenMitSaldo.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-xs text-s112-muted italic">
                    Noch keine Bewegungen erfasst
                  </td>
                </tr>
              )}

              {bewegungenMitSaldo.map((bew, i) => {
                const istAbgang    = bew.menge < 0
                const istZugang    = bew.menge > 0
                const colorClass   = istAbgang ? 'text-s112-err-fg' : istZugang ? 'text-s112-ok-fg' : 'text-s112-text-2'
                const rowBg        = istZugang ? 'bg-s112-ok-bg/50' : (i % 2 === 1 ? 'bg-s112-bg/30' : '')
                return (
                  <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${rowBg}`}>
                    <td className="px-4 py-2.5 text-xs text-s112-text-2 whitespace-nowrap">
                      {bew.datum ? new Date(bew.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' }) : '–'}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-s112-text-1">{bew.beschreibung}</p>
                      {bew.extra && <p className="text-xs text-s112-muted">{bew.extra}</p>}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${colorClass}`}>
                      {istAbgang ? '' : '+'}{fmtLiter(bew.menge)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-1">
                      {fmtLiter(bew.saldo)}
                    </td>
                  </tr>
                )
              })}

              {/* Saldo-Zeile */}
              <tr className="border-t-2 border-s112-teal/30 bg-s112-teal/5">
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-s112-text-1 text-sm">
                  Saldo laut Bewegungsbuch
                </td>
                <td className="px-4 py-2.5 text-right" />
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-s112-blue-700 text-base">
                  {fmtLiter(berechneterSaldo)}
                </td>
              </tr>
              {(bestandsAbweichung || bestandsUnstimmigkeit) && (
                <tr className="bg-s112-warn-bg/60">
                  <td colSpan={2} className="px-4 py-2 text-sm text-s112-warn-fg">
                    Gebuchter Bestand der Charge (weicht ab)
                  </td>
                  <td className="px-4 py-2 text-right" />
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-s112-warn-fg">
                    {fmtLiter(aktuell)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Schwund buchen (datierte Zeile + Bestand mindern) – Korrekturweg nach unten */}
      {writeOk && aktuell > 0.01 && (
        <SchwundBuchenForm bestandLiter={aktuell} action={schwundBuchen.bind(null, id)} />
      )}

      {/* Umziehen (wird über Header-Button mit ?form=umziehen geöffnet) */}
      {writeOk && aktuell > 0.01 && (
        <UmziehenWidget
          chargeId={weinausbau.id}
          chargeName={weinausbau.name}
          verfuegbarLiter={aktuell}
          gebinde={behaelter}
          alleChargen={alleChargen}
          action={umziehen}
          initialOpen={openForm === 'umziehen'}
          quelleRebsorte={weinausbau.rebsorte ?? null}
          quelleWeinart={weinausbau.weinart ?? null}
          quelleBehaelterId={weinausbau.behaelter_id ?? null}
        />
      )}

      {/* Verschneidung (wird über Header-Button mit ?form=verschneiden geöffnet) */}
      {writeOk && (
        <VerschneidungWidget
          bestehtAus={bestehtAus}
          zielCharge={{ id: weinausbau.id, name: weinausbau.name, menge_liter: aktuell, qualitaetsstufe: weinausbau.qualitaetsstufe ?? null, zusatzbezeichnung: weinausbau.zusatzbezeichnung ?? null, erzeugnis: weinausbau.erzeugnis ?? null, herkunft_code: weinausbau.herkunft_code ?? null, rebsorte: weinausbau.rebsorte ?? null, weinart: weinausbau.weinart ?? null, behaelter_id: weinausbau.behaelter_id ?? null, behaelter_volumen_liter: bhRows.find(b => b.id === weinausbau.behaelter_id)?.volumen_liter ?? null }}
          alleChargen={alleChargen}
          verschneidungen={verschneidungenAnzeige}
          initialOpen={openForm === 'verschneiden'}
          initialQuelleId={initialQuelleId}
          initialQuelleMenge={initialQuelleMenge}
        />
      )}

      {/* Edit-Formular – Rückmeldung Jörgen 07.10.2026: eingeklappt, damit „Speichern“ nach einer Buchung (Umziehen,
          Abfüllen …) nicht wie ein offener nächster Schritt wirkt; über ?form=bearbeiten geöffnet */}
      {writeOk && (
        <details id="bearbeiten" open={openForm === 'bearbeiten'} className="group">
          <summary className="cursor-pointer list-none font-semibold text-s112-text mb-3 flex items-center gap-2">
            <span className="text-s112-muted group-open:rotate-90 transition-transform">▸</span>
            Charge bearbeiten <span className="text-xs font-normal text-s112-muted">(Stammdaten – Buchungen laufen über die Knöpfe oben)</span>
          </summary>
          <WeinausbauForm
            weinausbau={weinausbau}
            weingaerten={weingaerten}
            behaelter={behaelter}
            selectedWeingaertenIds={selectedWeingaertenIds}
            maxQualitaetsstufe={maxQualitaetsstufe}
            vonPressung={vonPressung}
            gebindeSperre={gebindeSperre}
            herkunftGrundNoetig={herkunftGrundNoetig}
            pnSperre={pnSperre}
            action={updateWeinausbau.bind(null, id)}
          />
          {/* KAN-222: bei eingereichtem Antrag gesperrte Merkmale mit Grund korrigieren – nur Betriebsleitung */}
          {pnSperre === 'eingereicht' && role && canAdmin(role) && (
            <div className="mt-4">
              <FreezeKorrektur tabelle="weinausbau" id={id} felder={KORREKTUR_FELDER.weinausbau} werte={weinausbau as Record<string, unknown>}
                hinweis="Nur für die Betriebsleitung – z. B. Tippfehler in Jahrgang oder Rebsorte. Qualität, Zusatz und Herkunft nur über „Abstufen“. Alt/Neu, Benutzer und Grund stehen im Änderungsprotokoll." />
            </div>
          )}
        </details>
      )}
    </div>
  )
}
