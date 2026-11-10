// ── Abo-Regeln und Nur-Lesen-Modus (KAN-5, 25.09.2026) ───────────────────────
//
// Entscheidung Jörgen (25.09.2026): Ein Betrieb mit gesperrtem Abo wird NICHT mehr auf /abo
// umgeleitet, sondern arbeitet im Nur-Lesen-Modus. Ansehen, Drucken und Exportieren bleiben
// möglich (Aufbewahrungspflicht, DSGVO-Auskunft); gesperrt ist jedes Speichern sowie die
// KI-Abfrage und der Assistent (Kosten). Diese Datei hält die Regeln an EINER Stelle:
//
//  - aboStandBerechnen(): wann ein Abo gesperrt ist (Status, Testphase) und wer ausgenommen ist;
//    aboStandErmitteln(): dasselbe mit Cache und ungecachtem Nachladen vor jeder Ablehnung
//  - istSandboxOderDemo(): Sandbox und Demo-Musterhof über FESTE IDs statt über den Namen
//    (Teil von KAN-10 – ein Name ist änderbar, eine ID nicht)
//  - SCHREIBSPERRE_MELDUNG / KI_SPERRE_MELDUNG / sperrAntwortKoerper(): Text und JSON-Form der
//    Ablehnung – Server (lib/auth/sperren.ts) und Client-Wächter (lib/abo/nurLesen.ts) identisch
//  - paketEntscheidung(): ob der Stripe-Webhook bzw. der Paketwechsel auf /abo die
//    Paket-Vorgaben (Module, Benutzerlimit) anwenden darf – keine Upgrades ohne Zahlung
//  - aboZuordnung(): ob ein Stripe-Ereignis den Betrieb betrifft (Abo-ID, beendete Abos)
//  - checkoutAboDaten(): Abo-Daten des Stripe-Checkouts – ohne Testphase (KAN-402)
//
// Bewusst ohne Server- und React-Importe (nur '@/lib/pakete', das ebenfalls frei davon ist):
// genutzt von Server, Client und node:test (scripts/tests/abo-nurlesen.test.mjs).

import { PAKET_REIHENFOLGE, type PaketKey } from '@/lib/pakete'

// ── Ausnahmen ────────────────────────────────────────────────────────────────

/** Mandant „Sandbox“ (Test- und Schulungsbetrieb der Plattform) */
export const SANDBOX_TENANT_ID = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
/** Mandant „Demo-Musterhof“ (Vorführbetrieb, Smoke-Test der Rechte – admin/system/actions.ts) */
export const DEMO_TENANT_ID = '33333333-3333-4333-8333-333333333333'

const ABO_FREIE_BETRIEBE: ReadonlySet<string> = new Set([SANDBOX_TENANT_ID, DEMO_TENANT_ID])

/** Sandbox oder Demo-Musterhof? – beide sind von der Abo-Sperre ausgenommen (feste IDs) */
export function istSandboxOderDemo(tenantId: string | null | undefined): boolean {
  return typeof tenantId === 'string' && ABO_FREIE_BETRIEBE.has(tenantId.trim().toLowerCase())
}

// ── Abo-Stand ────────────────────────────────────────────────────────────────

// Rückmeldung 31.8.2026: Diese Stripe-Status sperren den Betrieb (seit KAN-5: Nur-Lesen-Modus).
// 'past_due' ist bewusst NICHT dabei – Stripes Dunning eskaliert fehlgeschlagene Zahlungen nach
// einigen Tagen selbst zu 'unpaid'; bis dahin zeigt das Layout nur eine Warnung.
export const ABO_GESPERRTE_STATUS: readonly string[] = ['unpaid', 'canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'paused']

/**
 * Rückmeldung 31.8.2026 („Trial-Ablauf: 14 Tage, dann Sperre wie bei unpaid“): 'trialing'
 * sperrt erst, wenn das von Stripe gelieferte trial_end in der Vergangenheit liegt.
 */
export function istTrialAbgelaufen(stripeStatus: string | null | undefined, trialEndsAt: string | null | undefined, jetzt: number = Date.now()): boolean {
  if (stripeStatus !== 'trialing' || !trialEndsAt) return false
  const ende = new Date(trialEndsAt).getTime()
  return Number.isFinite(ende) && ende < jetzt
}

export type AboStand = {
  gesperrt: boolean
  warnung: boolean
  /**
   * Neukunde, der den Stripe-Checkout der Registrierung nie abgeschlossen hat ('incomplete' ohne
   * Abo-ID): kein gesperrtes Abo, sondern noch gar keines – das Layout führt wie vor KAN-5 auf
   * /abo („Zahlung nachholen“) statt in einen leeren Betrieb im Nur-Lesen-Modus. Gesperrt
   * (gesperrt = true) ist er trotzdem, falls eine Server Action direkt aufgerufen wird.
   */
  zahlungOffen: boolean
}

const FREI: AboStand = { gesperrt: false, warnung: false, zahlungOffen: false }

/**
 * Abo-Stand eines Betriebs (reine Funktion). Ausgenommen: system_admin (Plattformbetreiber),
 * Sandbox und Demo-Musterhof (feste IDs) sowie Betriebe ohne Stripe-Status (manuell betreut).
 */
export function aboStandBerechnen(p: {
  tenantId: string | null | undefined
  stripeStatus: string | null | undefined
  trialEndsAt: string | null | undefined
  role: string | null | undefined
  /** tenants.stripe_subscription_id – nur für zahlungOffen (undefined = unbekannt → false) */
  aboId?: string | null
}, jetzt: number = Date.now()): AboStand {
  const status = p.stripeStatus ?? null
  if (!status || p.role === 'system_admin' || istSandboxOderDemo(p.tenantId)) return FREI
  if (ABO_GESPERRTE_STATUS.includes(status) || istTrialAbgelaufen(status, p.trialEndsAt, jetzt)) {
    return { gesperrt: true, warnung: false, zahlungOffen: status === 'incomplete' && p.aboId === null }
  }
  return { gesperrt: false, warnung: status === 'past_due', zahlungOffen: false }
}

/** Was aboStandErmitteln() vom Tenant-Kopf (lib/tenant/kopf.ts) braucht */
export type KopfAbo = {
  tenant: { stripe_status?: string | null; stripe_trial_ends_at?: string | null; stripe_subscription_id?: string | null } | null
  /** Laden fehlgeschlagen (DB-Fehler) – dann gibt es keine Aussage über das Abo */
  ladefehler?: boolean
}

/**
 * Abo-Stand der Mitgliedschaft mit Nachladen (reine Funktion, Lader werden übergeben):
 *  - system_admin, Sandbox und Demo-Musterhof: sofort frei, ganz ohne Abfrage
 *  - sonst Stand aus dem 60-s-Kopf-Cache; sagt der „gesperrt“ oder schlug das Laden fehl, wird
 *    EINMAL ungecacht nachgeladen – eine Ablehnung beruht so nie auf einem veralteten
 *    Cache-Eintrag (z. B. direkt nach der Zahlung, bevor der Webhook-Tag gegriffen hat).
 *  - scheitert auch das: frei (fail-open) – die Datenbank-Ebene (Migration kan5_abo_schreibsperre)
 *    sperrt unabhängig davon; ein DB-Ausfall ließe das Speichern ohnehin scheitern.
 */
export async function aboStandErmitteln(
  m: { tenantId: string | null | undefined; role: string | null | undefined },
  lade: { gecacht: (tenantId: string) => Promise<KopfAbo>; frisch: (tenantId: string) => Promise<KopfAbo> },
  jetzt: number = Date.now(),
): Promise<AboStand> {
  const tenantId = m.tenantId
  if (!tenantId || m.role === 'system_admin' || istSandboxOderDemo(tenantId)) return FREI
  const berechne = (k: KopfAbo) => aboStandBerechnen({
    tenantId, role: m.role,
    stripeStatus: k.tenant?.stripe_status ?? null,
    trialEndsAt: k.tenant?.stripe_trial_ends_at ?? null,
    aboId: k.tenant ? (k.tenant.stripe_subscription_id ?? null) : undefined,
  }, jetzt)
  let kopf = await lade.gecacht(tenantId)
  if (!kopf.ladefehler && !berechne(kopf).gesperrt) return berechne(kopf)
  kopf = await lade.frisch(tenantId)
  return kopf.ladefehler ? FREI : berechne(kopf)
}

// ── Meldungen ────────────────────────────────────────────────────────────────

/** Ablehnung jeder Schreibaktion im Nur-Lesen-Modus (Server Actions, API, Client-Wächter) */
export const SCHREIBSPERRE_MELDUNG = 'Das Abo dieses Betriebs ist gesperrt – Änderungen sind im Nur-Lesen-Modus nicht möglich. Bitte unter „Abo“ klären.'

/**
 * Ablehnung von KI-Abfrage, Assistent, Lead-Vorschlag und Visitenkarten-Erkennung: dort wollte
 * niemand etwas speichern – gesperrt sind sie wegen der KI-Kosten.
 */
export const KI_SPERRE_MELDUNG = 'Das Abo dieses Betriebs ist gesperrt – KI-Abfragen und Assistent sind im Nur-Lesen-Modus nicht verfügbar. Bitte unter „Abo“ klären.'

/** Hinweisleiste im Arbeitsbereich ((dashboard)/layout.tsx): „<Titel>: <Text> Zum Abo →“ */
export const NUR_LESEN_TITEL = 'Nur-Lesen-Modus'
export const NUR_LESEN_BANNER = 'Das Abo dieses Betriebs ist gesperrt – Änderungen sind nicht möglich.'

/** Kennung im JSON der Ablehnung (grund) – Clients können darauf gezielt reagieren */
export const NUR_LESEN_GRUND = 'nur_lesen'

/** Art der Ablehnung: Speichern (Standard) oder KI (Kosten) */
export type SperrArt = 'speichern' | 'ki'

export function sperrMeldung(art: SperrArt = 'speichern'): string {
  return art === 'ki' ? KI_SPERRE_MELDUNG : SCHREIBSPERRE_MELDUNG
}

/** Enthält ein Antworttext (z. B. die RSC-Antwort einer Server Action) eine der beiden Sperrmeldungen? → Art, sonst null */
export function sperrArtImText(text: string | null | undefined): SperrArt | null {
  if (!text) return null
  if (text.includes(KI_SPERRE_MELDUNG)) return 'ki'
  if (text.includes(SCHREIBSPERRE_MELDUNG)) return 'speichern'
  return null
}

/**
 * JSON-Körper der Ablehnung (HTTP 403). Die Aufrufer im Client lesen je nach Route
 * „fehler“, „error“ oder „meldung“ bzw. prüfen „ok“ – alle Felder tragen dieselbe Meldung,
 * damit jede bestehende Fehleranzeige den Text ohne Anpassung zeigt.
 */
export function sperrAntwortKoerper(art: SperrArt = 'speichern'): { ok: false; fehler: string; error: string; meldung: string; grund: string; nurLesen: true; art: SperrArt } {
  const m = sperrMeldung(art)
  return { ok: false, fehler: m, error: m, meldung: m, grund: NUR_LESEN_GRUND, nurLesen: true, art }
}

// ── Paket-Vorgaben nach Stripe-Ereignissen ───────────────────────────────────

export type PaketEntscheidung = {
  /** tenants.stripe_plan schreiben? false = unverändert lassen */
  planSetzen: boolean
  /** neuer Wert für stripe_plan (nur wenn planSetzen) */
  plan: PaketKey | null
  /** Paket-Vorgaben (Modul-Flags, Benutzerlimit) über wendePaketAn() anwenden? */
  moduleAnwenden: boolean
  /** Begründung fürs Protokoll */
  grund: string
}

function rang(paket: PaketKey | null): number {
  return paket ? PAKET_REIHENFOLGE.indexOf(paket) : -1
}

/** Mehr Leistung als bisher (auch: von „kein Paket“ auf ein Paket)? */
export function istUpgrade(bisher: PaketKey | null, neu: PaketKey | null): boolean {
  return neu !== null && rang(neu) > rang(bisher)
}

/**
 * KAN-8 (06.10.2026): Stripe-Parameter für den Selbstservice-Paketwechsel auf /abo.
 *  - Upgrade: Differenz sofort in Rechnung stellen (always_invoice) und den Wechsel nur übernehmen, wenn diese Rechnung
 *    bezahlt ist (pending_if_incomplete) – sonst bleibt das Abo beim alten Preis (pending_update), die App schaltet nichts
 *    frei; nach späterer Zahlung stellt Stripe um und der Webhook übernimmt das Paket.
 *  - Downgrade bzw. gleiches Paket: Gutschrift auf der nächsten Rechnung (create_prorations), wie bisher.
 * Achtung Stripe: Bei pending_if_incomplete sind nur Positionen/Proration erlaubt (keine metadata im selben Aufruf).
 */
export function paketwechselParameter(bisher: PaketKey | null, neu: PaketKey | null):
  { proration_behavior: 'always_invoice'; payment_behavior: 'pending_if_incomplete' } | { proration_behavior: 'create_prorations' } {
  return istUpgrade(bisher, neu)
    ? { proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete' }
    : { proration_behavior: 'create_prorations' }
}

/**
 * Darf ein Stripe-Ereignis (Webhook customer.subscription.*) bzw. der Selbstservice-Wechsel auf
 * /abo das Paket des Betriebs umstellen?
 *
 *  - Abo beendet ('geloescht'): stripe_plan → null (kein Abo mehr, „Paket wählen“ auf /abo
 *    zeigt wieder alle Pakete), die Module bleiben aber STEHEN – der Nur-Lesen-Modus braucht
 *    die Seiten (E&A, Export …), sonst wären Daten nicht mehr einsehbar und exportierbar.
 *  - gesperrter Status (unpaid, canceled, incomplete, incomplete_expired, paused): nichts
 *    ändern – keine Freischaltung nach dem Preis ohne Zahlung (z. B. Checkout mit
 *    3-D-Secure offen = 'incomplete'), und bei Sperre bleiben die bisherigen Module.
 *  - 'active' / 'trialing': Paket laut Preis anwenden (wie bisher, auch Downgrades).
 *  - 'past_due': Zahlung offen – Downgrade bzw. gleiches Paket anwenden, Upgrade erst nach
 *    Zahlungseingang (Stripe meldet dann customer.subscription.updated mit 'active').
 *  - unbekannter Status: nichts ändern (vorsichtig).
 */
export function paketEntscheidung(p: {
  ereignis: 'aktualisiert' | 'geloescht'
  status: string | null | undefined
  neuesPaket: PaketKey | null
  bisherigesPaket: PaketKey | null
}): PaketEntscheidung {
  const behalten = (grund: string): PaketEntscheidung => ({ planSetzen: false, plan: p.bisherigesPaket, moduleAnwenden: false, grund })
  if (p.ereignis === 'geloescht') {
    return { planSetzen: true, plan: null, moduleAnwenden: false, grund: 'Abo beendet – Module bleiben für den Nur-Lesen-Modus unverändert' }
  }
  const status = p.status ?? ''
  if (ABO_GESPERRTE_STATUS.includes(status)) {
    return behalten(`Status „${status}“: ohne Zahlung kein Paketwechsel, bisherige Module bleiben (Nur-Lesen-Modus)`)
  }
  if (status === 'active' || status === 'trialing') {
    return { planSetzen: true, plan: p.neuesPaket, moduleAnwenden: true, grund: `Status „${status}“: Paket laut Preis` }
  }
  if (status === 'past_due') {
    if (istUpgrade(p.bisherigesPaket, p.neuesPaket)) {
      return behalten('Status „past_due“: Upgrade erst nach Zahlungseingang')
    }
    return { planSetzen: true, plan: p.neuesPaket, moduleAnwenden: true, grund: 'Status „past_due“: Downgrade bzw. gleiches Paket' }
  }
  return behalten(`unbekannter Status „${status || '–'}“: keine Änderung`)
}

// ── Zuordnung von Stripe-Ereignissen zum Betrieb (KAN-5 Nachschliff, 25.09.2026) ─────
//
// Bisher schrieb der Webhook den Status blind über die customer_id: invoice.payment_succeeded
// → 'active', invoice.payment_failed → 'past_due', customer.subscription.deleted → 'cancelled'.
// Damit konnte (a) eine nach der Kündigung bezahlte Schlussrechnung einen gekündigten Betrieb
// dauerhaft entsperren (die Module bleiben seit KAN-5 stehen), (b) ein spät zugestelltes
// payment_failed einen 'unpaid' überschreiben (nur Warnung statt Sperre) und (c) das deleted
// eines alten Doppel-Abos einen zahlenden Kunden sperren. Jetzt:
//  - Der Webhook liest den Status IMMER frisch von Stripe (subscriptions.retrieve) – die
//    Reihenfolge der Zustellung spielt keine Rolle mehr, es gewinnt der aktuelle Stand.
//  - aboZuordnung() entscheidet, ob das Ereignis den Betrieb überhaupt betrifft (Abo-ID).

/** Stripe-Status, aus denen ein Abo nicht mehr zurückkommt */
export const ABO_BEENDET_STATUS: readonly string[] = ['canceled', 'incomplete_expired']

/** aktualisiert = customer.subscription.created/updated · geloescht = …deleted · rechnung = invoice.payment_* */
export type AboEreignis = 'aktualisiert' | 'geloescht' | 'rechnung'

export type AboZuordnung = {
  /** uebernehmen = Abo-ID + frischen Status schreiben · beenden = Abo-ID leeren, 'cancelled' · ignorieren = nichts */
  aktion: 'uebernehmen' | 'beenden' | 'ignorieren'
  grund: string
}

export function aboZuordnung(p: {
  ereignis: AboEreignis
  /** tenants.stripe_subscription_id des Betriebs */
  gespeicherteAboId: string | null | undefined
  /** Abo, um das es im Ereignis geht */
  aboId: string
  /** Status dieses Abos laut Stripe (frisch abgerufen; bei geloescht aus dem Ereignis) */
  aktuellerStatus: string | null | undefined
  /** nur bei abweichender gespeicherter Abo-ID: ist DAS gespeicherte Abo laut Stripe beendet? */
  gespeichertesAboBeendet?: boolean
}): AboZuordnung {
  const gespeichert = p.gespeicherteAboId || null
  const eigenes = gespeichert !== null && gespeichert === p.aboId
  if (p.ereignis === 'geloescht' || ABO_BEENDET_STATUS.includes(p.aktuellerStatus ?? '')) {
    return eigenes
      ? { aktion: 'beenden', grund: 'Abo des Betriebs ist beendet' }
      : { aktion: 'ignorieren', grund: gespeichert ? 'beendetes Abo gehört nicht (mehr) zum Betrieb – das aktuelle Abo bleibt' : 'beendetes Abo, Betrieb hat kein Abo mehr – nichts zu tun' }
  }
  if (p.ereignis === 'rechnung') {
    return eigenes
      ? { aktion: 'uebernehmen', grund: 'Rechnung des aktuellen Abos – Status laut Stripe' }
      : { aktion: 'ignorieren', grund: 'Rechnung eines anderen bzw. früheren Abos (z. B. nach der Kündigung bezahlte Schlussrechnung) – Status bleibt' }
  }
  if (eigenes || gespeichert === null) return { aktion: 'uebernehmen', grund: gespeichert ? 'aktuelles Abo des Betriebs' : 'erstes bzw. neues Abo des Betriebs' }
  if (p.gespeichertesAboBeendet === true) return { aktion: 'uebernehmen', grund: 'neues Abo ersetzt das beendete' }
  return { aktion: 'ignorieren', grund: 'Betrieb hat ein anderes, laufendes Abo – bitte in Stripe prüfen (Doppel-Abo?)' }
}

// ── Checkout ohne Testphase (KAN-402, 10.11.2026) ─────────────────────────────
// Vertrag v3 (NV 2.3/4.1, AGB 2.3): keine kostenlose Testphase, die entgeltliche Nutzung beginnt mit der
// Freischaltung. Jeder Checkout (erstes Abo, Zahlung nachholen, Wiederabschluss nach Kündigung) verlangt
// sofort die Zahlung – nie trial_period_days. Bis 10.11.2026 gab es 14 Tage einmal je Stripe-Kunde
// (testphaseTage, KAN-5); laufende Altfälle mit 'trialing' wertet aboStandBerechnen() weiter aus.
export function checkoutAboDaten(tenantId: string): { metadata: { tenant_id: string } } {
  return { metadata: { tenant_id: tenantId } }
}

/** /abo: Betrieb hat noch nie ein Paket gebucht (kein Abo, nicht gekündigt) – Hinweis zur Buchung statt Sperrtext. */
export function nochKeinPaketGebucht(stripeStatus: string | null | undefined, hatAbo: boolean): boolean {
  return !hatAbo && !['canceled', 'cancelled'].includes(String(stripeStatus ?? ''))
}
