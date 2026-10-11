/**
 * The Ace wordmark (public/brand/ace-wordmark.svg), inline so it takes the text colour.
 * Decorative: the link around it carries the name ("Ace home").
 */
export function Logo({ className = 'h-[15px]' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 648 150"
      className={`w-auto text-text ${className}`}
      fill="currentColor"
    >
      <path d="M0,150 L96,0 L124,0 L220,150 L182,150 L110,37 L38,150 Z M422,0 H324 A75,75 0 0 0 324,150 H422 V113 H324 A38,38 0 0 1 324,37 H422 Z M485,0 H648 V37 H521 V60 H626 V88 H521 V113 H648 V150 H485 Z" />
    </svg>
  );
}
