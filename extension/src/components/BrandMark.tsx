/**
 * The Security Copilot mark — the same eye-and-aperture glyph as the
 * dashboard (dashboard/components/BrandMark.tsx), drawn once here so the
 * popup, options page, and blocked page all share it. `active` sets the
 * aperture turning and a scan line sweeping the eye while a check runs.
 * Sizing/colour come from the `.mark` wrapper (see styles/aegis.css).
 */
export function BrandMark({ className, active = false }: { className?: string; active?: boolean }) {
  return (
    <div className={`mark ${active ? "is-active" : ""} ${className ?? ""}`}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <clipPath id="ext-bm-eye">
            <path d="M2.5 16C7 8.6 12 6.5 16 6.5S25 8.6 29.5 16C25 23.4 20 25.5 16 25.5S7 23.4 2.5 16Z" />
          </clipPath>
        </defs>
        <path
          d="M2.5 16C7 8.6 12 6.5 16 6.5S25 8.6 29.5 16C25 23.4 20 25.5 16 25.5S7 23.4 2.5 16Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <g clipPath="url(#ext-bm-eye)">
          <rect className="bm-scan" x="0" y="15.4" width="32" height="1.2" />
        </g>
        <circle className="bm-ring" cx="16" cy="16" r="6.2" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3.2 1.9" />
        <circle cx="16" cy="16" r="2.5" fill="currentColor" />
      </svg>
    </div>
  );
}
