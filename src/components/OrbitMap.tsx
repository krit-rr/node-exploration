'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { layerForDistance, ringDistance, RING_EDGE, type OrbitLayout, type OrbitMove, type OrbitPoint } from '@/utils/orbit';

const SIZE = 640;
const CENTER = SIZE / 2;
/** Pixels per unit of distance; the 150-ring and the band beyond it stay inside the frame. */
const SCALE = 290;
const RING_LABELS = ['5', '15', '50', '150'];
const INK = '#1E1E3F';
const DOT = '#4B4BA6';
const COLD = '#D97706';

interface Props {
  layout: OrbitLayout;
  selected: string | null;
  onSelect: (email: string | null) => void;
  /** A dot dropped on a ring: where the user wants this person. Past the last ring clears it. */
  onIntent: (email: string, layer: 1 | 2 | 3 | 4 | null) => void;
  /** Replaying the past: dots can be selected but not moved. */
  readOnly?: boolean;
  /** This week's ring moves: a trail from where activity had someone to where it has them now. */
  moves?: OrbitMove[];
  /** Introductions worth making: a faint arc between the two people. */
  arcs?: { a: string; b: string; title: string }[];
}

type Drag = { email: string; startX: number; startY: number; x: number; y: number; moved: boolean };

function toSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return { x: ((clientX - rect.left) / rect.width) * SIZE, y: ((clientY - rect.top) / rect.height) * SIZE };
}

function polar(distance: number, angle: number): { x: number; y: number } {
  return { x: CENTER + distance * SCALE * Math.cos(angle), y: CENTER + distance * SCALE * Math.sin(angle) };
}

function distanceFromCenter(x: number, y: number): number {
  return Math.hypot(x - CENTER, y - CENTER) / SCALE;
}

/**
 * Contacts as points in orbit. Distance is modelled closeness; a drag
 * inward or outward says where the person should be, and that intent is
 * drawn as a hollow marker joined to the dot by a dashed trail.
 */
export default function OrbitMap({ layout, selected, onSelect, onIntent, readOnly = false, moves = [], arcs = [] }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const startDrag = (point: OrbitPoint) => (event: ReactPointerEvent<SVGCircleElement>) => {
    const svg = svgRef.current;
    if (!svg || readOnly) return;
    event.preventDefault();
    const p = toSvg(svg, event.clientX, event.clientY);
    svg.setPointerCapture(event.pointerId);
    setDrag({ email: point.email, startX: p.x, startY: p.y, x: p.x, y: p.y, moved: false });
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || !drag || !svgRef.current) return;
    const p = toSvg(svgRef.current, event.clientX, event.clientY);
    const moved = drag.moved || Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4;
    setDrag({ ...drag, x: p.x, y: p.y, moved });
  };

  const end = () => {
    if (!drag) return;
    if (drag.moved) onIntent(drag.email, layerForDistance(distanceFromCenter(drag.x, drag.y)));
    else onSelect(selected === drag.email ? null : drag.email);
    setDrag(null);
  };

  const dropLayer = drag?.moved ? layerForDistance(distanceFromCenter(drag.x, drag.y)) : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="w-full h-auto max-h-[80vh] select-none touch-none"
      role="img"
      aria-label="Your network as orbits around you; distance is closeness"
      onPointerDown={event => { if (event.target === svgRef.current) onSelect(null); }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => setDrag(null)}
    >
      {RING_EDGE.slice(0, 4).map((edge, i) => {
        const r = edge * SCALE;
        const active = dropLayer === i + 1;
        return (
          <g key={edge}>
            <circle
              cx={CENTER} cy={CENTER} r={r}
              fill={active ? INK : 'none'} fillOpacity={active ? 0.04 : 0}
              stroke={active ? INK : '#E5E7EB'} strokeWidth={active ? 1.5 : 1}
            />
            <text x={CENTER} y={CENTER - r - 6} textAnchor="middle" fontSize="11" fill="#9CA3AF">
              {RING_LABELS[i]}
            </text>
          </g>
        );
      })}
      {drag?.moved && dropLayer === null && (
        <circle cx={CENTER} cy={CENTER} r={RING_EDGE[4] * SCALE} fill="none" stroke={INK} strokeOpacity="0.3" strokeDasharray="4 4" />
      )}

      {arcs.map(arc => {
        const a = layout.points.find(p => p.email === arc.a);
        const b = layout.points.find(p => p.email === arc.b);
        if (!a || !b) return null;
        const from = polar(a.distance, a.angle);
        const to = polar(b.distance, b.angle);
        // A curve bowed toward the centre reads as a bridge across the map, not a straight edge.
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const control = { x: mid.x + (CENTER - mid.x) * 0.35, y: mid.y + (CENTER - mid.y) * 0.35 };
        const d = `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`;
        return (
          <g key={`arc-${arc.a}-${arc.b}`}>
            <path d={d} fill="none" stroke={INK} strokeOpacity="0.28" strokeWidth="1.2" strokeDasharray="2 4" pointerEvents="none" />
            <path d={d} fill="none" stroke="transparent" strokeWidth="8">
              <title>{arc.title}</title>
            </path>
          </g>
        );
      })}

      {moves.map(move => {
        const point = layout.points.find(p => p.email === move.email);
        if (!point) return null;
        const from = polar(move.fromDistance, move.angle);
        const to = polar(point.distance, point.angle);
        const outward = move.to > move.from;
        return (
          <g key={`move-${move.email}`} pointerEvents="none">
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={outward ? COLD : DOT} strokeOpacity="0.55" strokeWidth="1.5" />
            <circle cx={from.x} cy={from.y} r="2.5" fill="none" stroke={outward ? COLD : DOT} strokeOpacity="0.55" />
          </g>
        );
      })}

      {layout.points.filter(p => p.intendedLayer).map(p => {
        const dot = polar(p.distance, p.angle);
        const marker = polar(ringDistance(p.intendedLayer!), p.angle);
        return (
          <g key={`intent-${p.email}`} pointerEvents="none">
            <line x1={dot.x} y1={dot.y} x2={marker.x} y2={marker.y} stroke={INK} strokeOpacity="0.35" strokeDasharray="3 3" />
            <circle cx={marker.x} cy={marker.y} r="5" fill="none" stroke={INK} strokeOpacity="0.6" strokeWidth="1.5" />
          </g>
        );
      })}

      {layout.points.map(p => {
        const dragging = drag?.email === p.email && drag.moved;
        const pos = dragging && drag ? { x: drag.x, y: drag.y } : polar(p.distance, p.angle);
        const emphasized = selected === p.email || hovered === p.email || dragging;
        const r = (p.layer === 1 ? 5.5 : p.layer === 5 ? 3 : 4.5) + (emphasized ? 2 : 0);
        const opacity = p.goingCold ? 0.9 : p.layer === 5 ? 0.3 : 0.45 + 0.55 * p.closeness;
        return (
          <circle
            key={p.email}
            cx={pos.x} cy={pos.y} r={r}
            fill={p.goingCold ? COLD : DOT} fillOpacity={opacity}
            stroke={selected === p.email || p.priority ? INK : 'none'} strokeWidth={selected === p.email ? 2 : 1.5}
            className={readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}
            style={dragging ? undefined : { transition: 'cx 350ms ease, cy 350ms ease' }}
            onPointerDown={readOnly ? undefined : startDrag(p)}
            onClick={readOnly ? () => onSelect(selected === p.email ? null : p.email) : undefined}
            onMouseEnter={() => setHovered(p.email)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{p.contact.company ? `${p.contact.name} · ${p.contact.company}` : p.contact.name}</title>
          </circle>
        );
      })}

      <circle cx={CENTER} cy={CENTER} r="6" fill={INK} />
      <text x={CENTER} y={CENTER + 20} textAnchor="middle" fontSize="11" fill="#6B7280">you</text>
    </svg>
  );
}
