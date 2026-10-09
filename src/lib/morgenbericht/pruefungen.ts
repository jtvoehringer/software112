// ── Morgenbericht: deterministische Prüfungen je Betrieb ─────────────────────
// Jede Prüfung liefert Befunde mit Stufe hoch / mittel / info und Link ins
// Modul. Nachvollziehbar und ohne KI - die KI fasst nur zusammen (ki.ts).
// Läuft mit dem Dashboard-Kontext (Session) oder einem Service-Role-Kontext
// (Cron, siehe erstellen.ts).

import { ladeFristen, ladeKeller, ZAHLUNGSZIEL_TAGE, posSum, type Ctx, type R } from '@/app/(dashboard)/dashboard/_shared/data'
import type { Befund } from '@/lib/wetter/regeln'
import { alle } from '@/lib/supabase/alle'
import { ereignisseLaden } from '@/lib/system/ereignis'
import { weinbauBetriebsnummerFehlt } from '@/lib/betrieb/betriebsnummer'
import { betriebeOhneMorgenberichtAmVortag } from './vortag'
import { SANDBOX_TENANT_ID } from '@/lib/abo/regeln'
import { BEHANDLUNG_RIEDEN_SELECT, riedText } from '@/lib/behandlungen/rieden'

export type { Befund }
export type Einstellungen = Awaited<ReturnType<typeof import('@/app/(dashboard)/dashboard/_shared/data').ladeEinstellungen>>

const eur = (n: number) => `€ ${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const datumDe = (iso: string) => new Date(iso).toLocaleDateString('de-AT')

export async function pruefeBetrieb(ctx: Ctx, einst: Einstellungen, paket: { istBasis: boolean }): Promise<Befund[]> {
  const befunde: Befund[] = []
  const heute = ctx.heute
  const seit90 = new Date(heute.getTime() - 90 * 86400000).toISOString().slice(0, 10)
  const seit7 = new Date(heute.getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const seit365 = new Date(heute.getTime() - 365 * 86400000).toISOString().slice(0, 10)

  const [fristen, keller, { data: offeneVp, error: offeneVpErr }, { data: ohneKat, error: ohneKatErr }, { count: belegeErkannt }, { data: txJahr, error: txJahrErr }, { data: fuellNeg, error: fuellNegErr }, { data: chargenNeg, error: chargenNegErr }, { data: dublettenRaw, error: dublettenRawErr }, { data: tenant, error: tenantErr }, { data: wartefristen, error: wartefristenErr }, { data: pressungen, error: pressungenErr }] = await Promise.all([
    ladeFristen(ctx, { modulEa: einst.modulEa, uvaZeitraum: einst.uvaZeitraum, vorwarnungTage: einst.vorwarnungTage, betriebsbeginn: einst.betriebsbeginn, doppik: einst.doppik, psmFristH: einst.psmFristH }),
    ladeKeller(ctx, einst.messintervallTage),
    ctx.tf(ctx.q('verkaufsposten').select('id, rechnungsnummer, datum, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).eq('storniert', false).eq('bezahlt', false).lt('datum', new Date(heute.getTime() - ZAHLUNGSZIEL_TAGE * 86400000).toISOString().slice(0, 10)).limit(500)),
    einst.modulEa ? ctx.tf(ctx.q('ea_transaktionen').select('id').is('kategorie_id', null).is('storniert_am', null).is('storno_von_id', null).gte('datum', seit90).limit(200)) : Promise.resolve({ data: [], error: null }),
    einst.modulEa ? ctx.tf(ctx.q('ea_belege').select('id', { count: 'exact', head: true }).eq('status', 'erkannt')) : Promise.resolve({ count: 0 }),
    einst.modulEa ? alle(ctx.tf(ctx.q('ea_transaktionen').select('id, datum, beschreibung, betrag_netto, kategorie_id, typ').gte('datum', seit365).is('anlage_id', null).is('storniert_am', null).is('storno_von_id', null).order('datum').order('id'))) : Promise.resolve({ data: [], error: null }),   // Sweep 20.9.: .limit(5000) wurde bei 1.000 gekappt
    ctx.tf(ctx.q('fuellungen').select('id, name, jahrgang, bestand_flaschen').eq('aktiv', true).lt('bestand_flaschen', 0).limit(20)),
    ctx.tf(ctx.q('weinausbau').select('id, name, jahrgang, menge_liter').eq('aktiv', true).lt('menge_liter', 0).limit(20)),
    // Dubletten serverseitig (Migration 213): alle aktiven Kontakte, gleiche E-Mail (Standard + weitere) oder gleicher Name, ohne "keine Dublette"-Markierungen
    ctx.supabase.rpc('crm_dubletten', { p_tenant_id: ctx.tenantId }),
    // tenant-isolation-ignore: tenants hat keine tenant_id-Spalte, Filter über die eigene id
    ctx.q('tenants').select('stripe_status, stripe_trial_ends_at, stripe_plan').eq('id', ctx.tenantId).maybeSingle(),
    // KAN-121 (01.10.2026): Ried auch über die Grundstücke der Maßnahme (App-Maßnahmen haben kein weingarten_id)
    ctx.tf(ctx.q('behandlungen').select(`id, datum, ernte_fruehesteins, ${BEHANDLUNG_RIEDEN_SELECT}`).is('storniert_am', null).gte('ernte_fruehesteins', new Date(heute.getTime() - 60 * 86400000).toISOString().slice(0, 10)).limit(500)),
    ctx.tf(ctx.q('pressungen').select('id, datum, weinbezeichnung').gte('datum', `${heute.getFullYear()}-01-01`).limit(500)),
  ])
  if ((offeneVpErr ?? ohneKatErr ?? txJahrErr ?? fuellNegErr ?? chargenNegErr ?? dublettenRawErr ?? tenantErr ?? wartefristenErr ?? pressungenErr)) throw new Error(`Daten konnten nicht geladen werden: ${(offeneVpErr ?? ohneKatErr ?? txJahrErr ?? fuellNegErr ?? chargenNegErr ?? dublettenRawErr ?? tenantErr ?? wartefristenErr ?? pressungenErr).message}`)

  // 1. Fristen: überfällig = hoch, fällig = mittel (UVA, BMD-Übergabe, Erntemeldung, AfA, eigene Fristen)
  for (const f of fristen) {
    if (f.status === 'ueberfaellig') befunde.push({ key: f.key, bereich: 'Fristen', stufe: 'hoch', titel: `Überfällig: ${f.bezeichnung}`, detail: f.statusText, href: f.href ?? '/dashboard/fristen' })
    else if (f.status === 'faellig') befunde.push({ key: f.key, bereich: 'Fristen', stufe: 'mittel', titel: `Fällig: ${f.bezeichnung}`, detail: f.statusText, href: f.href ?? '/dashboard/fristen' })
  }

  // 2. Gärkontrollen
  const faellig = keller.chargen.filter(c => c.messungFaellig)
  if (faellig.length) befunde.push({
    key: 'keller:gaerung', bereich: 'Kellerbuch', stufe: 'mittel',
    titel: `${faellig.length} ${faellig.length === 1 ? 'Charge' : 'Chargen'} in Gärung ohne aktuelle Messung`,
    detail: faellig.slice(0, 4).map(c => `${c.name}${c.tageSeitMessung === null ? ' (noch keine Analyse)' : ` (vor ${c.tageSeitMessung} Tagen)`}`).join(', ') + (faellig.length > 4 ? ` +${faellig.length - 4}` : ''),
    href: '/dashboard/kellerbuch',
  })

  // 3. Rechnungen über Zahlungsziel
  const ueberf = (offeneVp ?? []) as R[]
  if (ueberf.length) befunde.push({
    key: 'verkauf:ueberfaellig', bereich: 'Verkauf', stufe: ueberf.length >= 5 ? 'hoch' : 'mittel',
    titel: `${ueberf.length} ${ueberf.length === 1 ? 'Rechnung' : 'Rechnungen'} über Zahlungsziel (${ZAHLUNGSZIEL_TAGE} Tage)`,
    detail: `${eur(posSum(ueberf))} offen · älteste ${datumDe([...ueberf].sort((a, b) => String(a.datum).localeCompare(String(b.datum)))[0].datum)}`,
    href: '/weinhandel/offene-posten',
  })

  // 4. Belege
  if (einst.modulEa) {
    const n = ((ohneKat ?? []) as R[]).length
    if (n) befunde.push({ key: 'ea:ohne-kategorie', bereich: einst.doppik ? 'Belege & BMD' : 'E&A-Rechnung', stufe: 'info', titel: `${n} ${n === 1 ? 'Buchung' : 'Buchungen'} ohne Kategorie`, detail: 'letzte 90 Tage – Kategorie nachtragen, sonst fehlt das Konto in Auswertung und Übergabe', href: '/buchhaltung' })
    if ((belegeErkannt ?? 0) > 0) befunde.push({ key: 'ea:belege', bereich: einst.doppik ? 'Belege & BMD' : 'E&A-Rechnung', stufe: 'info', titel: `${belegeErkannt} erkannte Belege noch zu buchen`, detail: 'OCR fertig, Buchung fehlt', href: '/buchhaltung/belege' })

    // 5. Ungewöhnlicher Betrag: letzte 7 Tage, > 5× Median der Kategorie (12 Monate), mindestens € 500
    const tx = (txJahr ?? []) as R[]
    const jeKat = new Map<string, number[]>()
    for (const t of tx) { const k = `${t.typ}:${t.kategorie_id ?? '-'}`; jeKat.set(k, [...(jeKat.get(k) ?? []), Number(t.betrag_netto)]) }
    const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
    const auffaellig = tx.filter(t => String(t.datum) >= seit7).filter(t => {
      const werte = jeKat.get(`${t.typ}:${t.kategorie_id ?? '-'}`) ?? []
      if (werte.length < 6) return false
      const m = median(werte)
      return Number(t.betrag_netto) >= 500 && Number(t.betrag_netto) > 5 * m
    })
    if (auffaellig.length) befunde.push({
      key: 'ea:auffaellig', bereich: einst.doppik ? 'Belege & BMD' : 'E&A-Rechnung', stufe: 'mittel',
      titel: `${auffaellig.length} ${auffaellig.length === 1 ? 'Buchung' : 'Buchungen'} mit ungewöhnlichem Betrag`,
      detail: auffaellig.slice(0, 3).map(t => `${datumDe(t.datum)} ${t.beschreibung} ${eur(Number(t.betrag_netto))}`).join(' · ') + ' – mehr als das Fünffache des Üblichen in der Kategorie',
      href: '/buchhaltung',
    })
  }

  // 6. Negative Bestände
  const fn = (fuellNeg ?? []) as R[], cn = (chargenNeg ?? []) as R[]
  if (fn.length) befunde.push({ key: 'lager:negativ', bereich: 'Weinhandel', stufe: 'hoch', titel: `Negativer Flaschenbestand: ${fn.slice(0, 3).map(f => `${f.name} ${f.jahrgang ?? ''}`.trim()).join(', ')}${fn.length > 3 ? ` +${fn.length - 3}` : ''}`, detail: 'Bestand unter null – Abfüllung oder Verkauf prüfen', href: '/weinhandel' })
  if (cn.length) befunde.push({ key: 'keller:negativ', bereich: 'Kellerbuch', stufe: 'hoch', titel: `Negative Menge im Keller: ${cn.slice(0, 3).map(c => c.name).join(', ')}${cn.length > 3 ? ` +${cn.length - 3}` : ''}`, detail: 'Charge mit Menge unter null – Umzüge/Schwund prüfen', href: '/kellerbuch' })

  // 7. Wartefrist-Konflikte: Pressung vor Ablauf einer Wartefrist im selben Jahr
  const wf = (wartefristen ?? []) as R[]
  const pr = (pressungen ?? []) as R[]
  const konflikte = wf.filter(w => pr.some(p => String(p.datum) < String(w.ernte_fruehesteins) && String(p.datum) >= String(w.datum)))
  if (konflikte.length && pr.length) befunde.push({
    key: 'ps:wartefrist', bereich: 'Weingarten', stufe: 'hoch',
    titel: `Wartefrist möglicherweise unterschritten (${konflikte.length})`,
    detail: konflikte.slice(0, 3).map(w => `${riedText(w, { bevorzugt: 'ried', leer: 'Ried' })}: Lese frühestens ${datumDe(w.ernte_fruehesteins)}`).join(' · ') + ' – Pressung vor Ablauf der Wartezeit erfasst, bitte Zuordnung prüfen',
    href: '/behandlungen',
  })

  // 8. Doppelte Kontakte (gleiche E-Mail oder gleicher Name) – Liste und Zusammenführen unter CRM › Dubletten.
  // Migration 214 stuft ein: sicher / pruefen / unwahrscheinlich – gemeldet werden nur sicher + pruefen
  const dubletten = ((dublettenRaw ?? []) as R[]).filter(g => g.stufe !== 'unwahrscheinlich')
  if (dubletten.length) {
    const sicher = dubletten.filter(g => g.stufe === 'sicher').length
    const titelVon = (g: R) => g.art === 'email' ? String(g.schluessel).slice(2) : [g.kontakte?.[0]?.vorname, g.kontakte?.[0]?.nachname].filter(Boolean).join(' ') || String(g.schluessel).slice(2).replace('|', ' ')
    befunde.push({
      key: 'crm:dubletten', bereich: 'CRM', stufe: 'info',
      titel: `${dubletten.length} mögliche ${dubletten.length === 1 ? 'Kontakt-Dublette' : 'Kontakt-Dubletten'}${sicher ? ` (${sicher} sicher)` : ''}`,
      detail: dubletten.slice(0, 3).map(titelVon).join(', ') + (dubletten.length > 3 ? ' …' : '') + ' – unter CRM › Dubletten prüfen und zusammenführen',
      href: '/crm/dubletten',
    })
  }

  // 9. Abo
  const t = (tenant ?? {}) as R
  if (t.stripe_status === 'past_due' || t.stripe_status === 'unpaid') befunde.push({ key: 'abo:zahlung', bereich: 'Abo', stufe: 'hoch', titel: 'Abo: Zahlung offen', detail: 'Die letzte Abbuchung ist fehlgeschlagen – Zahlungsmittel unter Mein Betrieb → Abo & Paket prüfen', href: '/abo' })
  if (t.stripe_trial_ends_at) {
    const tage = Math.round((new Date(t.stripe_trial_ends_at).getTime() - heute.getTime()) / 86400000)
    if (tage >= 0 && tage <= 7 && !t.stripe_plan) befunde.push({ key: 'abo:trial', bereich: 'Abo', stufe: 'mittel', titel: `Testphase endet in ${tage} ${tage === 1 ? 'Tag' : 'Tagen'}`, detail: 'Paket wählen, damit der Zugang bestehen bleibt', href: '/abo' })
  }
  // 9b. Stammdaten: Weinbau-Betriebsnummer ist für Weinproduzenten Pflichtfeld (25.09.2026, KAN-261: nicht für
  //     Weinhändler) – ohne sie fehlen Angaben auf Transportbescheinigung und Prüfnummernantrag, und die BKI-Berichte
  //     haben keinen gültigen Dateinamen
  const { data: stamm, error: stammErr } = await ctx.tf(ctx.q('tenant_einstellungen').select('betrieb_betriebsnummer, betriebsart')).maybeSingle()
  if (stammErr) throw new Error(`Daten konnten nicht geladen werden: ${stammErr.message}`)
  if (weinbauBetriebsnummerFehlt((stamm as R | null)?.betrieb_betriebsnummer, (stamm as R | null)?.betriebsart)) befunde.push({
    key: 'betrieb:betriebsnummer', bereich: 'Betrieb', stufe: 'mittel', titel: 'Weinbau-Betriebsnummer fehlt',
    detail: 'Pflichtfeld unter Mein Betrieb → Betrieb – gebraucht für Transportbescheinigung, Prüfnummernantrag und BKI-Berichte',
    href: '/betrieb/einstellungen',
  })

  // 10. Systembericht (nur Sandbox = Betrieb der Super-Admins): Server-/Browser-Fehler
  //     aller Betriebe der letzten 24 h aus system_ereignisse (Migration 222)
  //     KAN-10 (01.10.2026): Sandbox über die feste ID statt über den Slug
  if (ctx.tenantId === SANDBOX_TENANT_ID) {
    try {
      const ereignisse = (await ereignisseLaden(new Date(heute.getTime() - 86400000))).filter(e => e.art !== 'cron')
      if (ereignisse.length) {
        const quellen = new Map<string, number>()
        for (const e of ereignisse) quellen.set(e.quelle, (quellen.get(e.quelle) ?? 0) + 1)
        const top = [...quellen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q, n]) => `${q} (${n})`).join(', ')
        befunde.push({ key: 'system:fehler', bereich: 'System', stufe: ereignisse.length >= 10 ? 'hoch' : 'mittel', titel: `${ereignisse.length} Fehler in den letzten 24 Stunden (alle Betriebe)`, detail: top, href: '/admin/system' })
      }
    } catch { /* Systembericht ist Zusatznutzen */ }
    // 10b. KAN-123: Betriebe ohne Morgenbericht am Vortag (Cron ausgelassen oder abgebrochen) –
    //      ausgenommen Demo-Betrieb, inaktive, deaktivierte, gesperrte und neu angelegte Betriebe
    try {
      const ohne = await betriebeOhneMorgenberichtAmVortag(heute)
      if (ohne.length) befunde.push({
        key: 'system:morgenbericht-vortag', bereich: 'System', stufe: 'mittel',
        titel: `${ohne.length} ${ohne.length === 1 ? 'Betrieb' : 'Betriebe'} ohne Morgenbericht am Vortag`,
        detail: ohne.slice(0, 4).map(b => b.name).join(', ') + (ohne.length > 4 ? ` +${ohne.length - 4}` : '') + ' – Cron-Lauf unter Administration → Systembericht prüfen',
        href: '/admin/system',
      })
    } catch { /* Systembericht ist Zusatznutzen */ }
  }
  void paket
  return befunde
}

export function zaehle(befunde: Befund[]) {
  return {
    hoch: befunde.filter(b => b.stufe === 'hoch').length,
    mittel: befunde.filter(b => b.stufe === 'mittel').length,
    info: befunde.filter(b => b.stufe === 'info').length,
  }
}

const RANG: Record<Befund['stufe'], number> = { hoch: 0, mittel: 1, info: 2 }
export function sortiere(befunde: Befund[]) {
  return [...befunde].sort((a, b) => RANG[a.stufe] - RANG[b.stufe])
}
