// Weinshop-Anbindung (KAN-460, 15.11.2026): Prüfung der Shop-Adresse, die der Betrieb selbst eingibt.
//
// Der Server ruft diese Adresse später auf (Verbindungstest, Übertragung) – ohne Prüfung könnte ein Betrieb damit
// interne Adressen der Plattform abfragen. Deshalb: nur https, kein Benutzer/Passwort in der Adresse, kein Port außer
// 443, keine IP-Adressen und keine internen Namen; die Namensauflösung prüft zusätzlich der Aufrufer (woocommerce.ts,
// `istInterneAdresse`). Isomorph (Formular und Server Action), ohne Importe.

export const SHOP_URL_MAX = 300

const INTERNE_ENDUNGEN = ['.local', '.localhost', '.internal', '.intranet', '.lan', '.home', '.corp', '.test', '.invalid', '.example']

/** Adresse wie eingegeben → einheitliche Form `https://host[/unterordner]` ohne Schrägstrich am Ende, oder null */
export function shopUrlNormalisiert(roh: unknown): string | null {
  const s = typeof roh === 'string' ? roh.trim() : ''
  if (!s || shopUrlFehler(s)) return null
  const u = new URL(s)
  return `https://${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
}

/** Fehlermeldung zur Shop-Adresse oder null, wenn sie passt (leer = keine Adresse, kein Fehler) */
export function shopUrlFehler(roh: unknown): string | null {
  const s = typeof roh === 'string' ? roh.trim() : ''
  if (!s) return null
  if (s.length > SHOP_URL_MAX) return `Die Shop-Adresse ist zu lang (höchstens ${SHOP_URL_MAX} Zeichen).`
  if (/\s/.test(s)) return 'Die Shop-Adresse darf keine Leerzeichen enthalten.'
  if (!/^https:\/\//i.test(s)) return 'Die Shop-Adresse muss mit https:// beginnen.'
  let u: URL
  try { u = new URL(s) } catch { return 'Die Shop-Adresse ist ungültig.' }
  if (u.protocol !== 'https:') return 'Die Shop-Adresse muss mit https:// beginnen.'
  if (u.username || u.password) return 'Die Shop-Adresse darf keinen Benutzernamen und kein Passwort enthalten.'
  if (u.port && u.port !== '443') return 'Die Shop-Adresse darf keinen eigenen Port enthalten.'
  if (u.search || u.hash) return 'Bitte nur die Adresse des Shops angeben, ohne „?“ und „#“.'
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!host.includes('.') || host.startsWith('[') || /^[0-9.]+$/.test(host) || /^0x/i.test(host)) {
    return 'Bitte den Namen des Shops angeben (z. B. https://www.mein-weingut.at), keine IP-Adresse.'
  }
  if (host === 'localhost' || INTERNE_ENDUNGEN.some(e => host.endsWith(e))) return 'Diese Adresse ist nicht öffentlich erreichbar.'
  if (!/^[a-z0-9.-]+$/.test(host) || host.split('.').some(t => !t || t.startsWith('-') || t.endsWith('-'))) return 'Die Shop-Adresse ist ungültig.'
  if (/(^|\/)wp-json(\/|$)/i.test(u.pathname)) return 'Bitte nur die Adresse des Shops angeben, ohne „/wp-json“.'
  return null
}

function v4Teile(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const t = m.slice(1).map(Number)
  return t.every(n => n <= 255) ? t : null
}

function v4Intern([a, b]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224          // „dieses Netz“, privat, Loopback, Multicast/reserviert
    || (a === 100 && b >= 64 && b <= 127)                       // Carrier-NAT
    || (a === 169 && b === 254)                                 // Link-Local (Metadaten-Dienste)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0))
    || (a === 198 && (b === 18 || b === 19))
}

/** true, wenn eine aufgelöste IP-Adresse nicht ins öffentliche Netz zeigt (privat, Loopback, Link-Local, …) */
export function istInterneAdresse(ip: string): boolean {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const v4 = v4Teile(s)
  if (v4) return v4Intern(v4)
  if (!s.includes(':')) return true                             // weder IPv4 noch IPv6 – nicht verwenden
  const eingebettet = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s)   // ::ffff:10.0.0.1, 64:ff9b::10.0.0.1
  if (eingebettet) { const t = v4Teile(eingebettet[1]); return !t || v4Intern(t) }
  if (s === '::' || s === '::1') return true
  const erste = parseInt(s.split(':')[0] || '0', 16)
  if (Number.isNaN(erste)) return true
  return (erste & 0xfe00) === 0xfc00                            // fc00::/7 Unique Local
    || (erste & 0xffc0) === 0xfe80                              // fe80::/10 Link-Local
    || (erste & 0xff00) === 0xff00                              // Multicast
    || s.startsWith('::ffff:') || s.startsWith('64:ff9b:')      // IPv4-Abbildungen in Hex-Schreibweise
    || erste === 0                                              // ::/16 (reserviert)
    || erste === 0x2001 && /^2001:(0?db8|0{0,4}):/.test(s)      // Dokumentation, Teredo
}
