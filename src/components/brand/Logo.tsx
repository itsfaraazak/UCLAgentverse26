/**
 * The SigmaFold mark and lockup.
 *
 * The mark is a Greek capital sigma drawn as a folded ribbon. Sigma is already
 * a folded form — two arms meeting at a crease — so the mark *is* the name
 * rather than an illustration of it, and the wordmark only has to carry
 * "Fold".
 *
 * The green is fixed; the wordmark uses `currentColor` so it inverts with the
 * theme. Do not re-colour the mark per surface — one accent, used consistently
 * (CONVENTIONS.md §8).
 */

export interface LogoProps {
  /** Rendered height in px. Width follows the aspect ratio. */
  readonly size?: number;
  /** Mark only, no wordmark — for the favicon, a collapsed rail, an avatar. */
  readonly markOnly?: boolean;
  readonly className?: string;
  /**
   * Accessible name. Pass `null` when the logo sits next to a visible
   * "SigmaFold" label, so a screen reader does not announce it twice.
   */
  readonly title?: string | null;
}

const UPPER_ARM = 'M 93 21 L 31 21 L 64 60';
const LOWER_ARM = 'M 64 60 L 31 99 L 93 99';
const CREASE = 'M 64 60 L 52 60';

function Mark({ idPrefix }: { readonly idPrefix: string }) {
  const upper = `${idPrefix}-upper`;
  const lower = `${idPrefix}-lower`;
  return (
    <>
      <defs>
        <linearGradient id={upper} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#BBF7D0" />
          <stop offset="1" stopColor="#6EE7A0" />
        </linearGradient>
        <linearGradient id={lower} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#34D07A" />
          <stop offset="1" stopColor="#5BE08F" />
        </linearGradient>
      </defs>
      {/* the face catching the light */}
      <path
        d={UPPER_ARM}
        fill="none"
        stroke={`url(#${upper})`}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* the face turned away */}
      <path
        d={LOWER_ARM}
        fill="none"
        stroke={`url(#${lower})`}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* the crease */}
      <path
        d={CREASE}
        fill="none"
        stroke="#0B3B22"
        strokeOpacity={0.22}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </>
  );
}

export function Logo({ size = 28, markOnly = false, className, title = 'SigmaFold' }: LogoProps) {
  // Gradient ids must be unique per instance or a second logo on the page
  // reuses the first one's defs.
  const idPrefix = markOnly ? 'sf-mark' : 'sf-lockup';
  const viewBox = markOnly ? '0 0 120 120' : '0 0 440 120';
  const width = markOnly ? size : (size * 440) / 120;

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={size}
      className={className}
      role={title === null ? 'presentation' : 'img'}
      aria-label={title ?? undefined}
      aria-hidden={title === null || undefined}
    >
      {title !== null && <title>{title}</title>}
      <Mark idPrefix={idPrefix} />
      {!markOnly && (
        <text
          x={124}
          y={78}
          fontFamily="var(--font-display), Poppins, ui-sans-serif, system-ui, sans-serif"
          fontSize={62}
          fontWeight={600}
          letterSpacing={-1.5}
          fill="currentColor"
        >
          Fold
        </text>
      )}
    </svg>
  );
}
