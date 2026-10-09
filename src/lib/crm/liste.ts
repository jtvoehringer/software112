// ── CRM-Listen serverseitig filtern und blättern (17.9.2026) ──────────────────
// Vorher luden Kontakte- und Firmenliste alle Datensätze (Gebeshuber: 8.267 /
// 4.648) in den Browser und filterten dort. Jetzt: Filter aus der URL
// (q, segment, buchstabe, lead, kunde, lieferant, sort, n), eine Abfrage mit
// .range() + count, Zähler je Segment/Lead über die RPC crm_zaehler
// (Migration 207). Aktivitäten/Pipeline/Ansprechpersonen nur für die
// geladenen Zeilen.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const LISTE_SCHRITT = 100
export const LISTE_MAX = 1000

// Kontakt-Felder „Position“ und „Quelle“ (02.10.2026): Höchstlängen wie in der
// Datenbank (CHECK), Sonderwert im URL-Parameter ?quelle= für „ohne Quelle“.
export const POSITION_MAX = 120
export const QUELLE_MAX = 80
export const QUELLE_OHNE = '__ohne__'

/** Freitext für Position/Quelle: trimmen, Leerzeichen zusammenfassen, leer → null (Formular und Datenimport) */
export function bereinigterText(roh: unknown): string | null {
  const wert = typeof roh === 'string' ? roh.trim().replace(/\s+/g, ' ') : ''
  return wert || null
}

// Kontaktspalten für Liste UND Detailseite (02.10.2026): enthält jedes Feld, das
// das Bearbeiten-Formular (KontaktForm) vorbelegt und updateKontakt schreibt –
// fehlte eines (bis 02.10.2026: email_weitere, skonto_pct, skonto_tage,
// betrieb_nr), setzte Speichern es auf leer bzw. den Standardwert zurück.
// Geprüft in scripts/tests/crm-bearbeiten-datenverlust.test.mjs.
export const KONTAKT_SPALTEN = 'id, accountnummer, vorname, nachname, segment, firma_id, email, email_weitere, telefon, telefon_vorwahl, mobil, mobil_vorwahl, strasse, plz, ort, land, betrieb_nr, newsletter, newsletter_bestaetigt, stammkunde, aktiv, notizen, erstellt_am, is_lead, sonderrabatt_pct, skonto_pct, skonto_tage, rabattgruppe_id, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct), zahlungsziel_tage, position, quelle, titel, titel_nachgestellt'

/** Zeile aus KONTAKT_SPALTEN (+ firmen:firma_id(name…)) → KontaktRow-Felder */
export function kontaktAusZeile(k: R) {
  const zahl = (x: unknown, standard: number) => { const n = parseFloat(String(x)); return Number.isFinite(n) ? n : standard }
  return {
    id:                    k.id as string,
    accountnummer:         (k.accountnummer as string | null) ?? null,
    vorname:               (k.vorname as string | null) ?? null,
    nachname:              k.nachname as string,
    segment:               k.segment,
    firma_id:              (k.firma_id as string | null) ?? null,
    firma_name:            ((k.firmen as R | null)?.name as string | undefined) ?? null,
    email:                 (k.email as string | null) ?? null,
    email_weitere:         (k.email_weitere as string[] | null) ?? [],
    telefon:               (k.telefon as string | null) ?? null,
    telefon_vorwahl:       (k.telefon_vorwahl as string | null) ?? '+43',
    mobil:                 (k.mobil as string | null) ?? null,
    mobil_vorwahl:         (k.mobil_vorwahl as string | null) ?? '+43',
    strasse:               (k.strasse as string | null) ?? null,
    plz:                   (k.plz as string | null) ?? null,
    ort:                   (k.ort as string | null) ?? null,
    land:                  (k.land as string | null) ?? null,
    betrieb_nr:            (k.betrieb_nr as string | null) ?? null,
    newsletter:            (k.newsletter as boolean | null) ?? false,
    newsletter_bestaetigt: (k.newsletter_bestaetigt as boolean | null) ?? false,
    stammkunde:            (k.stammkunde as boolean | null) ?? false,
    notizen:               (k.notizen as string | null) ?? null,
    rabattgruppe_id:       (k.rabattgruppe_id as string | null) ?? null,
    rabattgruppe_name:     ((k.rabattgruppe as R | null)?.name as string | undefined) ?? null,
    rabattgruppe_pct:      ((k.rabattgruppe as R | null)?.rabatt_pct as number | undefined) ?? null,
    sonderrabatt_pct:      zahl(k.sonderrabatt_pct, 0),
    skonto_pct:            zahl(k.skonto_pct, 0),
    skonto_tage:           k.skonto_tage == null ? 10 : zahl(k.skonto_tage, 10),
    zahlungsziel_tage:     (k.zahlungsziel_tage as number | null) ?? 14,
    is_lead:               !!k.is_lead,
    position:              (k.position as string | null) ?? null,
    quelle:                (k.quelle as string | null) ?? null,
    aktiv:                 (k.aktiv as boolean | null) ?? true,
    erstellt_am:           k.erstellt_am as string,
  }
}

export type ListenFilter = {
  q: string
  segment: string          // 'alle' | Segment-Wert
  buchstabe: string        // 'Alle' | 'A'…'Z'
  lead: 'alle' | 'lead' | 'kunde'
  kunde: boolean           // nur Firmen
  lieferant: boolean       // nur Firmen
  sort: 'nachname' | 'vorname' | 'name'
  /** KAN-150: deaktivierte Kontakte/Firmen mit anzeigen (?inaktiv=1) */
  inaktiv: boolean
  /** nur Kontakte: '' = alle Quellen, QUELLE_OHNE = ohne Quelle, sonst kontakte.quelle (?quelle=…) */
  quelle: string
  n: number                // Anzahl Zeilen (Schritte à LISTE_SCHRITT)
}

export function filterAusParams(sp: Record<string, string | string[] | undefined>, art: 'kontakt' | 'firma'): ListenFilter {
  const s = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? '' }
  const n = Math.min(LISTE_MAX, Math.max(LISTE_SCHRITT, parseInt(s('n'), 10) || LISTE_SCHRITT))
  const leadRaw = s('lead') || s('filter')
  const b = s('buchstabe').toUpperCase()
  return {
    q: s('q').trim().slice(0, 100),
    segment: s('segment') || 'alle',
    buchstabe: /^[A-Z]$/.test(b) ? b : 'Alle',
    lead: leadRaw === 'lead' || leadRaw === 'kunde' ? leadRaw : 'alle',
    kunde: s('kunde') === '1',
    lieferant: s('lieferant') === '1',
    sort: art === 'firma' ? 'name' : (s('sort') === 'vorname' ? 'vorname' : 'nachname'),
    inaktiv: s('inaktiv') === '1',
    quelle: art === 'kontakt' ? s('quelle').trim().slice(0, QUELLE_MAX) : '',
    n,
  }
}

export function paramsAusFilter(f: Partial<ListenFilter>): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.segment && f.segment !== 'alle') p.set('segment', f.segment)
  if (f.buchstabe && f.buchstabe !== 'Alle') p.set('buchstabe', f.buchstabe)
  if (f.lead && f.lead !== 'alle') p.set('lead', f.lead)
  if (f.kunde) p.set('kunde', '1')
  if (f.lieferant) p.set('lieferant', '1')
  if (f.sort && f.sort === 'vorname') p.set('sort', 'vorname')
  if (f.inaktiv) p.set('inaktiv', '1')
  if (f.quelle) p.set('quelle', f.quelle)
  if (f.n && f.n > LISTE_SCHRITT) p.set('n', String(f.n))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Höchstens so viele Suchwörter werden ausgewertet */
export const SUCHWOERTER_MAX = 5

/**
 * Suchtext → Wörter für die Listensuche (05.10.2026). Vorher wurde der ganze Text in jedem Feld einzeln gesucht –
 * „Dörfler Franz“ fand den Kontakt nicht, weil kein Feld beide Wörter enthält. Zeichen, die im ilike-Muster bzw. in
 * der PostgREST-or()-Syntax eine Bedeutung haben (% _ \ , ( ) " :), trennen wie Leerzeichen – ein Komma
 * („Dörfler, Franz“) brach sonst die Abfrage.
 */
export function suchWoerter(q: string): string[] {
  return q.split(/[\s%_\\,()":]+/).map(w => w.trim()).filter(Boolean).slice(0, SUCHWOERTER_MAX)
}

/** Ein or()-Filter je Wort: jedes Wort muss in mindestens einer der Spalten vorkommen (Wörter UND-verknüpft) */
export function suchFilter(spalten: readonly string[], q: string): string[] {
  return suchWoerter(q).map(w => spalten.map(s => `${s}.ilike.%${w}%`).join(','))
}

export const KONTAKT_SUCHSPALTEN = ['nachname', 'vorname', 'email', 'accountnummer', 'telefon', 'mobil', 'ort', 'position'] as const
export const FIRMA_SUCHSPALTEN = ['name', 'email', 'accountnummer', 'telefon', 'ort', 'uid_nummer'] as const

export type Zaehler = {
  gesamt: number
  segment: Record<string, number>
  lead: number
  kunde: number          // !is_lead
  istKunde: number       // Firmen: ist_kunde
  istLieferant: number   // Firmen: ist_lieferant
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeZaehler(client: any, tenantId: string | null, art: 'kontakt' | 'firma'): Promise<Zaehler> {
  const z: Zaehler = { gesamt: 0, segment: {}, lead: 0, kunde: 0, istKunde: 0, istLieferant: 0 }
  if (!tenantId) return z
  const { data, error } = await (client.rpc as any)('crm_zaehler', { p_tenant_id: tenantId })
  if (error) throw new Error(`Zähler konnten nicht geladen werden: ${error.message}`)
  for (const r of ((data ?? []) as R[]).filter(r => r.art === art)) {
    const n = Number(r.anzahl) || 0
    z.gesamt += n
    z.segment[r.segment] = (z.segment[r.segment] ?? 0) + n
    if (r.is_lead) z.lead += n; else z.kunde += n
    if (r.ist_kunde) z.istKunde += n
    if (r.ist_lieferant) z.istLieferant += n
  }
  return z
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeKontakteSeite(client: any, tenantId: string | null, f: ListenFilter): Promise<{ rows: R[]; gesamt: number }> {
  if (!tenantId) return { rows: [], gesamt: 0 }
  let q = (client.from('kontakte') as any)
    .select(`${KONTAKT_SPALTEN}, firmen:firma_id(name)`, { count: 'exact' })
    .eq('tenant_id', tenantId)
  if (!f.inaktiv) q = q.eq('aktiv', true)
  if (f.segment !== 'alle') q = q.eq('segment', f.segment)
  if (f.quelle === QUELLE_OHNE) q = q.is('quelle', null)
  else if (f.quelle) q = q.eq('quelle', f.quelle)
  if (f.buchstabe !== 'Alle') q = q.ilike(f.sort === 'vorname' ? 'vorname' : 'nachname', `${f.buchstabe}%`)
  if (f.lead === 'lead') q = q.eq('is_lead', true)
  if (f.lead === 'kunde') q = q.eq('is_lead', false)
  for (const filter of suchFilter(KONTAKT_SUCHSPALTEN, f.q)) q = q.or(filter)
  q = f.sort === 'vorname' ? q.order('vorname', { nullsFirst: false }).order('nachname') : q.order('nachname').order('vorname', { nullsFirst: false })
  const { data, count, error } = await q.order('id').range(0, f.n - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as R[], gesamt: count ?? 0 }
}

export type QuellenZaehler = {
  /** verwendete Quellen des Betriebs, alphabetisch, mit Anzahl */
  quellen: { quelle: string; anzahl: number }[]
  /** Kontakte ohne Quelle */
  ohne: number
}

/** Quellen-Werte zählen (02.10.2026) – ohne RPC: nur die Spalte quelle der Kontakte
 *  des Betriebs laden (mit inaktiven nur bei ?inaktiv=1, wie die Liste) und hier zählen. */
export function zaehleQuellen(rows: readonly R[]): QuellenZaehler {
  const m = new Map<string, number>()
  let ohne = 0
  for (const r of rows) {
    const q = typeof r.quelle === 'string' ? r.quelle.trim() : ''
    if (!q) { ohne++; continue }
    m.set(q, (m.get(q) ?? 0) + 1)
  }
  const quellen = [...m.entries()]
    .map(([quelle, anzahl]) => ({ quelle, anzahl }))
    .sort((a, b) => a.quelle.localeCompare(b.quelle, 'de'))
  return { quellen, ohne }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeFirmenSeite(client: any, tenantId: string | null, f: ListenFilter): Promise<{ rows: R[]; gesamt: number }> {
  if (!tenantId) return { rows: [], gesamt: 0 }
  let q = (client.from('firmen') as any)
    .select('id, accountnummer, name, segment, strasse, plz, ort, land, telefon, telefon_vorwahl, mobil, mobil_vorwahl, email, email_weitere, website, uid_nummer, betrieb_nr, debitor_nr, kreditlimit, zahlungsziel_tage, skonto_pct, skonto_tage, waehrung, notizen, aktiv, is_lead, ist_kunde, ist_lieferant, sonderrabatt_pct, rabattgruppe_id, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct)', { count: 'exact' })
    .eq('tenant_id', tenantId)
  if (!f.inaktiv) q = q.eq('aktiv', true)
  if (f.segment !== 'alle') q = q.eq('segment', f.segment)
  if (f.buchstabe !== 'Alle') q = q.ilike('name', `${f.buchstabe}%`)
  if (f.lead === 'lead') q = q.eq('is_lead', true)
  if (f.lead === 'kunde') q = q.eq('is_lead', false)
  if (f.kunde) q = q.eq('ist_kunde', true)
  if (f.lieferant) q = q.eq('ist_lieferant', true)
  for (const filter of suchFilter(FIRMA_SUCHSPALTEN, f.q)) q = q.or(filter)
  const { data, count, error } = await q.order('name').order('id').range(0, f.n - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as R[], gesamt: count ?? 0 }
}
