// THE ROUTE ORB. One route, drawn as the network sees it: your clinic in the middle of a slowly
// turning orb of small, same-size dots, and each stop placed around it by its real direction
// from the clinic. The orb is sized to hold five stops comfortably. A ten-stop route makes it
// grow to fit, in three even beats rather than one jump, and the stops arrive after it settles.
//
// The canvas is decoration plus pointer targets. Everything it shows is also in the stop list
// the parent renders beside it, which is where keyboard and screen-reader users read the route.
import { useEffect, useRef } from 'react';
import type { FieldStop } from '../data/field-data';
import { orbLayout } from './lib/field-math';

const DOTS = 1500;            // particles on the sphere
const DOT = 0.95;             // every dot the same radius, in CSS pixels
const FIT5 = 0.6;             // orb radius as a share of half the box, holding five stops
const FIT10 = 0.86;           // the same, holding ten
const BEAT = 340, REST = 140; // one expansion beat, and the pause after it (ms)
const COLORS = { phthalo: [18, 63, 49], lit: [31, 106, 82], rose: '#BD7189', ink: '#1C3A2C', joined: '#1F6A52', follow: '#B8903F', none: '#8A9A8F', pending: '#1C3A2C' };

type Props = { clinic: { lat: number; lng: number }; stops: FieldStop[]; activeId: string | null; onHover: (id: string | null) => void; onSelect: (id: string) => void; label: string };

export default function RouteOrb({ clinic, stops, activeId, onHover, onSelect, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ stops, activeId, onHover, onSelect, clinic });
  live.current = { stops, activeId, onHover, onSelect, clinic };
  // Animation state survives re-renders: the radius eases from wherever it is now.
  const anim = useRef({ scale: stops.length > 5 ? FIT10 : FIT5, from: FIT5, to: FIT5, beatStart: 0, beats: 0, appear: 0, routeKey: '' });

  useEffect(() => {
    const target = stops.length > 5 ? FIT10 : FIT5;
    const a = anim.current;
    const key = stops.map(s => s.id).join('|');
    if (key === a.routeKey) return;
    a.routeKey = key;
    a.from = a.scale; a.to = target; a.beatStart = performance.now(); a.beats = Math.abs(target - a.scale) > 0.01 ? 3 : 0; a.appear = performance.now() + (a.beats ? 3 * (BEAT + REST) : 0);
  }, [stops]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    // A Fibonacci sphere: evenly spread points, so the orb has no seams or bald patches.
    const pts = Array.from({ length: DOTS }, (_, i) => {
      const y = 1 - (i / (DOTS - 1)) * 2, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5));
      return [Math.cos(t) * r, y, Math.sin(t) * r];
    });
    let w = 0, h = 0, dpr = 1, frame = 0, spin = 0, last = performance.now(), visible = true;
    let hits: Array<{ id: string; x: number; y: number }> = [];
    const size = () => {
      const box = el.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      w = box.width; h = box.height; el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
    };
    const ease = (t: number) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }; // a soft overshoot

    function radiusNow(now: number) {
      const a = anim.current;
      if (!a.beats || reduce.matches) { a.scale = a.to; return a.scale; }
      const step = (a.to - a.from) / a.beats, elapsed = now - a.beatStart, period = BEAT + REST;
      const beat = Math.min(a.beats, Math.floor(elapsed / period));
      if (beat >= a.beats) { a.scale = a.to; a.beats = 0; return a.scale; }
      const t = Math.min(1, (elapsed - beat * period) / BEAT);
      a.scale = a.from + step * beat + step * ease(t);
      return a.scale;
    }

    function draw(now: number) {
      const { stops: route, activeId: active } = live.current;
      const dt = Math.min(64, now - last); last = now;
      if (!reduce.matches) spin += dt * 0.00009;
      const cx = w / 2, cy = h / 2, half = Math.min(w, h) / 2;
      const breathe = reduce.matches ? 1 : 1 + Math.sin(now / 1400) * 0.008;
      const R = half * radiusNow(now) * breathe;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // The orb. Depth is shown by opacity alone; every dot is the same size.
      const cos = Math.cos(spin), sin = Math.sin(spin), tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
      for (const [x0, y0, z0] of pts) {
        const x = x0 * cos - z0 * sin, z1 = x0 * sin + z0 * cos;
        const y = y0 * ct - z1 * st, z = y0 * st + z1 * ct;
        const depth = (z + 1) / 2;
        const c = depth > 0.55 ? COLORS.lit : COLORS.phthalo;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.08 + depth * 0.5).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(cx + x * R, cy + y * R, DOT, 0, Math.PI * 2); ctx.fill();
      }

      // The route: clinic, then each stop in order.
      const shown = Math.max(0, Math.min(route.length, Math.floor((now - anim.current.appear) / 120) + 1));
      const laid = orbLayout(live.current.clinic, route).map(p => ({ ...p, px: cx + p.x * R * 0.92, py: cy + p.y * R * 0.92 }));
      const path = [{ px: cx, py: cy }, ...laid.slice(0, shown)];
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(28,58,44,.42)'; ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = reduce.matches ? 0 : -now / 60;
      ctx.beginPath(); path.forEach((p, i) => i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py)); ctx.stroke(); ctx.setLineDash([]);

      // The clinic.
      ctx.fillStyle = 'rgba(189,113,137,.18)'; ctx.beginPath(); ctx.arc(cx, cy, 15 + Math.sin(now / 700) * (reduce.matches ? 0 : 1.5), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLORS.rose; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();

      // The stops.
      hits = [];
      const boxes: Array<[number, number, number, number]> = [];
      const clash = (b: [number, number, number, number]) => boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
      ctx.textBaseline = 'middle';
      laid.slice(0, shown).forEach(({ px, py }) => boxes.push([px - 15, py - 15, px + 15, py + 15]));
      laid.slice(0, shown).forEach(({ stop, px, py, x }, index) => {
        const on = stop.id === active;
        const ring = stop.outcome === 'joined' ? COLORS.joined : stop.outcome === 'follow-up' ? COLORS.follow : stop.outcome === 'pending' ? COLORS.pending : COLORS.none;
        const r = on ? 13 : 11;
        ctx.fillStyle = 'rgba(243,246,242,.92)'; ctx.beginPath(); ctx.arc(px, py, r + 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.strokeStyle = ring; ctx.lineWidth = on ? 3 : 2;
        if (stop.outcome === 'pending') ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COLORS.ink; ctx.font = `600 ${on ? 12 : 11}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(String(index + 1), px, py + 0.5);
        // Narrow screens show pin numbers only, plus the hovered stop's name; the stop list
        // beside the orb carries every name. Labels point away from the clinic, flip if they
        // would sit on another label or leave the canvas, and are trimmed to the room they have.
        if (w < 520 && !on) { hits.push({ id: stop.id, x: px, y: py }); return; }
        ctx.font = `${on ? 600 : 500} 11.5px Inter, system-ui, sans-serif`;
        const room = (side: boolean) => side ? w - (px + r + 10) : px - r - 10;
        let right = x >= 0;
        let text = stop.name.length > 22 ? stop.name.slice(0, 21) + '…' : stop.name;
        if (ctx.measureText(text).width > room(right) && room(!right) > room(right)) right = !right;
        while (text.length > 4 && ctx.measureText(text).width > room(right)) text = text.slice(0, -2).trimEnd() + '…';
        const tw = ctx.measureText(text).width;
        const rect = (side: boolean): [number, number, number, number] => { const tx = px + (side ? r + 7 : -(r + 7)); return side ? [tx - 3, py - 9, tx + tw + 3, py + 9] : [tx - tw - 3, py - 9, tx + 3, py + 9]; };
        if (clash(rect(right)) && !clash(rect(!right)) && tw <= room(!right)) right = !right;
        const box = rect(right);
        if (on || !clash(box)) {
          boxes.push(box);
          ctx.textAlign = right ? 'left' : 'right';
          const tx = px + (right ? r + 7 : -(r + 7));
          ctx.fillStyle = 'rgba(243,246,242,.86)'; ctx.fillRect(box[0], box[1], box[2] - box[0], 18);
          ctx.fillStyle = on ? COLORS.ink : '#3D5748'; ctx.fillText(text, tx, py + 0.5);
        }
        hits.push({ id: stop.id, x: px, y: py });
      });
    }
    const loop = (now: number) => { if (visible) draw(now); frame = requestAnimationFrame(loop); };
    const pick = (event: PointerEvent) => {
      const box = el.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      return hits.find(p => Math.hypot(p.x - x, p.y - y) < 18)?.id ?? null;
    };
    const move = (event: PointerEvent) => { const id = pick(event); el.style.cursor = id ? 'pointer' : 'default'; live.current.onHover(id); };
    const click = (event: PointerEvent) => { const id = pick(event); if (id) live.current.onSelect(id); };
    const leave = () => live.current.onHover(null);
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    size(); io.observe(el);
    const ro = new ResizeObserver(size); ro.observe(el);
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', click); el.addEventListener('pointerleave', leave);
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); io.disconnect(); ro.disconnect(); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', click); el.removeEventListener('pointerleave', leave); };
  }, []);

  return <canvas ref={canvas} className="route-orb" role="img" aria-label={label}/>;
}
