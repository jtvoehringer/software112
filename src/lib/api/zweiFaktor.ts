import { NextResponse } from 'next/server'
import { isAuthSessionMissingError } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { hatBestaetigtenFaktor, zweiFaktorErfuellt, mfaPflichtAktiv } from '@/lib/auth/mfa'

// ── Zwei-Faktor-Prüfung für API-Routen (KAN-54, 24.9.2026) ───────────────────
//
// Der Proxy (src/proxy.ts) erzwingt die Stufe aal2 nur für Seiten – sein Matcher
// schließt /api aus. Jeder benutzergebundene Route-Handler unter src/app/api ruft
// deshalb als Erstes:
//
//     const zweiFaktor = await pruefeZweiFaktor()
//     if (zweiFaktor) return zweiFaktor
//
// null = weiter, sonst eine fertige 401-Antwort { fehler }:
//  - Faktor eingerichtet, Code in dieser Sitzung noch nicht eingegeben (aal1)
//  - Zwei-Faktor-Pflicht in Kraft (Super-Admin/Betriebs-Manager ab MFA_PFLICHT_AB),
//    aber noch kein Faktor – die Seiten leiten in dem Fall auf /zwei-faktor?pflicht=1
//  - Sitzung vorhanden, aber vom Auth-Server nicht bestätigt (fail-closed)
// Ohne Sitzung liefert die Prüfung null: Die Anmeldung prüft die Route wie bisher selbst.
//
// Warum eine Hilfsfunktion statt /api im Proxy-Matcher: Der Proxy ruft getUser() –
// ein Netz-Roundtrip zum Auth-Server – bei jeder Anfrage auf, und Webhooks, Cron und
// OAuth-Rückkehr bräuchten dort eine Ausnahmeliste fern vom Code. Hier ist getUser()
// je Request dedupliziert (createSupabaseServerClient), die Cron-Routen prüfen nur
// ihren Sitzungszweig, und scripts/check-api-zwei-faktor.js (prebuild) meldet jeden
// Route-Handler ohne diesen Aufruf. Ausnahmen tragen im Code den Kommentar
// „zwei-faktor-ausnahme: <Grund>“.

export async function pruefeZweiFaktor(): Promise<NextResponse | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user) {
    if (!error || isAuthSessionMissingError(error)) return null
    return verweigert('Anmeldung konnte nicht geprüft werden – bitte neu anmelden.')
  }

  // currentLevel aus dem signierten Zugriffstoken (von getUser() bestätigt),
  // Faktoren aus dem geprüften User – nicht aus dem Cookie (siehe lib/auth/mfa.ts)
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (zweiFaktorErfuellt(aal)) return null   // KAN-287: auch Passkey-Anmeldung
  if (hatBestaetigtenFaktor(user)) {
    return verweigert('Zwei-Faktor-Anmeldung erforderlich – bitte zuerst den Code aus der Authenticator-App eingeben.')
  }
  const membership = await getCurrentMembership()
  if (membership && mfaPflichtAktiv(membership.role)) {
    return verweigert('Zwei-Faktor-Anmeldung ist für deine Rolle Pflicht – bitte zuerst einrichten.')
  }
  return null
}

function verweigert(fehler: string): NextResponse {
  return NextResponse.json({ fehler }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
}
