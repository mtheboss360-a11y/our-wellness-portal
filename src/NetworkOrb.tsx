// THE NETWORK ORB. The Network Map's centrepiece: a big orb of small, same-size dots with your clinic
// in the middle. While the nearby businesses are being looked up the orb pulses like sonar — rings
// ripple out from the clinic, the dots light up as each wave passes, a soft sweep turns round it.
// When the results land, the network builds in front of you: each town arrives in turn, its five best
// matches pop in one by one, and every business is joined to the clinic and to its neighbours, so the
// whole thing reads as one network. Positions are a diagram (each town gets its own side of the orb),
// not a scale map; the list beside it carries the real distances and addresses.
import { useEffect, useRef } from 'react';
import type { MapBusiness, TownGroup } from './lib/network-math';

const DOTS = 2200, DOT = 1;
const BEAT = .42, DRAW = .38, POP = .36, TOWN_GAP = .35;
const C = { phthalo: [18, 63, 49], lit: '#1F6A52', rose: '#BD7189', ink: '#1C3A2C', line: 'rgba(31,106,82,', chip: '#FFFFFF', rule: '#D5E0D5' };

type Props = { loading: boolean; groups: TownGroup[]; focus: number | null; selection: string[]; onOpen: (placeId: string) => void; clinicName: string };
type Node = { business: MapBusiness; town: number; x: number; y: number; start: number };

/** Where each business sits: its town's side of the orb, or the whole ring when one town is in focus. */
function layout(groups: TownGroup[], focus: number | null) {
  const nodes: Node[] = [], towns: Array<{ name: string; x: number; y: number; start: number }> = [];
  const shown = groups.map((g, i) => ({ ...g, i })).filter(g => focus === null || g.i === focus);
  let clock = .55;
  shown.forEach((group, k) => {
    const span = focus === null ? (Math.PI * 2) / Math.max(1, shown.length) : Math.PI * 2;
    const centre = -Math.PI / 2 + k * span;
    const n = group.businesses.length;
    towns.push({ name: group.town, x: Math.cos(centre) * .97, y: Math.sin(centre) * .97, start: clock });
    clock += .28;
    group.businesses.forEach((business, j) => {
      const spread = focus === null ? span * .78 : span;
      const angle = focus === null ? centre - spread / 2 + (spread * (j + .5)) / n : centre + (span * j) / n;
      const r = focus === null ? (j % 2 ? .7 : .5) + (j === 2 ? .12 : 0) : j % 2 ? .66 : .52;
      nodes.push({ business, town: group.i, x: Math.cos(angle) * r, y: Math.sin(angle) * r, start: clock });
      clock += BEAT;
    });
    clock += TOWN_GAP;
  });
  // The web: neighbours inside a town, and each town's edge to the next town's, so it all joins up.
  const links: Array<[number, number, number]> = [];
  shown.forEach((group, k) => {
    const mine = nodes.map((node, i) => [node, i] as const).filter(([node]) => node.town === group.i);
    for (let m = 1; m < mine.length; m++) links.push([mine[m - 1][1], mine[m][1], Math.max(mine[m - 1][0].start, mine[m][0].start)]);
    if (mine.length > 2) links.push([mine[0][1], mine[2][1], mine[2][0].start]);
    const next = shown[(k + 1) % shown.length];
    if (next && next !== group) {
      const theirs = nodes.map((node, i) => [node, i] as const).filter(([node]) => node.town === next.i);
      if (mine.length && theirs.length) links.push([mine[mine.length - 1][1], theirs[0][1], Math.max(mine[mine.length - 1][0].start, theirs[0][0].start)]);
    }
  });
  return { nodes, towns, links, done: clock };
}

export default function NetworkOrb({ loading, groups, focus, selection, onOpen, clinicName }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ loading, groups, focus, selection, onOpen, clinicName });
  live.current = { loading, groups, focus, selection, onOpen, clinicName };
  const build = useRef({ key: '', startedAt: 0, plan: layout([], null) });
  const hover = useRef<string | null>(null);

  useEffect(() => {
    const key = `${focus}|${groups.map(g => g.town + ':' + g.businesses.map(b => b.placeId).join(',')).join('|')}`;
    if (key === build.current.key) return;
    build.current = { key, startedAt: performance.now(), plan: layout(groups, focus) };
  }, [groups, focus]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pts = Array.from({ length: DOTS }, (_, i) => {
      const y = 1 - (i + .5) / DOTS * 2, r = Math.sqrt(1 - y * y), t = i * 2.399963229728653;
      return [Math.cos(t) * r, y, Math.sin(t) * r, .6 + .4 * Math.sin(i * 12.9898)];
    });
    let w = 0, h = 0, dpr = 1, frame = 0, spin = 0, last = performance.now(), visible = true;
    let hits: Array<{ id: string; x: number; y: number }> = [];
    const size = () => { const b = el.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); w = b.width; h = b.height; el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); };
    const ease = (v: number) => v < .5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
    const back = (v: number) => 1 + 2.2 * Math.pow(v - 1, 3) + 1.2 * Math.pow(v - 1, 2);
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const pill = (x: number, y: number, text: string, strong: boolean, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.font = `${strong ? 700 : 600} ${strong ? 13 : 11.5}px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(text).width + 20, th = strong ? 28 : 24;
      const px = Math.max(4, Math.min(w - tw - 4, x - tw / 2)), py = Math.max(4, Math.min(h - th - 4, y - th / 2));
      ctx.fillStyle = strong ? C.ink : C.chip; ctx.strokeStyle = strong ? C.ink : C.rule; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(px, py, tw, th, th / 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = strong ? '#fff' : C.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, px + 10, py + th / 2 + .5);
    };

    function draw(now: number) {
      const { loading: busy, selection: chosen } = live.current;
      const still = reduce.matches;
      const dt = Math.min(64, now - last); last = now;
      spin += still ? 0 : dt * (busy ? .00045 : .00011);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .45;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const { plan, startedAt } = build.current;
      const t = still ? 999 : (now - startedAt) / 1000;
      const built = !busy && plan.nodes.length > 0;
      const dim = built ? clamp(t / .6) : 0;

      // The orb. While loading, a sonar wave rolls out from the clinic and lights the dots it passes.
      const wave = busy && !still ? ((now / 1300) % 1) : -1;
      const cos = Math.cos(spin), sin = Math.sin(spin), tilt = .34, ct = Math.cos(tilt), st = Math.sin(tilt);
      const sweep = busy && !still ? (now / 900) % (Math.PI * 2) : 0;
      for (const [x0, y0, z0, k] of pts) {
        const x = x0 * cos - z0 * sin, z1 = x0 * sin + z0 * cos, y = y0 * ct - z1 * st, z = y0 * st + z1 * ct;
        const depth = (z + 1) / 2;
        let glow = 0;
        if (wave >= 0) {
          glow = Math.max(0, 1 - Math.abs(Math.hypot(x, y) - wave) / .09);
          const a = Math.atan2(y, x), off = Math.atan2(Math.sin(a - sweep), Math.cos(a - sweep));
          if (off < 0 && off > -.9) glow = Math.max(glow, (1 + off / .9) * .55);
        }
        const c = glow > .2 ? [31, 106, 82] : C.phthalo;
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.globalAlpha = Math.min(1, (.1 + .55 * depth * k) * (1 - .4 * dim) + glow * .7);
        ctx.beginPath(); ctx.arc(cx + x * R, cy + y * R, DOT + glow * .6, 0, Math.PI * 2); ctx.fill();
      }
      if (busy && !still) for (let i = 0; i < 3; i++) {
        const k = ((now / 1300) + i / 3) % 1;
        ctx.strokeStyle = C.rose; ctx.lineWidth = 1.5; ctx.globalAlpha = .45 * (1 - k);
        ctx.beginPath(); ctx.arc(cx, cy, 14 + k * R, 0, Math.PI * 2); ctx.stroke();
      }

      // The network.
      hits = [];
      if (built) {
        const P = (n: Node) => [cx + n.x * R, cy + n.y * R] as const;
        // links between businesses first, faint, so the spokes and dots sit on top
        for (const [a, b, start] of plan.links) {
          const k = ease(clamp((t - start - DRAW) / .5)); if (k <= 0) continue;
          const [ax, ay] = P(plan.nodes[a]), [bx, by] = P(plan.nodes[b]);
          ctx.strokeStyle = C.line + '.28)'; ctx.globalAlpha = 1; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k); ctx.stroke();
        }
        plan.nodes.forEach((node, i) => {
          const [x, y] = P(node);
          const draw = ease(clamp((t - node.start) / DRAW)); if (draw <= 0) return;
          const tx = cx + (x - cx) * draw, ty = cy + (y - cy) * draw;
          ctx.strokeStyle = C.line + '.5)'; ctx.globalAlpha = 1; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
          if (draw < 1) { ctx.fillStyle = C.lit; ctx.beginPath(); ctx.arc(tx, ty, 3.2, 0, Math.PI * 2); ctx.fill(); return; }
          const landed = node.start + DRAW, pop = clamp((t - landed) / POP);
          const ring = clamp((t - landed) / .8);
          if (ring < 1) { ctx.strokeStyle = C.rose; ctx.lineWidth = 1.4; ctx.globalAlpha = .5 * (1 - ring); ctx.beginPath(); ctx.arc(x, y, 9 + ring * 18, 0, Math.PI * 2); ctx.stroke(); }
          const on = hover.current === node.business.placeId, picked = chosen.includes(node.business.placeId);
          const r = (on ? 10 : 8) * Math.max(.01, back(pop));
          ctx.globalAlpha = Math.min(1, pop * 2);
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = node.business.category?.color ?? C.lit; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          if (picked) { ctx.strokeStyle = C.rose; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke(); }
          // referrals flowing in once the whole network is built
          if (!still && t > plan.done) {
            const f = (((t - plan.done) * .4 + i * .29) % 1);
            ctx.globalAlpha = (1 - Math.abs(f - .5) * 1.3) * clamp((t - plan.done) / .6);
            ctx.fillStyle = C.lit; ctx.beginPath(); ctx.arc(x + (cx - x) * f, y + (cy - y) * f, 2.6, 0, Math.PI * 2); ctx.fill();
          }
          hits.push({ id: node.business.placeId, x, y });
        });
        // town names on the rim, as each town arrives
        for (const town of plan.towns) {
          const k = ease(clamp((t - town.start) / .4)); if (k <= 0) continue;
          pill(cx + town.x * R, cy + town.y * R + (1 - k) * 6, town.name, false, k);
        }
        // Once the network has finished connecting, every business's name fades in, one after another.
        // A label sits just outside its dot, pointing away from the clinic, and steps further out (or
        // up and down) until it clears the town names and the labels before it.
        const boxes: Array<[number, number, number, number]> = plan.towns.map(town => { const x = cx + town.x * R, y = cy + town.y * R; return [x - 60, y - 14, x + 60, y + 14]; });
        const clash = (b: [number, number, number, number]) => b[0] < 2 || b[2] > w - 2 || b[1] < 2 || b[3] > h - 2 || boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
        if (t > plan.done) plan.nodes.forEach((node, i) => {
          const k = ease(clamp((t - plan.done - i * .07) / .45)); if (k <= 0) return;
          const [x, y] = P(node), len = Math.hypot(x - cx, y - cy) || 1, ux = (x - cx) / len, uy = (y - cy) / len;
          const raw = node.business.name ?? 'A nearby business', text = raw.length > 24 ? raw.slice(0, 23) + '…' : raw;
          ctx.font = '600 11px Inter, system-ui, sans-serif';
          const tw = ctx.measureText(text).width + 16, th = 21;
          let box: [number, number, number, number] | null = null;
          const tries = [[16, 0], [30, 0], [16, -16], [16, 16], [44, 0], [30, -22], [30, 22], [58, 0], [16, -30], [16, 30], [44, -30], [44, 30], [-30, 0]];
          for (const [out, side] of tries) {
            const ax = x + ux * out + -uy * side, ay = y + uy * out + ux * side;
            const left = ux < -.25 ? ax - tw : ux > .25 ? ax : ax - tw / 2;
            const top = uy < -.25 ? ay - th : uy > .25 ? ay : ay - th / 2;
            const b: [number, number, number, number] = [left, top, left + tw, top + th];
            if (!clash(b)) { box = b; break; }
          }
          if (!box) { // every spot is taken: use the nearest one anyway, so no business goes unnamed
            const ax = x + ux * 16, ay = y + uy * 16, left = ux < -.25 ? ax - tw : ux > .25 ? ax : ax - tw / 2, top = uy < -.25 ? ay - th : uy > .25 ? ay : ay - th / 2;
            box = [Math.max(2, Math.min(w - tw - 2, left)), Math.max(2, Math.min(h - th - 2, top)), 0, 0]; box[2] = box[0] + tw; box[3] = box[1] + th;
          }
          boxes.push(box);
          ctx.globalAlpha = k; ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(box[0], box[1] + (1 - k) * 4, tw, th, th / 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = C.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, box[0] + 8, box[1] + (1 - k) * 4 + th / 2 + .5);
        });
        // the hovered business's name, on top of everything
        const hovered = plan.nodes.find(n => n.business.placeId === hover.current);
        if (hovered) { const [x, y] = P(hovered); pill(x, y - 24, hovered.business.name ?? 'A nearby business', true, 1); }
      }

      // Your clinic, in the middle: it breathes while the results load, then anchors the network.
      const breathe = busy && !still ? 1 + Math.sin(now / 260) * .12 : 1;
      ctx.globalAlpha = .18; ctx.fillStyle = C.rose; ctx.beginPath(); ctx.arc(cx, cy, 22 * breathe, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(cx, cy, 12 * breathe, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const loop = (now: number) => { if (visible) draw(now); frame = requestAnimationFrame(loop); };
    const pick = (event: PointerEvent) => { const b = el.getBoundingClientRect(); const x = event.clientX - b.left, y = event.clientY - b.top; return hits.find(p => Math.hypot(p.x - x, p.y - y) < 16)?.id ?? null; };
    const move = (event: PointerEvent) => { const id = pick(event); hover.current = id; el.style.cursor = id ? 'pointer' : 'default'; };
    const up = (event: PointerEvent) => { const id = pick(event); if (id) live.current.onOpen(id); };
    const leave = () => { hover.current = null; };
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    size(); io.observe(el);
    const ro = new ResizeObserver(size); ro.observe(el);
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', leave);
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); io.disconnect(); ro.disconnect(); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointerleave', leave); };
  }, []);

  const count = groups.reduce((n, g) => n + g.businesses.length, 0);
  return <canvas ref={canvas} className="network-orb" role="img"
    aria-label={loading ? `Looking up the businesses around ${clinicName}.` : `${clinicName} at the centre, with ${count} matched businesses in ${groups.length} towns around it.`}/>;
}
