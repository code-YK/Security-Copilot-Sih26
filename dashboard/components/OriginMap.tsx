'use client'

import 'leaflet/dist/leaflet.css'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'

export default function OriginMap({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  return (
    <MapContainer center={[lat, lon]} zoom={4} style={{ height: 260, width: '100%', borderRadius: 8 }} scrollWheelZoom={false}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <CircleMarker center={[lat, lon]} radius={9} pathOptions={{ color: '#ef4444' }}>
        <Popup>{label}</Popup>
      </CircleMarker>
    </MapContainer>
  )
}
