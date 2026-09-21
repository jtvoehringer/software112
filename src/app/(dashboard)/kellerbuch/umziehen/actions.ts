'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelter, gebindeFehlerText } from '@/lib/keller/behaelter'
import { revalidatePath } from 'next/cache'
import { minQualitaet } from '@/lib/wein/qualitaet'
import { minHerkunft } from '@/lib/herkunft'
import { QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { deleteUmzug as _deleteUmzug } from '../gebinde-actions'
import { getCurrentMembership } from '@/lib/auth/roles'
import { fmtNum } from '@/lib/format'
import { AktionsFehler } from '@/lib/fehler'
import { weinartKonflikt, weinartKonfliktText, weinartAusFarbe, weinartBekannt } from '@/lib/keller/weinart'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface QuelleInput { weinausbau_id: string; menge: number }
interface ZielInput   { behaelter_id: string;  menge: number }

export async function umziehen(fd: FormData): Promise<{ verschneidungNeeded?: { existingChargeId: string; newChargeId: string; menge: number }; abstufung?: { von: string; nach: string; vonLabel: string; nachLabel: string } } | void> {
  const supabase = await createSupabaseServerClient()

  const quellen:    QuelleInput[] = JSON.parse(fd.get('quellen_json') as string || '[]')
  const ziele:      ZielInput[]   = JSON.parse(fd.get('ziele_json')   as string || '[]')
  const notizen   = (fd.get('notizen')   as string) || null
  const datum     = (fd.get('datum')     as string) || new Date().toISOString().split('T')[0]
  const umzugTyp  = (fd.get('umzug_typ') as string) || 'normal'

  if (quellen.length === 0 || ziele.length === 0) throw new AktionsFehler('Mindestens eine Quelle und ein Ziel erforderlich')

  const totalVon  = quellen.reduce((s, q) => s + q.menge, 0)
  const totalNach = ziele.reduce((s, z) => s + z.menge, 0)
  const schwund   = Math.max(0, +(totalVon - totalNach).toFixed(3))

  // Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen/ersten
  // tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft Daten des falschen
  // Betriebs gelesen/verändert werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) throw new AktionsFehler('Kein aktiver Mandant gefunden')

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

  const batchId = crypto.randomUUID()
  let verschneidungNeeded: { existingChargeId: string; newChargeId: string; menge: number } | undefined
  let abstufung: { von: string; nach: string; vonLabel: string; nachLabel: string } | undefined

  // ── Phase 1: Quellen validieren, reduzieren, Quelle-Records anlegen ──────────
  let minQualStufe: string | null = null
  const quellenDaten: R[] = []

  for (let i = 0; i < quellen.length; i++) {
    const q = quellen[i]

    const { data: vonRaw } = await (supabase.from('weinausbau') as any)
      .select('*').eq('id', q.weinausbau_id).eq('tenant_id', tenantId).single()
    const von = vonRaw as R
    if (!von) throw new AktionsFehler('Charge nicht gefunden')

    const verfuegbar = parseFloat(von.menge_liter) || 0
    if (q.menge > verfuegbar + 0.01) {
      throw new AktionsFehler(
        `„${von.name}": Menge (${fmtNum(q.menge)} L) überschreitet verfügbaren Bestand (${fmtNum(verfuegbar)} L)`
      )
    }

    quellenDaten.push(von)
    minQualStufe = minQualitaet(minQualStufe, von.qualitaetsstufe ?? null)

    // Bestand reduzieren / Charge abschließen
    const restmenge = Math.max(0, +(verfuegbar - q.menge).toFixed(3))
    if (restmenge <= 0.01) {
      { const { error: e } = await (supabase.from('weinausbau') as any)
        .update({ menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
        .eq('id', q.weinausbau_id)
        .eq('tenant_id', tenantId)
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weinausbau): ${e.message}`) }
    } else {
      { const { error: e } = await (supabase.from('weinausbau') as any)
        .update({ menge_liter: restmenge })
        .eq('id', q.weinausbau_id)
        .eq('tenant_id', tenantId)
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weinausbau): ${e.message}`) }
    }

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
      qualitaet_vorher:  von.qualitaetsstufe ?? null,
      qualitaet_nachher: minQualStufe,
      verschnitt:        false,
      notizen:           i === 0 ? notizen : null,
      umzug_batch_id:    batchId,
      zeilen_typ:        'quelle',
    })
    if (qErr) throw new AktionsFehler((qErr as R).message)
  }

  // ── Phase 2: Ziele befüllen, Ziel-Records anlegen ────────────────────────────
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

    // Rebsortenmix-Check: erste Quell-Rebsorte vs. bestehende Charge(n) im Zielbehälter.
    // Wichtig: eine bestehende Charge OHNE eindeutige Rebsorte (rebsorte = null, typischerweise
    // weil sie selbst schon ein Verschnitt ist, z.B. "Sortenverschnitt") zählt HIER ebenfalls als
    // Mix, nicht als "unbedenklich gleich" – vorher wurde in diesem Fall stillschweigend
    // zusammengeführt, weil `vorhanden.rebsorte != null` fehlschlug, obwohl real zwei
    // unterschiedliche Herkünfte im selben Tank landeten (Bugreport 5.8.2026: Weisser Riesling
    // wurde stillschweigend mit einem bestehenden Sortenverschnitt vermischt, ohne dass der
    // Verschneiden-Dialog bzw. eine Verschneidungs-Buchung ausgelöst wurde).
    const quelleRebsorte = quellenDaten.length === 1 ? (quellenDaten[0].rebsorte ?? null) : null

    // Liegt bereits eine Charge MIT EXAKT DERSELBEN Rebsorte im Ziel-Gebinde (auch wenn dort
    // noch weitere, andere Chargen herumstehen)? Dann direkt in DIESE zusammenführen.
    const gleicheRebsorte = quelleRebsorte != null
      ? vorhandenListe.find(v => v.rebsorte === quelleRebsorte) ?? null
      : null

    // Anker-Charge für den Vergleich: bevorzugt die mit gleicher Rebsorte; sonst (falls
    // mehrere lose Chargen im Ziel liegen) die mengenmäßig größte als sinnvollster Ausgangspunkt
    // für eine Verschneidung – der User kann im Verschneiden-Formular ohnehin beliebig weitere
    // Chargen aus demselben Tank ergänzen.
    const vorhanden = gleicheRebsorte
      ?? (vorhandenListe.length > 0
            ? [...vorhandenListe].sort((a, b) => (parseFloat(b.menge_liter) || 0) - (parseFloat(a.menge_liter) || 0))[0]
            : null)

    const istRebsortenmix = vorhanden != null
      && quelleRebsorte != null
      && (vorhanden.rebsorte == null || quelleRebsorte !== vorhanden.rebsorte)

    if (vorhanden && !istRebsortenmix) {
      // Gleiche Rebsorte: direkt zusammenführen
      const altQualitaet = vorhanden.qualitaetsstufe as string | null
      const neueQualitaet = minQualitaet(altQualitaet, minQualStufe)

      // Qualitätsabstufung erkennen und als Notiz persistieren
      let abstufungsText: string | null = null
      if (neueQualitaet && altQualitaet && neueQualitaet !== altQualitaet) {
        const vonLabel  = QUALITAET_LABEL[altQualitaet]    ?? altQualitaet
        const nachLabel = QUALITAET_LABEL[neueQualitaet]   ?? neueQualitaet
        abstufungsText = `Abstufung von ${vonLabel} auf ${nachLabel} (Zusammenführung per Umziehen)`
        abstufung = { von: altQualitaet, nach: neueQualitaet, vonLabel, nachLabel }
        // Notiz an weinausbau hängen (sichtbar in Charge bearbeiten)
        const bestehend = (vorhanden.notizen as string | null) ?? ''
        const neueNotizen = bestehend ? `${bestehend}\n${abstufungsText}` : abstufungsText
        { const { error: e } = await (supabase.from('weinausbau') as any)
          .update({ notizen: neueNotizen })
          .eq('id', vorhanden.id)
          .eq('tenant_id', tenantId)
          if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weinausbau): ${e.message}`) }
      }

      await (supabase.from('weinausbau') as any)
        .update({
          menge_liter:     +((vorhanden.menge_liter ?? 0) + z.menge).toFixed(3),
          qualitaetsstufe: neueQualitaet,
        })
        .eq('id', vorhanden.id)
        .eq('tenant_id', tenantId)
      nachWeinausbauId = vorhanden.id
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
        qualitaetsstufe:      minQualStufe,
        status:               von0?.status ?? 'ausbau',
        notizen:              `Umzug aus „${von0?.name ?? ''}"`,
        aktiv:                true,
      }).select('id')
      if (neuErr) throw new AktionsFehler(gebindeFehlerText((neuErr as R).message))
      nachWeinausbauId = ((newChargeData as R[])?.[0] as R | undefined)?.id ?? null
      if (nachWeinausbauId) {
        verschneidungNeeded = { existingChargeId: vorhanden.id, newChargeId: nachWeinausbauId, menge: z.menge }
      }
    } else {
      const von0 = quellenDaten[0]
      const { data: newChargeData, error: neuErr } = await (supabase.from('weinausbau') as any).insert({
        tenant_id:            tenantId,
        name:                 quellenDaten.length > 1 ? 'Zusammenführung' : (von0?.name ?? 'Umzug'),
        jahrgang:             von0?.jahrgang ?? null,
        rebsorte:             von0?.rebsorte ?? null,
        weinart:              von0?.weinart ?? 'unbekannt',
        herkunft_code:        minHerkunft(quellenDaten.map(q => q.herkunft_code as string | null)),
        weingarten_id:        von0?.weingarten_id ?? null,
        behaelter_id:         z.behaelter_id,
        menge_liter:          z.menge,
        // anfangsbestand_liter bleibt null - siehe Kommentar im Rebsortenmix-Zweig oben,
        // derselbe Doppelzählungs-Bug betrifft auch diesen Zweig (neue Charge, kein
        // bestehendes Ziel).
        anfangsbestand_liter: null,
        qualitaetsstufe:      minQualStufe,
        status:               von0?.status ?? 'ausbau',
        notizen:              quellen.length > 1
          ? `Zusammengeführt aus ${quellen.length} Chargen`
          : `Umzug aus „${von0?.name ?? ''}"`,
        aktiv:                true,
      }).select('id')
      if (neuErr) throw new AktionsFehler(gebindeFehlerText((neuErr as R).message))
      nachWeinausbauId = ((newChargeData as R[])?.[0] as R | undefined)?.id ?? null
    }

    // Ziel-Record (zeilen_typ = 'ziel') – ein Eintrag pro Ziel-Gebinde
    const zielNotizen = abstufung
      ? `Abstufung von ${abstufung.vonLabel} auf ${abstufung.nachLabel}`
      : null
    const { error: zErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:          tenantId,
      datum,
      nach_behaelter_id:  z.behaelter_id,
      nach_weinausbau_id: nachWeinausbauId,
      menge_liter:        z.menge,   // Netto für dieses Ziel
      schwund_liter:      0,
      brutto_liter:       null,
      umzug_typ:          umzugTyp,
      notizen:            zielNotizen,
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

// ── Umzug löschen ────────────────────────────────────────────────────────────
// Wrapper um gebinde-actions.deleteUmzug – behandelt beide Formate (alt + neu)
export async function deleteUmzug(id: string) {
  return _deleteUmzug(id)
}

// ── Umzug Datum/Notizen aktualisieren ────────────────────────────────────────
export async function updateUmzug(umzugId: string, datum: string, notizen: string | null) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  { const { error: e } = await (supabase.from('keller_umzuege') as any)
    .update({ datum, notizen: notizen || null })
    .eq('id', umzugId)
    .eq('tenant_id', membership.tenantId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (keller_umzuege): ${e.message}`) }
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
}
