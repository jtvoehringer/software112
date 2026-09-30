// ── Kupfer-Bilanz (Behördenmeldungen „cu-bilanz“ und „cu-bilanz-behandlungen“, 24.09.2026) ──
//
// Eine Berechnung für Druckseite /reports/cu-bilanz, Tab „Cu-Bilanz“ in /behandlungen/berichte
// und beide CSV-Dateien. Isomorph (BerichteClient rechnet im Browser mit cuBilanz()).
//
// Rechenweg:
//   • Cu-Gehalt: pflanzenschutzmittel.cu_gehalt_pct; fehlt er bei einem Kupfer-Wirkstoff,
//     ersatzweise wirkstoffgehalt_pct (Näherung, als Hinweis gemeldet – wie bisher im Berichte-Tab).
//   • Cu (kg) je Maßnahme = Mittelmenge (kg, mittelmengeKg mit Litern ≈ kg) × Cu-Gehalt / 100.
//     Die Mittelmenge einer Spritzung kommt seit KAN-133 (26.09.2026) nur aus dem Aufwand – „Menge
//     gesamt“ ist die Spritzbrühe und steht nur zur Information in der CSV.
//   • Cu (kg/ha) je Maßnahme = Cu (kg) / behandelte Fläche (Σ Grundstücke der Maßnahme).
//   • Je Ried (= Weingarten, KAN-132): Cu je GST-Zeile über verteileMassnahme() (lib/wein/massnahmeAnteile.ts,
//     Methode des größten Rests; Maßnahmen nur am Weingarten auf dessen aktuelle WI-GST), Σ der GST-Anteile
//     geteilt durch die WI-GST-Fläche der Ried (bis 30.09.2026 die Stammdaten-Fläche weingarten.flaeche_ha –
//     bei Gebeshuber leer); dazu die gleitenden Summen über 5 Jahre (ÖPUL, 20 kg/ha) und 7 Jahre
//     (DVO (EU) 2021/1165 Anhang II, 28 kg/ha).
//   • Höchste GST-Belastung (KAN-132 Regel 6): je GST-Zeile Σ der ungerundeten Cu je ha ihrer Maßnahmen im
//     Jahr bzw. in 5/7 Jahren, davon das Maximum je Ried – gegen alle drei Schwellen (Ampel „GST“).
//   • Betrieb: Σ Cu (kg) / Σ Fläche der WI-Grundstücke der aktiven Weingärten (betriebsflaecheWi,
//     KAN-133 Nr. 5). Bis 26.09.2026 Σ weingarten.flaeche_ha – bei Betrieben ohne Stammdaten-Fläche
//     0 ha und damit kein Wert. (Der Berichte-Tab teilte bis 24.09.2026 durch die Summe der
//     behandelten Flächen aller Anwendungen – bei fünf Spritzungen nur ein Fünftel des Eintrags je ha.)
//     Dieselbe Rechnung zeigt die Kachel „Kupfer“ in /reports (Tab „Behandlungen“).
//   • Ampel je Jahr gegen 4 kg/ha (EU-Bio-VO 2018/848, bisherige App-Regel; fachlich offen:
//     28 kg in 7 Jahren) – Warnschwelle ab 80 %.

import { runden, STELLEN, wienHeute, type CsvSpalte } from '@/lib/csv'
import { verteileMassnahme, type Verteilung, type WiGst } from '@/lib/wein/massnahmeAnteile'
import type { LadeErgebnis } from './typen'
import {
  behandlungKurz, betriebsflaecheWi, jahrZeitraum, ladeBehandlungen, ladeWeingaerten, liste,
  mittelmenge, mittelmengeKg, riedText, spritzbruehe, weingartenText, aufwandEinheitText, STELLEN_MENGE,
  type PsmBehandlung, type WeingartenStamm,
} from './psm'

export const CU_GRENZWERT_KG_HA_JAHR = 4
export const CU_GRENZWERT_KG_HA_5J = 20
export const CU_GRENZWERT_KG_HA_7J = 28
export const CU_WARNSCHWELLE = 0.8
/** Cu-Mengen und -Werte je ha: 4 Nachkommastellen (0,1 g) – wie bisher auf der Druckseite */
export const STELLEN_CU = 4

export type CuStatus = 'ueber' | 'warnung' | 'ok'
export const CU_STATUS_LABEL: Record<CuStatus, string> = {
  ueber: 'über Grenzwert',
  warnung: 'über 80 % des Grenzwerts',
  ok: 'im Rahmen',
}

export function cuStatus(kgHa: number | null, grenzwert = CU_GRENZWERT_KG_HA_JAHR): CuStatus | null {
  if (kgHa === null) return null
  if (kgHa > grenzwert) return 'ueber'
  if (kgHa > grenzwert * CU_WARNSCHWELLE) return 'warnung'
  return 'ok'
}

export type CuGehalt = { pct: number; quelle: 'Stammdaten' | 'Wirkstoffgehalt (Näherung)' }

/** Cu-Gehalt des Mittels; null = kein Kupfermittel */
export function cuGehalt(b: PsmBehandlung): CuGehalt | null {
  const p = b.psm
  if (!p) return null
  if (p.cuGehaltPct !== null && p.cuGehaltPct > 0) return { pct: p.cuGehaltPct, quelle: 'Stammdaten' }
  if ((p.wirkstoff ?? '').toLowerCase().includes('kupfer') && p.wirkstoffgehaltPct !== null && p.wirkstoffgehaltPct > 0) {
    return { pct: p.wirkstoffgehaltPct, quelle: 'Wirkstoffgehalt (Näherung)' }
  }
  return null
}

export type CuBehandlungZeile = {
  behandlungId: string
  datum: string
  jahr: number
  weingarten: string | null
  ried: string | null
  mittel: string
  zulassungsnr: string | null
  cuGehaltPct: number
  cuGehaltQuelle: string
  /** Spritzbrühe der Maßnahme (l) – nur zur Information, nie summieren (Tankmischung) */
  spritzbruehe: number | null
  /** erfasster Aufwand und Einheit (Grundlage der Mittelmenge) */
  aufwand: number | null
  aufwandEinheit: string
  /** Mittelmenge in kg (Grundlage der Cu-Berechnung; Mittel in l mit 1 kg/l) */
  mengeKg: number
  mengeBasis: string
  /** behandelte Fläche (ha) */
  flaecheHa: number | null
  cuKg: number
  cuKgHa: number | null
  /** Anzahl Anwendungen dieses Mittels im selben Jahr (für „Anw. / Max.“) */
  anwendungenImJahr: number
  maxAnwendungen: number | null
}

export type CuWeingartenZeile = {
  jahr: number
  weingartenId: string
  weingarten: string
  ried: string | null
  /** Stammdaten-Fläche des Weingartens (ha) */
  flaecheHa: number | null
  behandlungen: number
  cuKg: number
  cuKgHa: number | null
  grenzwertKgHa: number
  /** Anteil am Jahres-Grenzwert in % */
  auslastungPct: number | null
  status: string
  cuKgHa5J: number | null
  cuKgHa7J: number | null
  /** höchste Belastung einer GST-Zeile dieser Ried im Jahr bzw. über 5/7 Jahre (kg/ha, Regel 6) */
  gstMaxKgHa: number | null
  gstMaxKgHa5J: number | null
  gstMaxKgHa7J: number | null
  /** Ampel der GST-Zeilen gegen 4 kg/ha/Jahr, 20 kg/ha in 5 und 28 kg/ha in 7 Jahren */
  gstStatus: string
}

export type CuJahr = {
  jahr: number
  /** Betriebsfläche (WI-Grundstücke der aktiven Weingärten, ha) */
  gesamtHa: number
  /** Σ Cu (kg) der Einzelbehandlungen (gerundete Werte) */
  cuKg: number
  cuKgHa: number | null
  cuKgHa5J: number | null
  cuKgHa7J: number | null
  status: CuStatus | null
  behandlungen: CuBehandlungZeile[]
  weingaerten: CuWeingartenZeile[]
}

export type CuBilanz = {
  gesamtHa: number
  /** Jahre mit Kupfereinsatz (bzw. das angefragte Jahr), neueste zuerst */
  jahre: CuJahr[]
  /** alle Einzelbehandlungen der ausgegebenen Jahre (chronologisch) – CSV „cu-bilanz-behandlungen“ */
  behandlungsZeilen: CuBehandlungZeile[]
  /** je Jahr × Weingarten (Jahr aufsteigend, Weingarten) – CSV „cu-bilanz“ */
  weingartenZeilen: CuWeingartenZeile[]
  warnungen: string[]
}

function durch(z: number, n: number | null): number | null {
  return n !== null && n > 0 ? runden(z / n, STELLEN_CU) : null
}

/**
 * Kupfer-Bilanz aus den Maßnahmen (beliebig viele Jahre; für die 5-/7-Jahres-Summen die Vorjahre
 * mitgeben). `jahre`: auszugebende Jahre – ohne Angabe alle Jahre mit Kupfereinsatz.
 */
export function cuBilanz(behandlungen: readonly PsmBehandlung[], weingaerten: readonly WeingartenStamm[], opt: { jahre?: readonly number[] | null } = {}): CuBilanz {
  const gesamtHa = betriebsflaecheWi(weingaerten)
  const wgStamm = new Map(weingaerten.map(w => [w.id, w]))
  const warnungen: string[] = []
  // Hinweise je Jahr sammeln – mit Jahresauswahl ausgegeben nur die der ausgegebenen Jahre (Vorjahre zählen nur in die 5-/7-Jahres-Summen)
  type Hinweis = { jahr: number; text: string }
  const ohneMenge: Hinweis[] = []
  const ohneFlaeche: Hinweis[] = []
  const naeherungCu: Hinweis[] = []
  const literAngenommen: Hinweis[] = []

  // 1. Einzelbehandlungen
  const alleZeilen: CuBehandlungZeile[] = []
  // je Jahr → Ried-id → { cu (Σ gerundeter GST-Anteile), anzahl, name, lage, WI-Fläche der verteilten GST (Ersatz) }
  const jeWg = new Map<number, Map<string, { cu: number; anzahl: number; name: string; ried: string | null; gstHa: number }>>()
  // je Jahr → GST-Zeile → { kg/ha (ungerundet), Ried-id }
  const jeGst = new Map<number, Map<string, { kgHa: number; wgId: string }>>()
  const wiGst = new Map<string, WiGst[]>(weingaerten.map(w => [w.id, w.wiGst ?? []]))

  for (const b of [...behandlungen].sort((a, c) => a.datum.localeCompare(c.datum) || a.id.localeCompare(c.id))) {
    const gehalt = cuGehalt(b)
    if (!gehalt) continue
    const mm = mittelmengeKg(b, { literAlsKg: true })
    if (!mm) {
      const warnung = mittelmenge(b).warnung
      ohneMenge.push({ jahr: b.jahr, text: `${behandlungKurz(b)} – ${b.psm?.name ?? ''}${warnung ? `: ${warnung}` : ''}` })
      continue
    }
    if (mm.dichteAngenommen) literAngenommen.push({ jahr: b.jahr, text: behandlungKurz(b) })
    if (gehalt.quelle !== 'Stammdaten') naeherungCu.push({ jahr: b.jahr, text: b.psm?.name ?? '–' })
    const cuKg = runden(mm.kg * gehalt.pct / 100, STELLEN_CU)
    if (b.flaecheHa === null) ohneFlaeche.push({ jahr: b.jahr, text: behandlungKurz(b) })
    alleZeilen.push({
      behandlungId: b.id, datum: b.datum, jahr: b.jahr,
      weingarten: weingartenText(b), ried: riedText(b),
      mittel: b.psm?.name ?? '–', zulassungsnr: b.psm?.zulassungsnr ?? null,
      cuGehaltPct: gehalt.pct, cuGehaltQuelle: gehalt.quelle,
      spritzbruehe: spritzbruehe(b),
      aufwand: b.aufwand !== null ? runden(b.aufwand, STELLEN_MENGE) : null,
      aufwandEinheit: aufwandEinheitText(b.aufwandEinheit),
      mengeKg: mm.kg, mengeBasis: mm.basis,
      flaecheHa: b.flaecheHa,
      cuKg, cuKgHa: durch(cuKg, b.flaecheHa),
      anwendungenImJahr: 0,
      maxAnwendungen: b.psm?.maxAnwendungen && b.psm.maxAnwendungen > 0 ? b.psm.maxAnwendungen : null,
    })

    // KAN-132: Anteile je GST-Zeile (zentrale Funktion), Cu der Maßnahme = cuKg (dieselbe Rundung)
    const v: Verteilung = verteileMassnahme(b, { cuPct: gehalt.pct, literAlsKg: true, wiGstJeWeingarten: wiGst })
    const orte = v.anteile.filter(a => a.weingartenId)
    if (orte.length === 0) continue
    const jahrMap: Map<string, { cu: number; anzahl: number; name: string; ried: string | null; gstHa: number }> = jeWg.get(b.jahr) ?? new Map()
    const gstMap = jeGst.get(b.jahr) ?? new Map<string, { kgHa: number; wgId: string }>()
    const gezaehlt = new Set<string>()
    for (const a of orte) {
      const id = a.weingartenId as string
      const e = jahrMap.get(id) ?? { cu: 0, anzahl: 0, name: a.weingarten ?? '–', ried: a.lage, gstHa: 0 }
      e.cu = runden(e.cu + (a.cuKg ?? 0), STELLEN_CU)
      if (!gezaehlt.has(id)) {
        e.anzahl += 1; gezaehlt.add(id)
        e.gstHa = Math.max(e.gstHa, orte.filter(o => o.weingartenId === id).reduce((s, o) => s + (o.flaecheHa ?? 0), 0))
      }
      jahrMap.set(id, e)
      if (a.grundstueckId && a.cuKgHa !== null) {
        const g = gstMap.get(a.grundstueckId) ?? { kgHa: 0, wgId: id }
        g.kgHa += a.cuKgHa
        gstMap.set(a.grundstueckId, g)
      }
    }
    jeWg.set(b.jahr, jahrMap)
    jeGst.set(b.jahr, gstMap)
  }

  // Anwendungen je Mittel und Jahr
  const anw = new Map<string, number>()
  for (const z of alleZeilen) anw.set(`${z.jahr}|${z.mittel}`, (anw.get(`${z.jahr}|${z.mittel}`) ?? 0) + 1)
  for (const z of alleZeilen) z.anwendungenImJahr = anw.get(`${z.jahr}|${z.mittel}`) ?? 1

  // 2. Jahre
  const jahreMitCu = [...new Set(alleZeilen.map(z => z.jahr))]
  const ausgabe = [...new Set(opt.jahre && opt.jahre.length ? opt.jahre : jahreMitCu)].sort((a, b) => b - a)
  const cuJahrBetrieb = new Map<number, number>()
  for (const z of alleZeilen) cuJahrBetrieb.set(z.jahr, (cuJahrBetrieb.get(z.jahr) ?? 0) + z.cuKg)
  const summeBetrieb = (jahr: number, n: number) => {
    let s = 0
    for (let j = jahr - n + 1; j <= jahr; j++) s += cuJahrBetrieb.get(j) ?? 0
    return s
  }
  const wgCuGerundet = (jahr: number, id: string) => runden(jeWg.get(jahr)?.get(id)?.cu ?? 0, STELLEN_CU)
  /** höchste Σ kg/ha einer GST-Zeile der Ried über n Jahre bis jahr (Regel 6, ungerundet) */
  const gstMax = (jahr: number, wgId: string, n: number): number | null => {
    const summe = new Map<string, number>()
    for (let j = jahr - n + 1; j <= jahr; j++) {
      for (const [gid, g] of jeGst.get(j) ?? []) if (g.wgId === wgId) summe.set(gid, (summe.get(gid) ?? 0) + g.kgHa)
    }
    return summe.size > 0 ? Math.max(...summe.values()) : null
  }
  const summeWg = (jahr: number, id: string, n: number) => {
    let s = 0
    for (let j = jahr - n + 1; j <= jahr; j++) s += wgCuGerundet(j, id)
    return s
  }

  const jahre: CuJahr[] = ausgabe.map(jahr => {
    const behZeilen = alleZeilen.filter(z => z.jahr === jahr)
    const cuKg = runden(behZeilen.reduce((s, z) => s + z.cuKg, 0), STELLEN_CU)
    const cuKgHa = durch(cuKg, gesamtHa)
    const wgZeilen: CuWeingartenZeile[] = [...(jeWg.get(jahr)?.entries() ?? [])].map(([id, e]) => {
      const stamm = wgStamm.get(id)
      // KAN-132 Regel 8: Nenner = WI-GST-Fläche der Ried (Stand heute), sonst die Fläche der verteilten GST
      const flaeche = stamm && stamm.wiFlaecheHa > 0 ? stamm.wiFlaecheHa : (e.gstHa > 0 ? runden(e.gstHa, STELLEN.ha) : null)
      const cu = wgCuGerundet(jahr, id)
      const kgHa = durch(cu, flaeche)
      const st = cuStatus(kgHa)
      return {
        jahr, weingartenId: id, weingarten: stamm?.name ?? e.name, ried: stamm?.ried ?? e.ried,
        flaecheHa: flaeche, behandlungen: e.anzahl, cuKg: cu, cuKgHa: kgHa,
        grenzwertKgHa: CU_GRENZWERT_KG_HA_JAHR,
        auslastungPct: kgHa !== null ? runden(kgHa / CU_GRENZWERT_KG_HA_JAHR * 100, 1) : null,
        status: st ? CU_STATUS_LABEL[st] : 'Fläche fehlt',
        cuKgHa5J: durch(summeWg(jahr, id, 5), flaeche),
        cuKgHa7J: durch(summeWg(jahr, id, 7), flaeche),
        ...gstAmpel(gstMax(jahr, id, 1), gstMax(jahr, id, 5), gstMax(jahr, id, 7)),
      }
    }).sort((a, b) => (a.ried ?? '').localeCompare(b.ried ?? '', 'de') || a.weingarten.localeCompare(b.weingarten, 'de'))
    return {
      jahr, gesamtHa, cuKg, cuKgHa,
      cuKgHa5J: durch(runden(summeBetrieb(jahr, 5), STELLEN_CU), gesamtHa),
      cuKgHa7J: durch(runden(summeBetrieb(jahr, 7), STELLEN_CU), gesamtHa),
      status: cuStatus(cuKgHa),
      behandlungen: behZeilen,
      weingaerten: wgZeilen,
    }
  })

  const ausgabeSet = new Set(ausgabe)
  // ohne Jahresauswahl (Berichte-Tab „Cu-Bilanz“) gelten alle Hinweise – auch aus Jahren, in denen
  // keine Kupfer-Anwendung eine Mittelmenge hat (sonst verschwände z. B. eine Spritzung „ohne Aufwand“ still)
  const alleJahre = !(opt.jahre && opt.jahre.length)
  const imZeitraum = (h: Hinweis[]) => h.filter(x => alleJahre || ausgabeSet.has(x.jahr)).map(x => x.text)
  const vorjahre = alleJahre ? 0 : ohneMenge.filter(x => !ausgabeSet.has(x.jahr) && ausgabe.some(j => x.jahr < j && x.jahr > j - 7)).length
  const aMenge = imZeitraum(ohneMenge), aFlaeche = imZeitraum(ohneFlaeche), aLiter = imZeitraum(literAngenommen)
  const aCu = [...new Set(imZeitraum(naeherungCu))]
  if (aMenge.length > 0) warnungen.push(`${aMenge.length} Kupfer-${aMenge.length === 1 ? 'Anwendung' : 'Anwendungen'} ohne berechenbare Mittelmenge (Aufwand fehlt oder ist nicht umrechenbar) – nicht in der Bilanz: ${liste(aMenge)}`)
  if (vorjahre > 0) warnungen.push(`${vorjahre} Kupfer-${vorjahre === 1 ? 'Anwendung' : 'Anwendungen'} der Vorjahre ohne berechenbare Mittelmenge – fehlt in den 5-/7-Jahres-Summen.`)
  if (aFlaeche.length > 0) warnungen.push(`${aFlaeche.length} Kupfer-${aFlaeche.length === 1 ? 'Anwendung' : 'Anwendungen'} ohne behandelte Fläche – Cu (kg/ha) bleibt leer: ${liste(aFlaeche)}`)
  if (aLiter.length > 0) warnungen.push(`${aLiter.length} Kupfer-${aLiter.length === 1 ? 'Anwendung' : 'Anwendungen'} mit Mittelmenge in Litern – Dichte 1 kg/l angenommen (wie bisher): ${liste(aLiter)}`)
  if (aCu.length > 0) warnungen.push(`Cu-Gehalt fehlt in den Mittel-Stammdaten (${liste(aCu)}) – Wirkstoffgehalt als Näherung verwendet; bitte Cu-Gehalt unter Betriebsmittel ergänzen.`)
  const ohneWgFlaeche = jahre.flatMap(j => j.weingaerten.filter(w => w.flaecheHa === null).map(w => w.weingarten))
  if (ohneWgFlaeche.length > 0) warnungen.push(`Ried ohne Grundstücke mit Nutzart WI und ohne Fläche – Cu (kg/ha) bleibt leer: ${liste([...new Set(ohneWgFlaeche)])}`)
  if (jahre.some(j => String(j.jahr) < wienHeute().slice(0, 4) && j.weingaerten.length > 0)) warnungen.push('Cu je ha der Rieden in Vorjahren: Fläche Stand heute (WI-Grundstücke).')
  if (gesamtHa <= 0 && alleZeilen.some(z => ausgabeSet.has(z.jahr))) warnungen.push('Keine Grundstücke mit Nutzart WI in aktiven Weingärten – Cu je ha des Betriebs nicht berechenbar.')

  return {
    gesamtHa,
    jahre,
    behandlungsZeilen: alleZeilen.filter(z => ausgabeSet.has(z.jahr)),
    weingartenZeilen: [...jahre].sort((a, b) => a.jahr - b.jahr).flatMap(j => j.weingaerten),
    warnungen,
  }
}

/** Ampel der GST-Zeilen (KAN-132 Frage 8): alle drei Cu-Schwellen, Warnung ab 80 % */
function gstAmpel(jahr: number | null, fuenf: number | null, sieben: number | null): Pick<CuWeingartenZeile, 'gstMaxKgHa' | 'gstMaxKgHa5J' | 'gstMaxKgHa7J' | 'gstStatus'> {
  const r = (x: number | null) => (x === null ? null : runden(x, STELLEN_CU))
  const st = [cuStatus(jahr, CU_GRENZWERT_KG_HA_JAHR), cuStatus(fuenf, CU_GRENZWERT_KG_HA_5J), cuStatus(sieben, CU_GRENZWERT_KG_HA_7J)]
  const schlimmste = st.includes('ueber') ? 'ueber' : st.includes('warnung') ? 'warnung' : st.includes('ok') ? 'ok' : null
  return { gstMaxKgHa: r(jahr), gstMaxKgHa5J: r(fuenf), gstMaxKgHa7J: r(sieben), gstStatus: schlimmste ? CU_STATUS_LABEL[schlimmste] : '–' }
}

// KAN-132: „Ried“ = Entität weingarten, „Lage“ die Ebene darüber
export const SPALTEN_CU_BILANZ: CsvSpalte<CuWeingartenZeile>[] = [
  { kopf: 'Jahr', typ: 'ganzzahl', wert: z => z.jahr },
  { kopf: 'Ried', typ: 'text', wert: z => z.weingarten },
  { kopf: 'Lage', typ: 'text', wert: z => z.ried },
  { kopf: 'Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'Kupfer-Anwendungen', typ: 'ganzzahl', wert: z => z.behandlungen },
  { kopf: 'Cu (kg)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.cuKg },
  { kopf: 'Cu (kg/ha)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.cuKgHa },
  { kopf: 'Grenzwert (kg/ha/Jahr)', typ: 'dezimal', stellen: 2, wert: z => z.grenzwertKgHa },
  { kopf: 'Auslastung (%)', typ: 'prozent', stellen: 1, wert: z => z.auslastungPct },
  { kopf: 'Status', typ: 'text', wert: z => z.status },
  { kopf: 'Cu 5 Jahre (kg/ha)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.cuKgHa5J },
  { kopf: 'Cu 7 Jahre (kg/ha)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.cuKgHa7J },
  { kopf: 'Höchste GST-Belastung (kg/ha)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.gstMaxKgHa },
  { kopf: 'Höchste GST-Belastung 5 Jahre (kg/ha)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.gstMaxKgHa5J },
  { kopf: 'Höchste GST-Belastung 7 Jahre (kg/ha)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.gstMaxKgHa7J },
  { kopf: 'Status GST', typ: 'text', wert: z => z.gstStatus },
]

export const SPALTEN_CU_BEHANDLUNGEN: CsvSpalte<CuBehandlungZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Ried', typ: 'text', wert: z => z.weingarten },
  { kopf: 'Lage', typ: 'text', wert: z => z.ried },
  { kopf: 'Mittel', typ: 'text', wert: z => z.mittel },
  { kopf: 'Zulassungsnr.', typ: 'code', wert: z => z.zulassungsnr },
  { kopf: 'Cu-Gehalt (%)', typ: 'prozent', wert: z => z.cuGehaltPct },
  { kopf: 'Cu-Gehalt Quelle', typ: 'text', wert: z => z.cuGehaltQuelle },
  { kopf: 'Spritzbrühe (l)', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.spritzbruehe },
  { kopf: 'Aufwand', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.aufwand },
  { kopf: 'Aufwand-Einheit', typ: 'text', wert: z => z.aufwandEinheit },
  { kopf: 'Mittelmenge (kg)', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.mengeKg },
  { kopf: 'Mengenbasis', typ: 'text', wert: z => z.mengeBasis },
  { kopf: 'Behandelte Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'Cu (kg)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.cuKg },
  { kopf: 'Cu (kg/ha)', typ: 'dezimal', stellen: STELLEN_CU, wert: z => z.cuKgHa },
]

export type CuBilanzParameter = { jahr: number | null }

/**
 * Ladefunktion der Druckseite /reports/cu-bilanz UND beider CSV-Dateien. Lädt für die
 * 7-Jahres-Summe die sechs Vorjahre mit. zeilen = je Weingarten (CSV „cu-bilanz“).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeCuBilanz(supabase: any, tenantId: string, p: CuBilanzParameter): Promise<LadeErgebnis<CuWeingartenZeile> & CuBilanz & { warnungen: string[] }> {
  const [{ behandlungen, warnungen }, weingaerten] = await Promise.all([
    ladeBehandlungen(supabase, tenantId, jahrZeitraum(p.jahr, 6)),
    ladeWeingaerten(supabase, tenantId),
  ])
  const bilanz = cuBilanz(behandlungen, weingaerten, { jahre: p.jahr !== null ? [p.jahr] : null })
  return { ...bilanz, zeilen: bilanz.weingartenZeilen, warnungen: [...warnungen, ...bilanz.warnungen] }
}
