// ── Partner direkt aus der Partner-Suche anlegen (KAN-353, 22.10.2026) ──
// UAT-Befund: In Zukauf, Verkauf, Traubenverkauf und Lese ließ sich nur ein bestehender Kunde/Lieferant suchen –
// für einen neuen hieß es abbrechen, ins CRM, von vorn. Jetzt bietet <PartnerSuche> „+ Neue Firma“ / „+ Neuer
// Kontakt“ an (nur mit CRM-Schreibrecht); ein kleiner Dialog fragt die Pflichtfelder ab, die Server Action
// partnerSchnellAnlegen (crm/actions.ts) legt den Datensatz über DIESELBE Anlage wie das CRM an (Kundennummer,
// E-Mail-/Land-Prüfung, Zahlungsziel) – hier nur, was der Dialog zusätzlich braucht: Prüfung der Felder,
// Vorbelegung aus dem Suchtext, Standardwerte wie in den CRM-Formularen und der Treffer für die Auswahl.
//
// Reine Funktionen ohne '@/'-Importe (node:test, scripts/tests/kan353-partner-schnellanlage.test.mjs).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { weinbauBetriebsnummerPruefen } from '../betrieb/betriebsnummer.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { normalisiereLand } from '../katalog/laender.ts'

/** Suchart des Feldes (wie <PartnerSuche art>) – bestimmt, was angelegt werden darf und das ID-Format */
export type PartnerSuchArt = 'kunde' | 'lieferant' | 'kontakt' | 'firma'
export type SchnellTyp = 'kontakt' | 'firma'
export type SchnellRolle = 'kunde' | 'lieferant'

/** Höchstlänge der Namen im Dialog (Firmenname bzw. Vor-/Nachname) */
export const SCHNELL_NAME_MAX = 200

export type SchnellPartnerEingabe = {
  typ: SchnellTyp
  art: PartnerSuchArt
  /** Firma */
  name?: string
  /** Kontakt */
  vorname?: string
  nachname?: string
  betrieb_nr?: string
  land?: string
  /** Kennzeichen der Firma (Kontakte haben keine Kunde-/Lieferant-Spalte – sie erscheinen in beiden Suchen) */
  ist_kunde?: boolean
  ist_lieferant?: boolean
  /** Kontakt als Ansprechperson dieser Firma (Feld „z.H.“) */
  firma_id?: string | null
  /** Hinweis auf eine mögliche Dublette gelesen und bestätigt */
  trotzDublette?: boolean
}

/** Felder für die Anlage im CRM (Namen wie im CRM-Formular – createKontakt/createFirma lesen dieselben) */
export type SchnellFelder = Record<string, string>

export type SchnellPruefung =
  | { ok: true; typ: SchnellTyp; felder: SchnellFelder; anzeige: string }
  | { ok: false; fehler: string }

/** Was das Feld anlegen darf: Kunde/Lieferant → Firma und Kontakt, sonst nur die eine Tabelle */
export function anlageTypen(art: PartnerSuchArt): SchnellTyp[] {
  if (art === 'firma') return ['firma']
  if (art === 'kontakt') return ['kontakt']
  return ['firma', 'kontakt']
}

/** Rolle des neuen Partners: ausdrücklich vom Formular, sonst aus der Suchart (Zukauf → Lieferant, sonst Kunde) */
export function standardRolle(art: PartnerSuchArt, rolle?: SchnellRolle | null): SchnellRolle {
  if (rolle) return rolle
  return art === 'lieferant' ? 'lieferant' : 'kunde'
}

/** Suchtext als Namensvorschlag: Firma = ganzer Text; Kontakt = letztes Wort Nachname, der Rest Vorname */
export function namensVorschlag(typ: SchnellTyp, suchtext: string): { name: string; vorname: string; nachname: string } {
  const text = (suchtext ?? '').replace(/\s+/g, ' ').trim()
  if (typ === 'firma') return { name: text, vorname: '', nachname: '' }
  const woerter = text ? text.split(' ') : []
  const nachname = woerter.pop() ?? ''
  return { name: '', vorname: woerter.join(' '), nachname }
}

function text(roh: unknown): string {
  return typeof roh === 'string' ? roh.replace(/\s+/g, ' ').trim() : ''
}

/** Prüft die Eingabe des Dialogs und liefert die Felder für die CRM-Anlage – dieselbe Prüfung im Dialog und auf dem Server */
export function schnellAnlagePruefen(e: SchnellPartnerEingabe): SchnellPruefung {
  const art: PartnerSuchArt = e?.art === 'kunde' || e?.art === 'lieferant' || e?.art === 'firma' ? e.art : 'kontakt'
  const typ: SchnellTyp = e?.typ === 'firma' ? 'firma' : 'kontakt'
  if (!anlageTypen(art).includes(typ)) {
    return { ok: false, fehler: typ === 'firma' ? 'Hier kann nur ein Kontakt angelegt werden.' : 'Hier kann nur eine Firma angelegt werden.' }
  }

  const bnr = weinbauBetriebsnummerPruefen(e.betrieb_nr ?? '', 'weinhaendler')   // optional; nur Ziffern, höchstens 10 Stellen
  if (!bnr.ok) return { ok: false, fehler: bnr.fehler.replace('Weinbau-Betriebsnummer', 'Betriebsnummer') }

  const landRoh = text(e.land)
  const land = landRoh ? normalisiereLand(landRoh) : 'AT'
  if (!land) return { ok: false, fehler: `Unbekanntes Land „${landRoh}“ – bitte ein Land aus der Liste wählen.` }

  const gemeinsam: SchnellFelder = {
    land,
    betrieb_nr: bnr.wert ?? '',
    telefon_vorwahl: '+43',
    mobil_vorwahl: '+43',
  }

  if (typ === 'firma') {
    const name = text(e.name)
    if (!name) return { ok: false, fehler: 'Bitte den Namen der Firma eingeben.' }
    if (name.length > SCHNELL_NAME_MAX) return { ok: false, fehler: `Der Name ist zu lang (höchstens ${SCHNELL_NAME_MAX} Zeichen).` }
    // Im Verkauf muss die neue Firma Kunde sein, im Zukauf Lieferant – sonst fände die Suche sie nicht
    const istKunde = e.ist_kunde === true || art === 'kunde'
    const istLieferant = e.ist_lieferant === true || art === 'lieferant'
    if (!istKunde && !istLieferant) return { ok: false, fehler: 'Bitte „Kunde“ und/oder „Lieferant“ ankreuzen.' }
    return {
      ok: true, typ, anzeige: name,
      felder: {
        ...gemeinsam,
        name,
        segment: 'handel',            // Standard des CRM-Firmenformulars
        zahlungsziel_tage: '30',      // Standard des CRM-Firmenformulars
        ist_kunde: String(istKunde),
        ist_lieferant: String(istLieferant),
        // Neue Datensätze starten im CRM als Lead (Migration 034) – ein reiner Lieferant ist kein Verkaufs-Lead
        is_lead: String(istKunde),
      },
    }
  }

  const vorname = text(e.vorname)
  const nachname = text(e.nachname)
  if (!nachname) return { ok: false, fehler: 'Bitte den Nachnamen eingeben.' }
  if (vorname.length > SCHNELL_NAME_MAX || nachname.length > SCHNELL_NAME_MAX) {
    return { ok: false, fehler: `Vor- oder Nachname ist zu lang (höchstens ${SCHNELL_NAME_MAX} Zeichen).` }
  }
  const firmaId = art === 'kontakt' ? text(e.firma_id) : ''
  return {
    ok: true, typ, anzeige: [vorname, nachname].filter(Boolean).join(' '),
    felder: {
      ...gemeinsam,
      vorname,
      nachname,
      segment: 'privat',             // Standard des CRM-Kontaktformulars
      zahlungsziel_tage: '14',       // Standard des CRM-Kontaktformulars
      firma_id: firmaId,
      is_lead: String(standardRolle(art) === 'kunde'),
    },
  }
}

/** Treffer im Format von /api/crm/suche (PartnerTreffer), damit das Formular den neuen Partner sofort übernimmt */
export type SchnellTreffer = {
  id: string; label: string; sub?: string
  daten: { typ: SchnellTyp; firma_id: string | null; rabatt_pct: number | null; sonderrabatt_pct: number; skonto_pct: number; skonto_tage: number; betrieb_nr: string | null }
}

export function schnellTreffer(art: PartnerSuchArt, typ: SchnellTyp, id: string, felder: SchnellFelder, anzeige: string, accountnummer: string | null): SchnellTreffer {
  const praefix = art === 'kunde' || art === 'lieferant' ? `${typ}:` : ''
  const betriebNr = felder.betrieb_nr || null
  const sub = [praefix ? (typ === 'firma' ? 'Firma' : 'Person') : null, 'neu angelegt', accountnummer, betriebNr ? `Betr.Nr. ${betriebNr}` : null]
    .filter(Boolean).join(' · ')
  return {
    id: praefix + id,
    label: anzeige,
    sub,
    // Neuer Partner: keine Rabattgruppe, kein Sonderrabatt, kein Skonto – wie die Standardwerte der CRM-Anlage
    daten: { typ, firma_id: felder.firma_id || null, rabatt_pct: null, sonderrabatt_pct: 0, skonto_pct: 0, skonto_tage: 10, betrieb_nr: betriebNr },
  }
}
