// ── Paketmodell von software:112 ─────────────────────────────────────────────
//
// Rückmeldung 2.9.2026: die drei Pakete Basis / Standard / Premium sind gesetzt.
// Diese Datei ist die EINZIGE Quelle dafür, was ein Paket enthält - Signup,
// /abo (Selbstservice-Wechsel), Stripe-Webhook (schaltet Module hart auf das
// gebuchte Paket), Benutzerlimit und Mandanten-Verwaltung lesen alle von hier.
//
//   Basis    199 €  Weingarten, Kellerbuch, CRM · 1 Benutzer · KI 50/Monat
//   Standard 299 €  + Newsletter, E&A, Controlling · 5 Benutzer · KI 100/Monat
//   Premium  399 €  + bot:112 mit Sprachsteuerung, Export · unbegrenzt · KI unbegrenzt
//
// Weingarten/Kellerbuch/CRM sind in jedem Paket enthalten und werden nicht
// über das Paket gesteuert (modul_weingarten/-kellerbuch/-crm bleiben wie sie
// sind). Downgrade schaltet hart ab (Entscheidung 2.9.2026): der Webhook setzt
// die Flags exakt auf das neue Paket; Daten bleiben erhalten, nur die Menü-
// punkte verschwinden. Manuelle Toggles in Administration → Mandanten wirken
// als Override bis zum nächsten Paketwechsel (Subscription-Event).
//
// Bewusst frei von Server-Imports (wird auch in Client-Komponenten verwendet).
// Die Stripe-Preis-IDs kommen aus NEXT_PUBLIC_STRIPE_PRICE_{BASIS,STANDARD,PREMIUM}.

export type PaketKey = 'basis' | 'standard' | 'premium'

export type KiPaket = 'basic' | 'standard' | 'unlimited'

/** Die vom Paket gesteuerten Flags in tenant_einstellungen. */
export type PaketModule = {
  modul_newsletter:   boolean
  modul_ea:           boolean
  modul_controlling:  boolean
  modul_export:       boolean
  /** bot:112 (Prozess-Assistent inkl. Sprachsteuerung) */
  assistent_aktiv:    boolean
  ki_abfragen_aktiv:  boolean
  ki_abfragen_paket:  KiPaket
}

export type Paket = {
  key: PaketKey
  label: string
  preisMonat: number
  /** null = unbegrenzt */
  maxBenutzer: number | null
  /** Abfragen "Frag dein Weingut" pro Monat; null = unbegrenzt.
   *  Muss mit limit_map in check_und_increment_ki_abfrage (Migration 194) übereinstimmen. */
  kiLimit: number | null
  module: PaketModule
  /** Kurzbeschreibung für Paketkarten (Signup, /abo) */
  leistungen: string[]
}

export const PAKET_REIHENFOLGE: PaketKey[] = ['basis', 'standard', 'premium']

export const PAKETE: Record<PaketKey, Paket> = {
  basis: {
    key: 'basis', label: 'Basis', preisMonat: 199, maxBenutzer: 1, kiLimit: 50,
    module: {
      modul_newsletter: false, modul_ea: false, modul_controlling: false, modul_export: false,
      assistent_aktiv: false, ki_abfragen_aktiv: true, ki_abfragen_paket: 'basic',
    },
    leistungen: ['Weingarten & Rieden', 'Kellerbuch', 'CRM', '1 Benutzer', 'Frag dein Weingut: 50 Abfragen/Monat'],
  },
  standard: {
    key: 'standard', label: 'Standard', preisMonat: 299, maxBenutzer: 5, kiLimit: 100,
    module: {
      modul_newsletter: true, modul_ea: true, modul_controlling: true, modul_export: false,
      assistent_aktiv: false, ki_abfragen_aktiv: true, ki_abfragen_paket: 'standard',
    },
    leistungen: ['Alles aus Basis', 'Newsletter', 'E&A-Rechnung', 'Controlling', '5 Benutzer', 'Frag dein Weingut: 100 Abfragen/Monat'],
  },
  premium: {
    key: 'premium', label: 'Premium', preisMonat: 399, maxBenutzer: null, kiLimit: null,
    module: {
      modul_newsletter: true, modul_ea: true, modul_controlling: true, modul_export: true,
      assistent_aktiv: true, ki_abfragen_aktiv: true, ki_abfragen_paket: 'unlimited',
    },
    leistungen: ['Alles aus Standard', 'bot:112 mit Sprachsteuerung', 'Exportaufträge', 'Unbegrenzt Benutzer', 'Frag dein Weingut: unbegrenzt'],
  },
}

/** Modul-Flags ohne Paket (kein Abo / gekündigt): alles Paketgesteuerte aus. */
export const MODULE_OHNE_PAKET: PaketModule = {
  modul_newsletter: false, modul_ea: false, modul_controlling: false, modul_export: false,
  assistent_aktiv: false, ki_abfragen_aktiv: false, ki_abfragen_paket: 'basic',
}

export function istPaketKey(v: unknown): v is PaketKey {
  return v === 'basis' || v === 'standard' || v === 'premium'
}

// ── Stripe-Preis-IDs ─────────────────────────────────────────────────────────

export function paketPriceId(paket: PaketKey): string {
  switch (paket) {
    case 'basis':    return process.env.NEXT_PUBLIC_STRIPE_PRICE_BASIS    ?? ''
    case 'standard': return process.env.NEXT_PUBLIC_STRIPE_PRICE_STANDARD ?? ''
    case 'premium':  return process.env.NEXT_PUBLIC_STRIPE_PRICE_PREMIUM  ?? ''
  }
}

/** Alt-Preise (Professional 299 / Professional+ 349 / Enterprise 399, vor
 *  2.9.2026) auf das nächstliegende neue Paket abbilden, damit bestehende
 *  Stripe-Abos beim nächsten Subscription-Event sauber landen. */
function legacyPaket(priceId: string): PaketKey | null {
  if (priceId && priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_PROFESSIONAL)      return 'standard'
  if (priceId && priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_PROFESSIONAL_PLUS) return 'premium'
  if (priceId && priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE)        return 'premium'
  return null
}

export function paketFromPriceId(priceId: string | null | undefined): PaketKey | null {
  if (!priceId) return null
  for (const k of PAKET_REIHENFOLGE) {
    const id = paketPriceId(k)
    if (id && id === priceId) return k
  }
  return legacyPaket(priceId)
}

/** tenants.stripe_plan → Paket. Versteht auch die alten Slugs (ki_basic usw.),
 *  die bis zum nächsten Webhook-Event noch in der DB stehen können. */
export function paketAusPlan(stripePlan: string | null | undefined): PaketKey | null {
  if (!stripePlan) return null
  if (istPaketKey(stripePlan)) return stripePlan
  switch (stripePlan) {
    case 'ki_basic':     return 'standard'   // Professional (299)
    case 'ki_standard':  return 'premium'    // Professional+ (349)
    case 'ki_unlimited': return 'premium'    // Enterprise (399)
    default:             return null         // 'base' / unbekannt
  }
}

export function paketLabel(stripePlan: string | null | undefined): string {
  const p = paketAusPlan(stripePlan)
  return p ? `software:112 ${PAKETE[p].label}` : 'Kein Paket'
}

export function preisText(paket: Paket): string {
  return `${paket.preisMonat} € / Monat`
}
