/**
 * Thin concentric orbit rings rising from below, plus one faint
 * constellation: contacts as stars, the network as the lines between
 * them. Pure decorative SVG, fixed geometry, no animation.
 */
export default function OrbitField() {
  const nodes = [
    [618, 96], [668, 148], [736, 128], [700, 210], [760, 250], [652, 262],
  ];
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      {[340, 460, 580, 700].map(r => (
        <circle key={r} cx="400" cy="860" r={r} fill="none" stroke="rgba(235,240,255,0.07)" strokeWidth="1" />
      ))}
      <polyline
        points={nodes.map(p => p.join(',')).join(' ')}
        fill="none"
        stroke="rgba(235,240,255,0.14)"
        strokeWidth="1"
      />
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 2 ? 2.4 : 1.6} fill="rgba(235,240,255,0.5)" />
      ))}
    </svg>
  );
}
