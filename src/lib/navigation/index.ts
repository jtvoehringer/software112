// ── Navigationsstruktur von software:112 ─────────────────────────────────────
//
// Dashboard-Relaunch (27.8.2026, Mgmt-Entscheidung): die linke Sidebar ist durch
// eine horizontale Tab-Navigation unter der Navy-Kopfleiste ersetzt (Vorbild:
// ICP-HR-Suite-PoC bzw. E&A Suite / kps-smart-buchhaltung). Zeile 1 zeigt die
// Bereiche, Zeile 2 die Seiten des aktiven Bereichs. Die Struktur hier ist die
// EINZIGE Quelle für TabNav (Zeile 1 + 2) und die Befehlspalette (Strg K) –
// die Sichtbarkeitsregeln (Rolle, Modul-Toggles, Sandbox, Sandbox-Sonder-
// freigabe) sind 1:1 aus der früheren Sidebar.tsx übernommen.
//
// Diese Datei ist bewusst frei von Server-Imports (wird in Client-Komponenten
// verwendet).

import {
  LayoutDashboard, Grape, BookOpen, Warehouse, Calculator, ReceiptText,
  Users, Sparkles, Settings,
  type LucideIcon,
} from 'lucide-react'
import type { UserRole } from '@/lib/auth/roles'

export type ModulKey = 'modul_ea' | 'modul_sumup' | 'modul_export' | 'modul_controlling'

/** Teilmenge des Tenant-Brandings, die die Navigation braucht (Modul-Toggles). */
export type NavBranding = Record<ModulKey, boolean>

export type NavItem = {
  href: string
  label: string
  /** phase 2 = noch nicht verfügbar (ausgegraut) */
  phase?: number
  adminOnly?: boolean
  /** Eingerückter Unterpunkt (z.B. "Visitenkarte scannen" unter Kontakte) */
  child?: boolean
  hideIfModul?: Array<ModulKey>
  /** Item nur zeigen, wenn dieses Modul aktiv ist */
  requireModul?: ModulKey
  /** Nur im Mandanten "Sandbox" sichtbar (unabhängig von der Rolle) */
  sandboxOnly?: boolean
  /** Synonyme für die Befehlspalette */
  keywords?: string
}

export type NavGroup = {
  key: string
  label: string
  icon: LucideIcon
  items: NavItem[]
  adminOnly?: boolean
  modulKey?: ModulKey
  /** Strenger als adminOnly: nur system_admin (bzw. Sandbox-Sonderfreigabe) */
  systemAdminOnly?: boolean
  /** Controlling / Frag dein Weingut: Mitarbeiter nur mit Modul „auswertungen“ (Migration 218) */
  auswertungen?: boolean
}

// Bereiche (Zeile 1) mit ihren Seiten (Zeile 2). Der Bereich "Übersicht" trägt
// die fünf Sichten des neuen Dashboards (Übersicht · Kellerbuch · Verkauf & CRM ·
// Weingarten & Ernte · Meldungen & Fristen) – die Tab-Leiste des Dashboard-PoC
// ist damit Zeile 2 der Hauptnavigation.
const NAV: NavGroup[] = [
  {
    key: 'uebersicht', label: 'Übersicht', icon: LayoutDashboard,
    items: [
      { href: '/dashboard',            label: 'Übersicht',           keywords: 'dashboard start heute cockpit' },
      { href: '/dashboard/kellerbuch', label: 'Kellerbuch',          keywords: 'chargen pipeline gärung kanban' },
      { href: '/dashboard/verkauf',    label: 'Verkauf & CRM',       keywords: 'umsatz aufträge leads offene posten' },
      { href: '/dashboard/weingarten', label: 'Weingarten & Ernte',  keywords: 'rieden lese checkliste wartefristen' },
      { href: '/dashboard/fristen',    label: 'Meldungen & Fristen', keywords: 'termine meldung uva erntemeldung ampel' },
      { href: '/dashboard/morgenbericht', label: 'Morgenbericht',    keywords: 'wetter regen prognose spritzfenster scan befunde empfehlungen rieden' },
    ],
  },
  {
    key: 'rieden', label: 'Rieden', icon: Grape,
    items: [
      { href: '/weingarten',         label: 'Rieden',         phase: 1, keywords: 'weingarten grundstücke flächen' },
      { href: '/behandlungen',       label: 'Maßnahmen',      phase: 1, keywords: 'pflanzenschutz spritzung behandlung' },
      { href: '/behandlungen/lager', label: 'Betriebsmittel', phase: 1, keywords: 'psm lager dünger' },
      { href: '/erntemeldung',       label: 'Lese',           phase: 1, keywords: 'ernte jahrgang pressung erntemeldung' },
    ],
  },
  {
    key: 'kellerbuch', label: 'Kellerbuch', icon: BookOpen,
    items: [
      { href: '/kellerbuch',                 label: 'Übersicht',      phase: 1, keywords: 'behälter tank fass chargen' },
      { href: '/kellerbuch/kellerplan',      label: 'Kellerplan',     phase: 1, keywords: 'grundriss' },
      { href: '/dac',                        label: 'Prüfnummer',     phase: 1, keywords: 'dac antrag staatliche prüfnummer' },
      { href: '/kellerbuch/rueckverfolgung', label: 'Rückverfolgung', phase: 1, keywords: 'herkunft charge grundstück' },
    ],
  },
  {
    key: 'warenwirtschaft', label: 'Warenwirtschaft', icon: Warehouse,
    items: [
      { href: '/weinhandel',                  label: 'Warenlager',         phase: 1, keywords: 'flaschen füllungen bestand' },
      { href: '/weinhandel/verkauf',          label: 'Verkauf',            phase: 1, keywords: 'rechnung auftrag lieferschein' },
      { href: '/weinhandel/offene-posten',    label: 'Offene Posten',      phase: 1, keywords: 'überfällig zahlung mahnung' },
      { href: '/weinhandel/zukauf',           label: 'Zukauf',             phase: 1, keywords: 'trauben most wein einkauf' },
      { href: '/weinhandel/sonstige-artikel', label: 'Sonstiges-Produkte', phase: 1, keywords: 'artikel' },
      { href: '/weinhandel/rabattgruppen',    label: 'Rabattgruppen',      phase: 1 },
      { href: '/weinexport',                  label: 'Exportaufträge',     requireModul: 'modul_export', keywords: 'eur.1 cmr export' },
    ],
  },
  {
    key: 'crm', label: 'CRM', icon: Users,
    items: [
      { href: '/nachrichten',             label: 'E-Mail',   keywords: 'mail posteingang nachrichten' },
      { href: '/crm',                     label: 'Kalender', keywords: 'termine aktivitäten' },
      { href: '/crm/kontakte',            label: 'Kontakte', keywords: 'kunden personen' },
      { href: '/crm/kontakte/visitkarte', label: 'Visitenkarte scannen', child: true, keywords: 'ocr' },
      { href: '/crm/dubletten',           label: 'Dubletten', child: true, keywords: 'doppelte kontakte zusammenführen' },
      { href: '/crm/firmen',              label: 'Firmen',   keywords: 'kunden unternehmen' },
      { href: '/crm/pipeline',            label: 'Pipeline', keywords: 'leads chancen' },
    ],
  },
  {
    key: 'ea', label: 'E&A-Rechnung', icon: ReceiptText, modulKey: 'modul_ea',
    items: [
      { href: '/buchhaltung/uebersicht',      label: 'Finanzübersicht', keywords: 'wo stehe ich ergebnis liquidität vorjahr kennzahlen' },
      { href: '/buchhaltung',                 label: 'Buchungen',       keywords: 'einnahmen ausgaben' },
      { href: '/buchhaltung/belege',          label: 'Belege (OCR)',    child: true, keywords: 'scan foto upload' },
      { href: '/buchhaltung/kategorien',      label: 'Kategorien',      child: true },
      { href: '/buchhaltung/dauerauftraege',  label: 'Daueraufträge',   child: true, keywords: 'wiederkehrend' },
      { href: '/buchhaltung/monatsabschluss', label: 'Monatsabschluss', child: true },
      { href: '/buchhaltung/anlagen',         label: 'Anlagen & AfA',   child: true, keywords: 'anlagenverzeichnis abschreibung afa anlagenspiegel gwg nutzungsdauer buchwert' },
      { href: '/buchhaltung/uva',             label: 'UVA-Meldung',     keywords: 'umsatzsteuer finanzonline' },
      { href: '/weinhandel/offene-posten',    label: 'Offene Posten' },
      { href: '/konten',                      label: 'Konten',          keywords: 'bank kassa' },
      { href: '/buchhaltung/svs',             label: 'SV-Beiträge (SVS)', keywords: 'sozialversicherung einheitswert bauern beitragsgrundlage option' },
      { href: '/controlling/bmd',             label: 'BMD-Übergabe',    keywords: 'steuerberater export ntcs buchungsstapel kontenmapping' },
    ],
  },
  // Controlling ist seit Migration 193 ein zuschaltbares Modul (Rückmeldung
  // 2.9.2026, Paket "Standard"), analog zu E&A-Rechnung: Bereich nur sichtbar,
  // wenn tenant_einstellungen.modul_controlling gesetzt ist (Toggle in
  // Administration → Mandanten). "Auswertungen" (vorher eigener Bereich) und
  // die Kosten-Auswertung (vorher nur aus /reports verlinkt) sind hier
  // eingehängt. Die Routen selbst sichern Layout-Guards ab (lib/auth/modul.ts).
  {
    key: 'controlling', label: 'Controlling', icon: Calculator, modulKey: 'modul_controlling', auswertungen: true,
    items: [
      { href: '/reports',                     label: 'Auswertungen',      keywords: 'reports berichte weinbuch protokoll umsatz lager' },
      { href: '/controlling/kostenrechnung',  label: 'Kostenrechnung',    keywords: 'kostenstellen kostenarten' },
      { href: '/auswertungen/kostenrechnung', label: 'Kosten-Auswertung', child: true, keywords: 'kosten je ried behälter periode' },
      { href: '/controlling/export',          label: 'Datenexport',       keywords: 'csv' },
    ],
  },
  {
    key: 'ki', label: 'Frag dein Weingut', icon: Sparkles, auswertungen: true,
    items: [
      { href: '/ki', label: 'Frag dein Weingut', keywords: 'ki abfrage smart query' },
    ],
  },
  // "System" fasst die Punkte der früheren Sidebar-Überschrift "System"
  // zusammen (Hilfe, Mein Betrieb, Administration) – als ein Bereich statt
  // drei, damit Zeile 1 nicht überläuft.
  {
    key: 'system', label: 'System', icon: Settings,
    items: [
      { href: '/hilfe/handbuch',       label: 'Handbuch',          keywords: 'hilfe anleitung' },
      { href: '/hilfe/faq',            label: 'FAQ',               keywords: 'hilfe fragen' },
      { href: '/profil',               label: 'Profil',            keywords: 'passwort name' },
      { href: '/betrieb/einstellungen', label: 'Mein Betrieb',     adminOnly: true, keywords: 'einstellungen branding benutzer bawb' },
      // Administration: nur system_admin bzw. Sandbox-Sonderfreigabe (s.u.)
      { href: '/admin/mandanten',      label: 'Mandanten',         adminOnly: true, keywords: 'administration tenants' },
      { href: '/admin/kellergemeinschaft', label: 'Kellergemeinschaft', adminOnly: true, keywords: 'administration gebinde freigabe partner keller' },
      { href: '/admin/release-notes',  label: 'Release Notes',     adminOnly: true, keywords: 'administration' },
      { href: '/admin/import',         label: 'Datenimport',       adminOnly: true, keywords: 'administration csv' },
      { href: '/admin/benutzer',       label: 'Super-Admin',      adminOnly: true, keywords: 'administration benutzer' },
      { href: '/admin/onboarding',     label: 'Onboarding Guide',  adminOnly: true, keywords: 'administration' },
      { href: '/admin/zeiterfassung',  label: 'Zeiterfassung',     adminOnly: true, sandboxOnly: true },
    ],
  },
]

/** Pfade, die nur exakt matchen (kein Präfix-Match für Unterrouten) */
const EXACT_PATHS = new Set(['/dashboard', '/crm', '/weinhandel', '/auswertungen', '/kellerbuch', '/behandlungen', '/buchhaltung'])

export function isActivePath(href: string, pathname: string): boolean {
  return pathname === href || (!EXACT_PATHS.has(href) && pathname.startsWith(href))
}

export type NavContext = {
  role: UserRole
  branding: NavBranding
  /** true, wenn der aktive Betrieb der Mandant "Sandbox" ist */
  isSandbox: boolean
  /** Sandbox-Sonderfreigabe (lib/auth/roles.ts isSandboxAdminUnlock) */
  sandboxAdminUnlock: boolean
  /** Migration 197: doppelte Buchhaltung beim Steuerberater (BMD) statt E&A in software:112 */
  doppik?: boolean
  /** canSeeAuswertungen(role) – serverseitig ermittelt; false blendet Controlling + Frag dein Weingut aus */
  auswertungenSichtbar?: boolean
}

const ADMIN_PREFIX = '/admin/'

/**
 * Liefert die für den Nutzer sichtbaren Bereiche inkl. gefilterter Seiten.
 * Regeln (unverändert aus Sidebar.tsx übernommen):
 *  - adminOnly-Items: system_admin ODER tenant_admin
 *  - /admin/*-Items (frühere Gruppe "Administration", systemAdminOnly):
 *    nur system_admin ODER Sandbox-Sonderfreigabe – Betriebsleiter sehen sie nicht
 *  - modulKey/requireModul/hideIfModul gegen die Tenant-Modul-Toggles
 *  - sandboxOnly nur im Sandbox-Mandanten
 *  - Bereiche ohne sichtbare Seiten entfallen
 */
export function buildNav(ctx: NavContext): NavGroup[] {
  const isAdmin    = ctx.role === 'system_admin' || ctx.role === 'tenant_admin'
  const isSysAdmin = ctx.role === 'system_admin'

  const result: NavGroup[] = []
  for (const g of NAV) {
    if (g.systemAdminOnly && !isSysAdmin && !ctx.sandboxAdminUnlock) continue
    if (g.adminOnly && !isAdmin) continue
    if (g.modulKey && !ctx.branding[g.modulKey]) continue
    if (g.auswertungen && ctx.auswertungenSichtbar === false) continue

    const items = g.items.filter(it => {
      if (it.href.startsWith(ADMIN_PREFIX)) {
        if (!isSysAdmin && !ctx.sandboxAdminUnlock) return false
      } else if (it.adminOnly && !isAdmin) {
        // z.B. "Mein Betrieb": Betriebsleiter + System-Admin, KEINE Sonderfreigabe
        return false
      }
      if (it.sandboxOnly && !ctx.isSandbox) return false
      if (it.requireModul && !ctx.branding[it.requireModul]) return false
      if (it.hideIfModul?.some(m => ctx.branding[m])) return false
      return true
    })
    if (items.length === 0) continue
    result.push(g.key === 'ea' && ctx.doppik ? fuerDoppik({ ...g, items }) : { ...g, items })
  }
  return result
}

// Doppik-Mandant (Migration 197): software:112 ist nur Vorsystem, die
// Buchhaltung führt die Kanzlei in BMD. Der Bereich heißt dann "Belege & BMD",
// die BMD-Übergabe rückt direkt hinter die Buchungen, die UVA ist nur noch eine
// Vorschau (Meldung macht die Kanzlei aus BMD).
function fuerDoppik(g: NavGroup): NavGroup {
  const bmd = g.items.find(it => it.href === '/controlling/bmd')
  const rest = g.items.filter(it => it !== bmd).map(it =>
    it.href === '/buchhaltung/uva' ? { ...it, label: 'UVA (Vorschau)' } : it)
  // BMD-Übergabe direkt hinter "Buchungen" (Finanzübersicht bleibt erster Punkt)
  const pos = Math.max(0, rest.findIndex(it => it.href === '/buchhaltung')) + 1
  const items = bmd ? [...rest.slice(0, pos), { ...bmd, child: false }, ...rest.slice(pos)] as NavItem[] : rest
  return { ...g, label: 'Belege & BMD', items }
}

/** Bereich, zu dem der aktuelle Pfad gehört (Fallback: erster Bereich) */
export function activeGroup(groups: NavGroup[], pathname: string): NavGroup | undefined {
  // Längster passender href gewinnt (z.B. /weinhandel/offene-posten kommt in
  // Warenwirtschaft UND E&A vor – dann zählt der Bereich, in dem der Nutzer
  // gerade ist: erster Treffer in NAV-Reihenfolge).
  let best: { g: NavGroup; len: number } | null = null
  for (const g of groups) {
    for (const it of g.items) {
      if (isActivePath(it.href, pathname) && (!best || it.href.length > best.len)) best = { g, len: it.href.length }
    }
  }
  return best?.g ?? groups[0]
}
