// Pressungen im Kellerbuch (Pilot 30.09.2026): eigener Tab nach der Übersicht. Erfassen, Bearbeiten, Stornieren wie
// bisher auf der Lese-Seite – dieselbe Komponente (PressungSection) und dieselben Daten (ladeLeseKontext), nur mit
// Auswahl von Jahrgang und Lese statt über die Lese-Seite. Lese, Lesedaten und AMA-Erntemeldung bleiben unter Rieden.
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import PressungSection from '@/app/(dashboard)/erntemeldung/[id]/PressungSection'
import { ladeLeseKontext } from '@/app/(dashboard)/erntemeldung/[id]/leseKontext'
import { leseTitel } from '@/lib/wein/lesen'
import { AktionsFehler } from '@/lib/fehler'
import { pressenVorauswahl } from '@/lib/wein/pressenLink'

export const metadata: Metadata = { title: 'Pressungen' }
export const dynamic = 'force-dynamic'

interface Props { searchParams: Promise<{ jahrgang?: string | string[]; lese?: string | string[]; ried?: string | string[]; gst?: string | string[]; tag?: string | string[] }> }

const einzeln = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function pfad(jahrgangId: string, leseNr?: number | null) {
  return `/kellerbuch/pressungen?jahrgang=${jahrgangId}${leseNr != null ? `&lese=${leseNr}` : ''}`
}

const pille = (aktiv: boolean) =>
  `px-3 py-1.5 rounded-lg text-sm transition-colors ${aktiv
    ? 'bg-s112-teal text-s112-yellow font-semibold'
    : 'bg-s112-bg border border-s112-border text-s112-text-1 hover:border-s112-teal hover:text-s112-blue-700'}`

export default async function PressungenPage({ searchParams }: Props) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  if (!membership) notFound()
  const supabase = await createSupabaseServerClient()

  // Jahrgänge des Betriebs – ohne Auswahl der neueste
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawJg, error } = await (supabase.from('weinjahrgaenge') as any)
    .select('id, jahrgang').eq('tenant_id', membership.tenantId).order('jahrgang', { ascending: false })
  if (error) throw new AktionsFehler(`Jahrgänge konnten nicht geladen werden: ${error.message}`)
  const jahrgaenge = (rawJg ?? []) as { id: string; jahrgang: number }[]

  if (jahrgaenge.length === 0) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold text-s112-blue-700 mb-4">Pressungen</h1>
        <div className="card text-center py-12">
          <p className="text-s112-text-1 font-medium">Noch kein Jahrgang angelegt</p>
          <p className="text-s112-muted text-sm mt-1 mb-4">Pressungen gehören zu einem Jahrgang und einer Lese.</p>
          <Link href="/erntemeldung" className="text-sm text-s112-blue-700 hover:underline font-medium">Rieden › Lese →</Link>
        </div>
      </div>
    )
  }

  const gewaehlt = jahrgaenge.find(j => j.id === einzeln(sp.jahrgang)) ?? jahrgaenge[0]
  const k = await ladeLeseKontext(gewaehlt.id, sp.lese)
  const mehrereLesen = k.lesen.length > 1

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-s112-blue-700">Pressungen</h1>
        <Link href={`/erntemeldung/${gewaehlt.id}${mehrereLesen && k.aktiveLese ? `?lese=${k.aktiveLese.lfd_nr}` : ''}`}
          className="text-sm text-s112-blue-700 hover:underline">
          Lesedaten {gewaehlt.jahrgang} →
        </Link>
      </div>

      {/* Auswahl Jahrgang und Lese */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-s112-muted uppercase tracking-wide w-20">Jahrgang</span>
          {jahrgaenge.map(j => (
            <Link key={j.id} href={pfad(j.id)} className={pille(j.id === gewaehlt.id)} aria-current={j.id === gewaehlt.id ? 'page' : undefined}>
              {j.jahrgang}
            </Link>
          ))}
        </div>
        {mehrereLesen && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-s112-muted uppercase tracking-wide w-20">Lese</span>
            {k.lesen.map(l => (
              <Link key={l.id} href={pfad(gewaehlt.id, l.lfd_nr)} className={pille(l.id === k.aktiveLese?.id)}
                aria-current={l.id === k.aktiveLese?.id ? 'page' : undefined}>
                {leseTitel(gewaehlt.jahrgang, l)}
              </Link>
            ))}
          </div>
        )}
      </div>

      <PressungSection
        jahrgangId={gewaehlt.id}
        leseId={k.aktiveLese?.id ?? null}
        leseArt={k.aktiveLese?.art ?? null}
        pressungen={k.pressungen}
        wgOptions={k.wgOptions}
        behOptions={k.behOptions}
        waOptions={k.waOptions}
        verfuegbareKgByGST={k.verfuegbareKgByGST}
        zukaufTrauben={k.zukaufTrauben}
        behaelterMitCharge={k.behaelterMitCharge}
        leseParzellen={k.leseParzellen}
        leseEintraege={k.leseEintraege}
        writeOk={k.writeOk}
        adminOk={k.adminOk}
        vorauswahl={pressenVorauswahl(sp)}
      />
    </div>
  )
}
