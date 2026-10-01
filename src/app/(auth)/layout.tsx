import SwCacheLeeren from '@/components/pwa/SwCacheLeeren'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      {/* KAN-180: Login (nach jedem Abmelden) und Betrieb wählen leeren den Cache des Service Workers */}
      <SwCacheLeeren />
      {children}
    </div>
  )
}
