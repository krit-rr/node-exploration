'use client';

import { useEffect, useRef } from 'react';

/**
 * A sparse, seeded starfield on canvas: tiny dots of varying brightness,
 * a handful with a four-point sparkle, gently twinkling. Deterministic
 * (no hydration mismatch), DPR-aware, and static when the viewer prefers
 * reduced motion.
 */
export default function Starfield({ density = 0.00012 }: { density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let raf = 0;
    let stars: { x: number; y: number; r: number; base: number; phase: number; sparkle: boolean }[] = [];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Deterministic PRNG so the sky is the same on every visit
    let seed = 20261021;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { clientWidth: w, clientHeight: h } = canvas;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      seed = 20261021;
      const count = Math.round(w * h * density);
      stars = Array.from({ length: count }, () => ({
        x: rand() * w,
        y: rand() * h,
        r: 0.4 + rand() * 1.1,
        base: 0.25 + rand() * 0.65,
        phase: rand() * Math.PI * 2,
        sparkle: rand() > 0.965,
      }));
    };

    const draw = (t: number) => {
      const { clientWidth: w, clientHeight: h } = canvas;
      context.clearRect(0, 0, w, h);
      for (const star of stars) {
        const twinkle = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(t / 1600 + star.phase);
        const alpha = star.base * twinkle;
        context.fillStyle = `rgba(235, 240, 255, ${alpha})`;
        if (star.sparkle) {
          // four-point star
          const s = star.r * 5;
          context.save();
          context.translate(star.x, star.y);
          context.beginPath();
          context.moveTo(0, -s); context.quadraticCurveTo(0.6, -0.6, s, 0);
          context.quadraticCurveTo(0.6, 0.6, 0, s);
          context.quadraticCurveTo(-0.6, 0.6, -s, 0);
          context.quadraticCurveTo(-0.6, -0.6, 0, -s);
          context.fill();
          context.restore();
        } else {
          context.beginPath();
          context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
          context.fill();
        }
      }
      if (!reducedMotion) raf = requestAnimationFrame(draw);
    };

    build();
    if (reducedMotion) {
      draw(0);
    } else {
      raf = requestAnimationFrame(draw);
    }

    const onResize = () => { build(); if (reducedMotion) draw(0); };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  );
}
