'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelter, gebindeFehlerText } from '@/lib/keller/behaelter'
import { revalidatePath } from 'next/cache'
import { mischeQualitaet, normalisiereQualitaet, qualitaetsSpalten, gleicheQualitaet, type QualitaetsAngabe } from '@/lib/wein/qualitaetsrang'
import { minHerkunft, maxHerkunft, istNiedrigerAls as herkunftIstNiedrigerAls, HERKUNFT_LABEL } from '@/lib/herkunft'
import { qualitaetText } from '@/lib/weinqualitaet'
import { umzugQualitaetsSpalten } from '@/lib/kellerbuch/qualitaetMomentaufnahme'
import { deleteUmzug as _deleteUmzug } from '../gebinde-actions'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { fmtNum, zahlAus } from '@/lib/format'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { weinartKonflikt, weinartKonfliktText, weinartAusFarbe, weinartBekannt } from '@/lib/keller/weinart'
import { ladeUmzugZeilen, planeUmzugStorno, umzugSperrMeldung, nurNotizenAenderbar } from '@/lib/kellerbuch/storno'
import { pruefePruefnummernSchaden } from '@/lib/kellerbuch/pruefnummerLaden'
import { waehleZielCharge } from '@/lib/kellerbuch/umzugZiel'
import { mostgewichtNeu, mostgewichtZusammenfuehren, teilweiseVermerk, umzugMomentaufnahme, type Anteil } from '@/lib/kellerbuch/mostgewichtKette'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface QuelleInput { weinausbau_id: string; menge: number }
interface ZielInput   { behaelter_id: string;  menge: number }

// JSON-Zahlen direkt übernehmen (zahlAus würde „1.234“ als Tausenderpunkt lesen),
// Texteingaben über zahlAus (deutsches Format)
const zahl = (v: unknown): number => typeof v === 'number' ? v : (zahlAus(v) ?? NaN)

/** Quellen/Ziele aus dem Formular lesen und prüfen (KAN-35: serverseitig, vor der ersten Buchung) */
function leseZeilen(fd: FormData): { quellen: QuelleInput[]; ziele: ZielInput[] } {
  let qRoh: unknown
  let zRoh: unknown
  try {
    qRoh = JSON.parse(fd.get('quellen_json') as string || '[]')
    zRoh = JSON.parse(fd.get('ziele_json')   as string || '[]')
  } catch {
    throw new AktionsFehler('Ungültige Eingabe: Quellen und Ziele konnten nicht gelesen werden.')
  }
  if (!Array.isArray(qRoh) || !Array.isArray(zRoh)) throw new AktionsFehler('Ungültige Eingabe: Quellen und Ziele fehlen.')
  const quellen = (qRoh as R[]).map(q => ({ weinausbau_id: typeof q?.weinausbau_id === 'string' ? q.weinausbau_id : '', menge: zahl(q?.menge) }))
  const ziele   = (zRoh as R[]).map(z => ({ behaelter_id: typeof z?.behaelter_id === 'string' ? z.behaelter_id : '', menge: zahl(z?.menge) }))
  for (const q of quellen) {
    if (!q.weinausbau_id) throw new AktionsFehler('Bitte für jede Quelle eine Charge wählen.')
    if (!Number.isFinite(q.menge) || q.menge < 0.01) throw new AktionsFehler('Die Menge jeder Quelle muss mindestens 0,01 L betragen.')
  }
  for (const z of ziele) {
    if (!z.behaelter_id) throw new AktionsFehler('Bitte für jedes Ziel ein Gebinde wählen.')
    if (!Number.isFinite(z.menge) || z.menge < 0.01) throw new AktionsFehler('Die Menge jedes Ziels muss mindestens 0,01 L betragen.')
  }
  return { quellen, ziele }
}

/** KAN-94 (01.10.2026): Charge ändern und die Zeilenzahl prüfen – bisher wurde nur auf Fehler
 *  geprüft; lieferte das UPDATE 0 Zeilen (RLS, Charge inzwischen gelöscht), entstand eine
 *  Umzugszeile ohne Bestandsänderung. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function aendereCharge(supabase: any, tenantId: string, charge: R, werte: R): Promise<void> {
  const { data, error } = await (supabase.from('weinausbau') as any)
    .update(werte)
    .eq('id', charge.id)
    .eq('tenant_id', tenantId)
    .select('id')
  if (error) throw new AktionsFehler(`Speichern fehlgeschlagen (weinausbau): ${dbFehlerText(error)}`)
  if (((data ?? []) as R[]).length !== 1) {
    throw new AktionsFehler(`Die Charge „${charge.name ?? '?'}“ konnte nicht geändert werden (keine Berechtigung oder inzwischen geändert). Der Umzug wurde an dieser Stelle abgebrochen – bitte die Seite neu laden und die Bestände im Umzug-Protokoll prüfen.`)
  }
}

/** KAN-130 Etappe 2: Mostgewicht einer neuen Ziel-Charge aus den Quellen; „teilweise“ als Vermerk an der Zielzeile */
function mostgewichtFuerNeu(anteile: Anteil[], vermerke: string[]): R {
  const m = mostgewichtNeu(anteile)
  const v = teilweiseVermerk(m)
  if (m.spalten && v) vermerke.push(v)
  return m.spalten ?? {}
}

// KAN-83: bestaetigung = Rückfrage „Prüfnummer gilt nicht mehr“ – nichts gebucht; mit pn_bestaetigt=1 erneut senden
export async function umziehen(fd: FormData): Promise<{ verschneidungNeeded?: { existingChargeId: string; newChargeId: string; menge: number }; abstufung?: { von: string; nach: string; vonLabel: string; nachLabel: string }; bestaetigung?: string } | void> {
  const supabase = await createSupabaseServerClient()

  const { quellen, ziele } = leseZeilen(fd)
  const notizen   = (fd.get('notizen')   as string) || null
  const datum     = (fd.get('datum')     as string) || new Date().toISOString().split('T')[0]
  // Nur Umzug oder Filtration – 'schwund' ist den Schwundbuchungen (schwund_buchen) vorbehalten
  const umzugTyp  = fd.get('umzug_typ') === 'filtration' ? 'filtration' : 'normal'

  if (quellen.length === 0 || ziele.length === 0) throw new AktionsFehler('Mindestens eine Quelle und ein Ziel erforderlich')

  const totalVon  = quellen.reduce((s, q) => s + q.menge, 0)
  const totalNach = ziele.reduce((s, z) => s + z.menge, 0)
  // Kein stilles Kappen (KAN-35): mehr Ziel- als Quellmenge würde Wein erzeugen
  if (totalNach > totalVon + 0.01) {
    throw new AktionsFehler(`Die Ziel-Mengen (${fmtNum(totalNach, 2)} L) übersteigen die Quell-Mengen (${fmtNum(totalVon, 2)} L) – ein Umzug kann keinen Wein erzeugen.`)
  }
  const schwund   = totalVon - totalNach > 0 ? +(totalVon - totalNach).toFixed(3) : 0

  // Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen/ersten
  // tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft Daten des falschen
  // Betriebs gelesen/verändert werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  // KAN-94: Modulrecht wie beim Bearbeiten – vorher konnte ein Leser bzw. Mitarbeiter ohne Kellerbuch umziehen
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')

  // Ziele vorab prüfen (Kellergemeinschaft, Migration 203): eigenes oder freigegebenes,
  // aktives Gebinde, nicht durch einen anderen Betrieb belegt - bevor Quellen reduziert werden.
  const zielGebinde = await ladeBehaelter(supabase, tenantId, { nurAktiv: true })
  for (const z of ziele) {
    const g = zielGebinde.find(b => b.id === z.behaelter_id)
    if (!g) throw new AktionsFehler('Ziel-Gebinde nicht gefunden oder nicht freigegeben.')
    if (g.gesperrt) throw new AktionsFehler(`Gebinde „${g.name}“ ist durch ${g.fremd_betrieb ?? 'einen anderen Betrieb'} belegt – Umziehen dorthin ist nicht möglich.`)
  }

  // Weinart-Sperre (21.9.2026), VOR der ersten Buchung: Rot- und Weißwein dürfen weder
  // untereinander (Zusammenführung mehrerer Quellen) noch mit dem Inhalt eines Ziel-
  // Gebindes vermischt werden. Bisher griff diese Regel erst im Verschneiden-Schritt –
  // da war der Umzug schon gebucht (Musterhof: Zweigelt Reserve im Veltliner-Tank).
  // Chargen ohne Weinart werden über die Rebsortenfarbe (rebsorten.farbe) eingeordnet.
  {
    const { data: qRows } = await (supabase.from('weinausbau') as any)
      .select('id, name, weinart, rebsorte').in('id', quellen.map(q => q.weinausbau_id)).eq('tenant_id', tenantId)
    const { data: zRows } = await (supabase.from('weinausbau') as any)
      .select('id, name, weinart, rebsorte, behaelter_id').in('behaelter_id', ziele.map(z => z.behaelter_id))
      .eq('aktiv', true).neq('status', 'abgeschlossen').eq('tenant_id', tenantId)
    const sorten = [...new Set([...(qRows ?? []), ...(zRows ?? [])].map((r: R) => r.rebsorte).filter(Boolean))] as string[]
    const farbe = new Map<string, string>()
    if (sorten.length) {
      // tenant-isolation-ignore: rebsorten ist eine globale Stammtabelle ohne tenant_id
      const { data: rs } = await (supabase.from('rebsorten') as any).select('name_de, farbe').in('name_de', sorten)
      for (const r of (rs ?? []) as R[]) farbe.set(r.name_de, r.farbe)
    }
    const artVon = (r: R): string => weinartBekannt(r.weinart) ? r.weinart : weinartAusFarbe(farbe.get(r.rebsorte))
    const qs = (qRows ?? []) as R[]
    for (let i = 1; i < qs.length; i++) {
      if (weinartKonflikt(artVon(qs[0]), artVon(qs[i]))) throw new AktionsFehler(`Rot- und Weißwein dürfen laut Weingesetz nicht vermischt werden: „${qs[0].name}“ und „${qs[i].name}“ können nicht zusammengeführt werden.`)
    }
    for (const z of ziele) {
      const g = zielGebinde.find(b => b.id === z.behaelter_id)
      for (const v of ((zRows ?? []) as R[]).filter(r => r.behaelter_id === z.behaelter_id)) {
        for (const q of qs) {
          if (weinartKonflikt(artVon(q), artVon(v))) throw new AktionsFehler(weinartKonfliktText(q.name, artVon(q), g?.name ?? 'das Ziel-Gebinde', v.name, artVon(v)))
        }
      }
    }
  }

  // Bestand der Quellen VOR der ersten Buchung prüfen, Menge je Charge summiert (KAN-35) –
  // bisher wurde erst in der Schleife geprüft, wenn frühere Quellen schon reduziert waren.
  const bedarf = new Map<string, number>()
  for (const q of quellen) bedarf.set(q.weinausbau_id, (bedarf.get(q.weinausbau_id) ?? 0) + q.menge)
  let quellRows: R[] = []
  {
    const { data: bRows, error: bErr } = await (supabase.from('weinausbau') as any)
      .select('id, name, menge_liter, rebsorte').in('id', [...bedarf.keys()]).eq('tenant_id', tenantId)
    if (bErr) throw new AktionsFehler(dbFehlerText(bErr, 'Quell-Chargen konnten nicht geladen werden'))
    quellRows = (bRows ?? []) as R[]
    for (const [id, menge] of bedarf) {
      const w = quellRows.find(r => r.id === id)
      if (!w) throw new AktionsFehler('Charge nicht gefunden')
      const verfuegbar = parseFloat(w.menge_liter) || 0
      if (menge > verfuegbar + 0.01) {
        throw new AktionsFehler(`„${w.name}": Menge (${fmtNum(menge)} L) überschreitet verfügbaren Bestand (${fmtNum(verfuegbar)} L)`)
      }
    }
  }

  // KAN-83 (01.10.2026): Zusammenführung mit einer Charge, die eine geltende Prüfnummer hat –
  // VOR der ersten Buchung. Die Ziel-Charge wird mit derselben Regel bestimmt wie unten in
  // Phase 2 (waehleZielCharge); Quell-Chargen selbst zählen dabei nicht als Ziel. Umzug in ein
  // leeres Gebinde oder in eine neue Charge (Rebsortenmix → Verschneiden-Formular, das selbst
  // nachfragt) bleibt ohne Rückfrage.
  const pnNotizJeCharge = new Map<string, string>()
  {
    const quellRebsorten = quellen.map(q => quellRows.find(r => r.id === q.weinausbau_id) as R)
    const quellIds = new Set(quellen.map(q => q.weinausbau_id))
    const zielMenge = new Map<string, { name: string | null; liter: number }>()
    for (const z of ziele) {
      const { data: vRaw, error: vErr } = await (supabase.from('weinausbau') as any)
        .select('id, name, rebsorte, menge_liter')
        .eq('behaelter_id', z.behaelter_id)
        .eq('aktiv', true)
        .neq('status', 'abgeschlossen')
        .eq('tenant_id', tenantId)
      if (vErr) throw new AktionsFehler(dbFehlerText(vErr, 'Ziel-Chargen konnten nicht geladen werden'))
      const { vorhanden, istRebsortenmix } = waehleZielCharge(((vRaw ?? []) as R[]).filter(v => !quellIds.has(v.id)), quellRebsorten)
      if (!vorhanden || istRebsortenmix) continue
      const bisher = zielMenge.get(vorhanden.id)
      zielMenge.set(vorhanden.id, { name: vorhanden.name ?? null, liter: (bisher?.liter ?? 0) + z.menge })
    }
    const fragen: string[] = []
    for (const [chargeId, { name, liter }] of zielMenge) {
      const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'umzug', [{ chargeId, name, zugangLiter: liter }], datum)
      if (!pn) continue
      fragen.push(pn.frage)
      pnNotizJeCharge.set(chargeId, pn.notiz)
    }
    if (fragen.length > 0 && fd.get('pn_bestaetigt') !== '1') return { bestaetigung: fragen.join('\n') }
  }

  const batchId = crypto.randomUUID()
  let verschneidungNeeded: { existingChargeId: string; newChargeId: string; menge: number } | undefined
  let abstufung: { von: string; nach: string; vonLabel: string; nachLabel: string } | undefined

  // ── Phase 1: Quellen validieren, reduzieren, Quelle-Records anlegen ──────────
  // KAN-186: Qualitätsangabe samt Zusatzbezeichnung und Erzeugnis (Altwerte normalisiert)
  let minQual: QualitaetsAngabe | null = null
  const quellenDaten: R[] = []

  for (let i = 0; i < quellen.length; i++) {
    const q = quellen[i]

    const { data: vonRaw } = await (supabase.from('weinausbau') as any)
      .select('*').eq('id', q.weinausbau_id).eq('tenant_id', tenantId).maybeSingle()
    const von = vonRaw as R
    if (!von) throw new AktionsFehler('Charge nicht gefunden')

    const verfuegbar = parseFloat(von.menge_liter) || 0
    if (q.menge > verfuegbar + 0.01) {
      throw new AktionsFehler(
        `„${von.name}": Menge (${fmtNum(q.menge)} L) überschreitet verfügbaren Bestand (${fmtNum(verfuegbar)} L)`
      )
    }

    quellenDaten.push(von)
    const vonQual = normalisiereQualitaet(von)
    minQual = mischeQualitaet([minQual, vonQual])

    // Bestand reduzieren / Charge abschließen (Rest ≤ 0,01 L wird mit ausgebucht –
    // die Menge ist oben gegen den Bestand geprüft, hier wird nichts gekappt).
    // KAN-94: Zeilenzahl prüfen – sonst entstünde eine Umzugszeile ohne Bestandsänderung.
    const restmenge = +(verfuegbar - q.menge).toFixed(3)
    await aendereCharge(supabase, tenantId, von,
      restmenge <= 0.01 ? { menge_liter: 0, aktiv: false, status: 'abgeschlossen' } : { menge_liter: restmenge })

    // Quelle-Record (zeilen_typ = 'quelle') – ein Eintrag pro Quell-Charge
    const { error: qErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:         tenantId,
      datum,
      von_behaelter_id:  von.behaelter_id,
      von_weinausbau_id: q.weinausbau_id,
      brutto_liter:      q.menge,
      menge_liter:       q.menge,   // für quelle-Records: menge = brutto
      schwund_liter:     i === 0 ? schwund : 0,
      umzug_typ:         umzugTyp,
      ...umzugQualitaetsSpalten(vonQual, minQual),
      // KAN-94: Herkunft der Quell-Charge (bleibt unverändert) – Audit
      herkunft_code_vorher:  von.herkunft_code ?? null,
      herkunft_code_nachher: von.herkunft_code ?? null,
      verschnitt:        false,
      notizen:           i === 0 ? notizen : null,
      umzug_batch_id:    batchId,
      zeilen_typ:        'quelle',
    })
    if (qErr) throw new AktionsFehler((qErr as R).message)
  }

  // ── Phase 2: Ziele befüllen, Ziel-Records anlegen ────────────────────────────
  // KAN-130 Etappe 2: Mostgewicht – jedes Ziel bekommt die Quellen im Verhältnis ihrer Mengen
  const anteileFuer = (liter: number): Anteil[] => quellen.map((q, i) => ({
    liter: totalVon > 0 ? liter * q.menge / totalVon : 0,
    charge: quellenDaten[i],
  }))
  for (const z of ziele) {
    // WICHTIG: bewusst OHNE .maybeSingle() – sobald im Ziel-Gebinde bereits MEHR ALS EINE
    // aktive Charge liegt (z.B. weil eine frühere Verschneidung nach einem Rebsortenmix noch
    // nicht nachgezogen wurde), wirft .maybeSingle() bei >1 Treffern einen Fehler, der hier
    // nur über `data` (nicht `error`) ausgelesen wurde – dadurch wurde `vorhanden` STILL
    // schweigend null, der Rebsortenmix-Zweig nie erreicht und einfach eine weitere lose
    // Charge angelegt, ohne je eine Verschneidung anzustoßen (Bugreport 5.8.2026: Immervoll
    // 001 sammelte so nacheinander drei getrennte Chargen an, ohne dass der
    // Verschneiden-Dialog auch nur EIN Mal ausgelöst wurde, obwohl die vorherigen Client-Fixes
    // für den Redirect selbst bereits korrekt waren).
    const { data: vorhandenRaw } = await (supabase.from('weinausbau') as any)
      .select('*')
      .eq('behaelter_id', z.behaelter_id)
      .eq('aktiv', true)
      .neq('status', 'abgeschlossen')
      .eq('tenant_id', tenantId)
    const vorhandenListe = (vorhandenRaw ?? []) as R[]

    let nachWeinausbauId: string | null = null
    // KAN-145: Qualität der Ziel-Charge vor/nach der Zusammenführung (Momentaufnahme für den Storno; KAN-186: samt Zusatz/Erzeugnis)
    let zielVorher: QualitaetsAngabe | null = null
    let zielNachher: QualitaetsAngabe | null = null
    // KAN-94: dasselbe für den Herkunft-Code (keller_umzuege.herkunft_code_vorher/_nachher)
    let herkunftVorher: string | null = null
    let herkunftNachher: string | null = null
    // KAN-130 Etappe 2: Momentaufnahme des Mostgewichts (nur Zusammenführung in eine bestehende Charge)
    let mostgewichtSnapshot: Record<string, unknown> = {}
    const zielVermerke: string[] = []

    // Rebsortenmix-Check und Wahl der Anker-Charge: siehe waehleZielCharge
    const { vorhanden, istRebsortenmix } = waehleZielCharge(vorhandenListe, quellenDaten)

    if (vorhanden && !istRebsortenmix) {
      // Gleiche Rebsorte: direkt zusammenführen
      const altQualitaet = normalisiereQualitaet(vorhanden)
      const neueQualitaet = mischeQualitaet([altQualitaet, minQual])
      const chargeVermerke: string[] = []

      // Qualitätsabstufung erkennen und als Notiz persistieren (Text wie bisher – der Storno liest ihn)
      // KAN-186: Text samt Zusatzbezeichnung („Abstufung von Qualitätswein Reserve auf Qualitätswein“)
      if (neueQualitaet && altQualitaet.stufe && !gleicheQualitaet(neueQualitaet, altQualitaet)) {
        const vonLabel  = qualitaetText(altQualitaet)
        const nachLabel = qualitaetText(neueQualitaet)
        chargeVermerke.push(`Abstufung von ${vonLabel} auf ${nachLabel} (Zusammenführung per Umziehen)`)
        zielVermerke.push(`Abstufung von ${vonLabel} auf ${nachLabel}`)
        abstufung = { von: vonLabel, nach: nachLabel, vonLabel, nachLabel }
      }

      // KAN-94 (Übergang bis KAN-112): Herkunft wie beim Verschnitt auf den gemeinsamen Oberbegriff
      // (minHerkunft) – vorher behielt die Ziel-Charge ihre Herkunft, das wirkte als Aufwertung
      // (Riedenwein + Gebietswein blieb Riedenwein). Abstufung als Notiz, Codes als Audit.
      const altHerkunft = (vorhanden.herkunft_code as string | null) ?? null
      const beteiligt = [altHerkunft, ...quellenDaten.map(q => q.herkunft_code as string | null)]
      const neueHerkunft = minHerkunft(beteiligt) ?? altHerkunft
      const engsteHerkunft = maxHerkunft(beteiligt)
      if (neueHerkunft && engsteHerkunft && herkunftIstNiedrigerAls(neueHerkunft, engsteHerkunft)) {
        const text = `Abstufung Herkunft-Code (BKI) von ${HERKUNFT_LABEL[engsteHerkunft] ?? engsteHerkunft} auf ${HERKUNFT_LABEL[neueHerkunft] ?? neueHerkunft}`
        chargeVermerke.push(`${text} (Zusammenführung per Umziehen)`)
        zielVermerke.push(text)
      }

      // KAN-130 Etappe 2: Mostgewicht = gewichteter Mittelwert aus Ziel-Charge und Zugang, alter Wert in die Momentaufnahme
      const mg = mostgewichtZusammenfuehren(vorhanden, parseFloat(vorhanden.menge_liter) || 0, anteileFuer(z.menge))
      mostgewichtSnapshot = umzugMomentaufnahme(mg)
      const mgVermerk = teilweiseVermerk(mg)
      if (mg.werte && mgVermerk) zielVermerke.push(mgVermerk)

      // Menge, Qualität, Herkunft, Mostgewicht und Vermerke in EINEM Update (KAN-94: mit Zeilenzahl-Prüfung)
      const bestehend = ((vorhanden.notizen as string | null) ?? '').trim()
      const werte: R = {
        menge_liter:     +((parseFloat(vorhanden.menge_liter) || 0) + z.menge).toFixed(3),
        ...qualitaetsSpalten(neueQualitaet ?? altQualitaet),
        herkunft_code:   neueHerkunft,
        ...(mg.werte ?? {}),
      }
      if (chargeVermerke.length > 0) werte.notizen = bestehend ? `${bestehend}\n${chargeVermerke.join('\n')}` : chargeVermerke.join('\n')
      await aendereCharge(supabase, tenantId, vorhanden, werte)

      nachWeinausbauId = vorhanden.id
      zielVorher = altQualitaet
      zielNachher = neueQualitaet ?? altQualitaet
      herkunftVorher = altHerkunft
      herkunftNachher = neueHerkunft
      // KAN-83: Prüfnummer der Ziel-Charge erlischt (nach Bestätigung, siehe oben)
      const pnNotiz = pnNotizJeCharge.get(vorhanden.id)
      if (pnNotiz) zielVermerke.push(pnNotiz)
    } else if (vorhanden && istRebsortenmix) {
      // Rebsortenmix: separate neue Charge anlegen, Verschneidung wird danach getriggert
      const von0 = quellenDaten[0]
      const { data: newChargeData, error: neuErr } = await (supabase.from('weinausbau') as any).insert({
        tenant_id:            tenantId,
        name:                 von0?.name ?? 'Umzug',
        jahrgang:             von0?.jahrgang ?? null,
        rebsorte:             von0?.rebsorte ?? null,
        weinart:              von0?.weinart ?? 'unbekannt',
        herkunft_code:        von0?.herkunft_code ?? null,
        weingarten_id:        von0?.weingarten_id ?? null,
        behaelter_id:         z.behaelter_id,
        menge_liter:          z.menge,
        // anfangsbestand_liter bleibt null: der Zugang wird bereits über den unten
        // eingefügten keller_umzuege-"ziel"-Datensatz als Bewegung ("Zugang aus X")
        // erfasst - ein zusätzlicher Anfangsbestand würde denselben Zugang doppelt
        // zählen (siehe Bugreport 5.8.2026, Charge "Partywein Kängaru": Anfangsbestand
        // +3350L UND Zugang aus A01 +3350L nebeneinander, Saldo dadurch um 3350L zu hoch).
        anfangsbestand_liter: null,
        ...qualitaetsSpalten(minQual),
        status:               von0?.status ?? 'ausbau',
        notizen:              `Umzug aus „${von0?.name ?? ''}"`,
        aktiv:                true,
        ...mostgewichtFuerNeu(anteileFuer(z.menge), zielVermerke),
      }).select('id')
      if (neuErr) throw new AktionsFehler(gebindeFehlerText((neuErr as R).message))
      nachWeinausbauId = ((newChargeData as R[])?.[0] as R | undefined)?.id ?? null
      herkunftNachher = (von0?.herkunft_code as string | null) ?? null
      if (nachWeinausbauId) {
        verschneidungNeeded = { existingChargeId: vorhanden.id, newChargeId: nachWeinausbauId, menge: z.menge }
      }
    } else {
      const von0 = quellenDaten[0]
      const neueHerkunft = minHerkunft(quellenDaten.map(q => q.herkunft_code as string | null))
      const { data: newChargeData, error: neuErr } = await (supabase.from('weinausbau') as any).insert({
        tenant_id:            tenantId,
        name:                 quellenDaten.length > 1 ? 'Zusammenführung' : (von0?.name ?? 'Umzug'),
        jahrgang:             von0?.jahrgang ?? null,
        rebsorte:             von0?.rebsorte ?? null,
        weinart:              von0?.weinart ?? 'unbekannt',
        herkunft_code:        neueHerkunft,
        weingarten_id:        von0?.weingarten_id ?? null,
        behaelter_id:         z.behaelter_id,
        menge_liter:          z.menge,
        // anfangsbestand_liter bleibt null - siehe Kommentar im Rebsortenmix-Zweig oben,
        // derselbe Doppelzählungs-Bug betrifft auch diesen Zweig (neue Charge, kein
        // bestehendes Ziel).
        anfangsbestand_liter: null,
        ...qualitaetsSpalten(minQual),
        status:               von0?.status ?? 'ausbau',
        notizen:              quellen.length > 1
          ? `Zusammengeführt aus ${quellen.length} Chargen`
          : `Umzug aus „${von0?.name ?? ''}"`,
        aktiv:                true,
        ...mostgewichtFuerNeu(anteileFuer(z.menge), zielVermerke),
      }).select('id')
      if (neuErr) throw new AktionsFehler(gebindeFehlerText((neuErr as R).message))
      nachWeinausbauId = ((newChargeData as R[])?.[0] as R | undefined)?.id ?? null
      herkunftNachher = neueHerkunft
    }

    // Ziel-Record (zeilen_typ = 'ziel') – ein Eintrag pro Ziel-Gebinde
    const { error: zErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:          tenantId,
      datum,
      nach_behaelter_id:  z.behaelter_id,
      nach_weinausbau_id: nachWeinausbauId,
      menge_liter:        z.menge,   // Netto für dieses Ziel
      schwund_liter:      0,
      brutto_liter:       null,
      umzug_typ:          umzugTyp,
      ...umzugQualitaetsSpalten(zielVorher, zielNachher),
      herkunft_code_vorher:  herkunftVorher,
      herkunft_code_nachher: herkunftNachher,
      ...mostgewichtSnapshot,
      notizen:            zielVermerke.length > 0 ? zielVermerke.join('\n') : null,
      umzug_batch_id:     batchId,
      zeilen_typ:         'ziel',
    })
    if (zErr) throw new AktionsFehler((zErr as R).message)
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
  if (verschneidungNeeded) return { verschneidungNeeded }
  if (abstufung) return { abstufung }
}

// ── Umzug stornieren ─────────────────────────────────────────────────────────
// Wrapper um gebinde-actions.deleteUmzug – nur solange die Ziel-Charge nicht weiterbewegt
// wurde und die Rückbuchung vollständig möglich ist (KAN-35, lib/kellerbuch/storno.ts)
// schreibsperre-ausnahme: reicht nur an gebinde-actions.deleteUmzug weiter – dort prüfen kellerbuchSchreibrecht() Betrieb (KAN-30) und Schreibsperre (KAN-5)
export async function deleteUmzug(id: string, grund: string) {
  return _deleteUmzug(id, grund)
}

// ── Umzug Datum/Notizen aktualisieren ────────────────────────────────────────
// KAN-35: Notizen sind immer änderbar (nur diese Zeile). Ein neues Datum gilt für die ganze
// Buchung (alle Quell- und Zielzeilen – vorher nur für die angeklickte Zeile, Abgang und
// Zugang fielen dann auf verschiedene Tage) und nur unter denselben Bedingungen wie ein
// Storno: Ziel-Charge seither nicht weiterbewegt, keine Schwundbuchung, neues Zeilenformat.
export async function updateUmzug(umzugId: string, datum: string, notizen: string | null) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: vor den Rechten – sonst meldet ein veralteter Tab die Rechte des neuen Betriebs
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  const tenantId = membership.tenantId

  const zeilen = await ladeUmzugZeilen(supabase, tenantId, umzugId)
  const zeile = zeilen?.find(z => z.id === umzugId)
  if (!zeilen || !zeile) throw new AktionsFehler('Umzug nicht gefunden')

  const neuesDatum = (datum ?? '').trim()
  if (neuesDatum && neuesDatum !== zeile.datum) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(neuesDatum)) throw new AktionsFehler('Bitte ein gültiges Datum angeben.')
    const plan = await planeUmzugStorno(supabase, tenantId, zeilen)
    if (nurNotizenAenderbar(plan)) throw new AktionsFehler(umzugSperrMeldung(plan, 'datum'))
    const ids = zeilen.map(z => z.id as string)
    const { data, error: e } = await (supabase.from('keller_umzuege') as any)
      .update({ datum: neuesDatum })
      .in('id', ids)
      .eq('tenant_id', tenantId)
      .select('id')
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (keller_umzuege): ${dbFehlerText(e)}`)
    if (((data ?? []) as R[]).length !== ids.length) throw new AktionsFehler('Das Datum konnte nicht für alle Zeilen des Umzugs geändert werden (keine Berechtigung?).')
  }

  { const { error: e } = await (supabase.from('keller_umzuege') as any)
    .update({ notizen: notizen || null })
    .eq('id', umzugId)
    .eq('tenant_id', tenantId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (keller_umzuege): ${dbFehlerText(e)}`) }
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/gebinde')
  revalidatePath('/kellerbuch/behaelter', 'layout')
}
