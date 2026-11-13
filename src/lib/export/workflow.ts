// ── Weinexport: Statuswechsel des Exportauftrags (KAN-440, 13.11.2026) ──
// Bisher war der Status ein frei wählbares Feld (jeder Wert, auch rückwärts, „Versendet“ ohne Rechnung). Jetzt ändert er
// sich nur über die RPC s112_exportauftrag_status_setzen; dieselben Regeln stehen hier für Knöpfe und Vorabprüfung
// (Entscheidungen Jörgen 13.11.2026):
//
//   Entwurf → Bestätigt → Versendet → Abgeschlossen, je ein Schritt
//   „Versendet“ nur mit Rechnung bzw. ausgebuchtem Muster
//   zurück je ein Schritt, nur Betriebsleitung, mit Grund (≥ 10 Zeichen); auf „Entwurf“ nur ohne Rechnung/Muster
//   „Abgeschlossen“ ist endgültig – und geht nur mit Ausfuhr- bzw. Gelangensnachweis oder mit Begründung
//   (Teil 2; Mustersendungen ohne)
//
// Isomorph und ohne '@/'-Importe (node:test).

export const EXPORT_STATUS = ['entwurf', 'bestaetigt', 'versendet', 'abgeschlossen'] as const
export type ExportStatus = typeof EXPORT_STATUS[number]

export const EXPORT_STATUS_NAME: Record<ExportStatus, string> = {
  entwurf: 'Entwurf', bestaetigt: 'Bestätigt', versendet: 'Versendet', abgeschlossen: 'Abgeschlossen',
}

/** Mindestlänge des Grunds beim Zurückstufen – wie in der Datenbank */
export const EXPORT_GRUND_MIN = 10

export type ExportStand = {
  status?: string | null
  storniert_am?: string | null
  verkaufsposten_id?: string | null
  muster_ausgebucht_am?: string | null
  mustersendung?: boolean | null
  /** Anzahl erfasster Ausfuhr- bzw. Gelangensnachweise (Teil 2) */
  nachweise?: number | null
}

export function istExportStatus(s: unknown): s is ExportStatus {
  return typeof s === 'string' && (EXPORT_STATUS as readonly string[]).includes(s)
}

const stufe = (s: ExportStatus) => EXPORT_STATUS.indexOf(s)
const aktuell = (a: ExportStand): ExportStatus => (istExportStatus(a.status) ? a.status : 'entwurf')
const hatAbgang = (a: ExportStand) => !!a.verkaufsposten_id || !!a.muster_ausgebucht_am
/** abschließen ohne Nachweis (keine Mustersendung): nur mit Begründung */
const ohneNachweis = (a: ExportStand) => !a.mustersendung && !((a.nachweise ?? 0) > 0)
const grundReicht = (grund: string | null | undefined) => (grund ?? '').trim().length >= EXPORT_GRUND_MIN

/**
 * Warum der Wechsel auf `neu` nicht geht – null, wenn er erlaubt ist. Dieselben Regeln und Texte wie
 * s112_exportauftrag_status_setzen (die Datenbank entscheidet; das hier ist die Vorabprüfung).
 */
export function exportUebergangFehler(a: ExportStand, neu: unknown, grund: string | null | undefined, betriebsleitung: boolean): string | null {
  if (!istExportStatus(neu)) return 'Unbekannter Status.'
  if (a.storniert_am) return 'Der Exportauftrag ist storniert.'
  const alt = aktuell(a)
  const diff = stufe(neu) - stufe(alt)
  if (diff === 0) return `Der Exportauftrag ist bereits „${EXPORT_STATUS_NAME[alt]}“.`
  if (alt === 'abgeschlossen') return 'Der Exportauftrag ist abgeschlossen – der Status lässt sich nicht mehr ändern.'
  if (Math.abs(diff) !== 1) return `Von „${EXPORT_STATUS_NAME[alt]}“ geht es nicht direkt auf „${EXPORT_STATUS_NAME[neu]}“ – bitte Schritt für Schritt.`
  if (diff === 1) {
    if (neu === 'versendet' && !hatAbgang(a)) {
      return a.mustersendung ? '„Versendet“ geht erst, wenn das Muster ausgebucht ist.' : '„Versendet“ geht erst, wenn die Rechnung gestellt ist.'
    }
    if (neu === 'abgeschlossen' && ohneNachweis(a) && !grundReicht(grund)) {
      return `Zum Abschließen fehlt der Ausfuhr- bzw. Gelangensnachweis – bitte den Nachweis erfassen oder den Abschluss ohne Nachweis begründen (mindestens ${EXPORT_GRUND_MIN} Zeichen).`
    }
    return null
  }
  if (!betriebsleitung) return 'Zurückstufen darf nur die Betriebsleitung.'
  if (!grundReicht(grund)) return `Bitte den Grund für das Zurückstufen angeben (mindestens ${EXPORT_GRUND_MIN} Zeichen).`
  if (neu === 'entwurf' && hatAbgang(a)) return 'Zurück auf „Entwurf“ geht nicht, solange es eine Rechnung bzw. ein ausgebuchtes Muster gibt.'
  return null
}

export type ExportSchritt = {
  status: ExportStatus
  /** Beschriftung des Knopfs (Verb) */
  knopf: string
  /** zurückstufen: braucht einen Grund und die Betriebsleitung */
  zurueck: boolean
  /** der Schritt fragt einen Grund ab: zurückstufen bzw. abschließen ohne Nachweis */
  grundNoetig: boolean
  /** Warum der Schritt (noch) nicht geht – der Knopf ist dann gesperrt und zeigt den Hinweis */
  gesperrt: string | null
}

const KNOPF_VOR: Record<ExportStatus, string> = {
  entwurf: '', bestaetigt: 'Bestätigen', versendet: 'Als versendet markieren', abgeschlossen: 'Abschließen',
}

/**
 * Die Schritte, die vom aktuellen Stand aus angeboten werden: der nächste nach vorn (gesperrt mit Hinweis, wenn die
 * Rechnung bzw. das Muster fehlt) und – nur für die Betriebsleitung – einer zurück. Storniert und abgeschlossen: keine.
 */
export function exportSchritte(a: ExportStand, betriebsleitung: boolean): ExportSchritt[] {
  if (a.storniert_am) return []
  const alt = aktuell(a)
  if (alt === 'abgeschlossen') return []
  const aus: ExportSchritt[] = []
  const vor = EXPORT_STATUS[stufe(alt) + 1]
  if (vor) {
    // abschließen ohne Nachweis: der Knopf bleibt frei und fragt die Begründung ab
    const grundNoetig = vor === 'abgeschlossen' && ohneNachweis(a)
    aus.push({ status: vor, knopf: KNOPF_VOR[vor], zurueck: false, grundNoetig,
      gesperrt: exportUebergangFehler(a, vor, grundNoetig ? 'x'.repeat(EXPORT_GRUND_MIN) : null, betriebsleitung) })
  }
  const zurueck = stufe(alt) > 0 ? EXPORT_STATUS[stufe(alt) - 1] : null
  if (zurueck && betriebsleitung) {
    // der fehlende Grund ist kein Sperrgrund für den Knopf – er wird beim Zurückstufen abgefragt
    const fehler = exportUebergangFehler(a, zurueck, 'x'.repeat(EXPORT_GRUND_MIN), betriebsleitung)
    aus.push({ status: zurueck, knopf: `Zurück auf „${EXPORT_STATUS_NAME[zurueck]}“`, zurueck: true, grundNoetig: true, gesperrt: fehler })
  }
  return aus
}
