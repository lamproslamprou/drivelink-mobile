// Inline SVG rather than the 🇺🇸 emoji. On Chrome/Windows — which is most of
// the traffic — the emoji renders as the letters "US" in a box, which looks
// broken on a page whose whole job is looking trustworthy.
//
// Decorative by default: aria-hidden, because the words next to it already say
// "U.S." and a screen reader announcing "flag of the United States" adds noise.
// Pass a title if it ever appears without accompanying text.

export default function USFlag({ size = 16, style, title }) {
  const h = size;
  const w = size * 1.9;

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 38 20"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      style={{ display: "inline-block", verticalAlign: "-2px", borderRadius: 2, ...style }}
    >
      {title && <title>{title}</title>}
      <rect width="38" height="20" fill="#F5F7FA" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={i * 1.538} width="38" height="1.538" fill="#B22234" />
      ))}
      <rect width="15.2" height="10.77" fill="#3C3B6E" />
      {[...Array(4)].map((_, r) =>
        [...Array(5)].map((_, c) => (
          <circle
            key={`${r}-${c}`}
            cx={1.9 + c * 3.04 + (r % 2 ? 1.52 : 0)}
            cy={1.5 + r * 2.6}
            r="0.62"
            fill="#fff"
          />
        ))
      )}
    </svg>
  );
}
