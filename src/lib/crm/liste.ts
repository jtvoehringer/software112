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

export type ListenFilter = {
  q: string
  segment: string          // 'alle' | Segment-Wert
  buchstabe: string        // 'Alle' | 'A'…'Z'
  lead: 'alle' | 'lead' | 'kunde'
  kunde: boolean           // nur Firmen
  lieferant: boolean       // nur Firmen
  sort: 'nachname' | 'vorname' | 'name'
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
  if (f.n && f.n > LISTE_SCHRITT) p.set('n', String(f.n))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** ilike-Muster ohne Sonderzeichen-Überraschungen */
function muster(q: string): string {
  return `%${q.replace(/[%_\\]/g, ' ').trim()}%`
}

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
  const { data } = await (client.rpc as any)('crm_zaehler', { p_tenant_id: tenantId })
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
    .select('id, accountnummer, vorname, nachname, segment, firma_id, firmen:firma_id(name), email, telefon, telefon_vorwahl, mobil, mobil_vorwahl, strasse, plz, ort, land, newsletter, newsletter_bestaetigt, stammkunde, aktiv, notizen, erstellt_am, is_lead, sonderrabatt_pct, rabattgruppe_id, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct), zahlungsziel_tage', { count: 'exact' })
    .eq('tenant_id', tenantId).eq('aktiv', true)
  if (f.segment !== 'alle') q = q.eq('segment', f.segment)
  if (f.buchstabe !== 'Alle') q = q.ilike(f.sort === 'vorname' ? 'vorname' : 'nachname', `${f.buchstabe}%`)
  if (f.lead === 'lead') q = q.eq('is_lead', true)
  if (f.lead === 'kunde') q = q.eq('is_lead', false)
  if (f.q) {
    const m = muster(f.q)
    q = q.or(`nachname.ilike.${m},vorname.ilike.${m},email.ilike.${m},accountnummer.ilike.${m},telefon.ilike.${m},mobil.ilike.${m},ort.ilike.${m}`)
  }
  q = f.sort === 'vorname' ? q.order('vorname', { nullsFirst: false }).order('nachname') : q.order('nachname').order('vorname', { nullsFirst: false })
  const { data, count, error } = await q.order('id').range(0, f.n - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as R[], gesamt: count ?? 0 }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeFirmenSeite(client: any, tenantId: string | null, f: ListenFilter): Promise<{ rows: R[]; gesamt: number }> {
  if (!tenantId) return { rows: [], gesamt: 0 }
  let q = (client.from('firmen') as any)
    .select('id, accountnummer, name, segment, strasse, plz, ort, land, telefon, telefon_vorwahl, mobil, mobil_vorwahl, email, website, uid_nummer, betrieb_nr, debitor_nr, kreditlimit, zahlungsziel_tage, skonto_pct, skonto_tage, waehrung, notizen, aktiv, is_lead, ist_kunde, ist_lieferant, sonderrabatt_pct, rabattgruppe_id, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct)', { count: 'exact' })
    .eq('tenant_id', tenantId).eq('aktiv', true)
  if (f.segment !== 'alle') q = q.eq('segment', f.segment)
  if (f.buchstabe !== 'Alle') q = q.ilike('name', `${f.buchstabe}%`)
  if (f.lead === 'lead') q = q.eq('is_lead', true)
  if (f.lead === 'kunde') q = q.eq('is_lead', false)
  if (f.kunde) q = q.eq('ist_kunde', true)
  if (f.lieferant) q = q.eq('ist_lieferant', true)
  if (f.q) {
    const m = muster(f.q)
    q = q.or(`name.ilike.${m},email.ilike.${m},accountnummer.ilike.${m},telefon.ilike.${m},ort.ilike.${m},uid_nummer.ilike.${m}`)
  }
  const { data, count, error } = await q.order('name').order('id').range(0, f.n - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as R[], gesamt: count ?? 0 }
}
