import type { Metadata } from 'next'
import "./globals.css"

export const metadata: Metadata = {
  title: 'SmartSpot — AI Hotspot Editor',
  description: 'AI-powered interactive image hotspot engine for Sitecore XM Cloud Page Builder',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
