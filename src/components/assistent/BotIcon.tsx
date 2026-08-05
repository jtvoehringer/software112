// Eigenes Icon für bot:112 (Doppel-Sparkle-Motiv) statt des generischen
// lucide-react "Bot"-Icons – angelehnt an eine vom Nutzer vorgegebene
// Referenz (offener Ring + Sparkle), aber bewusst auf ein reines
// Doppel-Sparkle-Motiv reduziert, weil der offene Ring bei den tatsächlich
// genutzten Größen (18–22px in Sidebar/Chat-Widget) unscharf/generisch wirkt.
// API bewusst kompatibel zu lucide-react-Icons gehalten (size/className-Props,
// currentColor), damit es 1:1 als Ersatz für <Bot .../> eingesetzt werden kann.
import type { SVGProps } from 'react'

export function BotIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M 9.5 7.6 C 10.3 12.2 10.3 12.2 14.9 13 C 10.3 13.8 10.3 13.8 9.5 18.4 C 8.69 13.8 8.69 13.8 4.1 13 C 8.69 12.2 8.69 12.2 9.5 7.6 Z"
        fill="currentColor"
      />
      <path
        d="M 17.3 5.0 C 17.8 7.55 17.8 7.55 20.3 8 C 17.8 8.45 17.8 8.45 17.3 11.0 C 16.9 8.45 16.9 8.45 14.3 8 C 16.9 7.55 16.9 7.55 17.3 5.0 Z"
        fill="currentColor"
      />
    </svg>
  )
}
