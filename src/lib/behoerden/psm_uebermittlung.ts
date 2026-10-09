// ── Meldung „psm-uebermittlung“ (KAN-87, 05.10.2026) ────────────────────────────────────────────────────
//
// Maschinenlesbare Pflanzenschutz-Aufzeichnung nach DVO (EU) 2023/564 (elektronisch, spätestens 30 Tage nach der
// Anwendung; Stichtag 01.01.2027 nach DVO (EU) 2025/2203) – vorbereitet für die künftige digitale Übermittlung.
// Eine Zeile je Anwendung (Maßnahme mit Pflanzenschutzmittel) × Grundstück. KAN-120 verwendet dieselbe Ladefunktion
// und dieselben Spalten weiter – kein zweites CSV-Format.
// Ladefunktion = ladeBehandlungen() aus psm.ts (dieselbe wie die Druckseite des Behandlungsprotokolls).

import { STELLEN, type CsvSpalte } from '@/lib/csv'
import type { LadeErgebnis } from './typen'
import {
  aufwandEinheitText, amaNummern, EPPO_REBE, jahrZeitraum, KULTUR_REBE, ladeBehandlungen, liste, behandlungKurz,
  ART_LABEL, STELLEN_MENGE, type PsmBehandlung,
} from './psm'
import { verteileMassnahme } from '@/lib/wein/massnahmeAnteile'
import { erfassungsverzugH, fristAus, PSM_FRIST_STANDARD_H } from '@/lib/behandlungen/erfassungsfrist'

export type PsmUebermittlungZeile = {
  datensatzId: string
  betriebsnummer: string | null
  anwender: string | null
  datum: string
  datumBis: string | null
  startzeit: string | null
  endzeit: string | null
  /** Art der Verwendung (Freiland …) */
  artVerwendung: string | null
  /** Maßnahmenart (Spritzung, Sonstiges) */
  massnahme: string
  kultur: string
  eppoKultur: string
  /** EPPO-Code des Hauptschaderregers (Stammdaten des Mittels) */
  eppoSchaderreger: string | null
  bbch: string | null
  mittel: string | null
  registernummer: string | null
  aufwand: number | null
  aufwandEinheit: string
  flaecheHa: number | null
  kgNr: string | null
  kgName: string | null
  gstNr: string | null
  feldstueck: string | null
  schlag: string | null
  erfasstAm: string | null
  erfasstVon: string | null
  /** Volle Stunden zwischen Tagesende der Anwendung und Erfassung */
  verzugH: number | null
  nacherfasst: boolean | null
}

export type PsmUebermittlungParameter = { jahr: number | null }

/** Zeilen (gerundet) und Hinweise – nur Maßnahmen mit Pflanzenschutzmittel */
export function psmUebermittlungZeilen(
  behandlungen: readonly PsmBehandlung[], betriebsnummer: string | null, fristH: number = PSM_FRIST_STANDARD_H,
): { zeilen: PsmUebermittlungZeile[]; warnungen: string[] } {
  const zeilen: PsmUebermittlungZeile[] = []
  const ohneAnwender: string[] = []
  const ohneRegister = new Set<string>()
  for (const b of behandlungen) {
    if (!b.psm) continue
    if (!b.anwender) ohneAnwender.push(behandlungKurz(b))
    if (!b.psm.zulassungsnr) ohneRegister.add(b.psm.name)
    const verzugH = b.erfasstAm
      ? erfassungsverzugH({ datum: b.datum, datumBis: b.datumBis }, b.erfasstAm)
      : null
    const orte = verteileMassnahme(b).anteile
    for (const g of orte.length > 0 ? orte : [null]) {
      zeilen.push({
        datensatzId: b.id,
        betriebsnummer,
        anwender: b.anwender,
        datum: b.datum,
        datumBis: b.datumBis,
        startzeit: b.uhrzeitVon ?? null,
        endzeit: b.uhrzeitBis ?? null,
        artVerwendung: b.artVerwendung ?? null,
        massnahme: ART_LABEL[b.art] ?? b.art,
        kultur: KULTUR_REBE,
        eppoKultur: EPPO_REBE,
        eppoSchaderreger: b.psm.eppoCode,
        bbch: b.bbch,
        mittel: b.psm.name,
        registernummer: b.psm.zulassungsnr,
        aufwand: b.aufwand,
        aufwandEinheit: aufwandEinheitText(b.aufwandEinheit),
        flaecheHa: g?.flaecheHa ?? b.flaecheHa,
        kgNr: g?.kgNr ?? null,
        kgName: g?.kgName ?? null,
        gstNr: g?.gstNr ?? null,
        ...(() => { const a = amaNummern(b, g?.grundstueckId ?? null, g?.weingartenId ?? null); return { feldstueck: a.amaFeldstueck, schlag: a.amaSchlag } })(),
        erfasstAm: b.erfasstAm ?? null,
        erfasstVon: b.erfasstVon ?? null,
        verzugH,
        nacherfasst: verzugH === null ? null : verzugH > fristH,
      })
    }
  }
  const warnungen: string[] = []
  if (ohneAnwender.length > 0) warnungen.push(`${ohneAnwender.length} ${ohneAnwender.length === 1 ? 'Anwendung hat' : 'Anwendungen haben'} keinen Anwender (Pflichtangabe nach DVO (EU) 2023/564) – bitte in der Maßnahme ergänzen: ${liste(ohneAnwender)}`)
  if (ohneRegister.size > 0) warnungen.push(`${ohneRegister.size} ${ohneRegister.size === 1 ? 'Mittel hat' : 'Mittel haben'} keine Registernummer – bitte unter Pflanzenschutz › Lager › Stammdaten ergänzen: ${liste([...ohneRegister].sort((a, c) => a.localeCompare(c, 'de')))}`)
  if (!betriebsnummer) warnungen.push('Die Betriebsnummer fehlt – bitte unter Betrieb › Einstellungen ergänzen.')
  return { zeilen, warnungen }
}

export const SPALTEN_PSM_UEBERMITTLUNG: CsvSpalte<PsmUebermittlungZeile>[] = [
  { kopf: 'Datensatz-ID', typ: 'code', wert: z => z.datensatzId },
  { kopf: 'Betriebsnummer', typ: 'code', wert: z => z.betriebsnummer },
  { kopf: 'Anwender', typ: 'text', wert: z => z.anwender },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Datum bis', typ: 'datum', wert: z => z.datumBis },
  { kopf: 'Startzeit', typ: 'text', wert: z => z.startzeit },
  { kopf: 'Endzeit', typ: 'text', wert: z => z.endzeit },
  { kopf: 'Art der Verwendung', typ: 'text', wert: z => z.artVerwendung },
  { kopf: 'Maßnahme', typ: 'text', wert: z => z.massnahme },
  { kopf: 'Kultur', typ: 'text', wert: z => z.kultur },
  { kopf: 'EPPO-Code Kultur', typ: 'code', wert: z => z.eppoKultur },
  { kopf: 'EPPO-Code Schaderreger', typ: 'code', wert: z => z.eppoSchaderreger },
  { kopf: 'BBCH', typ: 'code', wert: z => z.bbch },
  { kopf: 'Mittel', typ: 'text', wert: z => z.mittel },
  { kopf: 'Registernummer', typ: 'code', wert: z => z.registernummer },
  { kopf: 'Aufwand', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.aufwand },
  { kopf: 'Aufwand-Einheit', typ: 'text', wert: z => z.aufwandEinheit },
  { kopf: 'Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.kgNr },
  { kopf: 'Katastralgemeinde', typ: 'text', wert: z => z.kgName },
  { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gstNr },
  { kopf: 'AMA-Feldstück', typ: 'code', wert: z => z.feldstueck },
  { kopf: 'AMA-Schlag', typ: 'code', wert: z => z.schlag },
  { kopf: 'Erfasst am', typ: 'zeitpunkt', wert: z => z.erfasstAm },
  { kopf: 'Erfasst von', typ: 'text', wert: z => z.erfasstVon },
  { kopf: 'Verzug (h)', typ: 'ganzzahl', wert: z => z.verzugH },
  { kopf: 'Nacherfasst', typ: 'janein', wert: z => z.nacherfasst },
]

/** Ladefunktion der CSV „psm-uebermittlung“ (und künftig KAN-120) */
export async function ladePsmUebermittlung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, betriebsnummer: string | null, p: PsmUebermittlungParameter,
): Promise<LadeErgebnis<PsmUebermittlungZeile>> {
  const [{ behandlungen, warnungen }, { data: einst, error: einstErr }] = await Promise.all([
    ladeBehandlungen(supabase, tenantId, jahrZeitraum(p.jahr)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any).select('psm_erfassungsfrist_h').eq('tenant_id', tenantId).maybeSingle(),
  ])
  // KAN-254: sonst die Standardfrist statt der des Betriebs – falsche „verspätet“-Kennzeichen in der Meldung
  if (einstErr) throw new Error(`Erfassungsfrist konnte nicht geladen werden: ${einstErr.message}`)
  const e = psmUebermittlungZeilen(behandlungen, betriebsnummer, fristAus(einst?.psm_erfassungsfrist_h))
  return { zeilen: e.zeilen, warnungen: [...warnungen, ...e.warnungen] }
}
