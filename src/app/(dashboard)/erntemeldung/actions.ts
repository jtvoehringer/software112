'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { kmwZuQualitaet } from '@/lib/weinqualitaet'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenant_memberships').select('tenant_id').limit(1).single()
  const id = (data as AR | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

// ── Jahrgänge ─────────────────────────────────────────────────────────────────

export async function createJahrgang(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).insert({
    tenant_id:   tenantId,
    jahrgang:    Number(formData.get('jahrgang')),
    ernte_beginn: (formData.get('ernte_beginn') as string) || null,
    ernte_ende:   (formData.get('ernte_ende') as string) || null,
    notizen:      (formData.get('notizen') as string) || null,
  })
  if (error) throw new Error((error as AR).message)
  revalidatePath('/erntemeldung')
}

export async function updateJahrgang(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).update({
    ernte_beginn:        (formData.get('ernte_beginn') as string) || null,
    ernte_ende:          (formData.get('ernte_ende') as string) || null,
    qualitaet_gesamt:    (formData.get('qualitaet_gesamt') as string) || null,
    witterungscharakter: (formData.get('witterungscharakter') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
  }).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/erntemeldung')
  revalidatePath(`/erntemeldung/${id}`)
}

// ── Ernte-Parzellen ───────────────────────────────────────────────────────────

export async function upsertErnteParzelle(jahrgangId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const weingartenId = formData.get('weingarten_id') as string
  const mengeKg = formData.get('menge_kg') ? Number(formData.get('menge_kg')) : null
  const mengeHl = mengeKg ? mengeKg / 130 : null  // 1 hl ≈ 130 kg

  const payload: AR = {
    jahrgang_id:      jahrgangId,
    weingarten_id:    weingartenId,
    ernte_datum:      (formData.get('ernte_datum') as string) || null,
    menge_kg:         mengeKg,
    menge_hl:         mengeHl,
    oechsle:          formData.get('oechsle') ? Number(formData.get('oechsle')) : null,
    klosterneuburger: formData.get('klosterneuburger') ? Number(formData.get('klosterneuburger')) : null,
    qualitaetsstufe:  (formData.get('qualitaetsstufe') as string) || null,
    lesemethode:      (formData.get('lesemethode') as string) || null,
    notizen:          (formData.get('notizen') as string) || null,
    grundstueck_id:   (formData.get('grundstueck_id') as string) || null,
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
  const weingartenIds = formData.getAll('weingarten_ids') as string[]

  type GSTEntry = { gst_id: string; weingarten_id: string; flaeche_ha: number | null; menge_kg?: number | null; kmw?: number | null; notizen?: string | null }
  const gstJsonRaw = formData.get('grundstueck_json') as string | null
  const gstEntries: GSTEntry[] = gstJsonRaw ? JSON.parse(gstJsonRaw) : []

  if (weingartenIds.length === 0 && gstEntries.length === 0) {
    throw new Error('Mindestens eine Ried oder ein Grundstück auswählen')
  }

  const ernteDatum  = (formData.get('ernte_datum') as string) || null
  const lesemethode = (formData.get('lesemethode') as string) || null
  const kmw         = formData.get('klosterneuburger') ? Number(formData.get('klosterneuburger')) : null
  const qualitaet   = (formData.get('qualitaetsstufe') as string) || null
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
      .select('id, flaeche_ha').eq('weingarten_id', wgId).eq('status', 'aktiv').order('gst_nr')
    const gstList = (gsts ?? []) as AR[]
    if (gstList.length === 0) {
      // Keine GSTs → eine Zeile für die ganze Ried
      rows.push({ ...base, weingarten_id: wgId, grundstueck_id: null, menge_kg: mengeKg, menge_hl: mengeKg ? mengeKg / 130 : null })
    } else {
      const mengen = splitKg(mengeKg, gstList.map((g: AR) => g.flaeche_ha ?? null))
      gstList.forEach((g: AR, i: number) => {
        const kg = mengen[i]
        rows.push({ ...base, weingarten_id: wgId, grundstueck_id: g.id, menge_kg: kg, menge_hl: kg ? kg / 130 : null })
      })
    }
  }

  // Einzelne GSTs → nach Weingarten gruppieren, Menge proportional aufteilen
  const gstsByWG = new Map<string, GSTEntry[]>()
  for (const g of gstEntries) {
    const arr = gstsByWG.get(g.weingarten_id) ?? []; arr.push(g); gstsByWG.set(g.weingarten_id, arr)
  }
  for (const [wgId, wgGsts] of gstsByWG) {
    const mengen = splitKg(mengeKg, wgGsts.map(g => g.flaeche_ha))
    wgGsts.forEach((g, i) => {
      const kg = g.menge_kg != null ? g.menge_kg : mengen[i]
      const perKmw = g.kmw != null ? g.kmw : kmw
      const perQualitaet = perKmw != null ? kmwZuQualitaet(perKmw) : qualitaet
      const perNotizen = g.notizen ?? notizen
      rows.push({
        ...base,
        weingarten_id: wgId, grundstueck_id: g.gst_id,
        menge_kg: kg, menge_hl: kg ? kg / 130 : null,
        klosterneuburger: perKmw, qualitaetsstufe: perQualitaet, notizen: perNotizen,
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

  // Ernte-Parzellen laden mit Weingarten+Rebsorte
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parzellen } = await (supabase.from('ernte_parzellen') as any)
    .select('menge_kg, menge_hl, weingarten:weingarten_id(name, rebsorte, flaeche_ha)')
    .eq('jahrgang_id', jahrgangId)

  const gesamtKg = (parzellen as AR[] ?? []).reduce((s: number, p: AR) => s + (p.menge_kg ?? 0), 0)
  const gesamtHl = gesamtKg / 130

  // Tenant-Daten (Betriebsnummer)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tenant } = await (supabase.from('tenants') as any)
    .select('name, betriebsnummer, weinbaugebiet').eq('id', tenantId).single()

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
    await (supabase.from('ama_erntemeldungen') as any).update(meldungPayload).eq('id', meldungId)
    // Positionen löschen und neu aufbauen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_meldepositionen') as any).delete().eq('meldung_id', meldungId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neu } = await (supabase.from('ama_erntemeldungen') as any)
      .insert(meldungPayload).select('id').single()
    meldungId = (neu as AR).id
  }

  // Positionen je Rebsorte aggregieren
  const rebsortenMap = new Map<string, AR>()
  for (const p of (parzellen as AR[] ?? [])) {
    const wg = p.weingarten as AR
    const key = wg?.rebsorte ?? 'Unbekannt'
    const curr = rebsortenMap.get(key) ?? { rebsorte_name: key, flaeche_ha: 0, menge_kg: 0 }
    curr.flaeche_ha += wg?.flaeche_ha ?? 0
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

type PressungWGInput    = { weingarten_id: string; grundstueck_id?: string | null; trauben_kg: number; rebsorte?: string; notizen?: string }
type PressungBehInput   = { behaelter_id?: string; weinausbau_id?: string; menge_liter?: number; notizen?: string }

export async function upsertPressung(fd: FormData): Promise<{ neu: { behaelter_id: string; weinausbau_id: string; name: string; menge_liter: number | null }[] }> {
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
    await (supabase.from('pressungen') as any).update({ datum, most_liter_gesamt: mostLiter, weinbezeichnung, kmw_grad: kmwGrad, notizen }).eq('id', existingId)
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
    if (!w.trauben_kg) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ernte_parzellen') as any)
      .update({ menge_kg: w.trauben_kg, menge_hl: w.trauben_kg / 130 })
      .eq('jahrgang_id', jahrgangId)
      .eq('weingarten_id', w.weingarten_id)
      .is('menge_kg', null)
  }

  // ── Auto-Weinausbau: Kellerbuch-Charge für jeden Behälter-Eintrag ──────────
  const neuChargen: { behaelter_id: string; weinausbau_id: string; name: string; menge_liter: number | null }[] = []
  // Jahrgang-Jahr für Bezeichnung laden
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jgData } = await (supabase.from('weinjahrgaenge') as any)
    .select('jahrgang, qualitaet_gesamt').eq('id', jahrgangId).single()
  const jgJahr      = (jgData as AR)?.jahrgang as number | null
  const jgQualitaet = (jgData as AR)?.qualitaet_gesamt as string | null
  // Qualität: User-Input > KMW-Ableitung > Fallback 'qualitaetswein'
  // ACHTUNG: jgQualitaet enthält Vintage-Bewertungen ('sehr_gut' etc.) – NICHT als qualitaetsstufe verwenden!
  const autoQualitaet = qualitaetsstufeInput
    ?? (kmwGrad != null && !isNaN(kmwGrad) ? kmwZuQualitaet(kmwGrad) : 'qualitaetswein')

  // Rebsorte + Weinart ableiten aus Weingarten-Tabelle
  const rebsortenAusForm = weingaerten.map(w => w.rebsorte).filter((r): r is string => !!r)
  let dominantRebsorte: string | null = null
  let autoWeinart: string = 'unbekannt'
  if (weingaerten.length > 0) {
    const wgIds  = weingaerten.map(w => w.weingarten_id).filter(Boolean) as string[]
    const gstIds = weingaerten.map(w => w.grundstueck_id).filter(Boolean) as string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: wgRows } = await (supabase.from('weingarten') as any).select('rebsorte, weinart').in('id', wgIds)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gstRows } = gstIds.length > 0
      ? await (supabase.from('grundstuecke') as any).select('weinart').in('id', gstIds)
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
      // Bestehende Charge aktualisieren (Name/Menge könnte sich geändert haben)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('weinausbau') as any)
        .update({ name: autoName, menge_liter: beh.menge_liter ?? null })
        .eq('id', beh.weinausbau_id)
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
          status:          'gaerung',
          behaelter_id:    beh.behaelter_id,
          qualitaetsstufe: autoQualitaet,
          weinart:         autoWeinart,
          aktiv:           true,
        })
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
        neuChargen.push({ behaelter_id: beh.behaelter_id, weinausbau_id: newId, name: autoName, menge_liter: beh.menge_liter ?? null })
      }
    }
  }

  revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/kellerbuch')
  return { neu: neuChargen }
}

export async function deletePressung(id: string, jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  // Auto-erstellte Weinausbau-Chargen mitlöschen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: behRows } = await (supabase.from('pressung_behaelter') as any)
    .select('weinausbau_id').eq('pressung_id', id)
  const waIds = ((behRows ?? []) as AR[]).map((b: AR) => b.weinausbau_id).filter(Boolean)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (waIds.length > 0) await (supabase.from('weinausbau') as any).delete().in('id', waIds)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('pressungen') as any).delete().eq('id', id)
  revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/kellerbuch')
}

export async function deleteJahrgang(id: string) {
  const supabase = await createSupabaseServerClient()
  // Cascade-Reihenfolge (FK ohne ON DELETE CASCADE)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pressIds } = await (supabase.from('pressungen') as any).select('id').eq('jahrgang_id', id)
  for (const p of ((pressIds ?? []) as AR[])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pressung_weingaerten') as any).delete().eq('pressung_id', p.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pressung_behaelter') as any).delete().eq('pressung_id', p.id)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('pressungen') as any).delete().eq('jahrgang_id', id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ama } = await (supabase.from('ama_erntemeldungen') as any).select('id').eq('jahrgang_id', id)
  for (const a of ((ama ?? []) as AR[])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_meldepositionen') as any).delete().eq('meldung_id', a.id)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('ama_erntemeldungen') as any).delete().eq('jahrgang_id', id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('ernte_parzellen') as any).delete().eq('jahrgang_id', id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).delete().eq('id', id)
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

  const jahrgangId = fd.get('jahrgang_id') as string | null
  const payload: AR = {
    tenant_id:       tenantId,
    jahrgang_id:     jahrgangId || null,
    weingarten_id:   fd.get('weingarten_id') as string,
    kontakt_id:      (fd.get('kontakt_id') as string) || null,
    firma_id:        (fd.get('firma_id') as string) || null,
    datum:           fd.get('datum') as string,
    menge_kg:        parseFloat((fd.get('menge_kg') as string).replace(',', '.')),
    preis_per_kg:    fd.get('preis_per_kg') ? parseFloat((fd.get('preis_per_kg') as string).replace(',', '.')) : null,
    kmw_grad:        fd.get('kmw_grad') ? parseFloat((fd.get('kmw_grad') as string).replace(',', '.')) : null,
    qualitaetsstufe: (fd.get('qualitaetsstufe') as string) || null,
    gesundheit:      (fd.get('gesundheit') as string) || 'G',
    herkunft_code:   (fd.get('herkunft_code') as string) || null,
    notizen:         (fd.get('notizen') as string) || null,
    liefernummer,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('traubenverkauf') as any).insert(payload)
  if (error) throw new Error((error as AR).message)
  if (jahrgangId) revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
}

export async function updateTraubenverkauf(id: string, fd: FormData) {
  const supabase = await createSupabaseServerClient()
  const jahrgangId = fd.get('jahrgang_id') as string | null
  const payload: AR = {
    weingarten_id:   fd.get('weingarten_id') as string,
    kontakt_id:      (fd.get('kontakt_id') as string) || null,
    firma_id:        (fd.get('firma_id') as string) || null,
    datum:           fd.get('datum') as string,
    menge_kg:        parseFloat((fd.get('menge_kg') as string).replace(',', '.')),
    preis_per_kg:    fd.get('preis_per_kg') ? parseFloat((fd.get('preis_per_kg') as string).replace(',', '.')) : null,
    kmw_grad:        fd.get('kmw_grad') ? parseFloat((fd.get('kmw_grad') as string).replace(',', '.')) : null,
    qualitaetsstufe: (fd.get('qualitaetsstufe') as string) || null,
    gesundheit:      (fd.get('gesundheit') as string) || 'G',
    herkunft_code:   (fd.get('herkunft_code') as string) || null,
    notizen:         (fd.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('traubenverkauf') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AR).message)
  if (jahrgangId) revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
}

export async function deleteTraubenverkauf(id: string, jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('traubenverkauf') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
}
