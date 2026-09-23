'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PASSWORT_MIN, pruefePasswort, passwortFehlerText } from '@/lib/auth/passwort'
import { Check, X, KeyRound } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function ProfilPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [telefon, setTelefon]   = useState('')
  const [mailBenachr, setMailBenachr] = useState(true)
  const [email, setEmail]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [erfolg, setErfolg]     = useState(false)
  const [fehler, setFehler]     = useState('')
  const [laden, setLaden]       = useState(true)

  useEffect(() => {
    fetch('/api/profil').then(r => r.json()).then(d => {
      setFullName(d.profil?.full_name ?? '')
      setTelefon(d.profil?.telefon   ?? '')
      setMailBenachr(d.profil?.benachrichtigung_email !== false)
      // Email aus Supabase Auth
      fetch('/api/auth/me').then(r => r.json()).then(u => setEmail(u.email ?? '')).catch(() => {})
      setLaden(false)
    })
  }, [])

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFehler('')
    try {
      // full_name bewusst NICHT mitschicken: der Name wird seit 7.8.2026
      // zentral von der Administration (Mandant > Benutzer) gepflegt, nicht
      // mehr selbst hier - siehe /api/profil (POST ignoriert full_name ohnehin).
      const res = await fetch('/api/profil', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefon, benachrichtigung_email: mailBenachr }),
      })
      const json = await res.json()
      if (!res.ok || json.fehler) {
        setFehler(json.fehler ?? `Fehler ${res.status}`)
      } else {
        setErfolg(true)
        setTimeout(() => setErfolg(false), 3000)
        router.refresh()
      }
    } catch (err) {
      setFehler('Netzwerkfehler')
    }
    setSaving(false)
  }

  // ── Passwort ändern (Rückmeldung 4.9.2026: bisher nur über "Passwort
  // vergessen" bzw. Einladungslink möglich). Das aktuelle Passwort wird über
  // eine erneute Anmeldung geprüft, dann setzt updateUser() das neue. Nutzer
  // mit Microsoft-365-Login haben kein Passwort - für sie greift der Hinweis.
  const [pwAlt, setPwAlt]       = useState('')
  const [pwNeu, setPwNeu]       = useState('')
  const [pwNeu2, setPwNeu2]     = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwErfolg, setPwErfolg] = useState(false)
  const [pwFehler, setPwFehler] = useState('')

  async function passwortAendern(e: React.FormEvent) {
    e.preventDefault()
    setPwFehler(''); setPwErfolg(false)
    { const f = pruefePasswort(pwNeu); if (f) { setPwFehler(f); return } }
    if (pwNeu !== pwNeu2)  { setPwFehler('Die Wiederholung stimmt nicht mit dem neuen Passwort überein.'); return }
    if (pwNeu === pwAlt)   { setPwFehler('Das neue Passwort muss sich vom aktuellen unterscheiden.'); return }
    setPwSaving(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password: pwAlt })
      if (loginErr) {
        setPwFehler(/invalid/i.test(loginErr.message)
          ? 'Das aktuelle Passwort ist nicht richtig.'
          : `Prüfung fehlgeschlagen: ${loginErr.message}`)
        return
      }
      const { error } = await supabase.auth.updateUser({ password: pwNeu })
      if (error) { setPwFehler(passwortFehlerText(error)); return }
      setPwAlt(''); setPwNeu(''); setPwNeu2('')
      setPwErfolg(true)
      setTimeout(() => setPwErfolg(false), 4000)
    } catch {
      setPwFehler('Netzwerkfehler')
    } finally {
      setPwSaving(false)
    }
  }

  if (laden) return <div className="p-8 text-s112-muted text-sm">Laden…</div>

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold text-s112-text mb-6">Mein Profil</h1>
      <div className="bg-white rounded-xl border border-s112-border p-6">
        <form onSubmit={speichern} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail (nicht änderbar)</label>
            <input aria-label="E-Mail (nicht änderbar)" value={email} disabled className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm bg-s112-bg text-s112-muted" />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Vollständiger Name (nicht änderbar)</label>
            <input aria-label="Vollständiger Name (nicht änderbar)" value={fullName || '–'} disabled
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm bg-s112-bg text-s112-muted" />
            <p className="text-[11px] text-s112-tertiary mt-0.5">Wird vom Administrator verwaltet (Admin &gt; Mandant &gt; Benutzer).</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Telefon</label>
            <input aria-label="Telefon" value={telefon} onChange={e => setTelefon(e.target.value)} placeholder="+43 664 …"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={mailBenachr} onChange={e => setMailBenachr(e.target.checked)} className="accent-s112-teal mt-0.5" />
            <span className="text-sm text-s112-text-1">
              E-Mail-Benachrichtigungen
              <span className="block text-[11px] text-s112-tertiary">Wenn mir eine Aufgabe oder ein Termin zugewiesen wird, etwas für alle gilt oder ich mit @Name erwähnt werde. Die Glocke in der Kopfleiste zeigt es in jedem Fall.</span>
            </span>
          </label>
          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
              {saving ? 'Speichern…' : 'Profil speichern'}
            </button>
            {erfolg && <p className="text-sm text-s112-ok-fg inline-flex items-center gap-1"><Check size={14} strokeWidth={2.25} />Gespeichert</p>}
            {fehler && <p className="text-sm text-s112-err-fg inline-flex items-center gap-1"><X size={14} strokeWidth={2.25} />{fehler}</p>}
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-s112-border p-6 mt-6">
        <h2 className="text-base font-semibold text-s112-text mb-1">Zwei-Faktor-Anmeldung</h2>
        <p className="text-sm text-s112-text-2 mb-3">Zusätzlich zum Passwort ein Code aus einer Authenticator-App auf dem Handy. Für Administratoren Pflicht, für alle anderen empfohlen.</p>
        <a href="/zwei-faktor" className="inline-block bg-s112-teal text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90">Einrichten oder verwalten</a>
      </div>

      <div className="bg-white rounded-xl border border-s112-border p-6 mt-6">
        <h2 className="font-semibold text-s112-text mb-1 inline-flex items-center gap-2"><KeyRound size={16} strokeWidth={1.75} />Passwort ändern</h2>
        <p className="text-xs text-s112-muted mb-4">
          Mindestens 12 Zeichen mit Buchstaben und Ziffern; aus Datenlecks bekannte Passwörter werden abgelehnt. Wenn du dich mit Microsoft 365 anmeldest, hast du hier kein Passwort – dann verwaltest du es bei Microsoft.
        </p>
        <form onSubmit={passwortAendern} className="space-y-4" autoComplete="off">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Aktuelles Passwort</label>
            <input aria-label="Aktuelles Passwort" type="password" value={pwAlt} onChange={e => setPwAlt(e.target.value)} required autoComplete="current-password"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Neues Passwort</label>
              <input aria-label="Neues Passwort" type="password" value={pwNeu} onChange={e => setPwNeu(e.target.value)} required minLength={PASSWORT_MIN} autoComplete="new-password" placeholder={`Min. ${PASSWORT_MIN} Zeichen, Buchstaben und Ziffern`}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Neues Passwort wiederholen</label>
              <input aria-label="Neues Passwort wiederholen" type="password" value={pwNeu2} onChange={e => setPwNeu2(e.target.value)} required minLength={PASSWORT_MIN} autoComplete="new-password"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={pwSaving || !pwAlt || !pwNeu || !pwNeu2}
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
              {pwSaving ? 'Wird geändert…' : 'Passwort ändern'}
            </button>
            {pwErfolg && <p className="text-sm text-s112-ok-fg inline-flex items-center gap-1"><Check size={14} strokeWidth={2.25} />Passwort geändert</p>}
            {pwFehler && <p className="text-sm text-s112-err-fg inline-flex items-center gap-1"><X size={14} strokeWidth={2.25} />{pwFehler}</p>}
          </div>
        </form>
      </div>
    </div>
  )
}
