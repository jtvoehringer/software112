// ── Belege an Buchungen (KAN-415, 11.11.2026) ────────────────────────────────────────────────────────────────────────
//
// Ein Beleg (ea_belege) gehört über ea_transaktion_id zu einer E&A-Buchung; eine Buchung kann mehrere Belege haben.
// Wege: (1) Datei direkt beim Erfassen der Buchung, (2) Datei nachträglich an eine bestehende Buchung, (3) ein per
// Belegscan erfasster, noch nicht verbuchter Beleg wird einer bestehenden Buchung zugeordnet (statt eine zweite Buchung
// zu erzeugen). Ein angehängter Beleg hat den Status „verbucht“ und ist damit unveränderlich (Trigger
// a_ea_abschluss_schutz, § 132 BAO) – er lässt sich nicht mehr entfernen oder umhängen. Das Anhängen selbst ändert die
// Buchung nicht und geht deshalb auch in abgeschlossenen Monaten.
// Isomorph, ohne '@/'-Importe (node:test) – gemeinsam für Formular, Server Action und Route.

export const BELEG_BUCKET = 'ea-belege'

/** Erlaubte Dateitypen wie beim Belegscan */
export const BELEG_TYPEN: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
}
export const BELEG_ACCEPT = Object.keys(BELEG_TYPEN).join(',')

/** Vercel nimmt höchstens 4,5 MB je Anfrage an – alle Dateien eines Vorgangs zusammen */
export const BELEG_MAX_BYTES = 4 * 1024 * 1024
/** Höchstzahl Dateien je Vorgang */
export const BELEG_MAX_ANZAHL = 5

export type BelegDatei = { name: string; type: string; size: number }

/** Prüfung der gewählten Dateien; null = in Ordnung (auch: keine Datei) */
export function belegDateienFehler(dateien: BelegDatei[]): string | null {
  if (dateien.length === 0) return null
  if (dateien.length > BELEG_MAX_ANZAHL) return `Höchstens ${BELEG_MAX_ANZAHL} Belege auf einmal – weitere lassen sich danach an der Buchung anhängen.`
  for (const d of dateien) {
    if (!d.size) return `Die Datei „${d.name}“ ist leer.`
    if (!BELEG_TYPEN[d.type]) return `„${d.name}“: nicht unterstütztes Dateiformat – bitte PDF, JPEG, PNG oder WebP.`
  }
  const gesamt = dateien.reduce((s, d) => s + d.size, 0)
  if (gesamt > BELEG_MAX_BYTES) return 'Die Belege sind zusammen zu groß (höchstens 4 MB) – bitte kleinere Dateien wählen oder einzeln anhängen.'
  return null
}

/** Ablagepfad im Bucket: <tenant>/<zeitstempel>-<nr>-<dateiname> – der erste Ordner ist der Betrieb (Storage-Policies) */
export function belegPfad(tenantId: string, dateiname: string, zeitstempel: number, nr = 0): string {
  const sicher = dateiname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'beleg'
  return `${tenantId}/${zeitstempel}-${nr}-${sicher}`
}

/** Beschriftung der Büroklammer */
export function belegAnzahlText(n: number): string {
  return n === 1 ? '1 Beleg' : `${n} Belege`
}

/** Adresse, unter der ein Beleg geöffnet wird (Weiterleitung auf eine kurzlebige signierte Adresse) */
export function belegDateiPfad(belegId: string): string {
  return `/api/buchhaltung/belege/${belegId}/datei`
}
