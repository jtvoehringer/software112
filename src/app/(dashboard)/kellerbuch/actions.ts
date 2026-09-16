'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { minQualitaet, maxQualitaet, istNiedrigerAls, QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { minHerkunft, maxHerkunft, istNiedrigerAls as herkunftIstNiedrigerAls, HERKUNFT_LABEL } from '@/lib/herkunft'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen/ersten
// tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft Daten des falschen
// Betriebs gelesen/verändert werden.
async function getTenantId(): Promise<string | null> {
  const membership = await getCurrentMembership()
  return membership?.tenantId ?? null
}

// BEHAELTER
export async function createBehaelter(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: R = {
    tenant_id:     tenantId,
    name:          formData.get('name') as string,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number((formData.get('volumen_liter') as string).replace(',', '.')) : null,
    standort:      (formData.get('standort') as string) || null,
    notizen:       (formData.get('notizen') as string)?.trim() || null,
    stapler:       formData.get('stapler') === 'true',
    // Kellergemeinschaft (Migration 203): Checkbox nur im Formular, wenn Partner bestehen -
    // fehlt sie, bleibt der Default (freigegeben), sonst der gesetzte Wert.
    ...(formData.has('gemeinsam_sichtbar') ? { gemeinsam: formData.get('gemeinsam') === 'true' } : {}),
    aktiv:         true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).insert(payload)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
}

// Rückmeldung 29.8.2026: "wenn eine Gebinde im lfd. Betrieb umbenannt wird,
// dann notiere das bitte in den Maßnahmen!" - die "Maßnahmen" je Behälter
// sind die Kellerbehandlungen (Tabelle keller_behandlungen, Seite
// .../behaelter/[id]/behandlungen, taucht dort UND im Bewegungsbuch als
// Eintrag mit art:'behandlung' auf, siehe bewegungen/page.tsx). Bei
// tatsächlicher Namensänderung wird hier automatisch ein solcher Eintrag mit
// Typ "Umbenennung" angelegt (Menge/Einheit bewusst leer - reine
// Protokollnotiz, keine Mengenbewegung). Der Typ "Umbenennung" wird beim
// allerersten Mal je Mandant automatisch angelegt (find-or-create per Name),
// exakt nach demselben Muster wie der Bot-Tool-Handler in
// src/lib/assistent/tools/kellerbehandlung.ts für neue Behandlungstypen.
// Schlägt das Protokollieren aus irgendeinem Grund fehl, soll das die
// eigentliche (bereits gespeicherte) Umbenennung nicht rückgängig machen -
// daher nur geloggt, nicht geworfen.
async function protokolliereGebindeUmbenennung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  behaelterId: string,
  alterName: string,
  neuerName: string
) {
  const TYP_NAME = 'Umbenennung'
  const { data: bestehenderTyp } = await (supabase.from('keller_behandlungstypen') as any)
    .select('id').eq('tenant_id', tenantId).ilike('name', TYP_NAME).maybeSingle()
  let typId = (bestehenderTyp as R | null)?.id ?? null
  if (!typId) {
    const { data: neuerTyp, error: typErr } = await (supabase.from('keller_behandlungstypen') as any)
      .insert({ tenant_id: tenantId, name: TYP_NAME, einheit_standard: '-' })
      .select('id').single()
    if (typErr) {
      console.error('[protokolliereGebindeUmbenennung] Typ konnte nicht angelegt werden:', (typErr as R).message)
      return
    }
    typId = (neuerTyp as R).id
  }

  const { error: behErr } = await (supabase.from('keller_behandlungen') as any).insert({
    tenant_id:         tenantId,
    behaelter_id:      behaelterId,
    datum:             new Date().toISOString().slice(0, 10),
    typ_id:            typId,
    typ_name_snapshot: TYP_NAME,
    notizen:           `Gebinde umbenannt von „${alterName}" zu „${neuerName}"`,
  })
  if (behErr) {
    console.error('[protokolliereGebindeUmbenennung] Eintrag konnte nicht gespeichert werden:', (behErr as R).message)
  }
}

export async function updateBehaelter(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const neuerName = formData.get('name') as string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: altRow } = await (supabase.from('behaelter') as any)
    .select('name').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  const alterName = (altRow as R | null)?.name ?? null

  const payload: R = {
    name:          neuerName,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number((formData.get('volumen_liter') as string).replace(',', '.')) : null,
    standort:      (formData.get('standort') as string) || null,
    notizen:       (formData.get('notizen') as string)?.trim() || null,
    stapler:       formData.get('stapler') === 'true',
    ...(formData.has('gemeinsam_sichtbar') ? { gemeinsam: formData.get('gemeinsam') === 'true' } : {}),
    aktiv:         formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as R).message)

  if (alterName && neuerName && alterName.trim() !== neuerName.trim()) {
    await protokolliereGebindeUmbenennung(supabase, tenantId, id, alterName, neuerName)
  }

  revalidatePath('/kellerbuch')
}

export async function deleteBehaelter(id: string): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) return { error: 'Kein Betrieb gefunden' }

  // Enthält der Behälter noch eine aktive Charge? Dann erst umziehen/abschließen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: aktiveChargen } = await (supabase.from('weinausbau') as any)
    .select('id').eq('behaelter_id', id).eq('aktiv', true).eq('tenant_id', tenantId).limit(1)
  if (aktiveChargen && aktiveChargen.length > 0) {
    return { error: 'Behälter enthält noch eine aktive Charge und kann nicht gelöscht werden.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) {
    // 23503 = foreign_key_violation – Behälter wird in Kellerbuch-Historie referenziert
    // (z.B. Umzug als Ziel, Pressung). Historie bleibt erhalten, Löschen wird verhindert.
    if ((error as R).code === '23503') {
      return { error: 'Behälter wird in bestehenden Kellerbuch-Einträgen verwendet (z.B. Umzug, Pressung) und kann nicht gelöscht werden. Stattdessen über „Bearbeiten" auf „Inaktiv" setzen.' }
    }
    return { error: (error as R).message }
  }
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
  return {}
}

// WEINAUSBAU
export async function createWeinausbau(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const payload: R = {
    tenant_id:       tenantId,
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:          formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    anfangsbestand_liter: formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    status:               (formData.get('status') as string) || 'ernte',
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number((formData.get('einstandspreis_pro_liter') as string).replace(',', '.'))
      : null,
    aktiv:           true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newWA, error } = await (supabase.from('weinausbau') as any).insert(payload).select('id').single()
  if (error) throw new Error((error as R).message)
  // Junction-Tabelle: Rieden/Weingärten verknüpfen
  if (wgIds.length > 0 && (newWA as R)?.id) {
    const waId = (newWA as R).id as string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau_weingaerten') as any).insert(
      wgIds.map(wgId => ({ tenant_id: tenantId, weinausbau_id: waId, weingarten_id: wgId }))
    )
  }
  revalidatePath('/kellerbuch')
}

export async function updateWeinausbau(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const neueMenge = formData.get('menge_liter')
    ? Number((formData.get('menge_liter') as string).replace(',', '.'))
    : null
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:     neueMenge,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    weinart:              (formData.get('weinart') as string) || 'unbekannt',
    status:               formData.get('status') as string,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number((formData.get('einstandspreis_pro_liter') as string).replace(',', '.'))
      : null,
    aktiv:           formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinausbau') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as R).message)

  // Junction-Tabelle: Rieden/Weingärten neu setzen (delete + insert)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('weinausbau_weingaerten') as any).delete().eq('weinausbau_id', id).eq('tenant_id', tenantId)
  if (wgIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau_weingaerten') as any).insert(
      wgIds.map(wgId => ({ tenant_id: tenantId, weinausbau_id: id, weingarten_id: wgId }))
    )
  }

  // KEIN Sync auf pressung_behaelter.menge_liter – das ist der historische Pressbetrag
  // und darf nicht mit dem laufenden Bestand überschrieben werden.

  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${id}`)
}

// ANALYSEN
export async function createAnalyse(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const weinausbauId = formData.get('weinausbau_id') as string
  if (!weinausbauId) throw new Error('Keine Charge angegeben')

  function numOrNull(key: string): number | null {
    const v = (formData.get(key) as string)?.replace(',', '.').trim()
    if (!v) return null
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }

  const payload: R = {
    tenant_id:            tenantId,
    weinausbau_id:        weinausbauId,
    analyse_datum:        formData.get('analyse_datum') as string,
    labor:                (formData.get('labor') as string) || null,
    probe_nr:             (formData.get('probe_nr') as string) || null,
    alkohol_vol:          numOrNull('alkohol_vol'),
    restzucker_gl:        numOrNull('restzucker_gl'),
    gesamtsaeure_gl:      numOrNull('gesamtsaeure_gl'),
    ph_wert:              numOrNull('ph_wert'),
    // Spaltenname im DB hat Umlaut – via Alias im Formular (fluechtige_saeure_gl)
    'flüchtige_saeure_gl': numOrNull('fluechtige_saeure_gl'),
    freie_so2_mgl:        numOrNull('freie_so2_mgl'),
    gesamt_so2_mgl:       numOrNull('gesamt_so2_mgl'),
    bewertung:            (formData.get('bewertung') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinanalysen') as any).insert(payload)
  if (error) throw new Error((error as R).message)

  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/analysen`)
  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/buch`)
}

// VERSCHNEIDUNG
export async function createVerschneidung(formData: FormData): Promise<{ qualitaetAbgestuft: { von: string; nach: string } | null; herkunftAbgestuft: { von: string; nach: string } | null }> {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const datum        = formData.get('datum') as string
  const zielId       = formData.get('ziel_weinausbau_id') as string
  const notizen      = (formData.get('notizen') as string) || null
  const quellenJson  = formData.get('quellen_json') as string
  const quellen: { weinausbau_id: string; menge_liter: number }[] = JSON.parse(quellenJson || '[]')

  if (!datum || !zielId || quellen.length === 0) throw new Error('Pflichtfelder fehlen')

  // Qualitätsstufe + Herkunft-Code der Ziel-Charge vor Verschneidung sichern
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: zielVorher } = await (supabase.from('weinausbau') as any)
    .select('qualitaetsstufe, herkunft_code').eq('id', zielId).eq('tenant_id', tenantId).single()
  const zielQualitaetVorher = (zielVorher as R | null)?.qualitaetsstufe ?? null
  const zielHerkunftVorher  = (zielVorher as R | null)?.herkunft_code ?? null

  // Verschneidungs-Datensatz anlegen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu, error: ve } = await (supabase.from('verschneidungen') as any)
    .insert({ tenant_id: tenantId, datum, ziel_weinausbau_id: zielId, notizen, ziel_qualitaet_vorher: zielQualitaetVorher, ziel_herkunft_code_vorher: zielHerkunftVorher })
    .select('id').single()
  if (ve) throw new Error((ve as R).message)
  const vId = (neu as R).id as string

  // Quellen anlegen + anteil_pct berechnen
  const gesamtLiter = quellen.reduce((s, q) => s + q.menge_liter, 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('verschneidung_quellen') as any).insert(
    quellen.map(q => ({
      verschneidung_id:    vId,
      quell_weinausbau_id: q.weinausbau_id,
      menge_liter:         q.menge_liter,
      anteil_pct:          gesamtLiter > 0 ? Math.round((q.menge_liter / gesamtLiter) * 1000) / 10 : null,
    }))
  )

  // Qualitaetsstufen + Rebsorten + Weinart der Quell-Chargen laden
  const { data: quellenData } = await (supabase.from('weinausbau') as any)
    .select('id, qualitaetsstufe, rebsorte, weinart, herkunft_code')
    .in('id', quellen.map(q => q.weinausbau_id))
    .eq('tenant_id', tenantId)
  const quellenRows = (quellenData ?? []) as R[]

  // Guard: Rotwein + Weißwein darf nicht verschnitten werden
  const { data: zielWeinartRow } = await (supabase.from('weinausbau') as any)
    .select('weinart').eq('id', zielId).eq('tenant_id', tenantId).single()
  const zielWeinart = (zielWeinartRow as R | null)?.weinart as string | null ?? null
  const quelleKonflikt = quellenRows.find((q: R) => {
    const qwa = q.weinart as string | null
    if (!qwa || !zielWeinart || qwa === 'unbekannt' || zielWeinart === 'unbekannt') return false
    return (zielWeinart === 'rot' && qwa === 'weiss') || (zielWeinart === 'weiss' && qwa === 'rot')
  })
  if (quelleKonflikt) throw new Error('Rotwein und Weißwein dürfen gemäß Weingesetz nicht miteinander verschnitten werden.')
  // Niedrigste Qualitaetsstufe aus Quellen + Ziel bestimmen
  const alleQualitaeten = [zielQualitaetVorher, ...quellenRows.map((q: R) => q.qualitaetsstufe as string | null)]
  const neueQualitaet = minQualitaet(alleQualitaeten)
  // Niedrigsten (breitesten) Herkunft-Code aus Quellen + Ziel bestimmen – kann durch Verschneiden
  // rechnerisch nie aufgestuft werden (dieselbe Logik wie bei der Qualität).
  const alleHerkuenfte = [zielHerkunftVorher, ...quellenRows.map((q: R) => q.herkunft_code as string | null)]
  const neueHerkunft = minHerkunft(alleHerkuenfte)

  // Ziel-Charge: Bestand erhöhen + Rebsorte nach 85%-Regel + Qualität anpassen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ziel } = await (supabase.from('weinausbau') as any)
    .select('menge_liter, rebsorte').eq('id', zielId).eq('tenant_id', tenantId).single()
  const aktuell = parseFloat((ziel as R)?.menge_liter ?? '0') || 0
  const zielRebsorteJetzt = (ziel as R)?.rebsorte as string | null ?? null
  // Rebsorten-Anteile über alle beteiligten Mengen berechnen
  const total = aktuell + gesamtLiter
  const anteile: Record<string, number> = {}
  if (zielRebsorteJetzt && aktuell > 0) {
    anteile[zielRebsorteJetzt] = (anteile[zielRebsorteJetzt] ?? 0) + aktuell
  }
  for (const q of quellen) {
    const qRebsorte = (quellenRows.find((r: R) => r.id === q.weinausbau_id) as R | undefined)?.rebsorte as string | null ?? null
    if (qRebsorte) anteile[qRebsorte] = (anteile[qRebsorte] ?? 0) + q.menge_liter
  }
  const dominante = Object.entries(anteile).sort((a, b) => b[1] - a[1])[0]
  const dominanterAnteil = dominante && total > 0 ? dominante[1] / total : 0
  // ≥ 85 %: Rebsorte bleibt; < 85 %: Sortenverschnitt
  // Dominante Rebsorte verwenden (nicht zielRebsorteJetzt, da Quelle dominieren kann)
  const neueRebsorte = dominanterAnteil >= 0.85 ? (dominante[0] ?? zielRebsorteJetzt) : 'Sortenverschnitt'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: zielUpdateErr } = await (supabase.from('weinausbau') as any)
    .update({
      menge_liter: aktuell + gesamtLiter,
      rebsorte: neueRebsorte,
      qualitaetsstufe: neueQualitaet,
      herkunft_code: neueHerkunft,
    })
    .eq('id', zielId)
    .eq('tenant_id', tenantId)
  if (zielUpdateErr) throw new Error(`Ziel-Charge konnte nicht aktualisiert werden: ${zielUpdateErr.message}`)

  // Quell-Chargen: Bestand reduzieren
  for (const q of quellen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: src } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', q.weinausbau_id).eq('tenant_id', tenantId).single()
    const srcLiter = parseFloat((src as R)?.menge_liter ?? '0') || 0
    const neueLiter = Math.max(0, srcLiter - q.menge_liter)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update(neueLiter <= 0
        ? { menge_liter: 0, aktiv: false, status: 'abgeschlossen' }
        : { menge_liter: neueLiter })
      .eq('id', q.weinausbau_id)
      .eq('tenant_id', tenantId)
  }

  // Qualitäts-Abstufung: Vergleich gegen HÖCHSTE Qualität aller Beteiligten (Ziel + Quellen).
  // Beispiel: Ziel Kabinett + Quelle Auslese → Ergebnis Kabinett → Abstufung von Auslese auf Kabinett.
  const alleQualitaetenBeteiligt = [zielQualitaetVorher, ...quellenRows.map((q: R) => q.qualitaetsstufe as string | null)]
  const hoechsteQualitaet = maxQualitaet(alleQualitaetenBeteiligt)
  const qualitaetAbgestuft: { von: string; nach: string } | null =
    (neueQualitaet && hoechsteQualitaet && istNiedrigerAls(neueQualitaet, hoechsteQualitaet))
      ? { von: hoechsteQualitaet, nach: neueQualitaet }
      : null

  // Herkunft-Abstufung: Vergleich gegen die ENGSTE Herkunftsstufe aller Beteiligten (Ziel + Quellen).
  const alleHerkuenfteBeteiligt = [zielHerkunftVorher, ...quellenRows.map((q: R) => q.herkunft_code as string | null)]
  const engsteHerkunft = maxHerkunft(alleHerkuenfteBeteiligt)
  const herkunftAbgestuft: { von: string; nach: string } | null =
    (neueHerkunft && engsteHerkunft && herkunftIstNiedrigerAls(neueHerkunft, engsteHerkunft))
      ? { von: engsteHerkunft, nach: neueHerkunft }
      : null

  // Abstufungs-Info automatisch in Notizen speichern
  const abstufTexte: string[] = []
  if (qualitaetAbgestuft) {
    const vonLabel  = QUALITAET_LABEL[qualitaetAbgestuft.von]  ?? qualitaetAbgestuft.von
    const nachLabel = QUALITAET_LABEL[qualitaetAbgestuft.nach] ?? qualitaetAbgestuft.nach
    abstufTexte.push(`Abstufung Qualität von ${vonLabel} auf ${nachLabel}`)
  }
  if (herkunftAbgestuft) {
    const vonLabel  = HERKUNFT_LABEL[herkunftAbgestuft.von]  ?? herkunftAbgestuft.von
    const nachLabel = HERKUNFT_LABEL[herkunftAbgestuft.nach] ?? herkunftAbgestuft.nach
    abstufTexte.push(`Abstufung Herkunft-Code (BKI) von ${vonLabel} auf ${nachLabel}`)
  }
  if (abstufTexte.length > 0) {
    const neueNotizen = notizen ? `${notizen}\n${abstufTexte.join('\n')}` : abstufTexte.join('\n')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('verschneidungen') as any)
      .update({ notizen: neueNotizen })
      .eq('id', vId)
      .eq('tenant_id', tenantId)
  }

  revalidatePath('/kellerbuch')
  quellen.forEach(q => revalidatePath(`/kellerbuch/weinausbau/${q.weinausbau_id}/buch`))
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)

  return { qualitaetAbgestuft, herkunftAbgestuft }
}

// VERSCHNEIDUNG STORNIEREN
export async function deleteVerschneidung(verschneidungId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  // Quellen + Mengen laden bevor gelöscht wird
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vRaw } = await (supabase.from('verschneidungen') as any)
    .select('id, ziel_weinausbau_id, ziel_qualitaet_vorher, ziel_herkunft_code_vorher, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter)')
    .eq('id', verschneidungId)
    .eq('tenant_id', tenantId)
    .single()
  if (!vRaw) throw new Error('Verschneidung nicht gefunden')
  const v = vRaw as R

  const zielId = v.ziel_weinausbau_id as string
  const quellen = (v.quellen ?? []) as R[]
  const gesamtLiter = quellen.reduce((s: number, q: R) => s + (parseFloat(q.menge_liter) || 0), 0)

  // Ziel-Charge: Bestand wieder reduzieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ziel } = await (supabase.from('weinausbau') as any)
    .select('menge_liter').eq('id', zielId).eq('tenant_id', tenantId).single()
  const zielAkt = parseFloat((ziel as R)?.menge_liter ?? '0') || 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('weinausbau') as any)
    .update({ menge_liter: Math.max(0, zielAkt - gesamtLiter) })
    .eq('id', zielId)
    .eq('tenant_id', tenantId)

  // Quell-Chargen: Menge wieder gutschreiben
  for (const q of quellen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: src } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', q.quell_weinausbau_id).eq('tenant_id', tenantId).single()
    const srcAkt = parseFloat((src as R)?.menge_liter ?? '0') || 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: srcAkt + (parseFloat(q.menge_liter) || 0) })
      .eq('id', q.quell_weinausbau_id)
      .eq('tenant_id', tenantId)
  }

  // Qualitätsstufe + Herkunft-Code wiederherstellen falls gespeichert
  const zielQualitaetVorher = (vRaw as R).ziel_qualitaet_vorher as string | null
  const zielHerkunftVorher  = (vRaw as R).ziel_herkunft_code_vorher as string | null
  if (zielQualitaetVorher || zielHerkunftVorher) {
    const restorePayload: R = {}
    if (zielQualitaetVorher) restorePayload.qualitaetsstufe = zielQualitaetVorher
    if (zielHerkunftVorher)  restorePayload.herkunft_code   = zielHerkunftVorher
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update(restorePayload)
      .eq('id', zielId)
      .eq('tenant_id', tenantId)
  }

  // Datensatz löschen (CASCADE löscht verschneidung_quellen automatisch)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('verschneidungen') as any)
    .delete().eq('id', verschneidungId).eq('tenant_id', tenantId)
  if (error) throw new Error((error as R).message)

  revalidatePath('/kellerbuch')
  quellen.forEach((q: R) => revalidatePath(`/kellerbuch/weinausbau/${q.quell_weinausbau_id}`))
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
}

// MANUELLER SCHWUND
// Bucht einen Schwund-Abgang als keller_umzug mit umzug_typ='schwund'.
// brutto_liter = Schwundmenge, menge_liter = 0 → kein Nettozugang im Zielbehälter.
// Erscheint im Bewegungsbuch als Abgang mit Beschreibung "Schwund / Verlust".

export async function manuellSchwundBuchen(formData: FormData) {
  const supabase     = await createSupabaseServerClient()
  const tenantId     = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const behaelterId  = formData.get('behaelter_id')  as string
  const weinausbauId = formData.get('weinausbau_id') as string
  const menge        = parseFloat((formData.get('menge') as string)?.replace(',', '.') || '0')
  const datum        = formData.get('datum') as string

  if (!behaelterId || !weinausbauId || menge <= 0 || !datum) {
    throw new Error('Ungültige Eingabe: alle Felder sind erforderlich')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('keller_umzuege') as any).insert({
    tenant_id:         tenantId,
    von_weinausbau_id: weinausbauId,
    nach_behaelter_id: behaelterId,  // Pflichtfeld – selber Behälter, menge_liter=0 → kein Zugang
    menge_liter:       0,
    brutto_liter:      menge,
    schwund_liter:     menge,
    datum,
    umzug_typ:         'schwund',
    notizen:           'Manueller Schwund',
  })

  if (error) throw new Error((error as R).message)

  revalidatePath(`/kellerbuch/behaelter/${behaelterId}/bewegungen`)
  revalidatePath('/kellerbuch')
}

// KELLERBEHANDLUNG
//
// Server-Action-Kapselung für keller_behandlungen – dieser Prozess lief bisher
// ausschließlich über direkte Client-seitige Schreibzugriffe (createSupabaseBrowserClient
// in der Kellerbehandlungen-Seite). Damit der Prozess-Assistent (Bot) denselben
// Tool-Handler-Ansatz wie bei den übrigen Prozessen nutzen kann, kapselt diese neue Action
// exakt dieselbe Insert-Logik in einer Server Action (siehe Konzeptdokument Abschnitt 3b).
// Die bestehende Seite bleibt bewusst unverändert (funktioniert weiterhin über den
// Browser-Client) – diese Action ist zusätzlich, kein Ersatz.
export async function createKellerbehandlung(formData: FormData): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const behaelterId = formData.get('behaelter_id') as string
  if (!behaelterId) throw new Error('Kein Behälter angegeben')
  const datum = formData.get('datum') as string
  if (!datum) throw new Error('Kein Datum angegeben')
  const typId = formData.get('typ_id') as string
  if (!typId) throw new Error('Kein Behandlungstyp angegeben')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: typRaw } = await (supabase.from('keller_behandlungstypen') as any)
    .select('id, name, einheit_standard').eq('id', typId).eq('tenant_id', tenantId).maybeSingle()
  if (!typRaw) throw new Error('Behandlungstyp nicht gefunden')
  const typ = typRaw as R

  const menge   = formData.get('menge') ? parseFloat((formData.get('menge') as string).replace(',', '.')) : null
  const einheit = (formData.get('einheit') as string) || (typ.einheit_standard as string | null) || null

  // Volumen Ist: falls nicht angegeben, aktuellen Gesamtinhalt des Behälters (Summe aktiver
  // Chargen) als sinnvollen Default nachladen – wie in der bestehenden Seite vorbelegt.
  let volumenLiterIst = formData.get('volumen_liter_ist')
    ? parseFloat((formData.get('volumen_liter_ist') as string).replace(',', '.'))
    : null
  if (volumenLiterIst == null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chargenImBehaelter } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('behaelter_id', behaelterId).eq('aktiv', true).eq('tenant_id', tenantId)
    const summe = ((chargenImBehaelter ?? []) as R[]).reduce((s, w) => s + (parseFloat(w.menge_liter) || 0), 0)
    volumenLiterIst = summe > 0 ? summe : null
  }

  const notizen      = (formData.get('notizen') as string) || null
  const weinausbauId = (formData.get('weinausbau_id') as string) || null

  const payload: R = {
    tenant_id:          tenantId,
    behaelter_id:       behaelterId,
    datum,
    typ_id:             typId,
    typ_name_snapshot:  typ.name as string,
    menge,
    einheit,
    volumen_liter_ist:  volumenLiterIst,
    notizen,
    weinausbau_id:      weinausbauId,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('keller_behandlungen') as any)
    .insert(payload).select('id').single()
  if (error) throw new Error((error as R).message)

  revalidatePath(`/kellerbuch/behaelter/${behaelterId}/behandlungen`)
  revalidatePath('/kellerbuch')
  return { id: (data as R).id as string }
}
