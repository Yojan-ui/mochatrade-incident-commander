# SecureMailScope frontend

React 19 + Vite + Tailwind CSS v4. Tailwind v4 is configured in CSS, not `tailwind.config.js`: theme tokens (obsidian surfaces, `ok` #10B981, `crit` #EF4444, JetBrains Mono) live in the `@theme` block of `src/index.css`.

```bash
npm install
npm run dev          # http://localhost:5173, proxies /api -> http://127.0.0.1:8000
API_TARGET=http://127.0.0.1:8765 npm run dev   # point the proxy elsewhere
npm run build        # typecheck + production build into dist/
```

URL parameters: `?demo=<scenario>` (fortress, startup, wide-open, legacy-corp, parked, firewalled), `?domain=<name>` for a live scan, and `?delay=1500` to slow demo responses while working on loading states.

In production the root `Dockerfile` builds this app and FastAPI serves `dist/` from the same origin, so API paths stay relative.

## Defense Lattice (3D)

`src/components/lattice/` renders the posture as a React Three Fiber scene: a wireframe icosahedron core (tinted by overall score) with the 7 vectors as orbiting octahedron satellites, joined by one dynamic `LineSegments` geometry rewritten every frame.

- **Pass:** solid green link with data packets flowing to the node. **Warn:** amber. **Unmeasured / N/A:** dim slate, no glow.
- **Fail:** the link snaps on an under-damped spring (whip, recoil, droop), turns red and sparks at the break; the node glitches (position/scale jitter, white flashes). Reverting to pass reconnects the link.
- Glow comes from `@react-three/postprocessing` `<Bloom mipmapBlur luminanceThreshold={1}>`: only colours pushed above 1.0 (live links, packets, failing nodes) bloom.
- `OrbitControls` with damping; wheel-zoom is off so the page still scrolls. Auto-rotate pauses while dragging.
- Lazy-loaded chunk; rendering pauses when scrolled off-screen; honours `prefers-reduced-motion`. Click a node (or its legend chip) to jump to that vector's card.
