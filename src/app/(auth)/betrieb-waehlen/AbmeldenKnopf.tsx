'use client'

import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

/** Abmelden ohne aktiven Betrieb (Hinweisseite „Kein aktiver Betrieb“, KAN-159 B16). */
export default function AbmeldenKnopf() {
  const router = useRouter()
  async function abmelden() {
    await createSupabaseBrowserClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }
  return (
    <button type="button" onClick={abmelden}
      className="btn-primary mt-4 text-sm">
      Abmelden
    </button>
  )
}
