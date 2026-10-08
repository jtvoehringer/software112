// ── PSM-Übermittlung: Stand je Maßnahme (KAN-120, 08.10.2026) ─────────────────────────────────────────────
//
// Status je Pflanzenschutz-Aufzeichnung aus den aktuellen Exportzeilen und dem Protokoll psm_uebermittlungen:
//   offen          – noch nie exportiert
//   exportiert     – der letzte Export hat denselben Hash wie die aktuellen Zeilen
//   korrektur      – nach dem letzten Export geändert (auch Grundstücke, Mittel-Stammdaten, Betriebsnummer) oder
//                    storniert („Korrektur offen“: Bericht nochmals vorlegen, Entscheidung Jörgen 06.10.2026)
// Der Hash (SHA-256) läuft über die Exportzeilen der Maßnahme – genau das, was in der Datei steht.
// Ohne @/-Importe zur Laufzeit (node:test); Typen werden beim Übersetzen entfernt.

import { createHash } from 'node:crypto'
import type { PsmUebermittlungZeile } from '@/lib/behoerden/psm_uebermittlung'

export type UebermittlungsStatus = 'offen' | 'exportiert' | 'korrektur'

export const STATUS_TEXT: Record<UebermittlungsStatus, string> = {
  offen: 'offen',
  exportiert: 'exportiert',
  korrektur: 'Korrektur offen',
}

export type ProtokollEintrag = {
  behandlung_id: string
  export_id: string
  hash: string
  version: number
  status: string
  exportiert_am: string
  exportiert_von_name: string | null
}

export type MassnahmenStand = {
  behandlungId: string
  zeilen: PsmUebermittlungZeile[]
  hash: string
  status: UebermittlungsStatus
  letzterExport: ProtokollEintrag | null
  /** exportiert, inzwischen aber storniert bzw. ohne Pflanzenschutzmittel – keine Zeilen mehr */
  entfallen: boolean
}

/** SHA-256 (hex) über die Exportzeilen einer Maßnahme */
export function zeilenHash(zeilen: readonly PsmUebermittlungZeile[]): string {
  return createHash('sha256').update(JSON.stringify(zeilen)).digest('hex')
}

/** Letzter Export je Maßnahme (spätester Zeitpunkt, bei Gleichstand die größere export_id) */
export function letzteExporte(protokoll: readonly ProtokollEintrag[]): Map<string, ProtokollEintrag> {
  const m = new Map<string, ProtokollEintrag>()
  for (const p of protokoll) {
    const alt = m.get(p.behandlung_id)
    if (!alt || p.exportiert_am > alt.exportiert_am || (p.exportiert_am === alt.exportiert_am && p.export_id > alt.export_id)) m.set(p.behandlung_id, p)
  }
  return m
}

/** Stand je Maßnahme: aktuelle Zeilen (gruppiert nach Datensatz-ID) gegen den letzten Export */
export function standJeMassnahme(zeilen: readonly PsmUebermittlungZeile[], protokoll: readonly ProtokollEintrag[]): MassnahmenStand[] {
  const gruppen = new Map<string, PsmUebermittlungZeile[]>()
  for (const z of zeilen) {
    const g = gruppen.get(z.datensatzId)
    if (g) g.push(z)
    else gruppen.set(z.datensatzId, [z])
  }
  const letzte = letzteExporte(protokoll)
  const stand: MassnahmenStand[] = []
  for (const [id, g] of gruppen) {
    const hash = zeilenHash(g)
    const l = letzte.get(id) ?? null
    stand.push({ behandlungId: id, zeilen: g, hash, letzterExport: l, entfallen: false,
      status: !l ? 'offen' : l.hash === hash ? 'exportiert' : 'korrektur' })
  }
  // Exportiert, aber heute ohne Zeilen (storniert): einmal als Korrektur melden, danach (Hash der leeren Liste) erledigt
  const leer = zeilenHash([])
  for (const [id, l] of letzte) {
    if (gruppen.has(id)) continue
    stand.push({ behandlungId: id, zeilen: [], hash: leer, letzterExport: l, entfallen: true,
      status: l.hash === leer ? 'exportiert' : 'korrektur' })
  }
  return stand
}

/** Was der nächste Export enthält: offene und geänderte Maßnahmen (kein Doppelexport) */
export function auswahlFuerExport(stand: readonly MassnahmenStand[]): MassnahmenStand[] {
  return stand.filter(s => s.status !== 'exportiert')
}

/**
 * Erneut herunterladen: die Zeilen der Maßnahmen eines Export-Laufs, deren Inhalt seither unverändert ist (gleicher
 * Hash) – genau die Datei von damals. Geänderte Maßnahmen fehlen (sie sind „Korrektur offen“ und kommen mit dem nächsten
 * Export); `fehlend` zählt sie.
 */
export function zeilenEinesLaufs(stand: readonly MassnahmenStand[], protokoll: readonly ProtokollEintrag[], exportId: string):
  { zeilen: PsmUebermittlungZeile[]; massnahmen: number; fehlend: number } {
  const imLauf = protokoll.filter(p => p.export_id === exportId)
  const jeId = new Map(stand.map(s => [s.behandlungId, s]))
  const zeilen: PsmUebermittlungZeile[] = []
  let fehlend = 0
  for (const p of imLauf) {
    const s = jeId.get(p.behandlung_id)
    if (s && s.hash === p.hash) zeilen.push(...s.zeilen)
    else fehlend++
  }
  return { zeilen, massnahmen: imLauf.length, fehlend }
}

/** Hinweise zu fehlenden Pflichtangaben der exportierten Zeilen (blockieren nicht) */
export function pflichtHinweise(zeilen: readonly PsmUebermittlungZeile[], betriebsnummer: string | null): string[] {
  const h: string[] = []
  const ohneAnwender = new Set(zeilen.filter(z => !z.anwender).map(z => z.datensatzId)).size
  const ohneRegister = new Set(zeilen.filter(z => !z.registernummer).map(z => z.mittel ?? '?'))
  if (ohneAnwender > 0) h.push(`${ohneAnwender} ${ohneAnwender === 1 ? 'Anwendung hat' : 'Anwendungen haben'} keinen Anwender (Pflichtangabe) – bitte in der Maßnahme ergänzen.`)
  if (ohneRegister.size > 0) h.push(`Ohne Registernummer: ${[...ohneRegister].sort((a, b) => a.localeCompare(b, 'de')).join(', ')} – bitte unter Pflanzenschutz › Lager › Stammdaten ergänzen.`)
  if (!betriebsnummer) h.push('Die Betriebsnummer fehlt – bitte unter Betrieb › Einstellungen ergänzen (Identifikation bei der Prüfstelle).')
  return h
}

/** Hinweis zu entfallenen Aufzeichnungen (storniert nach dem Export) – stehen nicht mehr in der Datei */
export function entfallenHinweis(auswahl: readonly MassnahmenStand[]): string | null {
  const n = auswahl.filter(s => s.entfallen).length
  if (n === 0) return null
  return `${n} bereits exportierte ${n === 1 ? 'Aufzeichnung ist' : 'Aufzeichnungen sind'} inzwischen storniert und nicht mehr in der Datei – bitte der Prüfstelle mitteilen.`
}
