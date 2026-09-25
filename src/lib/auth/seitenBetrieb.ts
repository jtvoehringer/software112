import 'server-only'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { AktionsFehler } from '@/lib/fehler'
import { BETRIEB_GEWECHSELT_MELDUNG, SEITEN_BETRIEB_HEADER, seitenBetriebPasst } from '@/lib/tenant/waechter'

// ── Schreibzugriffe gegen veraltete Tabs absichern (KAN-30, Tiefenverteidigung) ─
//
// Architekturentscheidung: Der Betrieb der Seite kommt als HTTP-Header, nicht als Formularfeld.
// components/BetriebsWaechter.tsx installiert einen schmalen fetch-Wrapper, der an jede
// schreibende Anfrage (nicht GET/HEAD) an die eigene Herkunft den Header x-s112-seiten-betrieb
// mit dem Betrieb hängt, mit dem die Seite gerendert wurde – Server Actions ebenso wie
// POST/PUT/PATCH/DELETE an /api (KI-Assistent, Import, Export, Belege …).
// Verworfen wurden:
//  - Hidden-Feld <SeitenBetrieb /> bzw. ein Submit-Listener, der es in jedes <form> einfügt:
//    erreicht nur FormData, das aus einem Formular entsteht. Die kritischsten Aufrufe bauen
//    ihr FormData selbst (Verkauf anlegen: verkauf/neu/page.tsx, Umzug: UmziehenClient) oder
//    übergeben nur eine ID (stornoVerkauf, schwundAusbuchen, deleteUmzug) – jede Aufrufstelle
//    hätte angefasst werden müssen.
//  - Eigene Header sieht Next für Server Actions nicht vor; der Client-Router ruft dafür aber
//    zur Laufzeit das globale fetch auf (next/dist/client/components/segment-cache/fetch.js).
//    scripts/tests/betriebswaechter.test.mjs prüft das gegen die installierte Next-Version –
//    ändert ein Update das, schlägt npm run test:csv fehl, statt dass die Prüfung still
//    durchlässt (fail-open). Der Wächter sperrt den Tab ohnehin weiterhin im Browser.
//  - Prüfung in getCurrentMembership(): läuft auch beim Rendern nach einer Action
//    (revalidatePath/redirect im selben Request) und an ~350 Stellen mit unterschiedlichen
//    Fehlerwegen – deshalb in den Kontext-Helfern der Action-Module, jeweils direkt nach
//    getCurrentMembership() und VOR der Rechteprüfung (sonst meldet ein veralteter Tab die
//    Rechte des NEUEN Betriebs). scripts/check-seiten-betrieb.js (prebuild) verlangt den
//    Aufruf in jeder 'use server'-Datei unter (dashboard) oder eine begründete Ausnahme.
// Fehlt der Header (ältere Seiten, Formular vor der Hydrierung, Aufrufe außerhalb des
// Arbeitsbereichs, Cron/Webhooks), wird NICHT abgelehnt. Der Header kann eine Anfrage nur
// ablehnen lassen, nie freischalten – Mandantenfilter und RLS hängen weiter am Cookie.

async function seitenBetriebDerAnfrage(): Promise<string | null> {
  try {
    return (await headers()).get(SEITEN_BETRIEB_HEADER)
  } catch {
    return null   // außerhalb eines Requests (z. B. Skript) – keine Aussage
  }
}

/**
 * Wirft AktionsFehler „Der Betrieb wurde in einem anderen Tab gewechselt – bitte Seite neu
 * laden.“, wenn die aufrufende Seite zu einem anderen Betrieb gehört als der aktive
 * (Cookie, von getCurrentMembership() geprüft). Ohne aktiven Betrieb keine Prüfung – das
 * meldet der Aufrufer selbst („Kein aktiver Mandant gefunden“).
 */
export async function pruefeSeitenBetrieb(aktiverBetrieb: string | null | undefined): Promise<void> {
  if (!aktiverBetrieb) return
  if (!seitenBetriebPasst(await seitenBetriebDerAnfrage(), aktiverBetrieb)) {
    throw new AktionsFehler(BETRIEB_GEWECHSELT_MELDUNG)
  }
}

/**
 * Wie pruefeSeitenBetrieb, aber ohne Werfen – für Actions, die Fehler als { error } bzw.
 * { ok: false, fehler } zurückgeben: Meldung bei abweichendem Betrieb, sonst null.
 */
export async function seitenBetriebFehler(aktiverBetrieb: string | null | undefined): Promise<string | null> {
  if (!aktiverBetrieb) return null
  return seitenBetriebPasst(await seitenBetriebDerAnfrage(), aktiverBetrieb) ? null : BETRIEB_GEWECHSELT_MELDUNG
}

/**
 * Für Route-Handler: fertige 409-Antwort, wenn die aufrufende Seite zu einem anderen Betrieb
 * gehört, sonst null. Muster wie pruefeZweiFaktor():
 *
 *     const konflikt = await seitenBetriebKonflikt(tenantId)
 *     if (konflikt) return konflikt
 *
 * feld = Schlüssel der Fehlermeldung, den der Client der Route liest ('fehler' bzw. 'error').
 */
export async function seitenBetriebKonflikt(
  aktiverBetrieb: string | null | undefined,
  feld: 'fehler' | 'error' = 'fehler',
): Promise<NextResponse | null> {
  if (!aktiverBetrieb) return null
  if (seitenBetriebPasst(await seitenBetriebDerAnfrage(), aktiverBetrieb)) return null
  return NextResponse.json({ [feld]: BETRIEB_GEWECHSELT_MELDUNG }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
}
