import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken } from '@/lib/m365/graph'
import { M365TokenFehler, NEU_VERBINDEN_TEXT, istNeuVerbinden } from '@/lib/m365/tokenFehler'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Spiegelt die Outlook-Kalendertermine des angemeldeten Users (per-User M365-Verbindung,
// siehe user_email_connections) in den CRM-Kalender. Liefert bewusst IMMER eine leere Liste
// (statt eines Fehlers) zurück, wenn keine aktive M365-Verbindung besteht oder der Abruf
// fehlschlägt – das Feature soll das CRM nie blockieren, sondern nur optional ergänzen.
export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const von = req.nextUrl.searchParams.get('von')
    const bis = req.nextUrl.searchParams.get('bis')
    if (!von || !bis) return NextResponse.json({ eintraege: [] })

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()

    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ eintraege: [] })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ eintraege: [] })

    const [{ data: cfg }, { data: tenantCfg }] = await Promise.all([
      (admin.from('user_email_connections') as any)
        .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, email_spiegel_info')
        .eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle(),
      (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc')
        .eq('tenant_id', tenantId).maybeSingle(),
    ])
    const c = cfg as R | null

    // KAN-125: Verbindung muss neu hergestellt werden → Hinweis statt stiller Leere
    if (c?.m365_aktiv && !c?.m365_access_token_enc && istNeuVerbinden(c.email_spiegel_info)) {
      return NextResponse.json({ eintraege: [], fehler: NEU_VERBINDEN_TEXT, neuVerbinden: true })
    }
    // Kein aktiv verbundenes M365-Konto → einfach keine Outlook-Termine anzeigen (kein Fehler)
    if (!c?.m365_aktiv || !c?.m365_access_token_enc) return NextResponse.json({ eintraege: [] })

    // Ab hier IST eine Verbindung vorhanden – ein Fehler ist also ein echtes Problem
    // (z.B. Token-Refresh-Race bei Microsoft), kein erwarteter "nicht verbunden"-Fall.
    // Wird geloggt (Vercel Function Logs) UND mit "fehler"-Feld an den Client zurückgegeben,
    // damit der Client die zuletzt erfolgreich geladenen Termine NICHT überschreibt/löscht.
    let token: string
    try {
      token = await getValidUserAccessToken(c, tenantCfg as R, admin, tenantId, user.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[outlook-kalender] Token-Fehler für user=${user.id} tenant=${tenantId}:`, msg)
      // KAN-125: eingestufte Token-Fehler sind schon lesbar (kein rohes JSON mehr)
      if (err instanceof M365TokenFehler) return NextResponse.json({ eintraege: [], fehler: msg, neuVerbinden: err.art === 'neu_verbinden' })
      return NextResponse.json({ eintraege: [], fehler: `Token: ${msg}` })
    }

    const startDateTime = `${von}T00:00:00`
    const endDateTime   = `${bis}T23:59:59`
    let url: string | undefined = `https://graph.microsoft.com/v1.0/me/calendarView`
      + `?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}`
      + `&$select=id,subject,start,end,isAllDay,webLink,isCancelled`
      + `&$top=250&$orderby=start/dateTime`

    // WICHTIG: Graph liefert bei calendarView maximal $top Eintraege PRO SEITE
    // (chronologisch sortiert ab startDateTime) und verweist bei mehr Daten via
    // "@odata.nextLink" auf die naechste Seite. Ohne Pagination werden bei Usern
    // mit vielen (z.B. taeglich wiederkehrenden) Terminen NUR die ersten ~250
    // Termine ab Fensterbeginn geladen - alles Spaetere im Zeitraum faellt
    // komplett unter den Tisch. Das fuehrte dazu, dass z.B. der aktuell
    // betrachtete Monat je nach Fensterlage mal Termine zeigte, mal nicht
    // ("Termine erscheinen kurz und verschwinden wieder" beim Navigieren).
    // Sicherheitsgrenze: max. 10 Seiten (=2500 Termine), damit ein einzelner
    // User mit extrem vielen Terminen die Funktion nicht dauerhaft blockiert.
    const events: R[] = []
    let seiten = 0
    const MAX_SEITEN = 10
    while (url && seiten < MAX_SEITEN) {
      const res: Response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="W. Europe Standard Time"',
        },
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error(`[outlook-kalender] Graph-Fehler für user=${user.id} tenant=${tenantId}: HTTP ${res.status} ${body.slice(0, 500)}`)
        return NextResponse.json({ eintraege: [], fehler: `Graph HTTP ${res.status}` })
      }
      const data = await res.json() as R
      events.push(...((data.value ?? []) as R[]))
      url = data['@odata.nextLink'] as string | undefined
      seiten++
    }
    if (url) {
      // Sicherheitsgrenze erreicht, es gaebe noch mehr Seiten - loggen, damit das
      // auffaellt, statt still unvollstaendige Daten zu liefern.
      console.warn(`[outlook-kalender] Seitenlimit (${MAX_SEITEN}) erreicht für user=${user.id} tenant=${tenantId} – Ergebnis evtl. unvollständig (${events.length} Termine geladen)`)
    }

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
  } catch (err) {
    // Best-effort: Outlook-Spiegelung darf den CRM-Kalender nie zum Absturz bringen.
    // Trotzdem loggen (statt lautlos zu verschlucken) – sonst ist ein Fehler wie ein
    // fehlgeschlagener Token-Refresh im Nachhinein nie nachvollziehbar.
    console.error('[outlook-kalender] Unerwarteter Fehler:', err instanceof Error ? err.message : err)
    return NextResponse.json({ eintraege: [], fehler: 'unerwarteter Fehler (siehe Server-Logs)' })
  }
}
