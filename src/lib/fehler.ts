// Fehler zwischen Server-Actions und Client (20.9.2026)
//
// Next.js maskiert in Produktion JEDEN aus einer Server-Action geworfenen Fehler:
// der Client bekommt ein Error-Objekt mit dem Text „An error occurred in the
// Server Components render …“ – die eigentliche Meldung („Speichern fehlgeschlagen
// (psm_lager_bewegungen): new row violates row-level security policy“) geht
// verloren. Einzig die Eigenschaft `digest` wird unverändert durchgereicht
// (create-error-handler: „If the error already has a digest, respect the
// original digest“). Darüber transportieren wir die Meldung.
//
// Server:  throw new AktionsFehler('Speichern fehlgeschlagen: …')
// Client:  catch (e) { setFehler(fehlerText(e)) }
//
// Diese Datei ist bewusst ohne Server-Importe (client-sicher).

const PRAEFIX = 'S112|'
const NEXT_MASKE = 'An error occurred in the Server Components render'

export class AktionsFehler extends Error {
  digest: string
  constructor(meldung: string) {
    super(meldung)
    this.name = 'AktionsFehler'
    this.digest = PRAEFIX + meldung
  }
}

/** Lesbare Meldung eines gefangenen Fehlers – auch in Produktion. */
export function fehlerText(e: unknown, ersatz = 'Unerwarteter Fehler – bitte erneut versuchen.'): string {
  if (e && typeof e === 'object') {
    const d = (e as { digest?: unknown }).digest
    if (typeof d === 'string' && d.startsWith(PRAEFIX)) return d.slice(PRAEFIX.length)
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m.trim() && !m.startsWith(NEXT_MASKE)) return m
    return ersatz
  }
  if (typeof e === 'string' && e.trim()) return e
  return ersatz
}
