import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { DialRoot } from 'dialkit'
import 'dialkit/styles.css'
import '@/styles/globals.css'
import '@/styles/editor.css'
import '@/styles/lab.css'

// Optimistic is the whole type system: one variable family carrying
// weight (300..800), width (80..100), italic and DRKM.
const optimistic = localFont({
  src: '../fonts/OptimisticVF.ttf',
  variable: '--font-optimistic',
  display: 'swap',
  weight: '300 800',
})

export const metadata: Metadata = {
  title: 'MBS Background Generator',
  description:
    'Generate Meta background Looks with approved color packs, framing, material, motion preview, and export controls.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={optimistic.variable}>
      <body>
        {children}
        <DialRoot />
      </body>
    </html>
  )
}
