/**
 * Campus Reserve brand icon: a campus building (pediment, three columns,
 * steps). Drawn in currentColor so it takes its colour from the theme.
 *
 * The same geometry is used for the browser tab icons in src/app/icon.svg,
 * favicon.ico and apple-icon.png - keep them in step if this changes.
 */
export function CampusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2.6 21.6 7.9H2.4Z" />
      <rect x="3.4" y="8.8" width="17.2" height="1.7" rx="0.35" />
      <rect x="5.1" y="11.4" width="2.6" height="6.3" rx="0.3" />
      <rect x="10.7" y="11.4" width="2.6" height="6.3" rx="0.3" />
      <rect x="16.3" y="11.4" width="2.6" height="6.3" rx="0.3" />
      <rect x="3.4" y="18.5" width="17.2" height="1.6" rx="0.35" />
      <rect x="2.2" y="20.7" width="19.6" height="1.6" rx="0.35" />
    </svg>
  );
}
