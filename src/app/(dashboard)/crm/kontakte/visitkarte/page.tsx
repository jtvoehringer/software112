'use client'
import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, X } from 'lucide-react'
import { createLeadFromVisitkarte } from '../../actions'
import { fehlerText } from '@/lib/fehler'

type Kontakt = {
  vorname: string|null; nachname: string|null; firma: string|null
  position: string|null; email: string|null; telefon: string|null
  mobil: string|null; strasse: string|null; plz: string|null
  ort: string|null; land: string|null
}

export default function VisitkartenScannerPage() {
  const router = useRouter()
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<'start'|'camera'|'analyse'|'bestaetigen'|'speichern'>('start')
  const [videoReady, setVideoReady] = useState(false)
  const [foto, setFoto]   = useState<string | null>(null)
  const [kontakt, setKontakt] = useState<Kontakt | null>(null)
  const [fehler, setFehler]   = useState<string | null>(null)

  const kameraStarten = async () => {
    setVideoReady(false)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setFehler('Kamerazugriff wird von diesem Browser nicht unterstützt. Bitte Foto hochladen.')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      })
      streamRef.current = stream
      setPhase('camera')

      // iOS Safari: srcObject erst NACH dem Rendern setzen (Video-Element muss im DOM sein)
      await new Promise(r => setTimeout(r, 50))
      const video = videoRef.current
      if (!video) return

      // Bereit-Signal aus mehreren Events (iOS feuert nicht immer loadedmetadata)
      const markReady = () => { if (video.videoWidth > 0) setVideoReady(true) }
      video.addEventListener('loadedmetadata', markReady, { once: true })
      video.addEventListener('canplay',        markReady, { once: true })
      video.addEventListener('playing',        markReady, { once: true })
      video.srcObject = stream

      // Play explizit aufrufen (iOS-Anforderung)
      try { await video.play() } catch { /* autoPlay-Policy ignorieren */ }

      // Fallback-Polling: alle 200ms ob Dimensionen da sind (max. 5s)
      let tries = 0
      const poll = setInterval(() => {
        tries++
        if (video.videoWidth > 0) { setVideoReady(true); clearInterval(poll) }
        else if (tries >= 25)     { clearInterval(poll) }
      }, 200)

    } catch (err: unknown) {
      const msg = fehlerText(err)
      setFehler('Kamera konnte nicht geöffnet werden: ' + msg)
    }
  }

  const kameraStop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const fotografieren = () => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (!video.videoWidth || !video.videoHeight) {
      setFehler('Video ist noch nicht bereit. Bitte kurz warten und nochmal versuchen.')
      return
    }
    const MAX = 1024
    const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight))
    canvas.width  = Math.round(video.videoWidth  * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.80)
    if (!dataUrl || dataUrl === 'data:,') {
      setFehler('Foto konnte nicht aufgenommen werden. Bitte nochmal versuchen.')
      return
    }
    setFoto(dataUrl)
    kameraStop()
    analysieren(dataUrl)
  }

  const analysieren = async (dataUrl: string) => {
    setPhase('analyse')
    const base64 = dataUrl.split(',')[1]
    if (!base64) {
      setFehler('Kein Bild vorhanden – bitte Foto hochladen oder erneut fotografieren.')
      setPhase('start')
      return
    }
    try {
      const res  = await fetch('/api/visitkarte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType: 'image/jpeg' }),
      })
      const data = await res.json()
      if (data.fehler) { setFehler(data.fehler); setPhase('start'); return }
      setKontakt(data.kontakt)
      setPhase('bestaetigen')
    } catch (e) {
      setFehler(fehlerText(e)); setPhase('start')
    }
  }

  const speichern = async () => {
    if (!kontakt) return
    setPhase('speichern')
    // Anlage läuft über eine Server Action (createLeadFromVisitkarte), damit der
    // korrekt aktive Betrieb (Betrieb-Wechsler-Cookie via getCurrentMembership())
    // verwendet wird - im Browser ist dieser Cookie nicht auslesbar.
    const { kontaktId, error } = await createLeadFromVisitkarte(kontakt)
    if (kontaktId) router.push(`/crm/kontakte/${kontaktId}`)
    else { setFehler(error || 'Kontakt konnte nicht gespeichert werden'); setPhase('bestaetigen') }
  }

  const f = (v: string|null|undefined, label: string) => v ? (
    <div key={label}>
      <span className="text-xs text-s112-muted">{label}: </span>
      <span className="text-sm text-s112-text">{v}</span>
    </div>
  ) : null

  return (
    <div className="p-6 max-w-lg mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => { kameraStop(); router.back() }} className="text-s112-muted hover:text-s112-text-1 text-sm">← Zurück</button>
        <h1 className="text-xl font-semibold text-s112-text">Visitenkarte scannen</h1>
      </div>

      {fehler && (
        <div className="bg-s112-err-bg border border-s112-err/30 rounded-xl p-3 text-sm text-s112-err-fg flex justify-between">
          {fehler}
          <button aria-label="Meldung schließen" onClick={() => { setFehler(null); setPhase('start') }} className="text-s112-err hover:text-s112-err-fg"><X className="w-4 h-4" /></button>
        </div>
      )}

      {phase === 'start' && (
        <div className="bg-white rounded-xl border border-s112-border p-8 text-center space-y-4">
          <Camera className="w-12 h-12 text-s112-blue-700 mx-auto" />
          <h2 className="font-semibold text-s112-text">Visitenkarte fotografieren</h2>
          <p className="text-sm text-s112-muted">KI liest die Karte aus und legt den Kontakt als Lead an.</p>
          <button onClick={kameraStarten}
            className="bg-s112-teal text-s112-yellow px-6 py-3 rounded-xl font-semibold hover:bg-s112-teal/90 w-full">
            Kamera öffnen
          </button>
          <label className="block">
            <span className="text-xs text-s112-muted">oder Foto hochladen</span>
            <input type="file" accept="image/*" className="hidden" onChange={e => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = ev => { const url = ev.target?.result as string; setFoto(url); analysieren(url) }
              reader.readAsDataURL(file)
            }} />
          </label>
        </div>
      )}

      {phase === 'camera' && (
        <div className="space-y-3">
          <video ref={videoRef} autoPlay playsInline muted
            className="w-full rounded-xl border-2 border-s112-teal" />
          <canvas ref={canvasRef} className="hidden" />
          {!videoReady && (
            <p className="text-xs text-center text-s112-muted animate-pulse">Kamera wird gestartet…</p>
          )}
          <button onClick={fotografieren} disabled={!videoReady}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-opacity inline-flex items-center justify-center gap-2
              ${videoReady ? 'bg-s112-teal text-s112-yellow hover:bg-s112-teal/90' : 'bg-s112-line text-s112-tertiary cursor-not-allowed'}`}>
            <Camera className="w-5 h-5" /> Fotografieren
          </button>
        </div>
      )}

      {phase === 'analyse' && (
        <div className="bg-white rounded-xl border border-s112-border p-8 text-center space-y-3">
          {foto && <img src={foto} alt="Visitenkarte" className="w-full rounded-xl max-h-48 object-contain" />}
          <p className="text-sm text-s112-muted animate-pulse">KI analysiert die Visitenkarte…</p>
        </div>
      )}

      {phase === 'bestaetigen' && kontakt && (
        <div className="space-y-4">
          {foto && <img src={foto} alt="Visitenkarte" className="w-full rounded-xl max-h-32 object-contain border border-s112-border" />}
          <div className="bg-white rounded-xl border border-s112-border p-5 space-y-2">
            <h2 className="font-semibold text-s112-text mb-3">Erkannte Daten</h2>
            {f([kontakt.vorname, kontakt.nachname].filter(Boolean).join(' '), 'Name')}
            {f(kontakt.firma, 'Firma')}
            {f(kontakt.position, 'Position')}
            {f(kontakt.email, 'E-Mail')}
            {f(kontakt.telefon, 'Telefon')}
            {f(kontakt.mobil, 'Mobil')}
            {f([kontakt.strasse, kontakt.plz, kontakt.ort].filter(Boolean).join(', '), 'Adresse')}
          </div>
          <div className="flex gap-3">
            <button onClick={speichern}
              className="flex-1 bg-s112-teal text-s112-yellow py-3 rounded-xl font-semibold hover:bg-s112-teal/90">
              Als Lead speichern
            </button>
            <button onClick={() => { setFoto(null); setKontakt(null); setPhase('start') }}
              className="px-4 py-3 rounded-xl border border-s112-border text-s112-text-2 hover:bg-s112-bg text-sm">
              Nochmal
            </button>
          </div>
        </div>
      )}

      {phase === 'speichern' && (
        <div className="bg-white rounded-xl border border-s112-border p-8 text-center">
          <p className="text-sm text-s112-muted animate-pulse">Kontakt wird angelegt…</p>
        </div>
      )}
    </div>
  )
}
