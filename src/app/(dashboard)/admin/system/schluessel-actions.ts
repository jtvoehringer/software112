'use server'
// seiten-betrieb-ausnahme: Schlüsseltausch über alle Mandanten (Super-Admin), kein Bezug zum aktiven Betrieb (KAN-30)
// schreibsperre-ausnahme-datei: Schlüsseltausch über alle Mandanten – nur Super-Admin, von der Abo-Sperre ausgenommen (KAN-5)

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { AktionsFehler } from '@/lib/fehler'
import { decryptPass, encryptPass, istV2, v2Aktiv } from '@/lib/email/crypto'

// Schlüsseltausch für gespeicherte Zugangsdaten (Sicherheits-Welle 2, S2b, 23.9.2026):
// liest alle Werte im alten Format (AES-CBC, EMAIL_CRYPT_SECRET) und schreibt sie im
// neuen Format (AES-GCM, EMAIL_CRYPT_SECRET_V2) neu. Mehrfach ausführbar; bereits
// umgestellte Werte werden übersprungen. Nur Super-Admin.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// klartext: true = Spalte war bis 23.9.2026 unverschlüsselt (S11: Brevo, SumUp, bawb) –
// Altwerte werden direkt verschlüsselt statt mit dem alten Schlüssel entschlüsselt.
const TABELLEN: { tabelle: string; schluessel: string; spalten: string[]; klartext?: boolean }[] = [
  { tabelle: 'tenant_einstellungen',   schluessel: 'tenant_id', spalten: ['email_smtp_pass_enc', 'email_imap_pass_enc', 'm365_client_secret_enc', 'm365_access_token_enc', 'm365_refresh_token_enc'] },
  { tabelle: 'user_email_connections', schluessel: 'id',        spalten: ['m365_access_token_enc', 'm365_refresh_token_enc', 'imap_pass_enc', 'smtp_pass_enc'] },
  { tabelle: 'tenant_einstellungen',   schluessel: 'tenant_id', spalten: ['brevo_api_key', 'sumup_api_key', 'bawb_passwort'], klartext: true },
]

export type SchluesselStatus = { v2Aktiv: boolean; alt: number; neu: number; je: { tabelle: string; spalte: string; alt: number; neu: number }[] }

async function pruefeAdmin() {
  if ((await getCurrentUserRole()) !== 'system_admin') throw new AktionsFehler('Nur für Super-Admins')
}

async function ladeZeilen(tabelle: string, spalten: string[], schluessel: string): Promise<R[]> {
  const admin = createSupabaseAdminClient()
  // tenant-isolation-ignore: Schlüsseltausch betrifft bewusst alle Betriebe (Super-Admin, Service-Role)
  const { data, error } = await (admin.from(tabelle) as any).select([schluessel, 'tenant_id', ...spalten].join(', '))
  if (error) throw new AktionsFehler(`${tabelle}: ${error.message}`)
  return (data ?? []) as R[]
}

export async function schluesselStatus(): Promise<SchluesselStatus> {
  await pruefeAdmin()
  const je: SchluesselStatus['je'] = []
  for (const t of TABELLEN) {
    const zeilen = await ladeZeilen(t.tabelle, t.spalten, t.schluessel)
    for (const s of t.spalten) {
      const werte = zeilen.map(z => z[s]).filter((v): v is string => typeof v === 'string' && v.length > 0)
      je.push({ tabelle: t.tabelle, spalte: s, alt: werte.filter(v => !istV2(v)).length, neu: werte.filter(v => istV2(v)).length })
    }
  }
  return { v2Aktiv: v2Aktiv(), alt: je.reduce((a, x) => a + x.alt, 0), neu: je.reduce((a, x) => a + x.neu, 0), je }
}

export async function schluesselTauschen(): Promise<{ umgestellt: number; fehler: string[]; status: SchluesselStatus }> {
  await pruefeAdmin()
  if (!v2Aktiv()) throw new AktionsFehler('EMAIL_CRYPT_SECRET_V2 ist in Vercel noch nicht gesetzt (danach neu deployen).')
  const admin = createSupabaseAdminClient()
  let umgestellt = 0
  const fehler: string[] = []
  for (const t of TABELLEN) {
    const zeilen = await ladeZeilen(t.tabelle, t.spalten, t.schluessel)
    for (const z of zeilen) {
      const neu: R = {}
      for (const s of t.spalten) {
        const v = z[s]
        if (typeof v !== 'string' || !v || istV2(v)) continue
        try { neu[s] = encryptPass(t.klartext ? v : decryptPass(v)) }
        catch (e) { fehler.push(`${t.tabelle}.${s} (${String(z[t.schluessel]).slice(0, 8)}…): ${e instanceof Error ? e.message : String(e)}`) }
      }
      if (Object.keys(neu).length === 0) continue
      // tenant-isolation-ignore: Zeile wird über ihren Primärschlüssel adressiert, tenant_id zusätzlich gefiltert
      const { error } = await (admin.from(t.tabelle) as any).update(neu).eq(t.schluessel, z[t.schluessel]).eq('tenant_id', z.tenant_id)
      if (error) fehler.push(`${t.tabelle} (${String(z[t.schluessel]).slice(0, 8)}…): ${error.message}`)
      else umgestellt += Object.keys(neu).length
    }
  }
  return { umgestellt, fehler, status: await schluesselStatus() }
}
