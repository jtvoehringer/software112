import 'server-only'
import { csvDatei, PROFIL_EXCEL_AT } from '@/lib/csv'
import { meldungFinden } from './register'
import { meldungsDateiname } from './dateiname'
import { betriebUndModuleLaden } from './zugriff'
import { istParameterFehler, type LadeKontext } from './typen'

// ── Snapshot einer abgegebenen Behördenmeldung (KAN-37 Etappe B, 02.10.2026) ──
//
// Beim Einreichen wird die Meldung genau so erzeugt wie über die zentrale CSV-Route (/meldungen/<id>/csv):
// dieselbe Ladefunktion, dieselben Spalten, dasselbe Profil und derselbe Dateiname. Gespeichert werden Parameter,
// Zeilen, Warnungen, Spaltenbeschreibung (Kopf, Typ, Stellen), Profil, Dateiname und die CSV selbst – die Datenbank
// (Tabelle meldung_abgaben, RPC s112_ama_einreichen) rechnet daraus SHA-256 der CSV und der Spalten und hält die
// Abgabe unveränderlich. Die abgegebene Datei liefert später /meldungen/<id>/csv?abgabe=<id> byte-gleich aus.

export type AbgabeSnapshot = {
  meldung: string
  parameter: unknown
  zeilen: unknown[]
  warnungen: string[]
  spalten: { kopf: string; typ: string; stellen: number | 'roh' | null }[]
  profil: string
  dateiname: string
  csv: string
}

export async function abgabeErzeugen(
  ctx: Omit<LadeKontext, 'betrieb'>,
  id: string,
  parameter: Record<string, string>,
): Promise<AbgabeSnapshot> {
  const meldung = meldungFinden(id)
  if (!meldung) throw new Error(`Unbekannte Behördenmeldung „${id}“.`)
  const p = meldung.parameter(new URLSearchParams(parameter))
  if (istParameterFehler(p)) throw new Error(p.fehler)
  const { betrieb } = await betriebUndModuleLaden(ctx.supabase, ctx.tenantId)
  const ergebnis = await meldung.laden({ ...ctx, betrieb }, p)
  const profil = meldung.profil ?? PROFIL_EXCEL_AT
  const datei = csvDatei(ergebnis.zeilen, meldung.spalten, profil)
  const { dateiname, warnungen: namensWarnungen } = meldungsDateiname(meldung, p, betrieb)
  return {
    meldung: id,
    parameter: JSON.parse(JSON.stringify(p)),
    zeilen: JSON.parse(JSON.stringify(ergebnis.zeilen)),
    warnungen: [...namensWarnungen, ...(ergebnis.warnungen ?? []), ...datei.warnungen],
    spalten: meldung.spalten.map(s => ({ kopf: s.kopf, typ: s.typ, stellen: s.stellen ?? null })),
    profil: profil.name,
    dateiname: dateiname.utf8,
    csv: datei.text,
  }
}
