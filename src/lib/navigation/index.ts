// ── Navigationsstruktur von software:112 ─────────────────────────────────────
//
// Dashboard-Relaunch (27.8.2026, Mgmt-Entscheidung): die linke Sidebar ist durch
// eine horizontale Tab-Navigation unter der Kopfleiste ersetzt (Vorbild:
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
import { istPflichtmeldungsRolle } from '@/lib/auth/pflichtmeldung'
import { isActivePath, aktiverBereichIndex } from './aktiv'

export { isActivePath }

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
  /** Pflichtmeldung unter /reports (Entscheidung 24.9.2026): Betriebsleiter immer,
   *  sonst nur mit Modul Controlling + Auswertungsrecht (siehe pflichtmeldungenSichtbar) */
  pflichtmeldung?: boolean
  /** Synonyme für die Befehlspalette */
  keywords?: string
  /** /admin/*-Seite, die zusätzlich Betriebs-Manager (tenant_admin) sehen – Hotfix 02.10.2026: Datenimport */
  betriebsleiter?: boolean
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

/** Stichwörter der Rückverfolgung in allen Modulen (KAN-360, Befehlspalette Strg K) */
export const RV_STICHWORTE = 'rückverfolgung rückruf rückruf-liste rückrufliste rv lieferkette'

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
      { href: '/dashboard/journal',    label: 'Journal',             keywords: 'protokoll verlauf meine buchungen transaktionen vorgänge wer hat was geändert angelegt storniert gelöscht' },   // KAN-332
    ],
  },
  {
    key: 'rieden', label: 'Rieden', icon: Grape,
    items: [
      // KAN-427: Einstieg in den Bereich = die Sicht „Weingarten & Ernte“ (derselbe Inhalt wie /dashboard/weingarten)
      { href: '/weingarten/uebersicht', label: 'Weingarten & Ernte', keywords: 'übersicht lese checkliste wartefristen karte' },
      { href: '/weingarten',         label: 'Rieden',         phase: 1, keywords: 'weingarten grundstücke flächen' },
      // KAN-89: Rebsorten ohne amtliches BKI-Kürzel prüfen und gesammelt korrigieren
      { href: '/weingarten/rebsorten', label: 'Rebsorten prüfen', child: true, keywords: 'rebsorte kürzel bki kürzelliste korrektur sortenverschnitt prüfen' },
      { href: '/behandlungen',       label: 'Maßnahmen',      phase: 1, keywords: 'pflanzenschutz spritzung behandlung' },
      // Pflichtmeldungen (Druck + CSV) – auch ohne Modul Controlling, siehe pflichtmeldungenSichtbar
      { href: '/reports/behandlungsprotokoll', label: 'Behandlungsprotokoll', child: true, pflichtmeldung: true, keywords: 'pflanzenschutz psm aufzeichnungen spritzprotokoll bio kontrolle behörde meldung druck csv' },
      { href: '/reports/cu-bilanz',            label: 'Cu-Bilanz',            child: true, pflichtmeldung: true, keywords: 'kupfer bio jahresbericht kg ha behörde meldung druck csv' },
      { href: '/reports/naehrstoffbilanz',     label: 'Nährstoffbilanz',      child: true, pflichtmeldung: true, keywords: 'düngung düngeaufzeichnungen stickstoff phosphor napv behörde meldung druck csv' },
      // KAN-142 (26.09.2026): „Lese“ samt AMA-Erntemeldung direkt hinter die Pflichtmeldungen von
      // „Maßnahmen“, „Betriebsmittel“ ans Ende – Reihenfolge Rieden · Maßnahmen · • Behandlungsprotokoll
      // · • Cu-Bilanz · • Nährstoffbilanz · Lese · • AMA-Erntemeldung · Betriebsmittel. Jeder
      // Unterpunkt bleibt bei seinem Hauptpunkt (Variante von Jörgen gewählt).
      { href: '/erntemeldung',       label: 'Lese',           phase: 1, keywords: 'ernte jahrgang lesedaten erntemeldung neue lese eiswein hauptlese' },
      { href: '/reports/ama',        label: 'AMA-Erntemeldung', child: true, pflichtmeldung: true, keywords: 'weinerntemeldung lesedaten weinbestandsmeldung bestandsmeldung stichtag weindatenbank behörde meldung druck csv' },
      { href: '/behandlungen/lager', label: 'Betriebsmittel', phase: 1, keywords: 'psm lager dünger weinbehandlungsmittel produktionsmittel korken flaschen bindedraht einkauf' },
      // KAN-108: Rückverfolgung Weingarten (Maßnahmen je Lese-Grundstück, Wartezeiten). KAN-360 (22.10.2026): in jedem
      // Modul an derselben Stelle – Hauptpunkt, letzter Punkt vor den Behördenmeldungen (Rieden: ans Ende; die
      // Pflichtmeldungen bleiben als Unterpunkte bei Maßnahmen bzw. Lese), gleiche Bezeichnung und Stichwörter (RV_STICHWORTE).
      { href: '/weingarten/rueckverfolgung', label: 'Rückverfolgung', phase: 1, keywords: `${RV_STICHWORTE} wartezeit pflanzenschutz lese grundstück maßnahmen ernte bis ernte lebensmittelsicherheit bki csv` },
    ],
  },
  {
    key: 'kellerbuch', label: 'Kellerbuch', icon: BookOpen,
    items: [
      // KAN-428: Einstieg = Dashboard-Sicht „Kellerbuch“; die bisherige Übersicht heißt „Gebinde & Chargen“
      { href: '/kellerbuch/uebersicht',      label: 'Übersicht',      keywords: 'chargen pipeline gärung kanban dashboard' },
      { href: '/kellerbuch',                 label: 'Gebinde & Chargen', phase: 1, keywords: 'behälter tank fass chargen' },
      // Pilottest 30.09.2026: Pressungen (vorher auf der Lese-Seite) und Zukauf (vorher Warenwirtschaft) direkt nach
      // der Übersicht; die Zukauf-Seiten behalten ihre Adresse /weinhandel/zukauf (activeGroup: längster Treffer).
      { href: '/kellerbuch/pressungen',      label: 'Pressungen',     phase: 1, keywords: 'pressung most trauben keltern presse lese charge' },
      { href: '/weinhandel/zukauf',          label: 'Zukauf',         phase: 1, keywords: 'trauben most wein einkauf zukauf' },
      // KAN-118 / UAT 23.10.2026 (Testfall 4.20): die Liste der Produktionen (mit Storno) war nur über Umwege erreichbar
      { href: '/kellerbuch/produktion',      label: 'Produktion',     phase: 1, keywords: 'produktion spritzer perlweinspritzer weinmischgetränk perlwein schaumwein sekt petnat storno verarbeitung' },
      // KAN-413 (UAT 12.11.2026): eigener Punkt statt Knopf in der Übersicht
      { href: '/kellerbuch/sammelbehandlung', label: 'Sammelmaßnahmen', phase: 1, keywords: 'sammelmaßnahme mehrere gebinde schwefeln behandlung bulk kellerbehandlung' },
      { href: '/kellerbuch/kellerplan',      label: 'Kellerplan',     phase: 1, keywords: 'grundriss' },
      { href: '/dac',                        label: 'Prüfnummer',     phase: 1, keywords: 'dac antrag staatliche prüfnummer' },
      // KAN-40 E1: Bewegungsjournal (nur lesen) mit Journal-Konsistenz
      { href: '/kellerbuch/journal',         label: 'Bewegungsjournal', phase: 1, keywords: 'journal buchungen beleg konsistenz bestand storno umstufung korrektur' },
      // KAN-44 Teil 1: BKI-Blätter Lagerstand zum Datum und Lagerbewegungen (Reiter auf der Seite)
      { href: '/kellerbuch/lagerstand',      label: 'Lagerstand (BKI)', phase: 1, keywords: 'lagerstand stichtag lagerbewegungen bki schnittstelle weindatenbank bestand flaschen etikettiert csv' },
      { href: '/kellerbuch/besondere-konten', label: 'Besondere Konten', phase: 1, keywords: 'besondere konten stoffkonto zucker saccharose rtk ktm säuerung entsäuerung kellermittel' },   // KAN-107
      // KAN-360 (22.10.2026): letzter Punkt vor den Behördenmeldungen – wie unter Rieden
      { href: '/kellerbuch/rueckverfolgung', label: 'Rückverfolgung', phase: 1, keywords: `${RV_STICHWORTE} herkunft charge grundstück` },
      { href: '/reports/weinbuecher-sammlung', label: 'Weinbuch-Sammlung', pflichtmeldung: true, keywords: 'weinbuch kellerbuch aufzeichnungen bki prüfung behörde meldung druck pdf csv' },
      // KAN-43 Etappe 2: BSM nach Buchungsarten je Weinwirtschaftsjahr (Kontrolljournal auf derselben Seite)
      { href: '/reports/bestandsmeldung-bsm', label: 'Bestandsmeldung (BSM)', pflichtmeldung: true, keywords: 'bsm weinbestandsmeldung bestand buchungsarten weinwirtschaftsjahr abwertung zugang abgang kontrolljournal weindatenbank behörde meldung druck csv' },
    ],
  },
  {
    key: 'warenwirtschaft', label: 'Warenwirtschaft', icon: Warehouse,
    items: [
      // KAN-428: Einstieg = Verkaufs-Teil der Sicht „Verkauf & CRM“
      { href: '/weinhandel/uebersicht',       label: 'Übersicht',          keywords: 'umsatz aufträge offene rechnungen überfällig top-kunden flaschenbestand dashboard' },
      { href: '/weinhandel',                  label: 'Warenlager',         phase: 1, keywords: 'flaschen füllungen bestand' },
      { href: '/weinhandel/verkauf',          label: 'Verkauf',            phase: 1, keywords: 'rechnung auftrag lieferschein' },
      // KAN-418: Aufträge reservieren Flaschen (verfügbar = Bestand − reserviert)
      { href: '/weinhandel/auftraege',        label: 'Aufträge',           phase: 1, keywords: 'auftrag reservierung reserviert bestellung auftragsbestätigung' },
      { href: '/weinhandel/sammelrechnung',   label: 'Sammelrechnung',     phase: 1, keywords: 'lieferscheine rechnung zusammenfassen nicht berechnet' },   // KAN-104
      { href: '/weinhandel/offene-posten',    label: 'Offene Posten',      phase: 1, keywords: 'überfällig zahlung mahnung' },
      // 30.09.2026: Liste der Transportbescheinigungen eines Zeitraums (Druck + CSV) – bisher nur über die Behördenmeldungen
      { href: '/weinhandel/transportbescheinigungen', label: 'Transportbescheinigungen', phase: 1, keywords: 'transportschein tbs begleitpapier weingesetz bki zeitraum' },
      { href: '/weinhandel/sonstige-artikel', label: 'Sonstiges-Produkte', phase: 1, keywords: 'artikel' },
      { href: '/weinhandel/rabattgruppen',    label: 'Rabattgruppen',      phase: 1 },
      { href: '/weinexport',                  label: 'Exportaufträge',     requireModul: 'modul_export', keywords: 'eur.1 cmr export' },
    ],
  },
  {
    key: 'crm', label: 'CRM', icon: Users,
    items: [
      // KAN-428: Einstieg = CRM-Teil der Sicht „Verkauf & CRM“
      { href: '/crm/uebersicht',          label: 'Übersicht', keywords: 'meine aktivitäten nächste termine leads dashboard' },
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
      // KAN-428: Einstieg = „Meldungen & Fristen“ (bleibt zusätzlich unter Übersicht für alle erreichbar)
      { href: '/controlling/fristen',         label: 'Meldungen & Fristen', keywords: 'termine meldung uva erntemeldung ampel behörden' },
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
      { href: '/hilfe/neuerungen',     label: 'Neuerungen',        keywords: 'release notes version änderungen was ist neu' },
      { href: '/hilfe/support',        label: 'Support',           keywords: 'hilfe kontakt premium-support telefon anfrage problem melden' },
      { href: '/profil',               label: 'Profil',            keywords: 'passwort name' },
      { href: '/betrieb/einstellungen', label: 'Mein Betrieb',     adminOnly: true, keywords: 'einstellungen branding benutzer bawb' },
      // Administration: nur system_admin bzw. Sandbox-Sonderfreigabe (s.u.)
      { href: '/admin/mandanten',      label: 'Mandanten',         adminOnly: true, keywords: 'administration tenants' },
      { href: '/admin/gemeinschaften', label: 'Gemeinschaften', adminOnly: true, keywords: 'administration gebinde freigabe partner keller kellergemeinschaft crm kontakte gemeinsam' },
      { href: '/admin/release-notes',  label: 'Release Notes',     adminOnly: true, keywords: 'administration' },
      { href: '/admin/system',         label: 'Systembericht',     adminOnly: true, keywords: 'administration fehler protokoll log' },
      { href: '/admin/import',         label: 'Datenimport',       adminOnly: true, betriebsleiter: true, keywords: 'administration csv import' },
      { href: '/admin/benutzer',       label: 'Super-Admin',      adminOnly: true, keywords: 'administration benutzer' },
      { href: '/admin/onboarding',     label: 'Onboarding Guide',  adminOnly: true, keywords: 'administration' },
      { href: '/admin/zeiterfassung',  label: 'Zeiterfassung',     adminOnly: true, sandboxOnly: true },
    ],
  },
]

// isActivePath und die exakt matchenden Pfade liegen in ./aktiv.ts (testbar ohne Bundler)

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

// Pflichtmeldungen (Entscheidung 24.9.2026): gleiche Regel wie der Seiten-Guard
// reports/(pflicht)/layout.tsx bzw. darfPflichtmeldungen() in lib/auth/modul.ts:
// Betriebsleiter immer, alle anderen nur mit Modul Controlling + Auswertungsrecht.
// Rollenliste gemeinsam aus lib/auth/pflichtmeldung.ts (isomorph).
function pflichtmeldungenSichtbar(ctx: NavContext): boolean {
  if (istPflichtmeldungsRolle(ctx.role)) return true
  return ctx.branding.modul_controlling && ctx.auswertungenSichtbar !== false
}

/**
 * Liefert die für den Nutzer sichtbaren Bereiche inkl. gefilterter Seiten.
 * Regeln (unverändert aus Sidebar.tsx übernommen):
 *  - adminOnly-Items: system_admin ODER tenant_admin
 *  - /admin/*-Items (frühere Gruppe "Administration", systemAdminOnly):
 *    nur system_admin ODER Sandbox-Sonderfreigabe – Betriebsleiter sehen sie nicht, außer das Item trägt
 *    betriebsleiter: true (Datenimport, Hotfix 02.10.2026: auch Betriebs-Manager)
 *  - modulKey/requireModul/hideIfModul gegen die Tenant-Modul-Toggles
 *  - sandboxOnly nur im Sandbox-Mandanten
 *  - pflichtmeldung: Betriebsleiter immer, sonst Modul Controlling + Auswertungsrecht
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
        if (!isSysAdmin && !ctx.sandboxAdminUnlock && !(it.betriebsleiter && isAdmin)) return false
      } else if (it.adminOnly && !isAdmin) {
        // z.B. "Mein Betrieb": Betriebsleiter + System-Admin, KEINE Sonderfreigabe
        return false
      }
      if (it.sandboxOnly && !ctx.isSandbox) return false
      if (it.pflichtmeldung && !pflichtmeldungenSichtbar(ctx)) return false
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

/** Alle Bereiche mit ihren Pfaden, ungefiltert – für das Ziel nach dem Speichern (KAN-334, zielImBereich) */
export function bereichsPfade(): { key: string; hrefs: string[] }[] {
  return NAV.map(g => ({ key: g.key, hrefs: g.items.map(it => it.href) }))
}

/** Bereich, zu dem der aktuelle Pfad gehört (Fallback: erster Bereich) */
export function activeGroup(groups: NavGroup[], pathname: string): NavGroup | undefined {
  // Längster passender href gewinnt (z.B. /weinhandel/offene-posten kommt in
  // Warenwirtschaft UND E&A vor – dann zählt der Bereich, in dem der Nutzer
  // gerade ist: erster Treffer in NAV-Reihenfolge). Unterseiten exakt matchender
  // Punkte (/weinhandel/fuellungen/…) gehören seit KAN-378 zu deren Bereich.
  return groups[aktiverBereichIndex(groups, pathname)]
}
