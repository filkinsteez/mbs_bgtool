import type { Metadata } from 'next'
import localFont from 'next/font/local'
import '@/styles/globals.css'
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
    'Generate static Meta backgrounds with approved Color Packs, presets, 2D and 3D framing, and 4K export.',
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
      </body>
    </html>
  )
}
