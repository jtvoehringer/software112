// KAN-286: Sitzungs-Cookie im Browser schreiben bzw. löschen (SessionTimeout, Login). Ohne Ablaufdatum – es fällt beim
// Schließen des Browsers weg; der Proxy prüft es serverseitig (src/lib/auth/sitzung.ts).
// KAN-287: auch nach der Anmeldung (Passwort oder Passkey) – so hängt der Beginn der Sitzung nicht davon ab, ob der
// Auth-Server last_sign_in_at bei jeder Anmeldeart setzt.
import { SITZUNG_COOKIE, STANDARD_TIMEOUT_MIN, sitzungWert } from '@/lib/auth/sitzung'
import { authCookieOptionen } from '@/lib/tenant/subdomain'

export function sitzungsCookieSchreiben(minuten: number = STANDARD_TIMEOUT_MIN, loeschen = false) {
  try {
    const domain = authCookieOptionen(window.location.host)?.domain
    const teile = [`${SITZUNG_COOKIE}=${loeschen ? '' : sitzungWert(Date.now(), minuten)}`, 'path=/', 'samesite=lax']
    if (loeschen) teile.push('max-age=0')
    if (window.location.protocol === 'https:') teile.push('secure')
    if (domain) teile.push(`domain=${domain}`)
    document.cookie = teile.join('; ')
  } catch { /* Cookie ist Zusatznutzen – der Proxy setzt es beim nächsten Seitenaufruf ebenfalls */ }
}
