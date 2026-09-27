// Next.js dev mode blocks cross-origin requests to its own static chunks/HMR
// websocket by default (a real security feature) — accessing the dashboard
// through a public tunnel (ngrok/cloudflared, a different origin than
// localhost) gets silently blocked without this. start_all.bash passes the
// tunnel's hostname in via NEXT_ALLOWED_DEV_ORIGIN once it knows the URL;
// this has no effect on `next build`/production, only `next dev`.
const allowedDevOrigin = process.env.NEXT_ALLOWED_DEV_ORIGIN?.trim()

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  ...(allowedDevOrigin ? { allowedDevOrigins: [allowedDevOrigin] } : {}),
}

export default nextConfig
