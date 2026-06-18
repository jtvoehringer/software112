/**
 * Aktiver Betrieb – Cookie-Helper
 * Speichert den aktiven Tenant als HttpOnly-Cookie.
 * Wird von getCurrentMembership() und getTenantId() gelesen.
 */
import { cookies } from 'next/headers'

const COOKIE = 's112_active_tenant'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 Tage

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
