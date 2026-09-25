import 'server-only'
import { NextResponse } from 'next/server'
import { ladeTenantKopf, ladeTenantKopfFrisch } from '@/lib/tenant/kopf'
import { ladeMfaStand } from '@/lib/auth/mfa'
import { AktionsFehler } from '@/lib/fehler'
import { aboStandErmitteln, sperrAntwortKoerper, SCHREIBSPERRE_MELDUNG, type AboStand, type SperrArt } from '@/lib/abo/regeln'
import type { Membership, UserRole } from '@/lib/auth/roles'

// ── Sitzungs- und Schreibsperren (server-only) ───────────────────────────────
//
// Zwei-Faktor-Einrichtungspflicht (25.09.2026): erzwingt das Dashboard-Layout per Umleitung auf
// /zwei-faktor?pflicht=1. Route-Handler unter (dashboard) – v. a. die zentrale CSV-Route
// /meldungen/<id>/csv – durchlaufen das Layout nicht; deshalb prüfen Layout UND Route über
// sitzungsSperre() (eine Regel, zwei Aufrufer).
//
// Abo-Sperre = Nur-Lesen-Modus (KAN-5, 25.09.2026, Entscheidung Jörgen): Ein Betrieb mit
// gesperrtem Abo darf alle Daten ansehen, drucken und exportieren (Aufbewahrungspflicht,
// DSGVO) – gesperrt ist jedes Speichern, die KI-Abfrage und der Assistent (Kosten). Regeln
// (Status, Testphase, Ausnahmen system_admin / Sandbox / Demo-Musterhof über feste IDs):
// lib/abo/regeln.ts. Durchgesetzt wird die Sperre serverseitig an drei Stellen:
//
//   Server Actions  – im Kontext-Helfer jedes Action-Moduls, direkt nach der Betriebs-Prüfung
//                     (KAN-30) und vor der Rechteprüfung:
//                         await pruefeSchreibzugriff(membership)              // wirft AktionsFehler
//                         const f = await schreibSperreFehler(membership)     // { error } / { ok: false, fehler }
//                         if (f) return { error: f }
//   API-Routen      – jeder schreibende Handler (POST/PUT/PATCH/DELETE), dazu KI-Routen:
//                         const gesperrt = await schreibSperreKonflikt(membership)          // 403 JSON
//                         const gesperrt = await schreibSperreKonflikt(membership, 'ki')    // KI-Routen
//                         if (gesperrt) return gesperrt
//                     GET-Handler, die nebenbei schreiben (Mail öffnen → Aktivität, BMD-Nummern),
//                     fragen schreibSperre() und lassen das Schreiben dann weg.
//   Datenbank       – RESTRICTIVE Policies abo_schreibsperre_* und die Sperre in den schreibenden
//                     RPCs (Migration kan5_abo_schreibsperre) – auch für direkte PostgREST-Zugriffe.
//   Layout          – Hinweisleiste statt Umleitung; der Betriebs-Wächter meldet Ablehnungen im
//                     Browser bzw. hält API-/Supabase-Schreibzugriffe zurück (lib/abo/nurLesen.ts).
// scripts/check-schreibsperre.js (prebuild) verlangt die Prüfung in jeder Server Action und
// jedem schreibenden Route-Handler – oder eine begründete Ausnahme („schreibsperre-ausnahme:“).
//
// Kosten: kein Zusatzaufruf je Aktion – der Abo-Status kommt aus dem 60-s-Tenant-Kopf-Cache
// (lib/tenant/kopf.ts), den der Stripe-Webhook bei jeder Änderung ablaufen lässt ({ expire: 0 }).
// Bevor abgelehnt wird, lädt aboStandErmitteln() einmal ungecacht nach (keine Ablehnung aus einem
// veralteten Cache-Eintrag, z. B. direkt nach der Zahlung). system_admin, Sandbox und
// Demo-Musterhof kommen ganz ohne Abfrage aus. Scheitert das Laden auch ungecacht, gilt „nicht
// gesperrt“ (fail-open) – die Datenbank-Ebene sperrt unabhängig davon.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Was die Sperrprüfungen von der Mitgliedschaft brauchen */
export type SperrMitgliedschaft = { tenantId: string | null | undefined; role: UserRole | null | undefined }

/**
 * Abo-Stand der Mitgliedschaft (Layout: Hinweisleiste, Umleitung bei nie abgeschlossener
 * Zahlung; Schreibsperre). Cache mit ungecachter Gegenprobe vor „gesperrt“ (lib/abo/regeln.ts).
 */
export function aboStandAktuell(m: SperrMitgliedschaft | null | undefined): Promise<AboStand> {
  return aboStandErmitteln({ tenantId: m?.tenantId, role: m?.role }, { gecacht: ladeTenantKopf, frisch: ladeTenantKopfFrisch })
}

/**
 * Schreibsperre der aktiven Mitgliedschaft: 'abo' (Nur-Lesen-Modus) oder null.
 * Ohne Mitgliedschaft/Betrieb keine Aussage (null) – das meldet der Aufrufer selbst.
 */
export async function schreibSperre(m: SperrMitgliedschaft | null | undefined): Promise<'abo' | null> {
  return (await aboStandAktuell(m)).gesperrt ? 'abo' : null
}

/** Für Server Actions, die Fehler werfen: AktionsFehler mit SCHREIBSPERRE_MELDUNG im Nur-Lesen-Modus */
export async function pruefeSchreibzugriff(m: SperrMitgliedschaft | null | undefined): Promise<void> {
  if (await schreibSperre(m)) throw new AktionsFehler(SCHREIBSPERRE_MELDUNG)
}

/** Für Server Actions mit { error } bzw. { ok: false, fehler }: Meldung im Nur-Lesen-Modus, sonst null */
export async function schreibSperreFehler(m: SperrMitgliedschaft | null | undefined): Promise<string | null> {
  return (await schreibSperre(m)) ? SCHREIBSPERRE_MELDUNG : null
}

/**
 * Für Route-Handler: fertige 403-Antwort im Nur-Lesen-Modus, sonst null. Der JSON-Körper trägt
 * die Meldung in „fehler“, „error“ und „meldung“ (je nachdem, was der Client der Route liest),
 * dazu ok: false, grund: 'nur_lesen' und art. KI-Routen übergeben art = 'ki' (eigene Meldung:
 * dort wollte niemand speichern). Muster wie pruefeZweiFaktor():
 *
 *     const gesperrt = await schreibSperreKonflikt(membership)        // bzw. (membership, 'ki')
 *     if (gesperrt) return gesperrt
 */
export async function schreibSperreKonflikt(m: SperrMitgliedschaft | null | undefined, art: SperrArt = 'speichern'): Promise<NextResponse | null> {
  if (!(await schreibSperre(m))) return null
  return NextResponse.json(sperrAntwortKoerper(art), { status: 403, headers: { 'Cache-Control': 'no-store', 'X-S112-Nur-Lesen': '1' } })
}

// ── Sitzungssperre (Zwei-Faktor) ─────────────────────────────────────────────

export type SitzungsSperre = 'mfa' | null

/**
 * Sperre der aktiven Sitzung für Route-Handler ohne Layout: 'mfa' (2FA-Pflicht, Faktor fehlt)
 * oder null. Die Abo-Sperre gehört seit KAN-5 NICHT mehr dazu – Exporte (CSV, Druck) sind im
 * Nur-Lesen-Modus ausdrücklich erlaubt.
 */
export async function sitzungsSperre(supabase: R, membership: Pick<Membership, 'role'>): Promise<SitzungsSperre> {
  const mfa = await ladeMfaStand(supabase, membership.role)
  return mfa.pflichtAktiv && !mfa.hatFaktor ? 'mfa' : null
}

/** Deutsche Meldung für die JSON-Antwort { fehler } (HTTP 403) */
export const SPERR_TEXT: Record<Exclude<SitzungsSperre, null>, string> = {
  mfa: 'Für deine Rolle ist die Zwei-Faktor-Anmeldung Pflicht – bitte zuerst unter „Profil › Zwei-Faktor-Anmeldung“ (/zwei-faktor) einrichten und den Export danach erneut starten.',
}
