// ── Drossel für öffentliche Formulare (23.9.2026) ─────────────────────────────
// /signup und /newsletter sind ohne Anmeldung erreichbar und lösen E-Mails bzw. neue
// Konten aus. Diese Drossel begrenzt Aufrufe je IP-Adresse im Speicher der Funktion.
// Mit Fluid Compute teilen sich viele Anfragen eine Instanz, die Grenze ist aber je
// Instanz – sie bremst einfache Skripte, ersetzt keine Firewall-Regel (Vercel WAF).
import { headers } from 'next/headers'

const fenster = new Map<string, number[]>()

export async function clientIp(): Promise<string> {
  const h = await headers()
  return (h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0] ?? 'unbekannt').trim()
}

/** true = erlaubt; false = zu viele Aufrufe für diesen Schlüssel im Zeitfenster. */
export function drossel(schluessel: string, max: number, fensterMs: number): boolean {
  const jetzt = Date.now()
  const liste = (fenster.get(schluessel) ?? []).filter(t => jetzt - t < fensterMs)
  if (liste.length >= max) { fenster.set(schluessel, liste); return false }
  liste.push(jetzt)
  fenster.set(schluessel, liste)
  if (fenster.size > 5000) {
    for (const [k, v] of fenster) if (!v.some(t => jetzt - t < fensterMs)) fenster.delete(k)
  }
  return true
}
