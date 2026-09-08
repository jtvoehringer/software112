// ── SVS-Beiträge (Bäuerliche Sozialversicherung) – Rechenkern ───────────────
//
// Rückmeldung 8.9.2026. Pauschalsystem: Beitragsgrundlage = Versicherungswert,
// ein Prozentsatz des Einheitswertes, der nach Einheitswert-Stufen gestaffelt
// wird (BSVG § 23; "Einkommensfaktoren nach Einheitswertgrenzen" der
// SVS-Beitragstabelle). Zupachtungen von Fremden zählen mit zwei Dritteln,
// von nahen Angehörigen voll; verpachtete Flächen werden abgezogen.
// Beitragsgrundlagenoption: Beitragsgrundlage = (Einkünfte aus Land- und
// Forstwirtschaft lt. Einkommensteuerbescheid + die im Jahr bezahlten KV/PV-
// Beiträge) / 12, begrenzt durch Mindest- und Höchstbeitragsgrundlage.
//
// Alle Sätze kommen aus svs_parameter (je Jahr, Migration 199). Das Ergebnis
// ist eine Orientierung - verbindlich ist der Beitragsbescheid der SVS.
// Datei bewusst ohne Server-Imports (wird auch im Client für die Vorschau genutzt).

export type SvsStaffelStufe = { bis: number | null; prozent: number }

export type SvsParameter = {
  jahr: number
  staffel: SvsStaffelStufe[]
  satz_pv: number
  satz_kv: number
  satz_uv: number
  satz_bh: number
  satz_kv_zusatz: number
  min_bg_kv_pv: number
  min_bg_uv: number
  hoechst_bg: number
  hinweis?: string | null
}

export type Zurechnung = 'eigen' | 'pacht_fremd' | 'pacht_angehoerige' | 'verpachtet' | 'keine'

export const ZURECHNUNG_LABEL: Record<Zurechnung, string> = {
  eigen: 'Eigentum (voll)',
  pacht_fremd: 'Zupachtung von Fremden (2/3)',
  pacht_angehoerige: 'Zupachtung von Angehörigen (voll)',
  verpachtet: 'Verpachtet (Abzug)',
  keine: 'Nicht berücksichtigen',
}

/** Anteil, mit dem der Einheitswert eines Grundstücks in die Beitragsgrundlage eingeht */
export function zurechnungsfaktor(z: Zurechnung): number {
  switch (z) {
    case 'eigen': return 1
    case 'pacht_fremd': return 2 / 3
    case 'pacht_angehoerige': return 1
    case 'verpachtet': return -1
    case 'keine': return 0
  }
}

export type EinheitswertSumme = {
  eigen: number; pachtFremd: number; pachtAngehoerige: number; verpachtet: number
  /** massgebender Einheitswert = eigen + angehörige + 2/3 fremd − verpachtet (nicht unter 0) */
  massgebend: number
  ohneWert: number   // Grundstücke ohne Einheitswert (Hinweis)
}

export function summiereEinheitswerte(gst: { einheitswert: number | null | undefined; svs_zurechnung: string | null | undefined }[]): EinheitswertSumme {
  const s: EinheitswertSumme = { eigen: 0, pachtFremd: 0, pachtAngehoerige: 0, verpachtet: 0, massgebend: 0, ohneWert: 0 }
  for (const g of gst) {
    const z = (g.svs_zurechnung ?? 'eigen') as Zurechnung
    if (z === 'keine') continue
    const ew = Number(g.einheitswert ?? 0) || 0
    if (!ew) { s.ohneWert++; continue }
    if (z === 'eigen') s.eigen += ew
    else if (z === 'pacht_fremd') s.pachtFremd += ew
    else if (z === 'pacht_angehoerige') s.pachtAngehoerige += ew
    else if (z === 'verpachtet') s.verpachtet += ew
  }
  s.massgebend = Math.max(0, s.eigen + s.pachtAngehoerige + s.pachtFremd * (2 / 3) - s.verpachtet)
  return s
}

/** Versicherungswert (monatliche Beitragsgrundlage) aus dem massgebenden Einheitswert – gestaffelt */
export function versicherungswert(einheitswert: number, staffel: SvsStaffelStufe[]): number {
  let rest = Math.max(0, einheitswert), unten = 0, vw = 0
  for (const st of staffel) {
    const oben = st.bis ?? Infinity
    const anteil = Math.max(0, Math.min(rest, oben - unten))
    vw += anteil * st.prozent / 100
    rest -= anteil
    unten = oben
    if (rest <= 0) break
  }
  return Math.round(vw * 100) / 100
}

export type Beitraege = {
  beitragsgrundlage: number      // monatlich, nach Mindest/Höchst
  bgUv: number                   // Unfallversicherung hat eigene Mindestgrundlage
  pv: number; kv: number; uv: number; bh: number; kvZusatz: number
  monat: number; jahr: number
  begrenzt: 'min' | 'max' | null
}

/** Monatsbeiträge aus einer (rohen) monatlichen Beitragsgrundlage */
export function beitraege(bgRoh: number, p: SvsParameter, kvAngehoerige = false): Beitraege {
  let begrenzt: Beitraege['begrenzt'] = null
  let bg = bgRoh
  if (bg < p.min_bg_kv_pv) { bg = p.min_bg_kv_pv; begrenzt = 'min' }
  if (bg > p.hoechst_bg) { bg = p.hoechst_bg; begrenzt = 'max' }
  const bgUv = Math.min(p.hoechst_bg, Math.max(bgRoh, p.min_bg_uv))
  const r2 = (n: number) => Math.round(n * 100) / 100
  const pv = r2(bg * p.satz_pv / 100), kv = r2(bg * p.satz_kv / 100), uv = r2(bgUv * p.satz_uv / 100), bh = r2(bg * p.satz_bh / 100)
  const kvZusatz = kvAngehoerige ? r2(bg * p.satz_kv_zusatz / 100) : 0
  const monat = r2(pv + kv + uv + bh + kvZusatz)
  return { beitragsgrundlage: bg, bgUv, pv, kv, uv, bh, kvZusatz, monat, jahr: r2(monat * 12), begrenzt }
}

/** Beitragsgrundlage der Option: (Einkünfte + bezahlte KV/PV-Beiträge) / 12 */
export function optionsGrundlage(einkuenfteJahr: number, bezahlteKvPvJahr: number): number {
  return Math.max(0, (einkuenfteJahr + bezahlteKvPvJahr) / 12)
}

export type Vergleich = {
  einheitswert: EinheitswertSumme
  versicherungswert: number
  pauschal: Beitraege
  option: Beitraege | null
  optionEinkuenfte: number | null
  ersparnisOptionJahr: number | null   // positiv = Option günstiger
}

export function vergleiche(gst: Parameters<typeof summiereEinheitswerte>[0], p: SvsParameter, opts: { einkuenfteJahr: number | null; kvAngehoerige?: boolean }): Vergleich {
  const ew = summiereEinheitswerte(gst)
  const vw = versicherungswert(ew.massgebend, p.staffel)
  const pauschal = beitraege(vw, p, opts.kvAngehoerige)
  let option: Beitraege | null = null
  if (opts.einkuenfteJahr !== null && opts.einkuenfteJahr !== undefined) {
    // Näherung: die im Jahr bezahlten KV/PV-Beiträge werden mit den Pauschalbeiträgen angesetzt
    const bezahlt = (pauschal.pv + pauschal.kv) * 12
    option = beitraege(optionsGrundlage(opts.einkuenfteJahr, bezahlt), p, opts.kvAngehoerige)
  }
  return {
    einheitswert: ew, versicherungswert: vw, pauschal, option,
    optionEinkuenfte: opts.einkuenfteJahr ?? null,
    ersparnisOptionJahr: option ? Math.round((pauschal.jahr - option.jahr) * 100) / 100 : null,
  }
}
