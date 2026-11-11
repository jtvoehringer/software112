/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import 'server-only'

// KAN-415: Dateien als Belege an eine bestehende E&A-Buchung hängen – gemeinsam für die Server Action „Buchung erfassen“
// und die Route /api/buchhaltung/belege/anhang. Der Aufrufer hat Rechte, Betrieb der Seite und Schreibsperre geprüft.
// Reihenfolge je Datei: Ablage im Bucket → Zeile in ea_belege (Status „verbucht“, mit Buchung). Scheitert die Zeile,
// wird die Datei wieder entfernt; schon angehängte Belege bleiben (sie sind als Nachweis unveränderlich).

import { dbFehlerText } from '@/lib/fehler'
import { BELEG_BUCKET, belegDateienFehler, belegPfad } from './belegAnhang'

type R = Record<string, any>

export type BelegAnhangErgebnis = { anzahl: number; error?: string }

export async function haengeDateienAn(
  supabase: any, tenantId: string, userId: string | null, transaktionId: string, dateien: File[],
): Promise<BelegAnhangErgebnis> {
  const fehler = belegDateienFehler(dateien)
  if (fehler) return { anzahl: 0, error: fehler }
  const jetzt = Date.now()
  let anzahl = 0
  for (const [i, datei] of dateien.entries()) {
    const pfad = belegPfad(tenantId, datei.name, jetzt, i)
    const { error: upErr } = await supabase.storage.from(BELEG_BUCKET).upload(pfad, datei, { contentType: datei.type, upsert: false })
    if (upErr) return { anzahl, error: `„${datei.name}“ konnte nicht abgelegt werden: ${dbFehlerText(upErr)}` }
    const { error: insErr } = await (supabase.from('ea_belege') as any).insert({
      tenant_id: tenantId, ea_transaktion_id: transaktionId, dateiname: datei.name, dateityp: datei.type, groesse_bytes: datei.size,
      storage_pfad: pfad, status: 'verbucht', verbucht_am: new Date().toISOString(), hochgeladen_von: userId,
    })
    if (insErr) {
      await supabase.storage.from(BELEG_BUCKET).remove([pfad])
      return { anzahl, error: `„${datei.name}“ konnte nicht angehängt werden: ${dbFehlerText(insErr)}` }
    }
    anzahl++
  }
  return { anzahl }
}

/** Dateien aus einem Formularfeld (leere Einträge des Browsers ohne Auswahl fallen weg) */
export function dateienAus(formData: FormData, feld: string): File[] {
  return formData.getAll(feld).filter((x): x is File => typeof x === 'object' && x !== null && 'size' in x && (x as File).size > 0)
}

/** Buchung des Betriebs, an die angehängt werden darf: vorhanden und nicht storniert; null = in Ordnung */
export async function buchungFuerAnhangFehler(supabase: any, tenantId: string, transaktionId: string): Promise<string | null> {
  const { data, error } = await (supabase.from('ea_transaktionen') as any)
    .select('id, storniert_am, storno_von_id').eq('id', transaktionId).eq('tenant_id', tenantId).maybeSingle()
  if (error) return dbFehlerText(error, 'Buchung konnte nicht geladen werden')
  const b = data as R | null
  if (!b) return 'Buchung nicht gefunden.'
  if (b.storniert_am || b.storno_von_id) return 'An eine stornierte Buchung bzw. ihre Gegenbuchung lässt sich kein Beleg anhängen.'
  return null
}
