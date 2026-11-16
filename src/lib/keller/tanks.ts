// ── Tank mit Kammern (KAN-466, 16.11.2026) ──────────────────────────────────────────────────────────────────────
// Manche Tanks sind in übereinander liegende Kammern geteilt (z. B. 7.000 l = 3.000 + 2.000 + 2.000 l). Jede Kammer ist
// ein normales Gebinde (Zeile in behaelter mit tank_id und kammer_nr, 1 = unterste); der Tank selbst (gebinde_tanks) ist
// kein Gebinde – er hält nur Name, Typ, Material und Standort, die die Kammern übernehmen.
// Diese Datei: Regeln für Formular und Server Action (dieselben wie die RPC s112_tank_anlegen) und Helfer für die
// Anzeige. Isomorph, ohne '@/'-Importe (Formulare und node:test).

export const KAMMERN_MIN = 2
export const KAMMERN_MAX = 12
export const TANK_NAME_MAX = 50

/** Typen, die ein Tank mit Kammern haben kann (wie CHECK gebinde_tanks_typ_chk – ohne Presse und Barriques) */
export const TANK_TYPEN: readonly { wert: string; label: string }[] = [
  { wert: 'stahltank', label: 'Stahltank' },
  { wert: 'lagertank', label: 'Lagertank' },
  { wert: 'immervolltank', label: 'Immervoll-Tank' },
  { wert: 'holzfass', label: 'Holzfass' },
  { wert: 'betonei', label: 'Betonei' },
  { wert: 'amphore', label: 'Amphore' },
  { wert: 'bottich', label: 'Bottich' },
  { wert: 'gaerstaender', label: 'Gärständer' },
  { wert: 'zisterne', label: 'Zisterne' },
  { wert: 'sonstiges', label: 'Sonstiges' },
]

export function tankTypLabel(typ: string | null | undefined): string {
  return TANK_TYPEN.find(t => t.wert === typ)?.label ?? (typ ?? '–')
}

/** Vorschlag für den Namen einer Kammer: „A10/1“ (1 = unterste) */
export function kammerVorschlag(tankName: string, nr: number): string {
  const t = tankName.trim()
  return t ? `${t}/${nr}` : ''
}

export type KammerEingabe = { name: string; volumen_liter: number | null; gemeinsam?: boolean }
export type TankEingabe = { name: string; typ: string; kammern: readonly KammerEingabe[] }

/** Prüfung der Eingabe – Formular und Server Action gleich; die RPC s112_tank_anlegen prüft dasselbe noch einmal */
export function tankEingabeFehler(e: TankEingabe): string | null {
  const name = e.name.trim()
  if (!name) return 'Bitte einen Namen für den geteilten Tank angeben.'
  if (name.length > TANK_NAME_MAX) return `Der Name des geteilten Tanks darf höchstens ${TANK_NAME_MAX} Zeichen haben.`
  if (!TANK_TYPEN.some(t => t.wert === e.typ)) return 'Bitte den Typ des geteilten Tanks wählen.'
  if (e.kammern.length < KAMMERN_MIN || e.kammern.length > KAMMERN_MAX) return `Ein geteilter Tank braucht ${KAMMERN_MIN} bis ${KAMMERN_MAX} Kammern.`
  const gesehen = new Set<string>()
  for (let i = 0; i < e.kammern.length; i++) {
    const k = e.kammern[i]
    const n = k.name.trim()
    if (!n) return `Kammer ${i + 1}: bitte einen Namen angeben.`
    if (n.length > TANK_NAME_MAX) return `Kammer ${i + 1}: der Name darf höchstens ${TANK_NAME_MAX} Zeichen haben.`
    const s = n.toLocaleLowerCase('de')
    if (gesehen.has(s)) return `Kammer ${i + 1}: der Name „${n}“ kommt doppelt vor – jede Kammer braucht einen eigenen Namen.`
    if (s === name.toLocaleLowerCase('de')) return `Kammer ${i + 1}: die Kammer darf nicht wie der geteilte Tank heißen.`
    gesehen.add(s)
    if (k.volumen_liter === null || !Number.isFinite(k.volumen_liter) || k.volumen_liter <= 0) return `Kammer ${i + 1}: bitte das Fassungsvermögen in Litern angeben.`
    if (k.volumen_liter >= 10_000_000) return `Kammer ${i + 1}: das Fassungsvermögen ist zu groß.`
  }
  return null
}

type MitTank = { name: string; tank_id?: string | null; tank_name?: string | null; kammer_nr?: number | null; tank_kammern?: number | null }

/**
 * Zusatz zum Namen einer Kammer in Auswahllisten: „Kammer 1 von 3“ – mit Tank-Namen davor, wenn der Name der Kammer
 * ihn nicht schon enthält („Unten · Tank A10, Kammer 1 von 3“). null bei einem eigenständigen Gebinde.
 */
export function tankZusatz(b: MitTank): string | null {
  if (!b.tank_id || !b.kammer_nr) return null
  const kammer = `Kammer ${b.kammer_nr}${b.tank_kammern && b.kammer_nr <= b.tank_kammern ? ` von ${b.tank_kammern}` : ''}`
  const tank = (b.tank_name ?? '').trim()
  if (!tank || b.name.trim().toLocaleLowerCase('de').startsWith(tank.toLocaleLowerCase('de'))) return kammer
  return `Geteilter Tank ${tank}, ${kammer}`
}

export type TankBlock<Z> = { id: string; name: string; kammern: Z[]; volumen: number; anzahl: number }

/**
 * Teilt Gebinde in eigenständige und Tanks mit ihren Kammern. Die Kammern stehen von oben nach unten (höchste Nummer
 * zuerst) – so liegt in einer Liste die unterste Kammer unten, wie im Keller. Tanks nach Name (a1, a2, a10 …).
 * `anzahl` = Kammern des Tanks insgesamt (bei einer Kellergemeinschaft sieht der Partner nur die freigegebenen).
 */
export function nachTank<Z extends MitTank & { volumen_liter?: number | null }>(zeilen: readonly Z[]): { einzeln: Z[]; tanks: TankBlock<Z>[] } {
  const einzeln: Z[] = []
  const je = new Map<string, TankBlock<Z>>()
  for (const z of zeilen) {
    if (!z.tank_id) { einzeln.push(z); continue }
    let t = je.get(z.tank_id)
    if (!t) { t = { id: z.tank_id, name: (z.tank_name ?? '').trim() || 'Tank', kammern: [], volumen: 0, anzahl: 0 }; je.set(z.tank_id, t) }
    t.kammern.push(z)
    t.volumen += z.volumen_liter ?? 0
    t.anzahl = Math.max(t.anzahl, z.tank_kammern ?? 0)
  }
  const tanks = [...je.values()]
  for (const t of tanks) {
    t.kammern.sort((a, b) => (b.kammer_nr ?? 0) - (a.kammer_nr ?? 0))
    t.anzahl = Math.max(t.anzahl, t.kammern.length)
  }
  tanks.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }))
  return { einzeln, tanks }
}

/** KAN-468: Stand einer Mehrfachauswahl (z. B. die belegten Kammern eines geteilten Tanks in der Sammelmaßnahme) */
export type AuswahlStand = 'alle' | 'teil' | 'keine'
export function auswahlStand(ids: readonly string[], gewaehlt: ReadonlySet<string>): AuswahlStand {
  const n = ids.filter(id => gewaehlt.has(id)).length
  return n === 0 ? 'keine' : n === ids.length ? 'alle' : 'teil'
}

/** Pfad zur Sammelmaßnahme mit den belegten Kammern eines geteilten Tanks als Vorauswahl */
export const tankSammelPfad = (tankId: string): string => `/kellerbuch/sammelbehandlung?tank=${encodeURIComponent(tankId)}`

/**
 * KAN-468 (Sichtprüfung 16.11.2026): Ziel des Knopfs „Behandlung für alle Kammern“. Die Sammelmaßnahme verlangt mindestens
 * zwei Gebinde – ist nur eine Kammer belegt, führt der Knopf zur Kellerbehandlung dieser Kammer; ohne belegte Kammer
 * gibt es kein Ziel (null).
 */
export function tankBehandlungZiel(tankId: string, belegteKammerIds: readonly string[]): { href: string; text: string; sammel: boolean } | null {
  if (belegteKammerIds.length === 0) return null
  if (belegteKammerIds.length === 1) return { href: `/kellerbuch/behaelter/${belegteKammerIds[0]}/behandlungen`, text: 'Behandlung für die belegte Kammer', sammel: false }
  return { href: tankSammelPfad(tankId), text: 'Behandlung für alle Kammern', sammel: true }
}
export const TANK_OHNE_BELEGTE_KAMMER = 'Keine belegte Kammer – eine Kellerbehandlung braucht Wein im Gebinde'

/** Meldung der Datenbank (RPC s112_tank_anlegen bzw. Trigger, HINT tank_…) lesbar durchreichen; sonst null */
export function tankDbFehler(error: unknown): string | null {
  const e = error as { code?: string; message?: string; hint?: string } | null
  if (!e) return null
  if (/^tank_/.test(String(e.hint ?? ''))) return String(e.message ?? '')
  if (e.code === '23505' && /gebinde_tanks_name_je_betrieb/.test(String(e.message ?? ''))) return 'Einen geteilten Tank mit diesem Namen gibt es in diesem Betrieb schon.'
  if (e.code === '23505' && /behaelter_name_je_betrieb/.test(String(e.message ?? ''))) return 'Ein Gebinde mit einem dieser Namen gibt es in diesem Betrieb schon – die Bezeichnung muss eindeutig sein.'
  return null
}
