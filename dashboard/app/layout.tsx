import type { Metadata, Viewport } from 'next'
import { Archivo, Geist_Mono, Instrument_Serif } from 'next/font/google'
import Script from 'next/script'
import { ThemeProvider } from '@/lib/theme'
import './globals.css'

// Three voices, three jobs:
//  - Archivo (variable width + weight): the institution — UI text at normal
//    width, headlines and numbers pushed wide and heavy.
//  - Instrument Serif italic: the copilot's own voice — only ever used for
//    what the AI agent says about a case.
//  - Geist Mono: the evidence — IPs, hashes, headers, run IDs, timestamps.
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' })
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-serif', display: 'swap' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Security Copilot · Email forensic intelligence',
  description:
    'Detect, trace, attribute and report malicious email: SPF/DKIM/DMARC, origin geolocation, attachment sandboxing and campaign correlation.',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f1ea' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0b0e' },
  ],
}

// Runs before first paint: apply the saved theme so a light-theme user
// never sees one frame of dark. Kept tiny and dependency-free on purpose.
const themeBootstrap = `try{var t=localStorage.getItem('scTheme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" className={`${archivo.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
