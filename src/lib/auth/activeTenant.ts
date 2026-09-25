/**
 * Aktiver Betrieb – Cookie-Helper
 * Speichert den aktiven Tenant als HttpOnly-Cookie.
 * Wird von getCurrentMembership() und getTenantId() gelesen.
 */
import { cookies } from 'next/headers'

const COOKIE = 's112_active_tenant'
// 400 Tage (Höchstwert der Browser) statt bisher 30 (KAN-30, 25.09.2026): Die Laufzeit zählte
// ab dem letzten Wechsel. Wer länger nur in einem Betrieb arbeitete, fiel nach Ablauf still auf
// den ältesten Betrieb zurück (getCurrentMembership-Fallback) – der Betriebs-Wächter sperrte dann
// einen einzelnen offenen Tab. Bewusst KEINE gleitende Verlängerung im Proxy: der schriebe den
// Wert der jeweiligen Anfrage zurück und könnte einen gleichzeitigen Wechsel in einem anderen
// Tab wieder überschreiben. Das Cookie enthält nur die Betriebs-ID; jede Nutzung prüft sie gegen
// die eigenen, aktiven Mitgliedschaften, jede Anmeldung setzt sie über /betrieb-waehlen neu.
const MAX_AGE = 60 * 60 * 24 * 400

export async function getActiveTenantCookie(): Promise<string | null> {
  const store = await cookies()
  return store.get(COOKIE)?.value ?? null
}

export async function setActiveTenantCookie(tenantId: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE, tenantId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: MAX_AGE,
  })
}

export async function clearActiveTenantCookie(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE)
}
