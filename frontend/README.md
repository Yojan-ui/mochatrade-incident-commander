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
