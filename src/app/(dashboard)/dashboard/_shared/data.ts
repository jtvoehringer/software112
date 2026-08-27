// ── Datenzugriff der Dashboard-Sichten (Server-only) ─────────────────────────
// Bündelt die Abfragen, die mehrere Sichten teilen (Übersicht greift auf
// Keller-, Verkaufs-, Weingarten- und Fristen-Kennzahlen zu). Alle Abfragen
// sind explizit auf den aktiven Betrieb gefiltert (tf) – zusätzlich zu RLS,
// siehe Kommentar in lib/auth/roles.ts (Mehrfach-Mitgliedschaft).

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, type UserRole } from '@/lib/auth/roles'
import type { Charge, Frist, FristStatus } from './types'
import { periodeVorBeginn } from '@/lib/ea/betriebsbeginn'
export { STATUS_LABEL } from './types'
export type { Charge, Frist, FristStatus } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>

export type Ctx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  tenantId: string | null
  tenantName: string | null
  userId: string | null
  role: UserRole
  heute: Date
  heuteStr: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: (table: string) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tf: (query: any) => any
}

export function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}
export function startOfWeek(d: Date) {
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  const s = new Date(d); s.setDate(d.getDate() + diff); s.setHours(0, 0, 0, 0)
  return s
}

export async function getCtx(): Promise<Ctx> {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const { data: { user } } = await supabase.auth.getUser()
  let tenantName: string | null = null
  if (tenantId) {
    const { data: t } = await (supabase.from('tenants') as any).select('name').eq('id', tenantId).maybeSingle()
    tenantName = (t as R | null)?.name ?? null
  }
  const heute = new Date()
  const q = (table: string) => (supabase.from(table) as any)
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query // eslint-disable-line @typescript-eslint/no-explicit-any
  return { supabase, tenantId, tenantName, userId: user?.id ?? null, role: membership?.role ?? null, heute, heuteStr: toDateStr(heute), q, tf }
}

// ── Verkauf ──────────────────────────────────────────────────────────────────

/** Netto-Umsatz aus Verkaufspositionen inkl. Rabatt/Sonderrabatt (wie bisheriges Dashboard) */
export function posSum(posten: R[]): number {
  return (posten ?? []).reduce((s: number, p: R) => {
    const pos = (p.positionen ?? p.verkauf_positionen ?? []) as R[]
    return s + pos.reduce((ps: number, x: R) => {
      const brutto = (Number(x.preis_brutto) || 0) * (Number(x.menge) || 0)
      return ps + brutto * (1 - (Number(x.rabatt_pct) || 0) / 100) * (1 - (Number(x.sonderrabatt_pct) || 0) / 100)
    }, 0)
  }, 0)
}

// Zahlungsziel-Annahme für "überfällig" (kein eigenes Fälligkeitsfeld im Datenmodell)
export const ZAHLUNGSZIEL_TAGE = 30

export async function ladeOffenePosten(ctx: Ctx) {
  const { data } = await ctx.tf(ctx.q('verkaufsposten')
    .select('id, datum, rechnungsnummer, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name), positionen:verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
    .eq('aktiv', true).eq('bezahlt', false).eq('storniert', false).order('datum', { ascending: true }).limit(300))
  const heuteMs = ctx.heute.getTime()
  const liste = ((data ?? []) as R[]).map(v => ({
    id: v.id as string,
    datum: v.datum as string,
    rechnungsnummer: (v.rechnungsnummer ?? null) as string | null,
    kunde: v.kontakt ? [v.kontakt.vorname, v.kontakt.nachname].filter(Boolean).join(' ') : (v.firma?.name ?? '–') as string,
    betrag: posSum([v]),
    tage: Math.floor((heuteMs - new Date(v.datum).getTime()) / 86400000),
  }))
  const ueberfaellig = liste.filter(v => v.tage > ZAHLUNGSZIEL_TAGE)
  return {
    liste,
    summe: liste.reduce((s, v) => s + v.betrag, 0),
    anzahl: liste.length,
    ueberfaellig: ueberfaellig.length,
    ueberfaelligSumme: ueberfaellig.reduce((s, v) => s + v.betrag, 0),
    avgTage: liste.length ? Math.round(liste.reduce((s, v) => s + v.tage, 0) / liste.length) : 0,
  }
}

// ── Kellerbuch ───────────────────────────────────────────────────────────────

/** Regel "Messung fällig": Charge in Gärung ohne Analyse seit X Tagen – Fallback,
 *  je Betrieb einstellbar in "Mein Betrieb" (tenant_einstellungen.gaerung_messintervall_tage, Migration 179) */
export const GAERUNG_MESSINTERVALL_TAGE = 3

export async function ladeKeller(ctx: Ctx, messintervallTage: number = GAERUNG_MESSINTERVALL_TAGE) {
  const [{ data: behaelterRaw }, { data: chargenRaw }, { data: fuellstandRaw }] = await Promise.all([
    ctx.tf(ctx.q('behaelter').select('id, name, typ, volumen_liter, aktiv')),
    ctx.tf(ctx.q('weinausbau')
      .select('id, name, jahrgang, rebsorte, weinart, menge_liter, status, aktiv, behaelter_id, ist_eroeffnungsbestand, qualitaetsstufe, notizen')
      .neq('status', 'abgeschlossen')
      .order('jahrgang', { ascending: false }).order('name')),
    ctx.tf(ctx.q('v_behaelter_fuellstand').select('behaelter_id, liter_aktuell')),
  ])
  const behaelter = ((behaelterRaw ?? []) as R[])
  const behaelterMap = new Map(behaelter.map(b => [b.id, b]))
  const fuellstand = new Map<string, number>()
  for (const f of (fuellstandRaw ?? []) as R[]) fuellstand.set(f.behaelter_id, parseFloat(f.liter_aktuell) || 0)

  const chargenBasis = ((chargenRaw ?? []) as R[]).filter(c => !c.ist_eroeffnungsbestand && c.aktiv !== false)
  const ids = chargenBasis.map(c => c.id)
  const behaelterIds = Array.from(new Set(chargenBasis.map(c => c.behaelter_id).filter(Boolean)))

  const [{ data: analysenRaw }, { data: massnahmenRaw }] = await Promise.all([
    ids.length
      ? ctx.tf(ctx.q('weinanalysen').select('weinausbau_id, analyse_datum, alkohol_vol, restzucker_gl, freie_so2_mgl, gesamtsaeure_gl').in('weinausbau_id', ids).order('analyse_datum', { ascending: false }).limit(500))
      : Promise.resolve({ data: [] }),
    behaelterIds.length
      ? ctx.tf(ctx.q('keller_behandlungen').select('behaelter_id, datum, typ_name_snapshot, menge, einheit').in('behaelter_id', behaelterIds).order('datum', { ascending: false }).limit(500))
      : Promise.resolve({ data: [] }),
  ])
  const letzteAnalyse = new Map<string, R>()
  for (const a of (analysenRaw ?? []) as R[]) if (!letzteAnalyse.has(a.weinausbau_id)) letzteAnalyse.set(a.weinausbau_id, a)
  const letzteMassnahme = new Map<string, R>()
  for (const m of (massnahmenRaw ?? []) as R[]) if (!letzteMassnahme.has(m.behaelter_id)) letzteMassnahme.set(m.behaelter_id, m)

  const heuteMs = ctx.heute.getTime()
  const chargen: Charge[] = chargenBasis.map(c => {
    const a = letzteAnalyse.get(c.id) ?? null
    const m = c.behaelter_id ? (letzteMassnahme.get(c.behaelter_id) ?? null) : null
    const tage = a ? Math.floor((heuteMs - new Date(a.analyse_datum).getTime()) / 86400000) : null
    return {
      id: c.id, name: c.name, jahrgang: c.jahrgang ?? null, rebsorte: c.rebsorte ?? null, weinart: c.weinart ?? null,
      status: c.status, menge_liter: Number(c.menge_liter) || 0,
      behaelter: c.behaelter_id ? (behaelterMap.get(c.behaelter_id)?.name ?? null) : null, behaelter_id: c.behaelter_id ?? null,
      qualitaetsstufe: c.qualitaetsstufe ?? null, notizen: c.notizen ?? null,
      letzteAnalyse: a ? { datum: a.analyse_datum, alkohol_vol: a.alkohol_vol, restzucker_gl: a.restzucker_gl, freie_so2_mgl: a.freie_so2_mgl, gesamtsaeure_gl: a.gesamtsaeure_gl } : null,
      letzteMassnahme: m ? { datum: m.datum, typ: m.typ_name_snapshot ?? null, menge: m.menge, einheit: m.einheit } : null,
      messungFaellig: c.status === 'gaerung' && (tage === null || tage >= messintervallTage),
      tageSeitMessung: tage,
    }
  })

  const aktiveBehaelter = behaelter.filter(b => b.aktiv !== false)
  const gesamtLiter = Array.from(fuellstand.values()).filter(v => v > 0).reduce((s, v) => s + v, 0)
  const jahr = ctx.heute.getFullYear()
  const jungweinLiter = chargen.filter(c => c.jahrgang === jahr).reduce((s, c) => s + c.menge_liter, 0)
  const kapazitaet = aktiveBehaelter.reduce((s, b) => s + (Number(b.volumen_liter) || 0), 0)

  return {
    chargen,
    gesamtLiter, jungweinLiter, kapazitaet,
    behaelterGesamt: aktiveBehaelter.length,
    behaelterBelegt: aktiveBehaelter.filter(b => (fuellstand.get(b.id) ?? 0) > 0).length,
    gaerungen: chargen.filter(c => c.status === 'gaerung').length,
    messungFaellig: chargen.filter(c => c.messungFaellig).length,
    fuellfertig: chargen.filter(c => c.status === 'abfuellung').length,
  }
}

// ── Flaschenlager ────────────────────────────────────────────────────────────

export async function ladeFlaschenlager(ctx: Ctx) {
  const wochenStart = toDateStr(startOfWeek(ctx.heute))
  const { data } = await ctx.tf(ctx.q('fuellungen').select('id, rebsorte, datum, anzahl_flaschen, bestand_flaschen, aktiv').eq('aktiv', true))
  const rows = (data ?? []) as R[]
  const bestand = rows.reduce((s, f) => s + (Number(f.bestand_flaschen) || 0), 0)
  const abgefuelltWoche = rows.filter(f => f.datum >= wochenStart).reduce((s, f) => s + (Number(f.anzahl_flaschen) || 0), 0)
  const nachRebsorte = new Map<string, number>()
  for (const f of rows) {
    const k = (f.rebsorte ?? 'Ohne Rebsorte') as string
    nachRebsorte.set(k, (nachRebsorte.get(k) ?? 0) + (Number(f.bestand_flaschen) || 0))
  }
  return {
    bestand, abgefuelltWoche,
    nachRebsorte: Array.from(nachRebsorte.entries()).map(([rebsorte, flaschen]) => ({ rebsorte, flaschen })).filter(x => x.flaschen > 0).sort((a, b) => b.flaschen - a.flaschen),
  }
}

// ── Weingarten ───────────────────────────────────────────────────────────────

export async function ladeWeingarten(ctx: Ctx) {
  const jahr = ctx.heute.getFullYear()
  const [{ data: wRaw }, { data: gRaw }, { data: bRaw }] = await Promise.all([
    ctx.tf(ctx.q('weingarten').select('id, name, ried, rebsorte, weinart, flaeche_ha, bewirtschaftung, aktiv, ama_feldnummer, codes, interne_bezeichnung, zentrum_lat, zentrum_lon').eq('aktiv', true).order('name')),
    ctx.tf(ctx.q('grundstuecke').select('id, weingarten_id, flaeche_ha, ama_feldnummer')),
    ctx.tf(ctx.q('behandlungen').select('id, datum, ernte_fruehesteins, weingarten_id, weingarten:weingarten_id(name)').gte('datum', `${jahr}-01-01`).order('datum', { ascending: false }).limit(500)),
  ])
  const rieden = ((wRaw ?? []) as R[])
  const grundstuecke = ((gRaw ?? []) as R[])
  const behandlungen = ((bRaw ?? []) as R[])
  const gstProRied = new Map<string, R[]>()
  for (const g of grundstuecke) {
    const arr = gstProRied.get(g.weingarten_id) ?? []; arr.push(g); gstProRied.set(g.weingarten_id, arr)
  }
  // Fläche je Ried wie auf der Rieden-Seite (weingarten/page.tsx): Summe der
  // Grundstücke, falls welche erfasst sind, sonst die Fläche am Weingarten selbst.
  // (Bugfix 27.8.2026: Übersicht zeigte 0,00 ha, weil nur weingarten.flaeche_ha gelesen wurde.)
  const riedenListe = rieden.map(w => {
    const gst = gstProRied.get(w.id) ?? []
    const gstHa = gst.reduce((s, g) => s + (Number(g.flaeche_ha) || 0), 0)
    const fs = Array.from(new Set([w.ama_feldnummer, ...gst.map(g => g.ama_feldnummer)].filter(Boolean))) as string[]
    return {
      id: w.id as string, name: w.name as string, ried: (w.ried ?? null) as string | null, rebsorte: (w.rebsorte ?? null) as string | null,
      flaeche_ha: gst.length > 0 ? gstHa : (Number(w.flaeche_ha) || 0), gstCount: gst.length, amaFs: fs,
      lat: w.zentrum_lat != null ? Number(w.zentrum_lat) : null, lon: w.zentrum_lon != null ? Number(w.zentrum_lon) : null,
      codes: (Array.isArray(w.codes) ? w.codes : (w.codes ? String(w.codes).split(/[,;\s]+/).filter(Boolean) : [])) as string[],
    }
  })
  const wartefristen = behandlungen
    .filter(b => b.ernte_fruehesteins && b.ernte_fruehesteins >= ctx.heuteStr)
    .map(b => ({ id: b.id as string, datum: b.datum as string, freiAb: b.ernte_fruehesteins as string, ried: (b.weingarten?.name ?? '–') as string }))
    .sort((a, b) => a.freiAb.localeCompare(b.freiAb))
  return {
    rieden: riedenListe,
    grundstueckeCount: grundstuecke.length,
    flaecheHa: riedenListe.reduce((s, r) => s + r.flaeche_ha, 0),
    behandlungenSaison: behandlungen.length,
    wartefristen,
  }
}

// ── Fristen (betriebseigene + aus Fachtabellen abgeleitete) ──────────────────

/** Vorwarnung "fällig" X Tage vor Termin – Fallback, je Betrieb einstellbar (tenant_einstellungen.fristen_vorwarnung_tage) */
export const FAELLIG_TAGE = 30

function statusAus(faelligAm: string | null, erledigt: boolean, heuteStr: string, vorwarnungTage: number = FAELLIG_TAGE): FristStatus {
  if (erledigt) return 'erledigt'
  if (!faelligAm) return 'offen'
  if (faelligAm < heuteStr) return 'ueberfaellig'
  const tage = Math.round((new Date(faelligAm).getTime() - new Date(heuteStr).getTime()) / 86400000)
  return tage <= vorwarnungTage ? 'faellig' : 'offen'
}

/** UVA-Perioden: Fälligkeit 15. des zweitfolgenden Monats nach Periodenende */
function uvaPerioden(zeitraum: 'monatlich' | 'quartalsweise', heute: Date) {
  const out: { jahr: number; zeitraum: string; label: string; faelligAm: string }[] = []
  const y = heute.getFullYear(), m = heute.getMonth() // 0-basiert
  if (zeitraum === 'monatlich') {
    for (let i = 12; i >= 1; i--) {
      const d = new Date(y, m - i, 1)
      const due = new Date(d.getFullYear(), d.getMonth() + 2, 15)
      out.push({ jahr: d.getFullYear(), zeitraum: String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' }), faelligAm: toDateStr(due) })
    }
  } else {
    for (let i = 4; i >= 1; i--) {
      const qStart = new Date(y, Math.floor(m / 3) * 3 - i * 3, 1)
      const qi = Math.floor(qStart.getMonth() / 3) + 1
      const due = new Date(qStart.getFullYear(), qStart.getMonth() + 3 + 1, 15)
      out.push({ jahr: qStart.getFullYear(), zeitraum: `Q${qi}`, label: `Q${qi} ${qStart.getFullYear()}`, faelligAm: toDateStr(due) })
    }
  }
  return out
}

export async function ladeFristen(ctx: Ctx, opts: { modulEa: boolean; uvaZeitraum: 'monatlich' | 'quartalsweise'; vorwarnungTage?: number; betriebsbeginn?: string | null }) {
  const jahr = ctx.heute.getFullYear()
  const vt = opts.vorwarnungTage ?? FAELLIG_TAGE
  const [{ data: eigeneRaw }, { data: uvaRaw }, { data: jgRaw }, { data: dacRaw }, { data: wfRaw }] = await Promise.all([
    ctx.tf(ctx.q('fristen').select('id, bezeichnung, beschreibung, kategorie, faellig_am, wiederholung, href, status, erledigt_am').order('faellig_am')),
    opts.modulEa ? ctx.tf(ctx.q('ea_uva').select('jahr, zeitraum, gesperrt, gesperrt_am')) : Promise.resolve({ data: [] }),
    ctx.tf(ctx.q('weinjahrgaenge').select('id, jahrgang, ama_gemeldet, ama_meldedatum, ama_erntemeldungen(status, eingereicht_am)').eq('jahrgang', jahr).limit(1)),
    ctx.tf(ctx.q('dac_antrag').select('id, bezeichnung, status, eingereicht_am').eq('aktiv', true).in('status', ['entwurf', 'eingereicht', 'in_pruefung']).order('created_at', { ascending: false }).limit(20)),
    ctx.tf(ctx.q('behandlungen').select('id, ernte_fruehesteins').gte('ernte_fruehesteins', ctx.heuteStr).order('ernte_fruehesteins').limit(50)),
  ])

  const fristen: Frist[] = []

  // Betriebseigene Fristen (Tabelle) – jährliche Wiederholung: erledigte des
  // Vorjahres werden nicht angezeigt, offene bleiben stehen bis erledigt.
  for (const f of (eigeneRaw ?? []) as R[]) {
    const st = statusAus(f.faellig_am, f.status === 'erledigt', ctx.heuteStr, vt)
    fristen.push({
      key: `f:${f.id}`, id: f.id, bezeichnung: f.bezeichnung, hinweis: f.beschreibung ?? '', kategorie: f.kategorie,
      faelligAm: f.faellig_am, status: st,
      statusText: st === 'erledigt' ? `erledigt ${f.erledigt_am ? new Date(f.erledigt_am).toLocaleDateString('de-AT') : ''}`.trim() : `bis ${new Date(f.faellig_am).toLocaleDateString('de-AT')}`,
      href: f.href ?? undefined, quelle: 'betrieb',
    })
  }

  // UVA (nur mit E&A-Modul): Perioden der letzten 12 Monate, nicht übermittelte
  // als fällig/überfällig, die zuletzt übermittelte als erledigt.
  if (opts.modulEa) {
    const uva = (uvaRaw ?? []) as R[]
    const perioden = uvaPerioden(opts.uvaZeitraum, ctx.heute)
    let letzteErledigt: Frist | null = null
    for (const p of perioden) {
      // Betriebsbeginn (Migration 180): Perioden davor existieren fachlich nicht
      if (periodeVorBeginn(p.jahr, p.zeitraum, opts.betriebsbeginn)) continue
      const row = uva.find(u => Number(u.jahr) === p.jahr && u.zeitraum === p.zeitraum)
      const erledigt = !!row?.gesperrt
      const st = statusAus(p.faelligAm, erledigt, ctx.heuteStr, vt)
      const eintrag: Frist = {
        key: `uva:${p.jahr}:${p.zeitraum}`, bezeichnung: `UVA ${p.label}`, kategorie: 'steuer',
        hinweis: 'Aus E/A-Rechnung · FinanzOnline (CSV-Export)', faelligAm: p.faelligAm, status: st,
        statusText: erledigt ? `übermittelt ${row?.gesperrt_am ? new Date(row.gesperrt_am).toLocaleDateString('de-AT') : ''}`.trim() : `bis ${new Date(p.faelligAm).toLocaleDateString('de-AT')}`,
        href: '/buchhaltung/uva', quelle: 'system',
      }
      if (erledigt) letzteErledigt = eintrag
      else if (st !== 'offen' || p.faelligAm <= toDateStr(new Date(ctx.heute.getTime() + 60 * 86400000))) fristen.push(eintrag)
    }
    if (letzteErledigt) fristen.push(letzteErledigt)
  }

  // Erntemeldung des laufenden Jahrgangs (bis 15.12.)
  {
    const jg = ((jgRaw ?? []) as R[])[0]
    const am = jg?.ama_erntemeldungen?.[0] ?? (Array.isArray(jg?.ama_erntemeldungen) ? null : jg?.ama_erntemeldungen)
    const eingereicht = !!jg?.ama_gemeldet || ['eingereicht', 'bestaetigt'].includes(am?.status)
    const faelligAm = `${jahr}-12-15`
    const st = statusAus(faelligAm, eingereicht, ctx.heuteStr, vt)
    fristen.push({
      key: `ernte:${jahr}`, bezeichnung: `Erntemeldung ${jahr}`, kategorie: 'weinrecht',
      hinweis: jg ? (eingereicht ? 'Über eAMA gemeldet' : `Entwurf entsteht aus den Pressungen · Status ${am?.status ?? 'entwurf'}`) : `Jahrgang ${jahr} noch nicht angelegt`,
      faelligAm, status: st,
      statusText: eingereicht ? `gemeldet ${jg?.ama_meldedatum ? new Date(jg.ama_meldedatum).toLocaleDateString('de-AT') : ''}`.trim() : `bis ${new Date(faelligAm).toLocaleDateString('de-AT')}`,
      href: jg ? `/erntemeldung/${jg.id}` : '/erntemeldung', quelle: 'system',
    })
  }

  // Prüfnummernanträge (vor Vermarktung)
  for (const d of (dacRaw ?? []) as R[]) {
    const eingereicht = d.status !== 'entwurf'
    fristen.push({
      key: `dac:${d.id}`, bezeichnung: `Prüfnummernantrag ${d.bezeichnung}`, kategorie: 'weinrecht',
      hinweis: eingereicht ? 'Eingereicht · Bescheid ausständig' : 'Vor Vermarktung einreichen · Antrag aus Charge befüllt',
      faelligAm: null, status: eingereicht ? 'laufend' : 'offen',
      statusText: eingereicht ? `eingereicht ${d.eingereicht_am ? new Date(d.eingereicht_am).toLocaleDateString('de-AT') : ''}`.trim() : 'Entwurf',
      href: `/dac/${d.id}`, quelle: 'system',
    })
  }

  // Wartefristen Pflanzenschutz (laufend)
  {
    const wf = (wfRaw ?? []) as R[]
    fristen.push({
      key: 'wartefristen', bezeichnung: 'Wartefristen Pflanzenschutz', kategorie: 'weinrecht',
      hinweis: 'Frühester Lesetermin je Behandlung (Wartezeit des Mittels)',
      faelligAm: wf[0]?.ernte_fruehesteins ?? null, status: 'laufend',
      statusText: wf.length ? `${wf.length} aktiv · frei ab ${new Date(wf[0].ernte_fruehesteins).toLocaleDateString('de-AT')}` : 'keine aktiven Wartefristen',
      href: '/behandlungen', quelle: 'system',
    })
  }

  const rang: Record<FristStatus, number> = { ueberfaellig: 0, faellig: 1, offen: 2, laufend: 3, erledigt: 4 }
  fristen.sort((a, b) => rang[a.status] - rang[b.status] || (a.faelligAm ?? '9999').localeCompare(b.faelligAm ?? '9999'))
  return fristen
}

// ── Termine / Aktivitäten ────────────────────────────────────────────────────

export async function ladeNaechsteTermine(ctx: Ctx, limit = 5) {
  const { data } = await ctx.tf(ctx.q('aktivitaeten')
    .select('id, art, betreff, datum, erledigt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name)')
    .eq('erledigt', false).gte('datum', ctx.heuteStr)
    .not('art', 'in', '(verkauf,notiz,email)')
    .order('datum', { ascending: true }).limit(limit))
  return ((data ?? []) as R[]).map(a => ({
    id: a.id as string, betreff: (a.betreff || a.art) as string, datum: a.datum as string,
    wer: a.kontakt ? [a.kontakt.vorname, a.kontakt.nachname].filter(Boolean).join(' ') : (a.firma?.name ?? '') as string,
  }))
}

// ── Tenant-Einstellungen, die die Sichten brauchen ───────────────────────────

export async function ladeEinstellungen(ctx: Ctx) {
  if (!ctx.tenantId) return { modulEa: false, uvaZeitraum: 'quartalsweise' as const, bawbKennung: false, assistentAktiv: false, m365Aktiv: false, messintervallTage: GAERUNG_MESSINTERVALL_TAGE, vorwarnungTage: FAELLIG_TAGE, betriebsbeginn: null as string | null }
  const { data } = await ctx.q('tenant_einstellungen')
    .select('modul_ea, ea_uva_zeitraum, bawb_kennung, assistent_aktiv, m365_modul_aktiv, gaerung_messintervall_tage, fristen_vorwarnung_tage, ea_betriebsbeginn')
    .eq('tenant_id', ctx.tenantId).maybeSingle()
  const d = (data ?? {}) as R
  return {
    modulEa: !!d.modul_ea,
    uvaZeitraum: (d.ea_uva_zeitraum === 'monatlich' ? 'monatlich' : 'quartalsweise') as 'monatlich' | 'quartalsweise',
    bawbKennung: !!d.bawb_kennung,
    assistentAktiv: !!d.assistent_aktiv,
    m365Aktiv: !!d.m365_modul_aktiv,
    // Dashboard-Regeln je Betrieb (Migration 179), Fallback = Konstanten oben
    messintervallTage: Number(d.gaerung_messintervall_tage) > 0 ? Number(d.gaerung_messintervall_tage) : GAERUNG_MESSINTERVALL_TAGE,
    vorwarnungTage:    Number(d.fristen_vorwarnung_tage)    > 0 ? Number(d.fristen_vorwarnung_tage)    : FAELLIG_TAGE,
    // Betriebsbeginn E&A (Migration 180) – UVA-Perioden davor nicht als offen zeigen
    betriebsbeginn:    (d.ea_betriebsbeginn ?? null) as string | null,
  }
}
