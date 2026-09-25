// ── Begrenzte Parallelität (KAN-123, 25.09.2026) ─────────────────────────────
// Kleiner Worker-Pool und Start-Takt für externe Abrufe. Bewusst ohne '@/'-Importe:
// genutzt vom Morgenbericht-Lauf (Betriebe), vom Wetter-Cache (Punkte, GeoSphere)
// und von node:test (scripts/tests/kan123-morgenbericht.test.mjs).

/**
 * Führt `fn` für alle Einträge aus, höchstens `n` gleichzeitig. Die Einträge werden
 * in ihrer Reihenfolge gestartet, das Ergebnis steht an derselben Stelle wie der
 * Eintrag (stabile Reihenfolge, unabhängig davon, wer zuerst fertig ist). Ein Fehler
 * in `fn` bricht den ganzen Aufruf ab – Aufrufer fangen Fehler je Eintrag selbst.
 */
export async function mitHoechstens<T, E>(eintraege: readonly T[], n: number, fn: (eintrag: T, index: number) => Promise<E>): Promise<E[]> {
  const ergebnis = new Array<E>(eintraege.length)
  let naechster = 0
  const worker = async () => {
    while (naechster < eintraege.length) {
      const i = naechster++
      ergebnis[i] = await fn(eintraege[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, eintraege.length)) }, worker))
  return ergebnis
}

/**
 * Start-Takt: höchstens `anzahl` Starts je gleitendem Fenster von `fensterMs`.
 * Der zurückgegebene Wächter wartet, bis ein Start frei ist; ein abgebrochenes
 * Signal beendet das Warten mit dem Abbruchgrund.
 */
export function startTakt(anzahl: number, fensterMs: number): (signal?: AbortSignal) => Promise<void> {
  const starts: number[] = []
  return async function takt(signal?: AbortSignal) {
    for (;;) {
      signal?.throwIfAborted()
      const jetzt = Date.now()
      while (starts.length && jetzt - starts[0] >= fensterMs) starts.shift()
      if (starts.length < anzahl) { starts.push(jetzt); return }
      await new Promise(r => setTimeout(r, fensterMs - (jetzt - starts[0]) + 1))
    }
  }
}
