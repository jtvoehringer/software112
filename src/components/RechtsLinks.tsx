// Links auf die öffentlichen Rechtsseiten (KAN-300): AGB, Datenschutz, Impressum, Barrierefreiheit – im Fuß von
// Anmeldung, Registrierung, Anwendung und den Rechtsseiten selbst. Alle Seiten sind ohne Anmeldung erreichbar
// (PUBLIC_ROUTES in src/proxy.ts).

export const RECHTS_SEITEN = [
  { href: '/agb', label: 'AGB' },
  { href: '/datenschutz', label: 'Datenschutz' },
  { href: '/impressum', label: 'Impressum' },
  { href: '/barrierefreiheit', label: 'Barrierefreiheit' },
] as const

export default function RechtsLinks({ className = '', trenner = ' · ' }: { className?: string; trenner?: string }) {
  return (
    <span className={className}>
      {RECHTS_SEITEN.map((s, i) => (
        <span key={s.href}>
          {i > 0 && trenner}
          <a href={s.href} className="hover:underline">{s.label}</a>
        </span>
      ))}
    </span>
  )
}
