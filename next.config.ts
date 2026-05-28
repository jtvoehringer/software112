import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Künftig: experimental.ppr für partial pre-rendering aktivieren
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',  // Multi-Tenant: beliebige externe Logo-URLs erlauben
      },
    ],
  },
}

export default nextConfig
