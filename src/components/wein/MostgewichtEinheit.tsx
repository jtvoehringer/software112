'use client'

// Bevorzugte Mostgewicht-Einheit des Betriebs für Client-Komponenten – KAN-128 Teil A, S3 (26.09.2026)
//
// Gesetzt in /betrieb/einstellungen (Tab „Kellerwirtschaft“, tenant_einstellungen.mostgewicht_einheit),
// geladen im Dashboard-Layout über ladeTenantKopf() und von der AppShell bereitgestellt. Formulare
// und Listen zeigen diese Einheit zuerst; die gemessene Einheit eines Eintrags bleibt davon
// unabhängig, Exporte zeigen immer °KMW vor °Oe. Server-Komponenten: ladeMostgewichtEinheit()
// aus lib/tenant/kopf.ts.

import { createContext, useContext } from 'react'
import type { MostgewichtEinheit } from '@/lib/wein/mostgewicht'

const MostgewichtEinheitKontext = createContext<MostgewichtEinheit>('kmw')

export function MostgewichtEinheitProvider({ einheit, children }: { einheit: MostgewichtEinheit; children: React.ReactNode }) {
  return <MostgewichtEinheitKontext value={einheit}>{children}</MostgewichtEinheitKontext>
}

/** Bevorzugte Einheit des aktiven Betriebs – 'kmw', solange nichts eingestellt ist (oder außerhalb der AppShell) */
export function useMostgewichtEinheit(): MostgewichtEinheit {
  return useContext(MostgewichtEinheitKontext)
}
