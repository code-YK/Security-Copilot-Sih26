'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet'

// Plain OpenStreetMap tiles (keyless). The dark theme gets its night look
// from a CSS filter on the tile pane only (see globals.css), so the pin and
// tooltip keep their real colours.
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

// A div marker so the origin pin is drawn by our CSS (pulsing ring, tone
// colour) instead of Leaflet's default image pin.
const pin = L.divIcon({
  className: 'origin-pin',
  html: '<span class="origin-pin-pulse"></span><span class="origin-pin-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

export default function OriginMap({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  return (
    <MapContainer center={[lat, lon]} zoom={4} className="leaflet-origin" scrollWheelZoom={false} attributionControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url={TILES} />
      <Marker position={[lat, lon]} icon={pin}>
        <Tooltip direction="top" offset={[0, -10]} permanent className="origin-tooltip">
          {label}
        </Tooltip>
      </Marker>
    </MapContainer>
  )
}
