import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import SignupClient from './SignupClient'

// ── Öffentliches Signup-Formular ──────────────────────────────────────────────
// Rückmeldung 31.8.2026 ("Self-Service-Signup"): bewusst AUSSERHALB der
// (dashboard)- und (auth)-Route-Gruppen, damit die Seite ohne Login erreichbar
// ist. Noch nirgends verlinkt (Homepage steht noch nicht) - erreichbar aber
// funktionsfähig, damit nur noch ein Link/Button von der künftigen Homepage
// hierher zeigen muss.

export const metadata: Metadata = { title: 'Jetzt registrieren' }
export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  // Bereits eingeloggte Personen landen nicht nochmal im Signup-Formular.
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return <SignupClient />
}
