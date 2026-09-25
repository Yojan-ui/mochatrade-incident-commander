# MochaTrade Incident Commander // HIGH-CORTISOL

**A crisis cockpit for a flash crash: it detects a liquidation cascade, escalates it automatically, lets one person stop it market by market, drafts the public message and writes a tamper-evident record of every decision.**

---

## 0. The 20-second pitch

> "In a flash crash, forced liquidations feed on themselves. In our model an unchecked cascade **doubles about every 11 seconds**, while a paused market **halves every 4 seconds**. The difference between a bad minute and a catastrophe is how fast one person can see it, decide, act and tell users. HIGH-CORTISOL puts that whole loop on one screen: **detect → escalate → act → communicate → record.**"

---

## 1. The problem

MochaTrade users trade leveraged perpetual futures ("perps") on crypto (BTC, ETH, SOL) and on US stocks (NVDA, TSLA).

1. **Price drops.** Leveraged traders fall below their maintenance margin.
2. **Liquidation.** The exchange force-closes those positions, which means selling into the market.
3. **Feedback loop.** Forced selling pushes the price lower, which liquidates more traders. That's a **liquidation cascade**.
4. **Support flood.** Angry users flood support ("my position was closed without warning").
5. **India-specific risk.** During Indian daytime the US stock market is **closed**. US-stock perps still trade 24/7, but their reference price is **stale**, so nothing anchors them and moves get wider and more violent.

Afterwards the exchange has to decide **who pays**: was it the exchange's fault (compensate from the Insurance Fund) or a genuine market move (the liquidation stands)?

The incident commander needs to **see** it, **decide** fast, **act** per market, **tell users** and **prove** later what was done and when. Today that's usually a Slack thread and five dashboards.

---

## 2. What's on screen (walkthrough)

### Header
| Element | What it does |
|---|---|
| `MochaTrade Incident Commander // HIGH-CORTISOL` | Product title |
| `INC-2417 BTC-PERP flash crash` | Incident ID |
| **SEV badge** | `SEV-2 ELEVATED` (amber) → `SEV-1 CRITICAL` (solid red) when liquidations ≥ 500/min |
| **Open** timer | Time since the incident opened |
| **`[ 60 ] MIN SLA` countdown** | Editable: type minutes and press Enter to restart. Turns red at SEV-1 and shows BREACHED at 00:00 |
| **Red SEV-1 banner** | States the rate and which markets are still cascading vs mitigated |

### Meltdown signals panel (always visible)
- **Liquidations/min** and **Open support tickets**, each with a sparkline. The liquidations sparkline has a dashed 500 threshold line; hover the chart for past values.
- **BTC-PERP mark price** and its 24h change.
- **Amber tag: `US EQUITY MARKETS: CLOSED (OFF-HOURS)`.** NVDA/TSLA are on a stale reference price, with volatility ×1.8 and slip ×2.5.
- **Stats strip:** threshold load %, peak, average, ticket change, liquidation engine (`RUNNING`, `3/5 RUNNING`, `PAUSED`), order entry (`OPEN`, `1/5 HALTED`).

### Tab bar: `OVERVIEW | BTC-PERP | ETH-PERP | SOL-PERP`
Each tab is also a status light: an asset tab shows its **% liquidity lost** (green/yellow/red) or `BRK` (cyan) when a circuit breaker is on. Arrow keys switch tabs.

### OVERVIEW tab (bird's-eye view)
1. **Live signals:** two escalation feeds.
   - **Liquidation Volume (USD/min)**, with a breakdown by market.
   - **Support Ticket Velocity (tickets/min)**, with the backlog and tickets per liquidation.
   - Each feed has a bar showing progress to its trigger and a sparkline. If **volume ≥ $10M/min or tickets ≥ 500/min**, a blinking red **SEV-1 ESCALATION** banner names the reason.
2. **Market controls matrix:** one row per market (BTC, ETH, SOL, NVDA, TSLA) showing liquidations/min, change, mark price, 24h change and status (`CASCADING / LIVE / PAUSED / HALTED`), with independent **Pause** and **Halt** buttons. NVDA and TSLA rows are tagged `STALE REF`.
3. **Broadcast panel:** a status message that drafts itself from live state and names the halted and paused markets.
4. **Comms triage:** three pre-written public templates, each with **STAGE FOR BROADCAST**. `[ASSET]` and `[TIME]` are filled from live state, with time shown in **UTC and IST**. The preview shows *why* each value was chosen, and has **COPY** and **RESTAGE**.
5. **Fault-vs-market ruling:** two yes/no checks → one ruling:
   - Company fault? **YES** → `Reverse/Compensate via Insurance Fund`
   - NO → Short-term overreaction? **YES** → `Liquidation Stands` / **NO** → `48-Hour Case-by-Case Review`
6. **Incident log:** a tamper-evident decision record.
   - Every action, escalation and ruling is added automatically, and team members can append their own notes.
   - `CHAIN OK` means the hash chain verifies.
   - **EXPORT .log** downloads it for the post-mortem.

### Asset tab (e.g. ETH-PERP): the 3D order book
- A 3D model of **ETH's bid-side order book**. In a crash it caves into red **ravines** (liquidity vanishing) and sends out **shockwaves** on each liquidation spike.
- The asset's own **Pause / Halt** buttons sit underneath. Press one and the surface **snaps flat and cyan** with a blinking `CIRCUIT BREAKER // HALTED` plate.

### Incident stream (right column)
A live terminal feed of every event. Each line is tagged `LIQ` (liquidation, amber), `SEV` (red), `OPS` (commander action, green), `TKT` (tickets, blue) or `SYS` (gray). Liquidations on stale-reference markets end with `stale-ref`.

---

## 3. The mathematics

All numbers come from one simulation engine (`use-incident-sim.ts`). The dashboard runs on realistic simulated data, and section 6 shows how real feeds replace it.

### 3.1 Liquidation cascade: compounding growth
Every 2–3 s ("a tick"), each market's liquidation rate `L` is **multiplied** by a growth factor `g`:

```
L(t+1) = L(t) · g

g = U(1.08, 1.20)                       normal compounding
    × U(1.15, 1.35) with 22% probability  spike
g = U(0.93, 1.00) with 12% probability  brief lull
g = U(0.55, 0.75)                       market PAUSED
g = U(0.35, 0.55)                       market HALTED
```
`U(a,b)` = uniform random between a and b.

**Why multiply rather than add?** A cascade is a feedback loop: each liquidation causes more. Multiplication gives exponential growth, which is why the sparklines curve upward.

**Key numbers (use these in the pitch):**

| Situation | Mean factor per tick | Result |
|---|---|---|
| Unchecked | E[g] ≈ **1.174** | **doubles every ~4.3 ticks ≈ 11 s** |
| Pause | 0.65 | **halves every ~1.6 ticks ≈ 4 s** |
| Halt | 0.45 | **halves every ~0.9 ticks ≈ 2.2 s** |

(Doubling time = ln 2 / ln E[g]; half-life = ln 0.5 / ln g.)

The total is the exact sum of the markets: `L_total = Σ L_m`. Each market is capped at `9,999 × share_m`.

### 3.2 Price impact: forced selling moves the price
Every 850 ms, each market still liquidating loses price:

```
P ← P · (1 − pressure · ease · β · vol · U(0.6, 1.4))

pressure = 0.0006 + min(L_m / share_m, 3000) × 1.2·10⁻⁶   more liquidations → more selling
ease     = max(0.25, 1 + 2 × drawdown)                    the fall slows as it deepens
β        = BTC 1.0, ETH 1.25, SOL 1.6, NVDA 1.3, TSLA 1.5  riskier assets fall harder
vol      = 1.8 for US-stock perps while US markets are closed, else 1
```
- The factor is always < 1, so the price **only falls** while the cascade runs.
- **Pause or Halt stops that market's decline instantly**, and only that market's.
- Example: at stress 1, pressure = 0.0012, so BTC falls ~**8% per minute**.

### 3.3 Stress (a normalised danger score per market)
```
S_m = L_m / (500 × share_m)       share = BTC .42, ETH .26, SOL .14, NVDA .10, TSLA .08
```
`S = 1` means that market alone is running at SEV-1 pace. This makes a small market's crisis as visible as BTC's.

### 3.4 Liquidation volume (USD) and ticket velocity
```
Volume_USD/min = Σ_m  L_m × avg_position_size_m × Price_m
                 avg size: 0.7 BTC, 7 ETH, 65 SOL, 35 NVDA, 20 TSLA  (≈ $43K, $18K, $9K, $6K, $7K)

Ticket velocity = (L_total × U(0.7, 1.0) + 20) × (0.35 if status broadcast sent)
Open backlog    B ← B + velocity × Δt − B × (1% per tick, or 10% after broadcast)
```
- Calibrated so **$10M/min trips at ~400 liquidations/min**, *before* the 500/min count threshold. Volume is the **early warning**.
- Broadcasting a status update cuts new tickets by 65%. Communication is a mitigation, not an afterthought.

### 3.5 Escalation rules
| Trigger | Threshold | Effect |
|---|---|---|
| Liquidation count | ≥ 500/min | Header SEV-1, red banner, red borders |
| Liquidation volume | ≥ $10M/min | Live signals SEV-1 ESCALATION |
| Ticket velocity | ≥ 500/min | Live signals SEV-1 ESCALATION |

Every crossing is written to the incident stream and the incident log.

### 3.6 The 3D order book (GLSL shader)
Axes: **x** = bid price level (mid price → 2% below mid), **z** = queue position across the book, **y** = cumulative bid liquidity.

**Healthy book** (the standard cumulative-depth curve: thin at mid, thick deeper in):
```
h₀(d) = H × (0.22 + 0.78 × (1 − e^(−d/0.28)))        d = distance from mid, 0..1
```

**Collapse depth** (shared by the shader, the readout and the tabs):
```
D = 1 − e^(−0.8 × S)          S=0.5 → 33%,  S=1 → 55%,  S=2 → 80%,  S=3 → 91%
```

**Severity easing** (so the floor caves in gradually, like a real structure):
```
sev ← sev + (D − sev) × (1 − e^(−k·Δt))     k = 0.6 collapsing (95% in 5 s), 0.75 recovering (4 s)
```

**Liquidity-loss field.** Liquidity is lost near mid first, along fracture lines:
```
nearMid = e^(−d/0.38)
amp     = (e^(2.4·sev) − 1) / (e^2.4 − 1)          volatility grows exponentially with severity
freq    = 1.1 × 2^(1.2·sev)                         features get finer as it worsens
loss    = clamp( sev·nearMid·(0.35 + 0.9·ridged) + amp·nearMid·0.45·fbm , 0, 1 )
height  = h₀·(1 − loss) − R·loss²                   small losses thin the book, big ones plunge
```
- **fbm** = fractional Brownian motion: 5 layers of 3D simplex noise, each at twice the frequency and 0.42× the weight of the one before. It gives natural, rugged terrain.
- **ridged** = the same with `(1 − |noise|)²`, which gives sharp cracks.
- The noise clock runs at `time × 0.06`, so the surface churns slowly, like a structure giving way.

**Shockwaves.** When a market's liquidations jump by more than 2% in one tick, a ring expands from mid:
```
ring = amp × fade × e^(−((r − front)/0.35)²),   amp = min(1, 0.3 + 3 × jump%),   lasts 5 s
```

**Heat colour.** Heat is the share of the drop to the floor:
- Green → yellow (at 35%) → red `#EF4444` (at 75%).
- Wires that hit the floor turn **white**: liquidations executing.
- The deepest red wires fade and **tear into holes**: the book shredding apart.

**Circuit breaker.** `sev = 0` in the same frame. The surface is perfectly flat (`y = 0`) and cyan `#06B6D4`.

**Rendering rules:** orthographic camera (no perspective distortion), no lights, no shadows, unlit wireframe, pure black background.

### 3.7 Tamper-evident log (hash chain)
```
hash_i = FNV-1a( hash_(i−1) | seq | timestamp | kind | actor | text )      hash_0 = 00000000
```
- Changing any old entry changes its hash and **breaks every later link**. The header re-verifies the whole chain on every render (`CHAIN OK`).
- Entries are frozen when written, and there is no edit or delete.
- *Honest note:* FNV-1a is tamper-*evident*, not cryptographic. Production would sign entries server-side (section 6).

### 3.8 Other precise details
- **SLA timer:** `remaining = ⌈(deadline − now)/1000⌉`. It counts against a fixed deadline, so throttled browser timers can't make it drift.
- **All numbers in sync:** every figure is computed once per update in a single `snapshot()` function, so the counter, banner, header, tabs and draft message can never disagree. In testing, 120 of 120 samples matched.
- **Safe flashing:** every blinking element runs at ≤ 1.25 Hz, under the WCAG limit of 3 flashes per second, and stops if the user has reduced motion on.

---

## 4. Architecture

```
                 useIncidentSim()   ← the ONLY place data changes (swap for real feeds)
   ┌────────────────────┼─────────────────────────────────────┐
   metrics (snapshot)   controls (per market)   logs (stream)   ledger (hash chain)
   │
   ├── Header + SEV banner + SLA          ├── AssetTabs → CascadePanel → CascadeGraph3D (lazy-loaded)
   ├── SignalNode (counters, stats)       ├── Overview: LiveSignals, ActionGrid, CommsTriage,
   └── IncidentStream                                   DecisionMatrix, IncidentLog
```

| Layer | Tech |
|---|---|
| UI | React 19 + TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| 3D | three.js + react-three-fiber + custom GLSL shader (drei for the 3D text). Loaded on demand, so the main bundle stays ~415 KB |
| Motion | `motion` (Framer Motion) |
| Fonts | Instrument Sans (UI), JetBrains Mono (data), bundled locally for offline demos |

| File | Role |
|---|---|
| `use-incident-sim.ts` | Simulation engine: cascade, prices, volume, tickets, escalation, controls, stream, ledger |
| `signal-node.tsx` | Meltdown signals, sparklines, stats strip, US-equities warning |
| `live-signals-panel.tsx` | USD volume + ticket velocity feeds, SEV-1 ESCALATION banner |
| `action-grid.tsx` | Per-market control matrix + broadcast panel |
| `comms-triage.tsx` | Public comms templates, placeholder filling, staging, copy |
| `decision-matrix.tsx` | Fault-vs-market ruling |
| `incident-log.tsx` | Hash-chained ledger, notes, export |
| `asset-tabs.tsx`, `cascade-panel.tsx` | Tab bar + single-asset view |
| `cascade-graph-3d.tsx`, `cascade-dynamics.ts` | GLSL order-book surface + shared collapse formula |
| `incident-stream.tsx` | Live terminal feed |

---

## 5. Demo script (about 3 minutes)

| Time | Do | Say |
|---|---|---|
| 0:00 | Open on OVERVIEW | "It's 2:45 pm in India. The US market is closed, so NVDA and TSLA perps have no anchor. A BTC flash crash has started." Point at the amber tag. |
| 0:20 | Point at Live signals | "Two feeds decide escalation: dollars liquidated and angry tickets per minute." |
| 0:35 | Wait for **SEV-1 ESCALATION** (volume trips first, ~20 s) | "Volume tripped *before* the count threshold. That's our early warning. Every 11 seconds of delay doubles the problem." |
| 1:00 | Click **ETH-PERP** tab | "This is ETH's order book. Green is healthy liquidity. Watch the bids near mid cave into red ravines. White is liquidations executing." |
| 1:25 | Click **Halt** on ETH | "Circuit breaker. The book snaps flat and cyan instantly. ETH only; BTC and SOL are still live." |
| 1:40 | Back to OVERVIEW, **Pause** BTC in the matrix | "Per market, not all-or-nothing. Pausing liquidations halves the cascade every 4 seconds while trading stays open." |
| 2:00 | **Comms triage → Announce Market Halt → STAGE** | "The public message fills itself: ETH-PERP, the exact halt time, in UTC and IST. Copy and it's out." |
| 2:20 | **Ruling:** fault? YES | "Our fault → compensate from the Insurance Fund. The 48-hour review path covers the grey cases." |
| 2:35 | Scroll to **Incident log** | "Every click is here, hash-chained. CHAIN OK. Export it for the post-mortem or the regulator." |
| 2:50 | Close | "Detect, escalate, act, communicate, record. One screen, one person, under pressure." |

**Demo tips:** reload the page just before presenting (the incident restarts at SEV-2). The SLA box lets you set a shorter clock, e.g. 15 minutes, for drama.

---

## 6. How it integrates with MochaTrade

The dashboard was built so the data source can be swapped without touching the screens. Every component reads one typed object (`Metrics`) and calls a few action functions. Integration = replace `useIncidentSim()` with a hook that fills the same shape from real systems.

### 6.1 Data in (read-only feeds)
| Dashboard field | Real source (typical exchange stack) | Transport |
|---|---|---|
| Liquidations per market, notional USD | Liquidation engine events | Kafka/NATS topic → WebSocket gateway |
| Mark / index price per market | Pricing & index service | WebSocket |
| **Stale-reference flag** | Index provider + an **NYSE session calendar** (holidays, early closes) against IST | Computed server-side |
| Order-book depth (the 3D surface) | L2 order book, bid levels down to −2% | WebSocket snapshots → texture uploaded to the shader (replaces the noise field) |
| Ticket velocity, backlog | Support desk (e.g. Zendesk or Freshdesk) ticket-created webhooks | Webhook → aggregator |

The `snapshot()` function stays: it's the single place where raw feeds become consistent derived numbers (stress, escalation, collapse depth).

### 6.2 Actions out (write paths, with safety)
| Button | Real call | Safeguards to add |
|---|---|---|
| Pause liquidations (per market) | Risk-engine admin API: suspend liquidations for a symbol | Role-based access, idempotency key, the UI waits for the engine's confirmation (replaces the demo's 650 ms timer) |
| Halt trading (per market) | Matching-engine admin API: halt symbol | **Two-person approval**, typed confirmation, auto-expiry reminder |
| Broadcast / Comms | Status page API, in-app banner service, push, X, email | Approval step; templates in **English + Hindi** for the Indian user base |
| Ruling = System Fault | Opens a compensation job against the Insurance Fund | Eligibility = liquidations on the affected markets inside the incident window |
| Escalation triggers | PagerDuty / Opsgenie incidents | Thresholds configurable per market |

### 6.3 Audit and compliance
- Move the ledger server-side into an append-only store (e.g. WORM / object-lock storage or an append-only Postgres table).
- Keep the same hash chain and **sign each entry** (HMAC or Ed25519) so it's cryptographically verifiable.
- Export straight into post-mortems and regulator requests. The India angle matters here: clear, timestamped records of halts, compensation and customer comms.

### 6.4 Rollout plan
1. **Shadow mode:** read-only feeds and alerts during real incidents, with no buttons wired.
2. **Assisted:** comms staging and the ledger go live; controls still executed manually by risk ops.
3. **Full:** per-market pause/halt wired through the risk engine with two-person approval.
4. **Automation:** during US off-hours, automatically tighten leverage or pause liquidations on stale-reference perps when stress exceeds a threshold.

---

## 7. Why it matters (business value)

- **Speed is money.** In the model, delay compounds (~2× every 11 s) and a pause decays it (½ every 4 s). A single-screen workflow cuts time to mitigation.
- **Surgical, not nuclear.** Per-market pause and halt keep healthy markets trading (less revenue lost, fewer angry users) while stopping the bleeding where it is.
- **Fewer tickets, less panic.** A fast, accurate public message cuts ticket inflow by 65% in the model.
- **Fair, consistent compensation.** The ruling checklist turns "who pays?" into a repeatable decision instead of an argument.
- **Provable.** A tamper-evident log of every action with UTC/IST time, ready for post-mortems and regulators.
- **India-aware.** It understands that Indian daytime means stale US reference prices, a risk generic tools miss.

---

## 8. Judge Q&A

**Is this real data?**
No. It's a calibrated simulation so the demo is reliable anywhere. The UI reads one typed interface, so real feeds plug in without redesign (section 6).

**Why multiply instead of add in the cascade?**
Liquidations cause more liquidations; that feedback is exponential. It gives the doubling-time metric (~11 s) that makes the urgency measurable.

**Why pause *and* halt?**
Pause stops forced selling but keeps trading open (least harm). Halt freezes the market (last resort, red button, two-person approval in production).

**Why a 3D order book?**
For quants, it's a real LOB depth surface: cumulative bid liquidity by price level. For everyone else, red ravines read instantly as "the floor is gone." The circuit breaker's snap to flat cyan makes the effect of the action obvious.

**How do you stop numbers disagreeing?**
Every figure is computed once per update in one function and shared everywhere.

**Is the log really immutable?**
Tamper-evident in the browser (hash chain, frozen entries, no edit path). In production it would be server-side, append-only and cryptographically signed.

**What's the US-market logic?**
When US equities are closed, US-stock perps have no live reference price. The model widens their volatility (×1.8) and slippage (×2.5). The production version reads the real NYSE calendar.

**Why are there two SEV-1 definitions?**
The header uses liquidation count (≥ 500/min). The Live signals panel escalates on dollar volume or ticket velocity. Volume usually trips first, on purpose: it's the early warning.

---

## 9. Honest limitations (say these before a judge does)
- Simulated data; no backend, login or real paging.
- State resets on reload (export the log first).
- The browser hash chain is tamper-evident, not cryptographic.
- The US-closed flag is a scenario setting, not the live clock.
- The Halt button has no confirmation step in the demo (production: two-person approval).
- The 3D view needs WebGL; it shows a text fallback if WebGL is unavailable.

---

## Running it
```bash
npm install
npm run dev
```
Open the URL Vite prints (e.g. http://localhost:5175).
