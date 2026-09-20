// Next.js Instrumentation (20.9.2026): jeder nicht gefangene Serverfehler –
// Server Components, Server Actions, Route Handler – landet im Systemprotokoll
// (system_ereignisse, Migration 222) und damit im täglichen Systembericht.
// Vorher waren solche Fehler nur in den Vercel-Laufzeitlogs sichtbar (kurz
// aufbewahrt, niemand schaut hinein).

import type { Instrumentation } from 'next'

const TENANT_COOKIE = 's112_active_tenant'

function cookieWert(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const teil of header.split(';')) {
    const [k, ...v] = teil.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return   // Edge: kein Admin-Client
  try {
    const { ereignisMelden } = await import('@/lib/system/ereignis')
    const e = (err ?? {}) as { message?: string; digest?: string; name?: string; stack?: string }
    const cookie = request.headers['cookie']
    await ereignisMelden({
      art: 'server',
      quelle: `${request.method} ${request.path}`,
      meldung: e.message ?? String(err),
      digest: e.digest ?? null,
      tenantId: cookieWert(typeof cookie === 'string' ? cookie : undefined, TENANT_COOKIE),
      details: {
        name: e.name ?? null,
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
        renderSource: context.renderSource ?? null,
        stack: (e.stack ?? '').split('\n').slice(0, 6).join('\n') || null,
      },
    })
  } catch (fehler) {
    console.error('[instrumentation] onRequestError:', fehler instanceof Error ? fehler.message : String(fehler))
  }
}
