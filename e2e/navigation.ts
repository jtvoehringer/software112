// ── Seiten der Navigation je Rolle – direkt aus src/lib/navigation ─────────────
//
// Keine abgeschriebene Pfadliste: buildNav() ist die einzige Quelle für TabNav und
// Befehlspalette. Die Tests rufen sie mit dem Kontext der Test-Rolle auf; kommt eine
// Seite dazu oder ändern sich Sichtbarkeitsregeln, zieht der Smoke-Test automatisch mit.

import { buildNav, type ModulKey, type NavBranding } from '../src/lib/navigation'
import { PROFILE } from '../src/lib/auth/lesebereiche'
import { istProfilRolle, module, ROLLEN, type Rolle } from './umgebung'

const ALLE_MODULE: ModulKey[] = ['modul_ea', 'modul_sumup', 'modul_export', 'modul_controlling']

function branding(): NavBranding {
  const aktiv = module()
  return Object.fromEntries(ALLE_MODULE.map(m => [m, aktiv === null ? true : aktiv.includes(m)])) as NavBranding
}

/** Eindeutige Seitenpfade der Navigation für eine Rolle (ohne Sandbox-Sonderseiten) */
export function navPfade(rolle: Rolle): string[] {
  // Profil (KAN-456): Mitarbeiter mit den Lesebereichen und Schreibmodulen des Profils
  const profil = istProfilRolle(rolle) ? PROFILE[rolle] : null
  const gruppen = buildNav({
    role: profil ? 'winzer' : rolle as Exclude<Rolle, 'extern' | 'vertrieb'>,
    ...(profil ? { lesbar: profil.lesen } : {}),
    branding: branding(),
    isSandbox: false,
    sandboxAdminUnlock: false,
    // Controlling/„Frag dein Weingut“ zeigen; ohne Recht leitet der Layout-Guard um
    auswertungenSichtbar: profil ? (profil.schreibmodule as readonly string[]).includes('auswertungen') : true,
  })
  const pfade = gruppen.flatMap(g => g.items.filter(it => !it.phase || it.phase < 2).map(it => it.href))
  return [...new Set(pfade)]
}

/** Vereinigung über alle Rollen – daraus entstehen die Testfälle (je Rolle wird übersprungen, was sie nicht sieht) */
export function alleNavPfade(): string[] {
  return [...new Set(ROLLEN.flatMap(navPfade))].sort()
}

/**
 * Knöpfe, die nur mit Schreibrecht erscheinen (canWrite). Leser dürfen sie nicht sehen,
 * Betriebs-Manager müssen sie sehen (sonst hat sich die Beschriftung geändert und die
 * Leser-Prüfung wäre wertlos). Bewusst klein gehalten – bei Bedarf erweitern.
 */
export const SCHREIB_KNOEPFE: Record<string, RegExp> = {
  '/crm/kontakte': /Neuer Kontakt/,
  '/crm/firmen': /Neue Firma/,
  '/weinhandel/verkauf': /Neuer Verkauf/,
  // E2E-Ausbau 10.10.2026
  '/weinhandel/zukauf': /Neuer Zukauf/,
  '/erntemeldung': /Neue Lese/,
}
