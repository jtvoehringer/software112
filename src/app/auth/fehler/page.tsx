import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { linkFehlerText } from '@/lib/auth/authLink'

export const metadata: Metadata = { title: 'Link nicht gültig' }
export const dynamic = 'force-dynamic'

// KAN-465 (Befund 16.11.2026): Scheitert ein Link aus einer E-Mail (Anmeldung, Einladung, Passwort), bleibt die Meldung
// hier stehen – auch wenn in diesem Browser schon jemand angemeldet ist. Bisher leitete /auth/callback auf
// /login?error=…; die Anmeldeseite zeigte den Fehler nicht an und führte bei offener Sitzung kommentarlos ins Dashboard
// des angemeldeten (anderen) Kontos.
export default async function AuthFehlerPage({ searchParams }: { searchParams: Promise<{ zweck?: string }> }) {
  const { zweck } = await searchParams
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const einladung = zweck === 'einladung'
  const text = zweck === 'anmeldung'
    ? 'Die Anmeldung über diesen Link hat nicht geklappt – der Link wurde bereits verwendet, ist abgelaufen oder wurde in einem anderen Browser angefordert. Bitte melde dich neu an.'
    : linkFehlerText(einladung ? 'einladung' : 'passwort', null)

  return (
    <div className="min-h-screen flex items-center justify-center bg-s112-bg px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-3xl font-semibold text-s112-blue-700 inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </p>
        </div>
        <div className="bg-white rounded-xl border border-s112-border p-8 space-y-4">
          <h1 className="text-lg font-semibold text-s112-text">Dieser Link ist nicht mehr gültig</h1>
          <p role="alert" className="text-sm text-s112-err-fg">{text}</p>
          {user?.email && (
            <p role="status" className="text-sm text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2">
              In diesem Browser ist {user.email} angemeldet. An diesem Konto wurde nichts geändert – galt der Link für ein anderes Konto,
              fordere unten einen neuen an und öffne ihn am besten in einem privaten Fenster.
            </p>
          )}
          {zweck !== 'anmeldung' && (
            <Link href="/login/reset" className="block w-full text-center bg-s112-teal text-s112-yellow px-6 py-3 rounded-xl font-semibold hover:bg-s112-teal/90">
              {einladung ? 'Link zum Festlegen des Passworts anfordern' : 'Neuen Link anfordern'}
            </Link>
          )}
          <Link href={user ? '/dashboard' : '/login'} className="block text-center text-sm text-s112-blue-700 hover:underline">
            {user ? 'Zum Dashboard' : 'Zur Anmeldung'}
          </Link>
        </div>
      </div>
    </div>
  )
}
