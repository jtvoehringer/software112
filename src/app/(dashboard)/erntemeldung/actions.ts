'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { kmwZuQualitaet } from '@/lib/weinqualitaet'
import { findePassendeHerkunftsstufe, HERKUNFT_LABEL, minHerkunft } from '@/lib/herkunft'
import { createVerkaufspostenFuerTrauben, ermittleQuellenName } from '@/app/(dashboard)/weinhandel/traubenverkauf/actions'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Kein aktiver Mandant gefunden')
  return membership.tenantId
}


// ── Jahrgänge ─────────────────────────────────────────────────────────────────

export async function createJahrgang(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const jahrgang = Number(formData.get('jahrgang'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).insert({
    tenant_id:   tenantId,
    jahrgang,
    ernte_beginn: (formData.get('ernte_beginn') as string) || null,
    ernte_ende:   (formData.get('ernte_ende') as string) || null,
    notizen:      (formData.get('notizen') as string) || null,
  })
  if (error) {
    // 23505 = unique_violation (unique(tenant_id, jahrgang)) – verständliche Meldung statt Server-Crash
    if ((error as AR).code === '23505') {
      return { error: `Jahrgang ${jahrgang} existiert bereits für diesen Betrieb.` }
    }
    return { error: (error as AR).message }
  }
  revalidatePath('/erntemeldung')
  return {}
}

export async function updateJahrgang(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).update({
    ernte_beginn:        (formData.get('ernte_beginn') as string) || null,
    ernte_ende:          (formData.get('ernte_ende') as string) || null,
    qualitaet_gesamt:    (formData.get('qualitaet_gesamt') as string) || null,
    witterungscharakter: (formData.get('witterungscharakter') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
  }).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/erntemeldung')
  revalidatePath(`/erntemeldung/${id}`)
}

// ── Ernte-Parzellen ───────────────────────────────────────────────────────────

export async function upsertErnteParzelle(jahrgangId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const weingartenId = formData.get('weingarten_id') as string
  // .replace(',', '.') ist nötig, da die Felder °KMW-typisch mit Komma-Dezimaltrennzeichen
  // erfasst werden (de-AT) - ohne die Ersetzung liefert Number() bei "9,5" NaN.
  const mengeKg = formData.get('menge_kg') ? Number((formData.get('menge_kg') as string).replace(',', '.')) : null
  const mengeHl = mengeKg ? mengeKg / 130 : null  // 1 hl ≈ 130 kg
  const grundstueckId = (formData.get('grundstueck_id') as string) || null

  // Herkunft-Code (BKI) vom Grundstück übernehmen + Sortenspiegel-Abstufung, falls die
  // gelesene Rebsorte auf der GST-Stufe nicht zulässig ist (nur Abstufung, nie Aufstufung).
  let herkunftCode: string | null = null
  let notizenZusatz = ''
  if (grundstueckId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gst } = await (supabase.from('grundstuecke') as any)
      .select('trauben_herkunft_code, rebsorte').eq('id', grundstueckId).eq('tenant_id', tenantId).maybeSingle()
    const gstHerkunft = (gst as AR | null)?.trauben_herkunft_code as string | null ?? null
    const gstRebsorte = (gst as AR | null)?.rebsorte as string | null ?? null
    const passend = findePassendeHerkunftsstufe(gstHerkunft, gstRebsorte)
    herkunftCode = passend.code
    if (passend.abgestuft && gstHerkunft) {
      notizenZusatz = `Herkunft-Code automatisch abgestuft von ${HERKUNFT_LABEL[gstHerkunft] ?? gstHerkunft} auf ${HERKUNFT_LABEL[passend.code ?? ''] ?? passend.code} (Sortenspiegel: ${gstRebsorte ?? 'unbekannte Rebsorte'})`
    }
  }
  const notizenInput = (formData.get('notizen') as string) || null
  const notizen = notizenZusatz ? [notizenInput, notizenZusatz].filter(Boolean).join('\n') : notizenInput

  const payload: AR = {
    jahrgang_id:      jahrgangId,
    weingarten_id:    weingartenId,
    ernte_datum:      (formData.get('ernte_datum') as string) || null,
    menge_kg:         mengeKg,
    menge_hl:         mengeHl,
    oechsle:          formData.get('oechsle') ? Number((formData.get('oechsle') as string).replace(',', '.')) : null,
    klosterneuburger: formData.get('klosterneuburger') ? Number((formData.get('klosterneuburger') as string).replace(',', '.')) : null,
    qualitaetsstufe:  (formData.get('qualitaetsstufe') as string) || null,
    herkunft_code:    herkunftCode,
    lesemethode:      (formData.get('lesemethode') as string) || null,
    notizen:          notizen,
    grundstueck_id:   grundstueckId,
  }

  const existingId = formData.get('existing_id') as string | null
  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('ernte_parzellen') as any).update(payload).eq('id', existingId)
    if (error) throw new Error((error as AR).message)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('ernte_parzellen') as any).insert(payload)
    if (error) throw new Error((error as AR).message)
  }
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

// Mehrfacherfassung: eine Parzelle pro Weingarten mit gemeinsamen Feldern
export async function createMultipleErnteParzellen(jahrgangId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const weingartenIds = formData.getAll('weingarten_ids') as string[]

  type GSTEntry = { gst_id: string; weingarten_id: string; flaeche_ha: number | null; menge_kg?: number | null; kmw?: number | null; lesemethode?: string | null; notizen?: string | null }
  const gstJsonRaw = formData.get('grundstueck_json') as string | null
  const gstEntries: GSTEntry[] = gstJsonRaw ? JSON.parse(gstJsonRaw) : []

  if (weingartenIds.length === 0 && gstEntries.length === 0) {
    throw new Error('Mindestens eine Ried oder ein Grundstück auswählen')
  }

  const ernteDatum  = (formData.get('ernte_datum') as string) || null
  const lesemethode = (formData.get('lesemethode') as string) || null
  // .replace(',', '.') nötig für de-AT-Komma-Eingabe (z.B. "9,5") - siehe upsertErnteParzelle.
  const kmw         = formData.get('klosterneuburger') ? Number((formData.get('klosterneuburger') as string).replace(',', '.')) : null
  // Qualitätsstufe wird ausschließlich aus den °KMW abgeleitet (kein manuelles Formularfeld
  // mehr) - Fallback 'qualitaetswein', wenn kein KMW erfasst wurde.
  const qualitaet   = kmw != null ? kmwZuQualitaet(kmw) : 'qualitaetswein'
  const notizen     = (formData.get('notizen') as string) || null
  const mengeKgRaw  = formData.get('menge_kg') as string | null
  const mengeKg     = mengeKgRaw ? Number(mengeKgRaw.replace(',', '.')) : null

  // Proportionale Aufteilung nach Fläche (ha); Fallback: gleichmäßig
  function splitKg(total: number | null, areas: (number | null)[]): (number | null)[] {
    if (!total || areas.length === 0) return areas.map(() => null)
    const validAreas = areas.filter((a): a is number => a != null && a > 0)
    if (validAreas.length === 0) {
      const each = Math.round(total / areas.length)
      return areas.map(() => each)
    }
    const totalArea = validAreas.reduce((s, a) => s + a, 0)
    const result = areas.map(a => (a ?? 0) > 0 ? Math.floor(total * ((a as number) / totalArea)) : 0)
    // Restkilos auf das erste GST draufrechnen
    const diff = total - result.reduce((s, v) => s + (v ?? 0), 0)
    if (diff > 0 && result.length > 0) result[0] = (result[0] ?? 0) + diff
    return result
  }

  const base = { jahrgang_id: jahrgangId, ernte_datum: ernteDatum, oechsle: null, klosterneuburger: kmw, qualitaetsstufe: qualitaet, lesemethode, notizen }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: AR[] = []

  // Ganze Rieden → GSTs aus DB laden, Menge proportional aufteilen
  for (const wgId of weingartenIds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gsts } = await (supabase.from('grundstuecke') as any)
      .select('id, flaeche_ha, trauben_herkunft_code, rebsorte').eq('weingarten_id', wgId).eq('status', 'aktiv').eq('tenant_id', tenantId).order('gst_nr')
    const gstList = (gsts ?? []) as AR[]
    if (gstList.length === 0) {
      // Keine GSTs → eine Zeile für die ganze Ried (kein GST-Herkunft-Code verfügbar)
      rows.push({ ...base, weingarten_id: wgId, grundstueck_id: null, menge_kg: mengeKg, menge_hl: mengeKg ? mengeKg / 130 : null })
    } else {
      const mengen = splitKg(mengeKg, gstList.map((g: AR) => g.flaeche_ha ?? null))
      gstList.forEach((g: AR, i: number) => {
        const kg = mengen[i]
        const passend = findePassendeHerkunftsstufe(g.trauben_herkunft_code ?? null, g.rebsorte ?? null)
        rows.push({
          ...base, weingarten_id: wgId, grundstueck_id: g.id, menge_kg: kg, menge_hl: kg ? kg / 130 : null,
          herkunft_code: passend.code,
          notizen: passend.abgestuft
            ? [base.notizen, `Herkunft-Code automatisch abgestuft auf ${HERKUNFT_LABEL[passend.code ?? ''] ?? passend.code} (Sortenspiegel: ${g.rebsorte ?? 'unbekannte Rebsorte'})`].filter(Boolean).join('\n')
            : base.notizen,
        })
      })
    }
  }

  // Einzelne GSTs → nach Weingarten gruppieren, Menge proportional aufteilen
  const gstsByWG = new Map<string, GSTEntry[]>()
  for (const g of gstEntries) {
    const arr = gstsByWG.get(g.weingarten_id) ?? []; arr.push(g); gstsByWG.set(g.weingarten_id, arr)
  }
  // Herkunft-Code + Rebsorte der referenzierten GSTs nachladen (nicht Teil des Frontend-Payloads)
  const alleGstIds = gstEntries.map(g => g.gst_id).filter(Boolean)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: gstStammdaten } = alleGstIds.length > 0
    ? await (supabase.from('grundstuecke') as any).select('id, trauben_herkunft_code, rebsorte').in('id', alleGstIds).eq('tenant_id', tenantId)
    : { data: [] }
  const gstStammdatenMap = new Map<string, AR>(((gstStammdaten ?? []) as AR[]).map((g: AR) => [g.id, g]))

  for (const [wgId, wgGsts] of gstsByWG) {
    const mengen = splitKg(mengeKg, wgGsts.map(g => g.flaeche_ha))
    wgGsts.forEach((g, i) => {
      const kg = g.menge_kg != null ? g.menge_kg : mengen[i]
      const perKmw = g.kmw != null ? g.kmw : kmw
      const perQualitaet = perKmw != null ? kmwZuQualitaet(perKmw) : qualitaet
      const perLesemethode = g.lesemethode ?? lesemethode
      const perNotizen = g.notizen ?? notizen
      const gstStamm = gstStammdatenMap.get(g.gst_id)
      const passend = findePassendeHerkunftsstufe(gstStamm?.trauben_herkunft_code ?? null, gstStamm?.rebsorte ?? null)
      const finaleNotizen = passend.abgestuft
        ? [perNotizen, `Herkunft-Code automatisch abgestuft auf ${HERKUNFT_LABEL[passend.code ?? ''] ?? passend.code} (Sortenspiegel: ${gstStamm?.rebsorte ?? 'unbekannte Rebsorte'})`].filter(Boolean).join('\n')
        : perNotizen
      rows.push({
        ...base,
        weingarten_id: wgId, grundstueck_id: g.gst_id,
        menge_kg: kg, menge_hl: kg ? kg / 130 : null,
        klosterneuburger: perKmw, qualitaetsstufe: perQualitaet, lesemethode: perLesemethode, notizen: finaleNotizen,
        herkunft_code: passend.code,
      })
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('ernte_parzellen') as any).insert(rows)
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

export async function deleteErnteParzelle(id: string, jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('ernte_parzellen') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

// ── AMA Meldung ───────────────────────────────────────────────────────────────

export async function createOrUpdateAMAMeldung(jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Ernte-Parzellen laden mit Weingarten+Rebsorte+Grundstück (für korrekte Flächenzuordnung)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parzellen } = await (supabase.from('ernte_parzellen') as any)
    .select('menge_kg, menge_hl, grundstueck_id, weingarten:weingarten_id(name, rebsorte, flaeche_ha, weinbaugebiet), grundstueck:grundstueck_id(flaeche_ha)')
    .eq('jahrgang_id', jahrgangId)

  const gesamtKg = (parzellen as AR[] ?? []).reduce((s: number, p: AR) => s + (p.menge_kg ?? 0), 0)
  const gesamtHl = gesamtKg / 130

  // Betriebsnummer liegt auf tenant_einstellungen (nicht auf tenants); Weinbaugebiet gibt es
  // nur auf Ried-/Grundstücksebene – aus den geernteten Rieden ableiten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('betrieb_betriebsnummer').eq('tenant_id', tenantId).maybeSingle()
  const weinbaugebiete = [...new Set(
    ((parzellen as AR[] ?? []).map(p => (p.weingarten as AR | null)?.weinbaugebiet).filter(Boolean))
  )] as string[]
  const tenant = {
    betriebsnummer: (einst as AR | null)?.betrieb_betriebsnummer ?? null,
    weinbaugebiet:  weinbaugebiete.length === 1 ? weinbaugebiete[0] : (weinbaugebiete[0] ?? null),
  }

  // Meldung anlegen oder aktualisieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from('ama_erntemeldungen') as any)
    .select('id').eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId).maybeSingle()

  const meldungPayload: AR = {
    tenant_id:       tenantId,
    jahrgang_id:     jahrgangId,
    betriebsnummer:  (tenant as AR)?.betriebsnummer ?? null,
    weinbaugebiet:   (tenant as AR)?.weinbaugebiet ?? null,
    gesamtmenge_kg:  gesamtKg,
    gesamtmenge_hl:  gesamtHl,
    status:          'bereit',
  }

  let meldungId: string
  if (existing) {
    meldungId = (existing as AR).id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_erntemeldungen') as any).update(meldungPayload).eq('id', meldungId).eq('tenant_id', tenantId)
    // Positionen löschen und neu aufbauen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_meldepositionen') as any).delete().eq('meldung_id', meldungId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neu } = await (supabase.from('ama_erntemeldungen') as any)
      .insert(meldungPayload).eq('tenant_id', tenantId).select('id').single()
    meldungId = (neu as AR).id
  }

  // Positionen je Rebsorte aggregieren
  // WICHTIG: die Fläche der Zeile ist die des jeweiligen Grundstücks (falls gesetzt),
  // NICHT die volle Ried-Fläche – sonst wird die Fläche bei GST-Aufteilung mehrfach gezählt.
  const rebsortenMap = new Map<string, AR>()
  for (const p of (parzellen as AR[] ?? [])) {
    const wg  = p.weingarten as AR
    const gst = p.grundstueck as AR | null
    const key = wg?.rebsorte ?? 'Unbekannt'
    const zeilenFlaeche = p.grundstueck_id ? (gst?.flaeche_ha ?? 0) : (wg?.flaeche_ha ?? 0)
    const curr = rebsortenMap.get(key) ?? { rebsorte_name: key, flaeche_ha: 0, menge_kg: 0 }
    curr.flaeche_ha += zeilenFlaeche
    curr.menge_kg   += p.menge_kg ?? 0
    rebsortenMap.set(key, curr)
  }

  const positionen = Array.from(rebsortenMap.values()).map(r => ({
    meldung_id:     meldungId,
    rebsorte_name:  r.rebsorte_name,
    flaeche_ha:     r.flaeche_ha,
    menge_kg:       r.menge_kg,
    qualitaetsstufe: 'qualitaetswein',
  }))

  if (positionen.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_meldepositionen') as any).insert(positionen)
  }

  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

// ── Pressungen ────────────────────────────────────────────────────────────────

type PressungWGInput    = { weingarten_id?: string; grundstueck_id?: string | null; zukauf_posten_id?: string; trauben_kg: number; rebsorte?: string; notizen?: string }
type PressungBehInput   = { behaelter_id?: string; weinausbau_id?: string; menge_liter?: number; notizen?: string }

export async function upsertPressung(fd: FormData): Promise<{ neu: { behaelter_id: string; weinausbau_id: string; name: string; menge_liter: number | null; qualitaetsstufe: string | null; herkunft_code: string | null }[] }> {
  const supabase    = await createSupabaseServerClient()
  const tenantId    = await getTenantId()
  const jahrgangId  = fd.get('jahrgang_id') as string
  const existingId  = (fd.get('existing_id') as string) || null
  const datum            = fd.get('datum') as string
  const mostLiter        = fd.get('most_liter_gesamt') ? parseFloat((fd.get('most_liter_gesamt') as string).replace(',', '.')) : null
  const weinbezeichnung  = (fd.get('weinbezeichnung') as string) || null
  const kmwRaw           = (fd.get('kmw_grad') as string || '').replace(',', '.')
  const kmwGrad          = kmwRaw ? parseFloat(kmwRaw) : null
  const notizen          = (fd.get('notizen') as string) || null
  const qualitaetsstufeInput = (fd.get('qualitaetsstufe') as string) || null
  const wgJson      = fd.get('weingaerten_json') as string
  const behJson     = fd.get('behaelter_json') as string
  const weingaerten = JSON.parse(wgJson || '[]') as PressungWGInput[]
  const behaelter   = JSON.parse(behJson || '[]') as PressungBehInput[]

  let pressId: string

  if (existingId) {
    pressId = existingId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pressungen') as any).update({ datum, most_liter_gesamt: mostLiter, weinbezeichnung, kmw_grad: kmwGrad, notizen }).eq('id', existingId).eq('tenant_id', tenantId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pressung_weingaerten') as any).delete().eq('pressung_id', existingId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pressung_behaelter') as any).delete().eq('pressung_id', existingId)
    if (weingaerten.length > 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('pressung_weingaerten') as any).insert(weingaerten.map(w => ({ pressung_id: existingId, ...w })))
    if (behaelter.length > 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('pressung_behaelter') as any).insert(behaelter.map(b => ({ pressung_id: existingId, ...b, behaelter_id: b.behaelter_id || null, weinausbau_id: b.weinausbau_id || null })))
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neu } = await (supabase.from('pressungen') as any)
      .insert({ tenant_id: tenantId, jahrgang_id: jahrgangId, datum, most_liter_gesamt: mostLiter, weinbezeichnung, kmw_grad: kmwGrad, notizen })
      .eq('tenant_id', tenantId)
      .select('id').single()
    pressId = (neu as AR).id
    if (weingaerten.length > 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('pressung_weingaerten') as any).insert(weingaerten.map(w => ({ pressung_id: pressId, ...w })))
    if (behaelter.length > 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('pressung_behaelter') as any).insert(behaelter.map(b => ({ pressung_id: pressId, ...b, behaelter_id: b.behaelter_id || null, weinausbau_id: b.weinausbau_id || null })))
  }

  // ── Lesedaten sync: kg aus Pressung in ernte_parzellen übertragen ───────────
  // Nur Zeilen ohne gesetztes menge_kg werden befüllt (bestehende Werte bleiben)
  for (const w of weingaerten) {
    // Zukauf-Trauben (kein weingarten_id) haben keine eigene Lese-Zeile zum Sync
    if (!w.trauben_kg || !w.weingarten_id) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('ernte_parzellen') as any)
      .update({ menge_kg: w.trauben_kg, menge_hl: w.trauben_kg / 130 })
      .eq('jahrgang_id', jahrgangId)
      .eq('weingarten_id', w.weingarten_id)
      .is('menge_kg', null)
    // Wenn die Pressung ein konkretes Grundstück referenziert, NUR dessen Ernte-Zeile
    // aktualisieren – sonst würden andere, noch offene Grundstücke desselben Rieds
    // fälschlich mit überschrieben.
    if (w.grundstueck_id) q = q.eq('grundstueck_id', w.grundstueck_id)
    await q
  }

  // ── Auto-Weinausbau: Kellerbuch-Charge für jeden Behälter-Eintrag ──────────
  const neuChargen: { behaelter_id: string; weinausbau_id: string; name: string; menge_liter: number | null; qualitaetsstufe: string | null; herkunft_code: string | null }[] = []
  // Jahrgang-Jahr für Bezeichnung laden
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jgData } = await (supabase.from('weinjahrgaenge') as any)
    .select('jahrgang, qualitaet_gesamt').eq('id', jahrgangId).eq('tenant_id', tenantId).single()
  const jgJahr      = (jgData as AR)?.jahrgang as number | null
  const jgQualitaet = (jgData as AR)?.qualitaet_gesamt as string | null
  // Qualität: User-Input > KMW-Ableitung > Fallback 'qualitaetswein'
  // ACHTUNG: jgQualitaet enthält Vintage-Bewertungen ('sehr_gut' etc.) – NICHT als qualitaetsstufe verwenden!
  const autoQualitaet = qualitaetsstufeInput
    ?? (kmwGrad != null && !isNaN(kmwGrad) ? kmwZuQualitaet(kmwGrad) : 'qualitaetswein')

  // Herkunft-Code (BKI): niedrigster (breitester) Wert der verknüpften Ernte-Parzellen übernehmen
  // (analog Qualität – Verschneiden/Pressen kann Herkunft nur ab-, nie aufstufen).
  let autoHerkunft: string | null = null
  if (weingaerten.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: epRows } = await (supabase.from('ernte_parzellen') as any)
      .select('herkunft_code, weingarten_id, grundstueck_id').eq('jahrgang_id', jahrgangId)
    const epList = ((epRows ?? []) as AR[])
    const passendeCodes = weingaerten.map(w => {
      const match = epList.find((e: AR) =>
        e.weingarten_id === w.weingarten_id &&
        (w.grundstueck_id ? e.grundstueck_id === w.grundstueck_id : true)
      )
      return match?.herkunft_code as string | null ?? null
    })
    autoHerkunft = minHerkunft(passendeCodes)
  }

  // Rebsorte + Weinart ableiten aus Weingarten-Tabelle
  const rebsortenAusForm = weingaerten.map(w => w.rebsorte).filter((r): r is string => !!r)
  let dominantRebsorte: string | null = null
  let autoWeinart: string = 'unbekannt'
  if (weingaerten.length > 0) {
    const wgIds  = weingaerten.map(w => w.weingarten_id).filter(Boolean) as string[]
    const gstIds = weingaerten.map(w => w.grundstueck_id).filter(Boolean) as string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: wgRows } = await (supabase.from('weingarten') as any).select('rebsorte, weinart').in('id', wgIds).eq('tenant_id', tenantId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gstRows } = gstIds.length > 0
      ? await (supabase.from('grundstuecke') as any).select('weinart').in('id', gstIds).eq('tenant_id', tenantId)
      : { data: [] }
    const wgArr  = ((wgRows  ?? []) as AR[])
    const gstArr = ((gstRows ?? []) as AR[])
    // Rebsorte
    const wgRebsorten = wgArr.map((w: AR) => w.rebsorte).filter(Boolean) as string[]
    const allRebsorten = rebsortenAusForm.length > 0 ? rebsortenAusForm : wgRebsorten
    const uniqueRebsorten = [...new Set(allRebsorten)]
    dominantRebsorte = uniqueRebsorten.length === 1 ? uniqueRebsorten[0] : uniqueRebsorten.length > 1 ? 'Sortenverschnitt' : null
    // Weinart: GST hat Vorrang vor Weingarten; eindeutig → übernehmen; gemischt → 'unbekannt'
    const weinartQuellen = gstArr.length > 0 ? gstArr : wgArr
    const uniqueWeinart = [...new Set(weinartQuellen.map((w: AR) => w.weinart).filter((a: string) => a && a !== 'unbekannt'))]
    if (uniqueWeinart.length === 1) autoWeinart = uniqueWeinart[0] as string
  } else if (rebsortenAusForm.length > 0) {
    const unique = [...new Set(rebsortenAusForm)]
    dominantRebsorte = unique.length === 1 ? unique[0] : 'Sortenverschnitt'
  }
  const autoName = weinbezeichnung
    ? weinbezeichnung
    : dominantRebsorte
      ? dominantRebsorte
      : `Pressung ${new Date(datum).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })}`

  for (const beh of behaelter) {
    if (!beh.behaelter_id) continue
    if (beh.weinausbau_id) {
      // Bestehende Charge aktualisieren – auch rebsorte + qualitaetsstufe mitschreiben
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('weinausbau') as any)
        .update({
          name:            autoName,
          menge_liter:     beh.menge_liter ?? null,
          rebsorte:        dominantRebsorte,
          qualitaetsstufe: autoQualitaet,
          herkunft_code:   autoHerkunft,
          weinart:         autoWeinart !== 'unbekannt' ? autoWeinart : undefined,
        })
        .eq('id', beh.weinausbau_id)
        .eq('tenant_id', tenantId)
    } else {
      // Neue Charge für diesen Behälter anlegen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: neuWA, error: waErr } = await (supabase.from('weinausbau') as any)
        .insert({
          tenant_id:       tenantId,
          name:            autoName,
          jahrgang:        jgJahr,
          rebsorte:        dominantRebsorte,
          menge_liter:     beh.menge_liter ?? null,
          status:          'ausbau',
          behaelter_id:    beh.behaelter_id,
          qualitaetsstufe: autoQualitaet,
          herkunft_code:   autoHerkunft,
          weinart:         autoWeinart,
          aktiv:           true,
        })
        .eq('tenant_id', tenantId)
        .select('id').single()
      if (waErr) throw new Error(`Kellerbuch-Charge konnte nicht angelegt werden: ${waErr.message}`)
      if (neuWA) {
        const newId = (neuWA as AR).id as string
        // Rückverknüpfung: pressung_behaelter.weinausbau_id setzen
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('pressung_behaelter') as any)
          .update({ weinausbau_id: newId })
          .eq('pressung_id', pressId)
          .eq('behaelter_id', beh.behaelter_id)
        neuChargen.push({ behaelter_id: beh.behaelter_id, weinausbau_id: newId, name: autoName, menge_liter: beh.menge_liter ?? null, qualitaetsstufe: autoQualitaet, herkunft_code: autoHerkunft })
      }
    }
  }

  revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/kellerbuch')
  return { neu: neuChargen }
}

export async function deletePressung(id: string, jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // Auto-erstellte Weinausbau-Chargen mitlöschen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: behRows } = await (supabase.from('pressung_behaelter') as any)
    .select('weinausbau_id').eq('pressung_id', id)
  const waIds = ((behRows ?? []) as AR[]).map((b: AR) => b.weinausbau_id).filter(Boolean)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (waIds.length > 0) await (supabase.from('weinausbau') as any).delete().in('id', waIds).eq('tenant_id', tenantId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('pressungen') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/kellerbuch')
}

export async function deleteJahrgang(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // Cascade-Reihenfolge (FK ohne ON DELETE CASCADE)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pressIds } = await (supabase.from('pressungen') as any).select('id').eq('jahrgang_id', id).eq('tenant_id', tenantId)
  for (const p of ((pressIds ?? []) as AR[])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pressung_weingaerten') as any).delete().eq('pressung_id', p.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pressung_behaelter') as any).delete().eq('pressung_id', p.id)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('pressungen') as any).delete().eq('jahrgang_id', id).eq('tenant_id', tenantId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ama } = await (supabase.from('ama_erntemeldungen') as any).select('id').eq('jahrgang_id', id).eq('tenant_id', tenantId)
  for (const a of ((ama ?? []) as AR[])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_meldepositionen') as any).delete().eq('meldung_id', a.id)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('ama_erntemeldungen') as any).delete().eq('jahrgang_id', id).eq('tenant_id', tenantId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('ernte_parzellen') as any).delete().eq('jahrgang_id', id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/erntemeldung')
}

// ── Traubenverkauf ────────────────────────────────────────────────────────────

export async function createTraubenverkauf(fd: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Liefernummer auto-generieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lnData } = await (supabase.rpc as any)('get_next_liefernummer', { p_tenant_id: tenantId })
  const liefernummer = lnData as string | null

  const jahrgangId   = fd.get('jahrgang_id') as string | null
  const weingartenId = (fd.get('weingarten_id') as string) || null
  const zukaufPostenId = (fd.get('zukauf_posten_id') as string) || null
  const grundstueckId = (fd.get('grundstueck_id') as string) || null
  const mengeKg      = parseFloat((fd.get('menge_kg') as string).replace(',', '.'))
  const preisPerKg   = fd.get('preis_per_kg') ? parseFloat((fd.get('preis_per_kg') as string).replace(',', '.')) : null
  const kontaktId    = (fd.get('kontakt_id') as string) || null
  const firmaId      = (fd.get('firma_id') as string) || null
  const datum        = fd.get('datum') as string

  const weingartenName = await ermittleQuellenName(supabase, weingartenId, zukaufPostenId, tenantId)

  const payload: AR = {
    tenant_id:       tenantId,
    jahrgang_id:     jahrgangId || null,
    weingarten_id:   weingartenId,
    zukauf_posten_id: zukaufPostenId,
    grundstueck_id:  grundstueckId,
    kontakt_id:      kontaktId,
    firma_id:        firmaId,
    datum,
    menge_kg:        mengeKg,
    preis_per_kg:    preisPerKg,
    kmw_grad:        fd.get('kmw_grad') ? parseFloat((fd.get('kmw_grad') as string).replace(',', '.')) : null,
    qualitaetsstufe: (fd.get('qualitaetsstufe') as string) || null,
    gesundheit:      (fd.get('gesundheit') as string) || 'G',
    herkunft_code:   (fd.get('herkunft_code') as string) || null,
    notizen:         (fd.get('notizen') as string) || null,
    liefernummer,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error } = await (supabase.from('traubenverkauf') as any).insert(payload).eq('tenant_id', tenantId).select('id').single()
  if (error) throw new Error((error as AR).message)

  // Verkaufsposten anlegen, damit der Traubenverkauf auch in der Buchhaltung/Rechnungsübersicht auftaucht
  // (dieselbe Logik wie weinhandel/traubenverkauf, damit beide Erfassungswege konsistent sind)
  const postenId = await createVerkaufspostenFuerTrauben(supabase, tenantId, {
    datum, kontaktId, firmaId, weingartenName, mengeKg, preisPerKg,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('traubenverkauf') as any).update({ verkaufsposten_id: postenId }).eq('id', (inserted as AR).id).eq('tenant_id', tenantId)

  if (jahrgangId) revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
  revalidatePath('/weinhandel/verkauf')
}

export async function updateTraubenverkauf(id: string, fd: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const jahrgangId    = fd.get('jahrgang_id') as string | null
  const weingartenId  = (fd.get('weingarten_id') as string) || null
  const zukaufPostenId = (fd.get('zukauf_posten_id') as string) || null
  const grundstueckId = (fd.get('grundstueck_id') as string) || null
  const mengeKg       = parseFloat((fd.get('menge_kg') as string).replace(',', '.'))
  const preisPerKg    = fd.get('preis_per_kg') ? parseFloat((fd.get('preis_per_kg') as string).replace(',', '.')) : null
  const kontaktId     = (fd.get('kontakt_id') as string) || null
  const firmaId       = (fd.get('firma_id') as string) || null
  const datum         = fd.get('datum') as string

  const payload: AR = {
    weingarten_id:   weingartenId,
    zukauf_posten_id: zukaufPostenId,
    grundstueck_id:  grundstueckId,
    kontakt_id:      kontaktId,
    firma_id:        firmaId,
    datum,
    menge_kg:        mengeKg,
    preis_per_kg:    preisPerKg,
    kmw_grad:        fd.get('kmw_grad') ? parseFloat((fd.get('kmw_grad') as string).replace(',', '.')) : null,
    qualitaetsstufe: (fd.get('qualitaetsstufe') as string) || null,
    gesundheit:      (fd.get('gesundheit') as string) || 'G',
    herkunft_code:   (fd.get('herkunft_code') as string) || null,
    notizen:         (fd.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tvAlt } = await (supabase.from('traubenverkauf') as any).select('verkaufsposten_id').eq('id', id).eq('tenant_id', tenantId).single()
  const altPostenId = (tvAlt as AR | null)?.verkaufsposten_id as string | null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('traubenverkauf') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)

  const weingartenName = await ermittleQuellenName(supabase, weingartenId, zukaufPostenId, tenantId)
  const verkaufsOpts = { datum, kontaktId, firmaId, weingartenName, mengeKg, preisPerKg }

  if (!altPostenId) {
    // Bisher noch kein Verkaufsposten verknüpft (z.B. vor diesem Fix angelegte Zeile) -> jetzt nachziehen
    const postenId = await createVerkaufspostenFuerTrauben(supabase, tenantId, verkaufsOpts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('traubenverkauf') as any).update({ verkaufsposten_id: postenId }).eq('id', id).eq('tenant_id', tenantId)
  }

  if (jahrgangId) revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
  revalidatePath('/weinhandel/verkauf')
}

export async function deleteTraubenverkauf(id: string, jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('traubenverkauf') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
}
