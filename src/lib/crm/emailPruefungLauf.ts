import 'server-only'

// ── Nächtlicher Lauf der E-Mail-Prüfung (KAN-424, 12.11.2026) ────────────────────────────────────────────────────────
// Teil des täglichen Laufs (/api/cron/taeglich, kein eigener Zeitplan). Je aktivem Betrieb höchstens EMAIL_LAUF_MENGE
// Kontakte: die am längsten nicht geprüften zuerst, jede Adresse frühestens nach EMAIL_WIEDER_TAGE wieder. Vom Betrieb
// bestätigte Adressen und anonymisierte Kontakte bleiben außen vor. Schreibt nur die drei Prüf-Spalten (Service-Role);
// die Adresse selbst wird nie geändert. Ein Netzfehler bei der Domain-Prüfung lässt den Kontakt ungeprüft (nächste Nacht).

import { resolve4, resolveMx } from 'node:dns/promises'
import { alle, bloecke } from '@/lib/supabase/alle'
import { ladeNewsletterBetriebNachId } from '@/lib/newsletter/betrieb'
import { blockedContacts } from '@/lib/brevo/api'
import {
  DOMAIN_HINWEIS, EMAIL_LAUF_MENGE, RUECKLAEUFER_HINWEIS, domainVon, pruefeDomain, pruefeSchreibweise, ruecklaeuferAus,
  wiederZuPruefenVor, type DnsAbfrage, type DomainUrteil,
} from './emailPruefung'

type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export type EmailPruefungErgebnis = {
  betriebe: number; geprueft: number; schreibweise: number; domain: number; ruecklaeufer: number; ungeklaert: number
  fehler: string[]; abgebrochen: boolean; dauerMs: number
}

const DNS: DnsAbfrage = {
  mx: async d => (await resolveMx(d)).length,
  a: async d => (await resolve4(d)).length,
}
/** höchstens so viele Seiten der Brevo-Sperrliste je Betrieb (100 Einträge je Seite) */
const BREVO_SEITEN_MAX = 20

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function schreibe(admin: any, tenantId: string, ids: string[], werte: R): Promise<string | null> {
  for (const block of bloecke(ids)) {
    const { error } = await (admin.from('kontakte') as R).update(werte).eq('tenant_id', tenantId).in('id', block)
    if (error) return error.message
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function laufEmailPruefung(admin: any, zeitbudgetMs = 60000, dns: DnsAbfrage = DNS): Promise<EmailPruefungErgebnis> {
  const start = Date.now()
  const erg: EmailPruefungErgebnis = { betriebe: 0, geprueft: 0, schreibweise: 0, domain: 0, ruecklaeufer: 0, ungeklaert: 0, fehler: [], abgebrochen: false, dauerMs: 0 }
  const zeitUm = () => Date.now() - start > zeitbudgetMs
  const domains = new Map<string, DomainUrteil>()   // je Lauf jede Domain nur einmal fragen

  // tenant-isolation-ignore: Cron über alle aktiven Betriebe – jede Abfrage darunter filtert auf den Betrieb
  const { data: betriebe, error: bErr } = await alle<R>((admin.from('tenants') as R).select('id').eq('active', true).order('id'))
  if (bErr) { erg.fehler.push(`Betriebe: ${bErr.message}`); erg.dauerMs = Date.now() - start; return erg }

  for (const b of betriebe ?? []) {
    if (zeitUm()) { erg.abgebrochen = true; break }
    const tenantId = b.id as string
    const jetzt = new Date()
    // alle-ausnahme: bewusst je Lauf nur die am längsten nicht geprüften Adressen (aufsteigend, begrenzt) – der Rest folgt in den nächsten Nächten
    const { data: kontakte, error: kErr } = await (admin.from('kontakte') as R)
      .select('id, email, email_pruefung')
      .eq('tenant_id', tenantId).eq('aktiv', true).not('email', 'is', null).is('anonymisiert_am', null)
      .or('email_pruefung.is.null,email_pruefung.in.(schreibweise,domain)')
      .or(`email_geprueft_am.is.null,email_geprueft_am.lt.${wiederZuPruefenVor(jetzt)}`)
      .order('email_geprueft_am', { nullsFirst: true }).order('id').limit(EMAIL_LAUF_MENGE)
    if (kErr) { erg.fehler.push(`Kontakte ${tenantId}: ${kErr.message}`); continue }
    erg.betriebe++

    const ok: string[] = [], schreibweise = new Map<string, string[]>(), domainFalsch: string[] = []
    for (const k of (kontakte ?? []) as R[]) {
      if (zeitUm()) { erg.abgebrochen = true; break }
      const s = pruefeSchreibweise(k.email)
      if (s) { schreibweise.set(s.hinweis, [...(schreibweise.get(s.hinweis) ?? []), k.id]); continue }
      const d = domainVon(k.email)
      if (!d) continue
      let urteil = domains.get(d)
      if (!urteil) { urteil = await pruefeDomain(d, dns); domains.set(d, urteil) }
      if (urteil === 'ok') ok.push(k.id)
      else if (urteil === 'ungueltig') domainFalsch.push(k.id)
      else erg.ungeklaert++   // Netzfehler: nicht geprüft, nächste Nacht wieder
    }

    const geprueftAm = jetzt.toISOString()
    const schreibFehler = [
      await schreibe(admin, tenantId, ok, { email_pruefung: null, email_pruef_hinweis: null, email_geprueft_am: geprueftAm }),
      await schreibe(admin, tenantId, domainFalsch, { email_pruefung: 'domain', email_pruef_hinweis: DOMAIN_HINWEIS, email_geprueft_am: geprueftAm }),
      ...(await Promise.all([...schreibweise.entries()].map(([hinweis, ids]) =>
        schreibe(admin, tenantId, ids, { email_pruefung: 'schreibweise', email_pruef_hinweis: hinweis, email_geprueft_am: geprueftAm })))),
    ].filter((f): f is string => !!f)
    if (schreibFehler.length > 0) { erg.fehler.push(`Schreiben ${tenantId}: ${schreibFehler[0]}`); continue }
    const nSchreibweise = [...schreibweise.values()].reduce((n, ids) => n + ids.length, 0)
    erg.geprueft += ok.length + domainFalsch.length + nSchreibweise
    erg.schreibweise += nSchreibweise
    erg.domain += domainFalsch.length

    // Rückläufer aus dem Brevo-Konto des Betriebs (nur mit eigenem Schlüssel)
    if (zeitUm()) { erg.abgebrochen = true; break }
    try {
      const betrieb = await ladeNewsletterBetriebNachId(tenantId)
      if (betrieb?.zugang) {
        const adressen = new Set<string>()
        for (let seite = 0; seite < BREVO_SEITEN_MAX && !zeitUm(); seite++) {
          const antwort = await blockedContacts(betrieb.zugang, seite * 100)
          for (const a of ruecklaeuferAus(antwort.contacts)) adressen.add(a)
          if (antwort.contacts.length < 100) break
        }
        for (const block of bloecke([...adressen])) {
          const { data: treffer, error: tErr } = await (admin.from('kontakte') as R)
            .update({ email_pruefung: 'ruecklaeufer', email_pruef_hinweis: RUECKLAEUFER_HINWEIS, email_geprueft_am: geprueftAm })
            .eq('tenant_id', tenantId).in('email', block).is('anonymisiert_am', null)
            .or('email_pruefung.is.null,email_pruefung.neq.ruecklaeufer')
            .select('id')
          if (tErr) { erg.fehler.push(`Rückläufer ${tenantId}: ${tErr.message}`); break }
          erg.ruecklaeufer += ((treffer ?? []) as unknown[]).length
        }
      }
    } catch (e) {
      erg.fehler.push(`Brevo ${tenantId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  erg.dauerMs = Date.now() - start
  return erg
}
