import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken } from '@/lib/m365/graph'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Spiegelt die Outlook-Kalendertermine des angemeldeten Users (per-User M365-Verbindung,
// siehe user_email_connections) in den CRM-Kalender. Liefert bewusst IMMER eine leere Liste
// (statt eines Fehlers) zurück, wenn keine aktive M365-Verbindung besteht oder der Abruf
// fehlschlägt – das Feature soll das CRM nie blockieren, sondern nur optional ergänzen.
export async function GET(req: NextRequest) {
  try {
    const von = req.nextUrl.searchParams.get('von')
    const bis = req.nextUrl.searchParams.get('bis')
    if (!von || !bis) return NextResponse.json({ eintraege: [] })

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()

    const { data: membership } = await (supabase.from('tenant_memberships') as any)
      .select('tenant_id').limit(1).single()
    const tenantId = (membership as R | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ eintraege: [] })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ eintraege: [] })

    const [{ data: cfg }, { data: tenantCfg }] = await Promise.all([
      (supabase.from('user_email_connections') as any)
        .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at')
        .eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle(),
      (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc')
        .eq('tenant_id', tenantId).maybeSingle(),
    ])
    const c = cfg as R | null

    // Kein aktiv verbundenes M365-Konto → einfach keine Outlook-Termine anzeigen (kein Fehler)
    if (!c?.m365_aktiv || !c?.m365_access_token_enc) return NextResponse.json({ eintraege: [] })

    const token = await getValidUserAccessToken(c, tenantCfg as R, supabase)

    const startDateTime = `${von}T00:00:00`
    const endDateTime   = `${bis}T23:59:59`
    const url = `https://graph.microsoft.com/v1.0/me/calendarView`
      + `?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}`
      + `&$select=id,subject,start,end,isAllDay,webLink,isCancelled`
      + `&$top=250&$orderby=start/dateTime`

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="W. Europe Standard Time"',
      },
    })
    if (!res.ok) return NextResponse.json({ eintraege: [] })

    const data   = await res.json() as R
    const events = (data.value ?? []) as R[]

    const eintraege = events
      .filter(e => !e.isCancelled)
      .map(e => {
        const allDay     = !!e.isAllDay
        const startDate  = (e.start?.dateTime ?? '').slice(0, 10)
        const endDate    = (e.end?.dateTime ?? '').slice(0, 10)
        const startTime  = allDay ? null : (e.start?.dateTime ?? '').slice(11, 19)
        const endTime    = allDay ? null : (e.end?.dateTime ?? '').slice(11, 19)

        // Graph liefert bei Ganztags-Terminen das Enddatum EXKLUSIV (Tag danach) →
        // für die Anzeige als Mehrtage-Balken einen Tag zurückrechnen.
        let bisDatum: string | null = null
        if (allDay && endDate && endDate !== startDate) {
          const d = new Date(endDate + 'T00:00:00')
          d.setDate(d.getDate() - 1)
          bisDatum = d.toISOString().slice(0, 10)
        }

        return {
          id:           `o_${e.id}`,
          datum:        startDate,
          titel:        e.subject || '(kein Betreff)',
          typ:          'outlook' as const,
          art:          'outlook',
          artIcon:      '📅',
          ganztags:     allDay,
          uhrzeit_von:  startTime,
          uhrzeit_bis:  endTime,
          bis_datum:    bisDatum,
          ueberfaellig: false,
          erledigt:     false,
          href:         e.webLink ?? '#',
        }
      })
      .filter(e => !!e.datum)

    return NextResponse.json({ eintraege })
  } catch {
    // Best-effort: Outlook-Spiegelung darf den CRM-Kalender nie zum Absturz bringen.
    return NextResponse.json({ eintraege: [] })
  }
}
