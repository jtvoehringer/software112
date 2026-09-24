// ── Behördenmeldungen „Weinexport“ (24.09.2026) ─────────────────────────────────
//
//  exportauftrag   Positionsliste eines Exportauftrags als gemeinsame Anlage zu den
//                  Begleitpapieren (V1/V2, EUR.1, CMR, Ursprungszeugnis) und für den
//                  Spediteur: eine Zeile je Position mit Bezeichnung, TARIC, Menge,
//                  Einheit, Liter, Wert (€), Ursprung, Bestimmungsland, EORI.
//                  Seite /weinexport/[id] und CSV nutzen ladeExportauftrag().
//  exportauftraege Auftragsliste mit Dokumentstatus (auch Phytosanitär), ARC-Nummer und
//                  EMCS-Status. Seite /weinexport und CSV nutzen ladeExportauftraege().
//
// Das EMCS-XML (IE801) und die HTML-Papiere unter /api/weinexport bleiben das Meldeformat;
// die CSV kommt zusätzlich. Wert je Position = Menge × Preis, kaufmännisch auf 2 Stellen
// gerundet; Summen addieren die gerundeten Werte (Seite und CSV stimmen überein).
//
// Isomorph ohne Server-Importe (Konstanten auch für WeinexportDetailClient) – Tests: scripts/tests/verkehr.test.mjs

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { STELLEN, runden, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { UUID_RE, feld, inBloecken, textOderNull, type R } from './verkehr-hilfen'

export const EXPORT_STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf', bestaetigt: 'Bestätigt', versendet: 'Versendet', abgeschlossen: 'Abgeschlossen',
}

export const EXPORT_DOK_LABEL: Record<string, string> = {
  v1v2: 'V1/V2 Begleitdokument', eur1: 'EUR.1 Ursprungszeugnis',
  cmr: 'CMR Frachtbrief', certificate_of_origin: 'Certificate of Origin',
  phytosanitaer: 'Phytosanitäres Zertifikat', lieferschein: 'Lieferschein',
  rechnung: 'Exportrechnung',
}

export const EXPORT_DOK_STATUS_LABEL: Record<string, string> = {
  ausstehend: 'Ausstehend', beantragt: 'Beantragt',
  ausgestellt: 'Ausgestellt', nicht_erforderlich: 'Nicht erforderlich',
}

export const EMCS_STATUS_LABEL: Record<string, string> = {
  draft: 'Entwurf', submitted: 'Eingereicht', accepted: 'Akzeptiert', cancelled: 'Storniert',
}

// ── Positionen ───────────────────────────────────────────────────────────────

export type ExportPositionZeile = {
  positionId: string
  referenz: string | null
  datum: string | null
  lieferdatum: string | null
  importeur: string | null
  eori: string | null
  bestimmungsland: string | null
  bestimmungsort: string | null
  ursprungsland: string | null
  incoterms: string | null
  transportart: string | null
  versenderUid: string | null
  position: number
  bezeichnung: string | null
  taric: string | null
  menge: number | null
  einheit: string | null
  flaschengroesseMl: number | null
  liter: number | null
  preisEur: number | null
  wertEur: number | null
}

export const SPALTEN_EXPORTAUFTRAG: CsvSpalte<ExportPositionZeile>[] = [
  { kopf: 'Referenz', typ: 'code', wert: z => z.referenz },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Lieferdatum', typ: 'datum', wert: z => z.lieferdatum },
  { kopf: 'Importeur', typ: 'text', wert: z => z.importeur },
  { kopf: 'EORI Importeur', typ: 'code', wert: z => z.eori },
  { kopf: 'Bestimmungsland', typ: 'text', wert: z => z.bestimmungsland },
  { kopf: 'Bestimmungsort', typ: 'text', wert: z => z.bestimmungsort },
  { kopf: 'Ursprungsland', typ: 'code', wert: z => z.ursprungsland },
  { kopf: 'Incoterms', typ: 'code', wert: z => z.incoterms },
  { kopf: 'Transportart', typ: 'text', wert: z => z.transportart },
  { kopf: 'UID Versender', typ: 'code', wert: z => z.versenderUid },
  { kopf: 'Pos.', typ: 'ganzzahl', wert: z => z.position },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'TARIC', typ: 'code', wert: z => z.taric },
  { kopf: 'Menge', typ: 'dezimal', stellen: 2, wert: z => z.menge },
  { kopf: 'Einheit', typ: 'code', wert: z => z.einheit },
  { kopf: 'Flaschengröße (ml)', typ: 'ganzzahl', wert: z => z.flaschengroesseMl },
  { kopf: 'Volumen (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.liter },
  { kopf: 'Preis je Einheit (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.preisEur },
  { kopf: 'Wert (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.wertEur },
]

function zahlOderNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Importeur wie auf den Papieren: Firma, sonst Vor- und Nachname des Kontakts */
export function importeurName(a: R): string | null {
  const firma = feld(a.firmen?.name)
  if (firma) return firma
  const person = [a.kontakte?.vorname, a.kontakte?.nachname].map(feld).filter(Boolean).join(' ')
  return person || null
}

/**
 * Volumen in Litern aus Menge und Einheit (Exportformular: Fl, Kiste, HL; zusätzlich l/Liter).
 * Nicht bestimmbar → null und ein Grund für die Warnung.
 */
export function literAus(menge: number | null, einheit: string | null, flaschengroesseMl: number | null): { liter: number | null; grund?: string } {
  if (menge === null) return { liter: null }
  const e = (einheit ?? '').trim().toLowerCase()
  if (e === 'hl') return { liter: runden(menge * 100, STELLEN.liter) }
  if (e === 'l' || e === 'liter') return { liter: runden(menge, STELLEN.liter) }
  if (e === 'fl' || e === 'flasche' || e === 'flaschen' || e === 'stk') {
    if (flaschengroesseMl && flaschengroesseMl > 0) return { liter: runden((menge * flaschengroesseMl) / 1000, STELLEN.liter) }
    return { liter: null, grund: 'Flaschengröße unbekannt (keine Füllung verknüpft)' }
  }
  if (e === 'kiste') return { liter: null, grund: 'Einheit „Kiste“: Flaschen je Kiste unbekannt' }
  return { liter: null, grund: `Einheit „${einheit ?? ''}“ nicht in Liter umrechenbar` }
}

/** Wert einer Position = Menge × Preis, kaufmännisch auf 2 Stellen */
export function positionsWert(menge: number | null, preis: number | null): number | null {
  if (menge === null || preis === null) return null
  return runden(menge * preis, STELLEN.betrag)
}

/** Summe bereits gerundeter Werte (Druck-Summe = Summe der CSV-Zeilen) */
export function summeGerundet(werte: readonly (number | null)[]): number {
  return runden(werte.reduce<number>((s, w) => s + (w ?? 0), 0), STELLEN.betrag)
}

/** Positionen eines Auftrags → CSV-Zeilen; `warnungen` erhält nicht umrechenbare Liter */
export function exportZeilen(auftrag: R, positionen: readonly R[], betrieb: R, warnungen: string[]): ExportPositionZeile[] {
  const kopf = {
    referenz: textOderNull(auftrag.referenz),
    datum: textOderNull(auftrag.datum),
    lieferdatum: textOderNull(auftrag.lieferdatum),
    importeur: importeurName(auftrag),
    eori: textOderNull(auftrag.eori_kunde),
    bestimmungsland: textOderNull(auftrag.destination_land),
    bestimmungsort: textOderNull(auftrag.destination_stadt),
    ursprungsland: textOderNull(auftrag.ursprungsland) ?? 'AT',
    incoterms: textOderNull(auftrag.incoterms),
    transportart: textOderNull(auftrag.transport_art),
    versenderUid: textOderNull(betrieb.betrieb_uid),
  }
  const ohneLiter: string[] = []
  const zeilen = positionen.map((p, i) => {
    const menge = zahlOderNull(p.menge)
    const preis = zahlOderNull(p.preis_eur)
    const ml = zahlOderNull(p.fuellungen?.flaschengroesse_ml)
    const einheit = textOderNull(p.einheit)
    const l = literAus(menge, einheit, ml)
    if (l.grund) ohneLiter.push(`Pos. ${i + 1}: ${l.grund}`)
    return {
      ...kopf,
      positionId: String(p.id ?? i),
      position: i + 1,
      bezeichnung: textOderNull(p.beschreibung) ?? textOderNull(p.fuellungen?.bezeichnung),
      taric: textOderNull(p.taric_code) ?? textOderNull(auftrag.taric_code),
      menge: menge === null ? null : runden(menge, 2),
      einheit,
      flaschengroesseMl: ml === null ? null : Math.trunc(ml),
      liter: l.liter,
      preisEur: preis === null ? null : runden(preis, STELLEN.betrag),
      wertEur: positionsWert(menge, preis),
    }
  })
  if (ohneLiter.length > 0) {
    const ref = kopf.referenz ? `${kopf.referenz}: ` : ''
    warnungen.push(`${ref}Volumen (l) leer gelassen – ${ohneLiter.slice(0, 5).join('; ')}${ohneLiter.length > 5 ? ' …' : ''}`)
  }
  return zeilen
}

// ── Laden: einzelner Auftrag ─────────────────────────────────────────────────

type Client = any

export type ExportauftragErgebnis = {
  auftrag: R
  dokumente: R[]
  zeilen: ExportPositionZeile[]
  /** Summe der gerundeten Positionswerte */
  gesamtEur: number
  warnungen: string[]
}

/**
 * Exportauftrag mit Positionen und Dokumenten – für /weinexport/[id] und die CSV.
 * null = Auftrag nicht gefunden (oder keine gültige id). Das Modul „Weinexport“ prüfen
 * Seite (Umleitung) bzw. Route (Katalog-Eintrag modul_export).
 */
export async function ladeExportauftrag(supabase: Client, tenantId: string, p: { id: string }): Promise<ExportauftragErgebnis | null> {
  if (!UUID_RE.test(p.id)) return null
  const [auftragRes, posRes, dokRes, cfgRes] = await Promise.all([
    (supabase.from('exportauftraege') as any)
      .select('*, kontakte(vorname,nachname,email,telefon), firmen(name,email,telefon)')
      .eq('id', p.id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    // exportauftrag_positionen/export_dokumente haben keine tenant_id – sie hängen am
    // mandantengefilterten Auftrag (RLS über den Auftrag); ohne Auftrag wird unten nichts ausgegeben
    alle<R>((supabase.from('exportauftrag_positionen') as any)
      .select('id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order, fuellungen(bezeichnung,flaschengroesse_ml)')
      .eq('exportauftrag_id', p.id)
      .order('sort_order')
      .order('id')),
    alle<R>((supabase.from('export_dokumente') as any)
      .select('*')
      .eq('exportauftrag_id', p.id)
      .order('dokument_art')
      .order('id')),
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_uid')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  if (auftragRes.error) throw new Error(`Laden fehlgeschlagen (exportauftraege): ${auftragRes.error.message}`)
  if (posRes.error) throw new Error(`Laden fehlgeschlagen (exportauftrag_positionen): ${posRes.error.message}`)
  if (dokRes.error) throw new Error(`Laden fehlgeschlagen (export_dokumente): ${dokRes.error.message}`)
  if (cfgRes.error) throw new Error(`Laden fehlgeschlagen (tenant_einstellungen): ${cfgRes.error.message}`)
  const auftrag = auftragRes.data as R | null
  if (!auftrag) return null

  const warnungen: string[] = []
  const zeilen = exportZeilen(auftrag, posRes.data, (cfgRes.data ?? {}) as R, warnungen)
  if (auftrag.aktiv === false) warnungen.push('Der Exportauftrag ist deaktiviert.')
  return { auftrag, dokumente: dokRes.data, zeilen, gesamtEur: summeGerundet(zeilen.map(z => z.wertEur)), warnungen }
}

// ── Laden: Auftragsliste ─────────────────────────────────────────────────────

/** Dokumentarten in fester Spaltenreihenfolge der Liste */
export const EXPORT_DOK_ARTEN = ['v1v2', 'eur1', 'cmr', 'certificate_of_origin', 'phytosanitaer', 'lieferschein', 'rechnung'] as const
export type ExportDokArt = typeof EXPORT_DOK_ARTEN[number]

export type ExportauftragListenZeile = {
  id: string
  referenz: string | null
  datum: string | null
  lieferdatum: string | null
  importeur: string | null
  eori: string | null
  bestimmungsland: string | null
  bestimmungsort: string | null
  ursprungsland: string | null
  incoterms: string | null
  transportart: string | null
  status: string | null
  statusLabel: string | null
  positionen: number
  literGesamt: number | null
  warenwertEur: number
  versicherungswertEur: number | null
  dokAusgestellt: number
  dokErforderlich: number
  /** Status-Anzeigetext je Dokumentart; null = Dokument nicht angelegt */
  dokStatus: Record<ExportDokArt, string | null>
  arcNummer: string | null
  emcsStatus: string | null
  emcsDatum: string | null
}

const SPALTEN_KOPF_LISTE: CsvSpalte<ExportauftragListenZeile>[] = [
  { kopf: 'Referenz', typ: 'code', wert: z => z.referenz },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Lieferdatum', typ: 'datum', wert: z => z.lieferdatum },
  { kopf: 'Importeur', typ: 'text', wert: z => z.importeur },
  { kopf: 'EORI Importeur', typ: 'code', wert: z => z.eori },
  { kopf: 'Bestimmungsland', typ: 'text', wert: z => z.bestimmungsland },
  { kopf: 'Bestimmungsort', typ: 'text', wert: z => z.bestimmungsort },
  { kopf: 'Ursprungsland', typ: 'code', wert: z => z.ursprungsland },
  { kopf: 'Incoterms', typ: 'code', wert: z => z.incoterms },
  { kopf: 'Transportart', typ: 'text', wert: z => z.transportart },
  { kopf: 'Status', typ: 'text', wert: z => z.statusLabel },
  { kopf: 'Positionen', typ: 'ganzzahl', wert: z => z.positionen },
  { kopf: 'Volumen (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.literGesamt },
  { kopf: 'Warenwert (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.warenwertEur },
  { kopf: 'Versicherungswert (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.versicherungswertEur },
  { kopf: 'Dokumente ausgestellt', typ: 'ganzzahl', wert: z => z.dokAusgestellt },
  { kopf: 'Dokumente erforderlich', typ: 'ganzzahl', wert: z => z.dokErforderlich },
]

export const SPALTEN_EXPORTAUFTRAEGE: CsvSpalte<ExportauftragListenZeile>[] = [
  ...SPALTEN_KOPF_LISTE,
  ...EXPORT_DOK_ARTEN.map((art): CsvSpalte<ExportauftragListenZeile> => ({ kopf: EXPORT_DOK_LABEL[art], typ: 'text', wert: z => z.dokStatus[art] })),
  { kopf: 'EMCS ARC-Nummer', typ: 'code', wert: z => z.arcNummer },
  { kopf: 'EMCS-Status', typ: 'text', wert: z => z.emcsStatus },
  { kopf: 'EMCS-Datum', typ: 'datum', wert: z => z.emcsDatum },
]

/** Auftrag + seine Positionen/Dokumente → Listenzeile (Zahlen gerundet, Summen aus gerundeten Werten) */
export function exportListenZeile(a: R, positionen: readonly R[], dokumente: readonly R[], warnungen: string[]): ExportauftragListenZeile {
  const zeilen = exportZeilen(a, positionen, {}, warnungen)
  const literBekannt = zeilen.every(z => z.liter !== null)
  const status = textOderNull(a.status)
  const dokStatus = Object.fromEntries(EXPORT_DOK_ARTEN.map(art => [art, null])) as Record<ExportDokArt, string | null>
  for (const d of dokumente) {
    const art = feld(d.dokument_art) as ExportDokArt
    if (!(EXPORT_DOK_ARTEN as readonly string[]).includes(art)) continue
    const st = feld(d.status)
    dokStatus[art] = st ? (EXPORT_DOK_STATUS_LABEL[st] ?? st) : null
  }
  const emcs = textOderNull(a.emcs_status)
  const versicherung = zahlOderNull(a.versicherungswert)
  return {
    id: String(a.id),
    referenz: textOderNull(a.referenz),
    datum: textOderNull(a.datum),
    lieferdatum: textOderNull(a.lieferdatum),
    importeur: importeurName(a),
    eori: textOderNull(a.eori_kunde),
    bestimmungsland: textOderNull(a.destination_land),
    bestimmungsort: textOderNull(a.destination_stadt),
    ursprungsland: textOderNull(a.ursprungsland) ?? 'AT',
    incoterms: textOderNull(a.incoterms),
    transportart: textOderNull(a.transport_art),
    status,
    statusLabel: status ? (EXPORT_STATUS_LABEL[status] ?? status) : null,
    positionen: zeilen.length,
    literGesamt: zeilen.length > 0 && literBekannt ? runden(zeilen.reduce((s, z) => s + (z.liter ?? 0), 0), STELLEN.liter) : null,
    warenwertEur: summeGerundet(zeilen.map(z => z.wertEur)),
    versicherungswertEur: versicherung === null ? null : runden(versicherung, STELLEN.betrag),
    dokAusgestellt: dokumente.filter(d => d.status === 'ausgestellt').length,
    dokErforderlich: dokumente.filter(d => d.status !== 'nicht_erforderlich').length,
    dokStatus,
    arcNummer: textOderNull(a.emcs_arc_nummer),
    emcsStatus: emcs ? (EMCS_STATUS_LABEL[emcs] ?? emcs) : 'nicht eingereicht',
    emcsDatum: textOderNull(a.emcs_datum),
  }
}

/** Alle aktiven Exportaufträge (neueste zuerst) mit Positionssummen und Dokumentstatus – für /weinexport und die CSV */
export async function ladeExportauftraege(supabase: Client, tenantId: string): Promise<{ zeilen: ExportauftragListenZeile[]; warnungen: string[] }> {
  const auftraegeRes = await alle<R>((supabase.from('exportauftraege') as any)
    .select('id, referenz, datum, lieferdatum, incoterms, transport_art, destination_land, destination_stadt, eori_kunde, taric_code, ursprungsland, versicherungswert, status, emcs_arc_nummer, emcs_status, emcs_datum, created_at, kontakte(vorname, nachname), firmen(name)')
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .order('created_at', { ascending: false })
    .order('id'))
  if (auftraegeRes.error) throw new Error(`Laden fehlgeschlagen (exportauftraege): ${auftraegeRes.error.message}`)
  const auftraege = auftraegeRes.data
  const ids = auftraege.map(a => String(a.id))

  const posJe = new Map<string, R[]>()
  const dokJe = new Map<string, R[]>()
  for (const block of inBloecken(ids)) {
    // Kindtabellen ohne tenant_id: nur Positionen/Dokumente der oben mandantengefilterten Aufträge
    const [pos, dok] = await Promise.all([
      alle<R>((supabase.from('exportauftrag_positionen') as any)
        .select('id, exportauftrag_id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order, fuellungen(bezeichnung,flaschengroesse_ml)')
        .in('exportauftrag_id', block)
        .order('exportauftrag_id')
        .order('sort_order')
        .order('id')),
      alle<R>((supabase.from('export_dokumente') as any)
        .select('id, exportauftrag_id, dokument_art, status')
        .in('exportauftrag_id', block)
        .order('exportauftrag_id')
        .order('id')),
    ])
    if (pos.error) throw new Error(`Laden fehlgeschlagen (exportauftrag_positionen): ${pos.error.message}`)
    if (dok.error) throw new Error(`Laden fehlgeschlagen (export_dokumente): ${dok.error.message}`)
    for (const p of pos.data) posJe.set(String(p.exportauftrag_id), [...(posJe.get(String(p.exportauftrag_id)) ?? []), p])
    for (const d of dok.data) dokJe.set(String(d.exportauftrag_id), [...(dokJe.get(String(d.exportauftrag_id)) ?? []), d])
  }

  const warnungen: string[] = []
  const zeilen = auftraege.map(a => exportListenZeile(a, posJe.get(String(a.id)) ?? [], dokJe.get(String(a.id)) ?? [], warnungen))
  return { zeilen, warnungen }
}
