// ── Anlagenverzeichnis: AfA-Rechenlogik (Migration 200) ─────────────────────
//
// Übernommen aus kps-smart-buchhaltung (Welle 7/8), Spaltennamen der Tabelle
// ea_anlagen. Regeln (Österreich, EStG):
// - Lineare AfA: Anschaffungskosten (abzüglich Restwert) gleichmäßig über die
//   Nutzungsdauer (§ 7 Abs. 1).
// - Halbjahresregel (§ 7 Abs. 2): Inbetriebnahme im 2. Halbjahr → im ersten
//   Jahr nur die halbe Jahres-AfA; die fehlende Hälfte verlängert die
//   Abschreibung um ein Jahr. Beim Abgang im 1. Halbjahr ebenfalls halbe AfA.
// - Degressive AfA (§ 7 Abs. 1a): fester Prozentsatz (max. 30 %) vom
//   Restbuchwert; Wechsel zur linearen AfA, sobald diese höher wäre.
// - GWG (§ 13): Sofortabschreibung im Jahr der Anschaffung.
//
// Keine Datenbankzugriffe - reine Funktionen (gegen die Testfälle der
// KPS-Vorlage geprüft, siehe docs/Anlagen_AfA.md).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund2 } from '../zahl/runden.ts'
export type AfaMethode = 'linear' | 'degressiv' | 'gwg'

export type Anlage = {
  id: string
  name: string
  gruppe: string | null
  konto_nr: number | null
  anschaffung_am: string;          // YYYY-MM-DD
  ak_netto: number
  nutzungsdauer_jahre: number
  methode: AfaMethode
  degressiv_satz: number | null
  restwert: number
  abgang_am: string | null
  veraeusserungserloes: number | null
}

export type AfaZeile = {
  jahr: number
  /** Buchwert am 1.1. (bzw. Anschaffungskosten im Zugangsjahr) */
  buchwertAnfang: number
  afa: number
  buchwertEnde: number
  /** halbe Jahres-AfA (Halbjahresregel) */
  halb: boolean
  /** Jahr des Abgangs – buchwertEnde ist dann der Restbuchwert beim Abgang */
  abgang: boolean
}

const rund = rund2
const jahrVon = (iso: string) => Number(iso.slice(0, 4))
const zweitesHalbjahr = (iso: string) => Number(iso.slice(5, 7)) >= 7

/** Jahres-AfA-Satz in Prozent (linear), z. B. 33,33 bei 3 Jahren */
export function afaSatzProzent(a: Pick<Anlage, 'nutzungsdauer_jahre' | 'methode' | 'degressiv_satz'>): number {
  if (a.methode === 'gwg') return 100
  if (a.methode === 'degressiv') return Number(a.degressiv_satz ?? 30)
  return rund(100 / Math.max(1, a.nutzungsdauer_jahre))
}

/**
 * Vollständiger AfA-Plan vom Zugangsjahr bis zum letzten Jahr mit AfA
 * (oder bis zum Abgang). Endet, sobald der Restwert erreicht ist.
 */
export function afaPlan(a: Anlage): AfaZeile[] {
  const zeilen: AfaZeile[] = []
  const kosten = Number(a.ak_netto)
  const rest = Math.min(Number(a.restwert ?? 0), kosten)
  const basis = rund(kosten - rest);                      // abschreibbarer Betrag
  if (basis <= 0) return zeilen

  const start = jahrVon(a.anschaffung_am)
  const abgangJahr = a.abgang_am ? jahrVon(a.abgang_am) : null
  const nd = Math.max(1, a.nutzungsdauer_jahre)
  const jahresAfa = rund(basis / nd)
  const halbErstesJahr = a.methode !== 'gwg' && zweitesHalbjahr(a.anschaffung_am)

  let buchwert = kosten
  // Sicherheitsgrenze: Nutzungsdauer + 1 (Halbjahresregel) + Puffer
  for (let jahr = start; jahr <= start + nd + 2; jahr++) {
    const verbleibend = rund(buchwert - rest)
    if (verbleibend <= 0) break

    let afa: number
    let halb = false

    if (a.methode === 'gwg') {
      afa = verbleibend
    } else if (a.methode === 'degressiv') {
      const satz = Number(a.degressiv_satz ?? 30) / 100
      const degressiv = rund(buchwert * satz)
      // Restlaufzeit ab diesem Jahr (Halbjahresregel verlängert um 1)
      const gelaufen = jahr - start
      const restJahre = Math.max(1, nd + (halbErstesJahr ? 1 : 0) - gelaufen)
      const linearRest = rund(verbleibend / restJahre)
      afa = Math.max(degressiv, linearRest);           // Wechsel auf linear, sobald günstiger
      if (jahr === start && halbErstesJahr) { afa = rund(afa / 2); halb = true; }
    } else {
      afa = jahresAfa
      if (jahr === start && halbErstesJahr) { afa = rund(jahresAfa / 2); halb = true; }
    }

    // Abgang: im 1. Halbjahr nur halbe AfA, danach Restbuchwert
    let abgang = false
    if (abgangJahr !== null && jahr >= abgangJahr) {
      abgang = true
      if (jahr === abgangJahr && a.abgang_am && !zweitesHalbjahr(a.abgang_am) && a.methode !== 'gwg') {
        afa = rund(afa / 2); halb = true
      }
    }

    afa = Math.min(afa, verbleibend)
    afa = rund(afa)
    zeilen.push({ jahr, buchwertAnfang: rund(buchwert), afa, buchwertEnde: rund(buchwert - afa), halb, abgang })
    buchwert = rund(buchwert - afa)
    if (abgang) break
  }
  return zeilen
}

/** AfA eines bestimmten Jahres (0, wenn außerhalb des Plans) */
export function afaImJahr(a: Anlage, jahr: number): number {
  return afaPlan(a).find(z => z.jahr === jahr)?.afa ?? 0
}

/**
 * Buchwert zum Stichtag: Anschaffungskosten abzüglich aller AfA bis
 * einschließlich des Vorjahres – innerhalb des laufenden Jahres bleibt
 * der Buchwert bis zum Jahresende konstant (AfA wird jährlich gebucht).
 * Nach dem Abgang: 0.
 */
export function buchwertAm(a: Anlage, stichtag: string): number {
  if (a.abgang_am && a.abgang_am <= stichtag) return 0
  if (a.anschaffung_am > stichtag) return 0
  const jahr = jahrVon(stichtag)
  const bisVorjahr = afaPlan(a).filter(z => z.jahr < jahr)
  const letzte = bisVorjahr[bisVorjahr.length - 1]
  return letzte ? letzte.buchwertEnde : rund(Number(a.ak_netto))
}

/** Buchwert am Ende eines Jahres (31.12.) */
export function buchwertEndeJahr(a: Anlage, jahr: number): number {
  if (a.abgang_am && jahrVon(a.abgang_am) <= jahr) return 0
  if (jahrVon(a.anschaffung_am) > jahr) return 0
  const bis = afaPlan(a).filter(z => z.jahr <= jahr)
  const letzte = bis[bis.length - 1]
  return letzte ? letzte.buchwertEnde : rund(Number(a.ak_netto))
}

export type Anlagenspiegel = {
  jahr: number
  anzahlAktiv: number
  anschaffungskosten: number;   // aller am Jahresende vorhandenen Anlagen
  zugaenge: number;             // AK der im Jahr angeschafften
  abgaenge: number;             // AK der im Jahr abgegangenen
  afaJahr: number
  kumulierteAfa: number;        // bis Jahresende, Bestand
  buchwertEnde: number
  /** Buchwert der Abgänge zum Abgangszeitpunkt (Restbuchwert) */
  restbuchwertAbgaenge: number
  veraeusserungserloese: number
}

export function anlagenspiegel(anlagen: Anlage[], jahr: number): Anlagenspiegel {
  const s: Anlagenspiegel = {
    jahr, anzahlAktiv: 0, anschaffungskosten: 0, zugaenge: 0, abgaenge: 0, afaJahr: 0,
    kumulierteAfa: 0, buchwertEnde: 0, restbuchwertAbgaenge: 0, veraeusserungserloese: 0,
  }
  for (const a of anlagen) {
    const zugang = jahrVon(a.anschaffung_am)
    const abgang = a.abgang_am ? jahrVon(a.abgang_am) : null
    if (zugang > jahr) continue
    const kosten = Number(a.ak_netto)
    s.afaJahr += afaImJahr(a, jahr)
    if (zugang === jahr) s.zugaenge += kosten
    if (abgang === jahr) {
      s.abgaenge += kosten
      const plan = afaPlan(a)
      s.restbuchwertAbgaenge += plan[plan.length - 1]?.buchwertEnde ?? 0
      s.veraeusserungserloese += Number(a.veraeusserungserloes ?? 0)
    }
    if (abgang === null || abgang > jahr) {
      s.anzahlAktiv += 1
      s.anschaffungskosten += kosten
      const bw = buchwertEndeJahr(a, jahr)
      s.buchwertEnde += bw
      s.kumulierteAfa += kosten - bw
    }
  }
  for (const k of Object.keys(s) as (keyof Anlagenspiegel)[]) {
    if (k !== 'jahr' && k !== 'anzahlAktiv') (s[k] as number) = rund(s[k] as number)
  }
  return s
}

// ── AfA-Buchung am Jahresende und Anlagenspiegel je Zeile ────────────────────

export type AfaBuchungRoh = {
  id: string
  anlage_id: string | null
  betrag_netto: number
  datum: string
  is_locked: boolean
}

export type AfaBuchungsZeile = {
  anlage: Anlage
  /** AfA laut Verzeichnis */
  soll: number
  /** bereits gebuchter Betrag (0 = keine Buchung) */
  ist: number
  buchungId: string | null
  gesperrt: boolean
  status: 'gebucht' | 'offen' | 'abweichend' | 'ueberfluessig'
}

export type AfaBuchungsStatus = {
  jahr: number
  zeilen: AfaBuchungsZeile[]
  soll: number
  ist: number
  offen: number;          // Anzahl zu buchender Zeilen (offen + abweichend + überflüssig)
  gesperrt: number;       // Buchungen in gesperrten Monaten
  komplett: boolean;      // alles gebucht und stimmig
}

/**
 * Vergleicht die AfA laut Verzeichnis mit den gebuchten AfA-Buchungen
 * eines Jahres (transactions mit anlage_id). Anlagen ohne AfA im Jahr
 * erscheinen nur, wenn trotzdem eine Buchung existiert (überflüssig).
 */
export function afaBuchungsStatus(anlagen: Anlage[], jahr: number, buchungen: AfaBuchungRoh[]): AfaBuchungsStatus {
  const gebucht = new Map<string, AfaBuchungRoh>()
  for (const b of buchungen) {
    if (b.anlage_id && jahrVon(b.datum) === jahr) gebucht.set(b.anlage_id, b)
  }
  const zeilen: AfaBuchungsZeile[] = []
  for (const a of anlagen) {
    const soll = afaImJahr(a, jahr)
    const b = gebucht.get(a.id)
    const ist = b ? rund(Number(b.betrag_netto)) : 0
    if (soll <= 0 && !b) continue
    const status: AfaBuchungsZeile['status'] =
      !b ? 'offen' : soll <= 0 ? 'ueberfluessig' : Math.abs(ist - soll) < 0.005 ? 'gebucht' : 'abweichend'
    zeilen.push({ anlage: a, soll, ist, buchungId: b?.id ?? null, gesperrt: !!b?.is_locked, status })
  }
  zeilen.sort((x, y) => x.anlage.anschaffung_am.localeCompare(y.anlage.anschaffung_am) || x.anlage.name.localeCompare(y.anlage.name))
  const soll = rund(zeilen.reduce((s, z) => s + z.soll, 0))
  const ist = rund(zeilen.reduce((s, z) => s + z.ist, 0))
  const offen = zeilen.filter(z => z.status !== 'gebucht').length
  const gesperrt = zeilen.filter(z => z.gesperrt).length
  return { jahr, zeilen, soll, ist, offen, gesperrt, komplett: zeilen.length > 0 && offen === 0 }
}

export type SpiegelZeile = {
  anlage: Anlage
  buchwertAnfang: number;   // 1.1. (0 bei Zugang im Jahr)
  zugang: number;           // AK bei Zugang im Jahr
  abgang: number;           // AK bei Abgang im Jahr
  afa: number
  halb: boolean
  kumulierteAfa: number;    // bis 31.12. bzw. bis zum Abgang
  buchwertEnde: number;     // 31.12. (0 nach Abgang)
  restbuchwertAbgang: number
  erloes: number
  abgegangen: boolean
}

/** Anlagenspiegel je Anlage – Grundlage der Druckseite. Nur Anlagen, die im Jahr vorhanden waren. */
export function anlagenspiegelZeilen(anlagen: Anlage[], jahr: number): { zeilen: SpiegelZeile[]; summe: Anlagenspiegel } {
  const zeilen: SpiegelZeile[] = []
  for (const a of anlagen) {
    const zugangJahr = jahrVon(a.anschaffung_am)
    const abgangJahr = a.abgang_am ? jahrVon(a.abgang_am) : null
    if (zugangJahr > jahr) continue
    if (abgangJahr !== null && abgangJahr < jahr) continue
    const kosten = rund(Number(a.ak_netto))
    const plan = afaPlan(a)
    const zeile = plan.find(z => z.jahr === jahr)
    const abgegangen = abgangJahr === jahr
    const buchwertAnfang = zugangJahr === jahr ? 0 : buchwertEndeJahr(a, jahr - 1)
    const buchwertEnde = abgegangen ? 0 : buchwertEndeJahr(a, jahr)
    const restbuchwertAbgang = abgegangen ? (plan[plan.length - 1]?.buchwertEnde ?? kosten) : 0
    zeilen.push({
      anlage: a,
      buchwertAnfang,
      zugang: zugangJahr === jahr ? kosten : 0,
      abgang: abgegangen ? kosten : 0,
      afa: zeile?.afa ?? 0,
      halb: zeile?.halb ?? false,
      kumulierteAfa: rund(kosten - (abgegangen ? restbuchwertAbgang : buchwertEnde)),
      buchwertEnde,
      restbuchwertAbgang,
      erloes: abgegangen ? rund(Number(a.veraeusserungserloes ?? 0)) : 0,
      abgegangen,
    })
  }
  zeilen.sort((x, y) => (x.anlage.gruppe ?? '').localeCompare(y.anlage.gruppe ?? '') || x.anlage.anschaffung_am.localeCompare(y.anlage.anschaffung_am) || x.anlage.name.localeCompare(y.anlage.name))
  return { zeilen, summe: anlagenspiegel(anlagen, jahr) }
}
