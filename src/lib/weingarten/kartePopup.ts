// ── Popup der Ried-Karte (KAN-256, 09.10.2026) ──────────────────────────────────────────────────────────────
// Leaflet setzt Popup- und Tooltip-Texte als HTML (innerHTML). Ried-Namen, Rebsorte usw. kommen aus der Datenbank und
// wurden bisher ungeprüft eingesetzt – ein Name wie <img src=x onerror=…> lief bei jedem Mitglied, das die Karte öffnet
// (gespeichertes XSS). Jetzt: Text über escHtml, Link nur als relativer Pfad der App.
// Ohne '@/'-Importe, damit node:test die Datei laden kann.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/buchhaltung/bmd.ts)
import { escHtml } from '../utils/html.ts'

export type PopupPin = { name: string; sub?: string; href?: string }

/** Nur relative Pfade der App („/…“, nicht „//…“) – kein javascript:, keine fremde Seite */
export function sichererPfad(href: string | undefined): string | null {
  return typeof href === 'string' && /^\/(?!\/)/.test(href) ? href : null
}

/** HTML des Popups einer Ried (Name fett, darunter Rebsorte/Fläche und der Link zur Ried) */
export function riedPopupHtml(p: PopupPin): string {
  const sub = p.sub ? `<br><span style="color:#6E717A;font-size:11px">${escHtml(p.sub)}</span>` : ''
  const pfad = sichererPfad(p.href)
  const link = pfad ? `<br><a href="${escHtml(pfad)}" style="font-size:11px">Ried öffnen →</a>` : ''
  return `<b style="font-size:13px">${escHtml(p.name)}</b>${sub}${link}`
}

/** Tooltip-Text (Leaflet setzt auch ihn als HTML) */
export const tooltipText = (name: string): string => escHtml(name)
