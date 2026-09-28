/**
 * The Security Copilot mark: an eye whose iris is a lens aperture — the
 * product watches inboxes, and it's Team Red Eye's build. `active` puts it
 * to work: the aperture ring turns and a scan line sweeps the eye, so the
 * logo itself becomes the "agent is investigating" indicator wherever it
 * appears (the shell, the scan theatre).
 */
export function BrandMark({ size = 30, active = false, className = '' }: { size?: number; active?: boolean; className?: string }) {
  return (
    <svg
      className={`brand-mark ${active ? 'is-active' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="bm-eye">
          <path d="M2.5 16C7 8.6 12 6.5 16 6.5S25 8.6 29.5 16C25 23.4 20 25.5 16 25.5S7 23.4 2.5 16Z" />
        </clipPath>
      </defs>
      <path
        className="bm-lid"
        d="M2.5 16C7 8.6 12 6.5 16 6.5S25 8.6 29.5 16C25 23.4 20 25.5 16 25.5S7 23.4 2.5 16Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <g clipPath="url(#bm-eye)">
        <rect className="bm-scan" x="0" y="15.4" width="32" height="1.2" />
      </g>
      <circle className="bm-ring" cx="16" cy="16" r="6.2" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3.2 1.9" />
      <circle className="bm-pupil" cx="16" cy="16" r="2.5" />
    </svg>
  )
}
