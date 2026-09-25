# HIGH-CORTISOL: Learning Guide (from the basics)

This guide assumes **no background** in trading, React, maths or 3D graphics. It builds each idea from scratch and then shows exactly where that idea lives in this project's code.

**How to use it:** read Part 1 and Part 2 first (the "what" and the "why"). Then read whichever of Parts 3–7 you need. Part 8 has hands-on experiments; changing a number and watching what happens is the fastest way to really understand it. Part 10 tests yourself.

> Companion file: `PROJECT_EXPLAINED.md` is the short **pitch guide** (demo script, judge Q&A). This file is the **deep understanding** guide.

---

## Contents
1. [Finance basics: what's actually happening in a flash crash](#part-1--finance-basics)
2. [The product: what the dashboard does and why](#part-2--the-product)
3. [Web basics: how this app is built](#part-3--web-basics)
4. [How the code runs: one tick, start to finish](#part-4--how-the-code-runs)
5. [Maths from the basics](#part-5--maths-from-the-basics)
6. [3D graphics from the basics](#part-6--3d-graphics-from-the-basics)
7. [Every file explained](#part-7--every-file-explained)
8. [Hands-on experiments](#part-8--hands-on-experiments)
9. [Glossary](#part-9--glossary)
10. [Test yourself (with answers)](#part-10--test-yourself)

---

# Part 1 · Finance basics

### 1.1 An exchange
An **exchange** (like MochaTrade) is a marketplace where people buy and sell assets. The exchange matches buyers with sellers and holds everyone's money.

### 1.2 Price, "mark price" and "mid"
- The **price** of an asset is whatever buyers and sellers last agreed on.
- The **mark price** is the exchange's official "fair" price, used to decide who's in trouble. In the dashboard: `BTC-PERP mark 60,574.0`.
- **Mid** (mid-price) is halfway between the best buy offer and the best sell offer.

### 1.3 The order book
Buyers post **bids** ("I'll buy 2 BTC at 60,000"). Sellers post **asks** ("I'll sell 1 BTC at 60,050"). The list of all waiting bids and asks is the **order book**.

```
        ASKS (sellers)          price
                          ┌── 60,100  ▓▓▓▓
                          ├── 60,075  ▓▓
                          ├── 60,050  ▓          ← best ask
        ───── mid ≈ 60,025 ─────────────────
                          ├── 60,000  ▓▓         ← best bid
                          ├── 59,975  ▓▓▓▓
        BIDS (buyers)     └── 59,950  ▓▓▓▓▓▓▓
```
- **Liquidity / depth** = how much is waiting to be bought or sold at each price.
- **Cumulative depth** = add it all up as you move away from mid. It's small near mid and grows the further away you go. The 3D view draws exactly this for the **bid** side.

**Why it matters:** if someone must sell a lot *right now*, they eat through the bids. If the bids are thin, the price falls a long way. That is **slippage**: the difference between the price you expected and the price you got.

### 1.4 Leverage and margin
**Leverage** means borrowing to make a bigger bet.
- With **10× leverage**, $1,000 of your own money (your **margin**) controls a $10,000 position.
- A 10% price drop = a $1,000 loss = **all your margin is gone**.

The exchange requires you to keep a minimum amount of margin, the **maintenance margin**. Fall below it and…

### 1.5 Liquidation
…the exchange **force-closes** your position so you don't lose more than you have. That forced close is a **liquidation**. To close a long (buy) position, the exchange must **sell**.

### 1.6 Perpetual futures ("perps")
A **perp** (e.g. `BTC-PERP`) is a contract that tracks an asset's price, can be leveraged, and never expires. This app has five:

| Market | What it tracks |
|---|---|
| BTC-PERP | Bitcoin |
| ETH-PERP | Ethereum |
| SOL-PERP | Solana |
| NVDA-PERP | Nvidia stock |
| TSLA-PERP | Tesla stock |

### 1.7 The liquidation cascade (the heart of the problem)
```
price falls ──► traders hit maintenance margin ──► liquidations (forced SELLING)
     ▲                                                          │
     └──────────── selling pushes price lower ◄─────────────────┘
```
Each liquidation causes more liquidations. This **feedback loop** is why a crash can go from "bad" to "catastrophic" in seconds. A **flash crash** is a very fast, very deep drop.

### 1.8 Why US-stock perps are extra dangerous in India's daytime
A US-stock perp needs a **reference price** from the real US stock market. The US market is open roughly **7:00 pm–1:30 am IST** (during US daylight saving time). During Indian daytime it's **closed**, but the perp still trades 24/7.
- The reference price is **stale** (frozen at the last close).
- Nothing anchors the perp, so moves get wider and slippage gets worse.
- The dashboard models this: `volatility ×1.8`, `slip ×2.5` on NVDA/TSLA while `US EQUITY MARKETS: CLOSED`.

### 1.9 The two emergency brakes
| Brake | What it does | Harm |
|---|---|---|
| **Pause margin liquidations** | Stops force-closing positions. Trading stays open | Low: the least disruptive fix |
| **Halt trading** | Freezes the market completely; no orders at all | High: the last resort (that's why it's the red button) |

Both work **per market**, so you can stop ETH without stopping BTC.

### 1.10 The Insurance Fund and "who pays?"
Exchanges keep an **Insurance Fund** to cover losses. After a crash they must decide:
- **Exchange's fault** (bug, bad price feed) → compensate users from the fund.
- **Genuine market move** → the liquidation was fair and stands.
- **Unclear** → review case by case.

That's the dashboard's **Fault-vs-market ruling**.

### 1.11 Severity (SEV) levels
Incident teams label how bad things are. **SEV-2** = serious. **SEV-1** = critical, wake everyone up. Here, SEV-1 is declared automatically at 500 liquidations/min (and by the Live signals triggers).

---

# Part 2 · The product

### 2.1 The one idea
An **incident commander** has to do five things, fast, under stress:

```
DETECT  ──►  ESCALATE  ──►  ACT  ──►  COMMUNICATE  ──►  RECORD
signals      SEV-1          pause/halt  public message    audit log
```
The dashboard puts all five on one screen.

### 2.2 Screen map
```
┌ HEADER: title · incident · SEV badge · Open timer · Commander · [ 60 ] MIN SLA 59:40 ┐
│ [red SEV-1 banner when liquidations ≥ 500/min]                                      │
├──────────────────────────────────────────────────────────┬──────────────────────────┤
│ MELTDOWN SIGNALS (always visible)                        │ INCIDENT STREAM          │
│  Liquidations ── BTC mark ── Support tickets             │  live terminal feed      │
│  US EQUITY MARKETS: CLOSED tag · stats strip             │  LIQ / SEV / OPS / TKT   │
├──────────────────────────────────────────────────────────┤                          │
│ [OVERVIEW] [BTC-PERP] [ETH-PERP] [SOL-PERP]   ← tabs     │                          │
│                                                          │                          │
│ OVERVIEW:                    │ ASSET TAB:                │                          │
│  Live signals ($ vol, tkts)  │  3D order book            │                          │
│  Market controls matrix      │  + Pause / Halt           │                          │
│  Broadcast                   │                           │                          │
│  Comms triage                │                           │                          │
│  Fault-vs-market ruling      │                           │                          │
│  Incident log                │                           │                          │
└──────────────────────────────┴───────────────────────────┴──────────────────────────┘
```

### 2.3 What each part is for
| Part | Job in the 5-step loop |
|---|---|
| Meltdown signals, Live signals | **Detect** |
| SEV badge/banner, SEV-1 ESCALATION, SLA timer | **Escalate** (and time pressure) |
| Market controls, asset-tab buttons | **Act** |
| Broadcast, Comms triage | **Communicate** |
| Ruling, Incident log, Incident stream | **Record** and decide who pays |
| 3D order book | Makes the damage (and the fix) *visible* |

### 2.4 Important honesty
All data is **simulated** by one engine so the demo always works. The screens are built so real data can replace the engine later (Part 7.1 and `PROJECT_EXPLAINED.md` section 6).

---

# Part 3 · Web basics

### 3.1 What a web app is
Your browser downloads HTML (structure), CSS (looks) and JavaScript (behaviour) and runs them. This app is a **single-page app**: one page whose content JavaScript updates live.

### 3.2 TypeScript
**TypeScript** = JavaScript + **types**. You declare what shape data has, and mistakes are caught before running:
```ts
interface Metrics { liquidations: number; critical: boolean /* … */ }
```
`npx tsc -b` checks every file. If the types don't fit, it errors.

### 3.3 React: components
**React** builds the screen from **components**: functions that return what to show.
```tsx
function Field({ label, children }) {
  return <div><span>{label}</span><span>{children}</span></div>
}
```
The `<div>`-looking syntax is **JSX**: HTML-like code inside JavaScript. **Props** (`label`, `children`) are inputs passed from the parent component.

### 3.4 React: state and re-rendering
**State** is data that changes over time. When state changes, React **re-runs** the component and updates the screen.
```tsx
const [selectedAsset, setSelectedAsset] = useState('OVERVIEW')   // App.tsx
// clicking a tab calls setSelectedAsset('ETH') → App re-renders → ETH view appears
```

### 3.5 Hooks this project uses
| Hook | Plain-English meaning | Example here |
|---|---|---|
| `useState` | "remember a value; redraw when it changes" | the selected tab, the SLA minutes |
| `useEffect` | "do something after drawing, e.g. start a timer" | the simulation clocks |
| `useRef` | "remember a value **without** redrawing" | latest metrics for the timers |
| `useCallback` | "keep the same function between redraws" | `toggleControl`, `record` |
| `useMemo` | "cache a calculation until its inputs change" | the 3D geometry |
| **custom hook** | your own hook bundling the above | `useIncidentSim()`, the brain |

### 3.6 Why refs matter here (a subtle but key idea)
The simulation runs on **timers** that start once and keep going. A timer created at startup would otherwise keep seeing the *old* state forever. So the project stores the latest data in a **ref** and updates it in the same step as the state:
```ts
const commitMetrics = (next) => {
  metricsRef.current = next   // timers read this
  setMetrics(next)            // screen redraws from this
}
```
The timers and the screen always see the **same** numbers.

### 3.7 Styling: Tailwind CSS
Instead of separate CSS files, styles are short class names:
`border border-white/10 bg-black font-mono text-[11px] text-crit`
= 1px border at 10% white, black background, monospace, 11px text, red text. Custom colours (`crit`, `ok`, `warn`) are defined in `src/index.css`.

### 3.8 Vite
**Vite** is the build tool. `npm run dev` starts a local server with instant reload. `npm run build` makes optimised production files in `dist/`.

### 3.9 Lazy loading
The 3D library (three.js) is large (~1 MB). It's loaded **only when you open an asset tab**:
```ts
const CascadeGraph3D = lazy(() => import('./cascade-graph-3d'))
```
So the first page load stays small (~415 KB).

---

# Part 4 · How the code runs

### 4.1 The big picture: one brain, many screens
```
                useIncidentSim()          ← the ONLY place data changes
      ┌───────────────┼─────────────────┬──────────────┐
   metrics         controls            logs          ledger
 (all numbers)  (pause/halt state)  (stream lines)  (decision log)
      │               │                 │              │
  every panel reads these; buttons call toggleControl / sendBroadcast / record
```
**Rule:** components never invent numbers. They only display what the hook gives them. That's why nothing on screen can disagree.

### 4.2 Two clocks
The engine runs two independent timers:

| Clock | How often | What it does |
|---|---|---|
| **Counter tick** | every 2–3 s (random) | new liquidation counts per market, tickets, USD volume, escalation checks |
| **Price step** | every 850 ms | prices fall for markets still cascading; maybe log one liquidation event |

### 4.3 One counter tick, step by step (`step()` in `use-incident-sim.ts`)
1. **Read the latest state** from refs: previous metrics, and which markets are paused or halted.
2. **For each market**, pick a growth factor `g` (Part 5.3) and compute `new = old × g`, capped.
3. **Add up** the markets → total liquidations.
4. **Ticket velocity** = liquidations × (0.7–1.0) + 20, cut by 65% if a broadcast went out. The open **backlog** grows by velocity × elapsed time, minus closures.
5. **USD volume** per market = count × typical position size × price.
6. Call **`snapshot()`**, which computes *every* derived number at once: deltas, peak, average, load, stress, SEV-1, drawdown, escalation flags.
7. **Commit** (ref + state together) → the screen redraws.
8. **Compare old vs new** and write events:
   - crossed 500/min → stream `SEV` line + log entry "SEV-1 declared";
   - crossed $10M or 500 tickets → escalation trigger entries;
   - a big jump in one market → a `spike` line.

### 4.4 One price step
1. Skip markets that are paused or halted (their price freezes).
2. For each active market: `price = price × (1 − small amount)` (Part 5.5).
3. Commit a new snapshot.
4. With probability `min(0.85, activeLiquidations / 600)`, log one `LIQ` event at the **price just committed**, so logged prices match the screen.

### 4.5 What happens when you click "Halt" on ETH
```
click ─► toggleControl('ETH-PERP', 'halt')
          ├─ status = 'executing'           (button shows "Halting…", lamp amber)
          └─ after 650 ms:
              ├─ status = 'executed'        (row shows HALTED, button becomes Resume)
              ├─ stream: "OPS ETH-PERP markets halted by commander; order entry disabled"
              └─ ledger: "ETH-PERP market halted, order entry disabled [by commander]"

next price steps : ETH skipped            → ETH price frozen
next counter tick: ETH growth = 0.35–0.55 → ETH liquidations collapse
3D view          : breaker on             → surface snaps flat + cyan, banner blinks
```
(The 650 ms delay simulates waiting for the exchange's engine to confirm.)

### 4.6 Why `snapshot()` is the most important function
It's the single place where raw numbers become displayed numbers. Because every panel reads the same snapshot, the banner, counter, tabs, readouts and draft message **always agree**.

---

# Part 5 · Maths from the basics

### 5.1 Random numbers: `U(a, b)`
`rand(a, b)` gives a random number between a and b, every value equally likely. That's a **uniform distribution**, written `U(a, b)`. Its average is `(a + b) / 2`.
```ts
const rand = (min, max) => min + Math.random() * (max - min)
```
Randomness makes the simulation feel alive: no two runs are identical.

### 5.2 Adding vs multiplying: linear vs exponential
- **Linear:** add the same amount each time: 100, 110, 120, 130… (a straight line)
- **Exponential:** multiply by the same factor: 100, 110, 121, 133, 146… (a curve that bends upward)

A cascade feeds itself, so it's **exponential**. That's why the sparklines curve up.

### 5.3 The cascade growth factor
Each tick, each market's liquidations are multiplied by `g`:

| Case | Chance | g |
|---|---|---|
| Normal | 88% | `U(1.08, 1.20)`, and 22% of those times also × `U(1.15, 1.35)` (a spike) |
| Lull | 12% | `U(0.93, 1.00)` |
| Paused | always | `U(0.55, 0.75)` |
| Halted | always | `U(0.35, 0.55)` |

**Average growth when unchecked:**
```
spike boost average  = 0.78 × 1 + 0.22 × 1.25            = 1.055
normal average       = 1.14 × 1.055                      ≈ 1.203
overall              = 0.88 × 1.203 + 0.12 × 0.965       ≈ 1.174   (+17.4% per tick)
```

### 5.4 Logarithms, doubling time and half-life
A **logarithm** answers "how many times do I multiply?". `ln` is the natural log.

- **Doubling time**: how many ticks until the value doubles: `n = ln 2 / ln g`
  - `ln 2 / ln 1.174 ≈ 0.693 / 0.160 ≈ 4.3 ticks ≈ 4.3 × 2.5 s ≈ 11 s`
- **Half-life**: how many ticks until it halves: `n = ln 0.5 / ln g`
  - Pause (g ≈ 0.65): `≈ 1.6 ticks ≈ 4 s`
  - Halt (g ≈ 0.45): `≈ 0.9 ticks ≈ 2.2 s`

> **Pitch line:** "Every ~11 s of delay doubles the problem; a pause halves it every ~4 s."

### 5.5 Price impact
Every 850 ms, for each market still cascading:
```
P_new = P × (1 − pressure × ease × β × vol × U(0.6, 1.4))
```
| Piece | Formula | Meaning |
|---|---|---|
| `pressure` | `0.0006 + min(L/share, 3000) × 0.0000012` | more liquidations → more forced selling |
| `ease` | `max(0.25, 1 + 2 × drawdown)` | the fall slows as the price gets very low (but never reverses) |
| `β` (beta) | BTC 1, ETH 1.25, SOL 1.6, NVDA 1.3, TSLA 1.5 | riskier assets fall harder |
| `vol` | 1.8 for US-stock perps while US is closed | stale reference = bigger moves |

**Worked example:** BTC at stress 1: `L/share = 500`, so `pressure = 0.0006 + 0.0006 = 0.0012` (0.12% per step). Steps per minute = 60 / 0.85 ≈ 70.6. Drop per minute = `1 − (1 − 0.0012)^70.6 ≈ 8.1%`.

**Drawdown** = `(price now − opening price) / opening price`. It's negative in a crash, e.g. −0.07 = −7%.

### 5.6 Stress: comparing big and small markets fairly
BTC always has more liquidations than TSLA, simply because BTC is bigger. To compare fairly, divide by each market's normal share of the threshold:
```
stress = L_market / (500 × share)        share: BTC 0.42, ETH 0.26, SOL 0.14, NVDA 0.10, TSLA 0.08
```
Stress 1.0 = "this market alone is running at SEV-1 pace."

### 5.7 The collapse curve `1 − e^(−0.8·S)`
`e ≈ 2.718`. `e^(−x)` starts at 1 and decays toward 0. So `1 − e^(−0.8·S)`:
- starts at 0 (no stress → no collapse);
- rises fast at first, then **flattens** toward 1 (it can never exceed 100%).

| Stress S | Collapse |
|---|---|
| 0.5 | 33% |
| 1 | 55% |
| 2 | 80% |
| 3 | 91% |

This saturating shape is common for anything that "fills up" toward a limit.

### 5.8 USD volume and ticket velocity
```
Volume per minute = Σ over markets ( liquidations × typical size × price )
typical size: 0.7 BTC, 7 ETH, 65 SOL, 35 NVDA, 20 TSLA   (≈ $43K, $18K, $9K, $6K, $7K)

Ticket velocity   = (liquidations × U(0.7, 1.0) + 20) × (0.35 if broadcast sent)
Backlog           = backlog + velocity × minutes elapsed − closures
closures          = 1% of backlog per tick (10% after a broadcast)
```
Calibration: $10M/min trips at about 400 liquidations/min, *before* the 500 count. That's the early warning.

### 5.9 Smoothing (easing) with `1 − e^(−k·Δt)`
To move smoothly toward a target instead of jumping:
```
value = value + (target − value) × (1 − e^(−k × Δt))
```
Every frame, you close a fixed *fraction* of the remaining gap. Time to get 95% of the way = `ln 20 / k`.
- 3D collapse: `k = 0.6` → **5 s** to cave in; `k = 0.75` → **4 s** to recover.
- The circuit breaker **skips** this and sets the value to 0 immediately. That's why it "snaps".

### 5.10 Thresholds and flags
Many decisions are simple comparisons that produce true/false **flags**:
```
critical         = liquidations ≥ 500
escalation.volume  = volume ≥ $10,000,000
escalation.tickets = ticket velocity ≥ 500
```
Edge detection: compare the previous and the new flag. `false → true` = "just crossed", so write the log entry exactly once.

### 5.11 Hashing and the hash chain
A **hash function** turns any text into a short fixed-size code. Change one letter and the code changes completely. This project uses **FNV-1a (32-bit)**:
```
h = 2166136261
for each character c:  h = (h XOR c) × 16777619     (kept to 32 bits)
```
**Hash chain:** each log entry's hash includes the *previous* entry's hash:
```
hash₁ = FNV( 00000000 | entry 1 )
hash₂ = FNV( hash₁   | entry 2 )
hash₃ = FNV( hash₂   | entry 3 )  …
```
Edit entry 2 and `hash₂` changes, so entry 3's stored "previous hash" no longer matches and every later link fails. `CHAIN OK` means all links still match.
*Limit:* FNV-1a detects accidents and casual edits, but it isn't cryptographically secure. Production would use signed hashes on a server.

### 5.12 Deadline-based countdown (why the SLA timer can't drift)
The naive approach subtracts 1 every second. But browsers delay timers (for example in background tabs), so it drifts. Instead:
```
deadline  = start time + minutes × 60,000 ms
remaining = ceil((deadline − now) / 1000)  seconds
```
The number is always recomputed from the real clock, so it's always correct.

---

# Part 6 · 3D graphics from the basics

### 6.1 A 3D scene
A 3D scene has **objects** (shapes), a **camera** (the viewpoint) and a **renderer** (draws the camera's view onto the screen). This project uses **three.js** (a 3D library) through **react-three-fiber** (three.js written as React components).

### 6.2 Meshes, vertices and wireframes
A 3D shape is a **mesh**: lots of **vertices** (points) joined into triangles. A `PlaneGeometry(24, 9, 320, 128)` is a flat 24 × 9 sheet cut into a 320 × 128 grid: about **41,000 vertices**. **Wireframe** draws only the triangle edges, which gives the terminal look.

### 6.3 Cameras: perspective vs orthographic
- **Perspective:** far things look smaller (like your eyes).
- **Orthographic:** size doesn't change with distance, like a technical drawing. This project uses orthographic so the heights can be compared honestly.

The camera is fixed at an angle, and a **fit** function computes the zoom so the whole surface fills the panel.

### 6.4 The GPU and shaders
The **GPU** (graphics chip) processes thousands of vertices in parallel. You program it with small programs called **shaders**, written in **GLSL**:
- The **vertex shader** runs once *per vertex*: "where should this point be?" This is where the ravines, cracks and shockwaves move the surface.
- The **fragment shader** runs once *per pixel*: "what colour is this pixel?" This is where the green/yellow/red heat, white meltdown and cyan breaker come from.

**Uniforms** are values sent from JavaScript to the shader every frame, e.g. `uSeverity`, `uTime`, `uBreaker`. That's how the simulation controls the 3D.

### 6.5 "Unlit" rendering
Normal 3D uses **lights** and **shading** (bright faces toward the light, dark away). This project uses **none**: every colour is decided directly by the shader from data. It looks flat and precise, like a terminal.

### 6.6 Noise: controlled randomness
`Math.random()` gives unrelated jumps: static. **Noise** gives *smooth* randomness: nearby points get similar values, like hills. This project uses **3D simplex noise** (an improved version of classic Perlin noise). The third dimension is **time**, so the terrain slowly evolves.

### 6.7 fBM: layering noise for natural detail
**Fractional Brownian Motion (fBM)** = add several noise layers ("octaves"), each at **higher frequency** and **lower weight**:
```
fbm(p) = 0.5·noise(p) + 0.21·noise(2.03p) + 0.088·noise(4.12p) + …   (5 layers, weight × 0.42 each)
```
Big layers make the broad canyons; small layers add roughness. That's how real terrain looks.

**Ridged noise** uses `(1 − |noise|)²`, which turns the smooth zero-crossings into **sharp creases**: the cracks.

### 6.8 How one vertex gets its height (the recipe)
For each point at distance `d` from mid (0 = mid, 1 = 2% below mid):
```
1. healthy  = H × (0.22 + 0.78 × (1 − e^(−d/0.28)))     normal cumulative bid depth
2. nearMid  = e^(−d/0.38)                                damage concentrates near mid
3. amp      = (e^(2.4·sev) − 1)/(e^2.4 − 1)              volatility grows exponentially
4. loss     = sev·nearMid·(0.35 + 0.9·ridged) + amp·nearMid·0.45·fbm   (clamped 0..1)
5. + shockwave ring if a spike just happened
6. height   = healthy × (1 − loss) − ravineDepth × loss²
7. if circuit breaker: height = 0
```
Step 6's `loss²` term means small losses only thin the book, but big losses **plunge** into a ravine.

### 6.9 How one pixel gets its colour
```
heat = (healthy − height) / (healthy + ravineDepth)       0 = intact … 1 = hit the floor
heat 0 → 0.35  : green → yellow
heat 0.35 → 0.75: yellow → red (#EF4444)
at the floor   : white rim / sparks  ("liquidations executing")
very deep      : fade + holes         ("the book tearing apart")
breaker        : cyan (#06B6D4)
```

### 6.10 The shockwave
When a market's liquidations jump more than 2% in one tick, a ring expands from mid:
```
ring = amplitude × fade × e^(−((distance − front) / 0.35)²)
front grows 0.2 surface-widths per second; the ring fades over 5 s
amplitude = min(1, 0.3 + 3 × jump%)
```
`e^(−x²)` is a **Gaussian bump**: a smooth hill. Sliding its centre outward makes a travelling wave.

### 6.11 Draw order and transparency (a bug we hit)
three.js draws **solid** objects first and **transparent** ones after. The torn surface is transparent, so it was drawn *over* the solid circuit-breaker plate. The fix: make the plate "transparent" too (at full opacity) so it joins the same group and draws last. Worth knowing: `renderOrder` only sorts *within* a group.

---

# Part 7 · Every file explained

### 7.1 `src/components/dashboard/use-incident-sim.ts`: the brain
- **Types:** `Market`, `Metrics` (every number), `Controls` (pause/halt per market plus broadcast), `LogLine` (stream), `LedgerEntry` (log).
- **Constants:** thresholds (500, $10M, 500 tickets), prices, beta, share, position sizes, the stale-reference multipliers.
- **Helpers:** `rand`, `byMarket` (do something for each market), `push` (keep the last 28 values), `seedExponential` (a realistic starting history), `splitByMarket`.
- **`snapshot()`:** computes every derived number (Part 4.6).
- **`useIncidentSim()`:** holds state, runs the two clocks, and provides:
  - `toggleControl(market, 'pause' | 'halt')`, `sendBroadcast()`
  - `record(kind, text, actor)`: the only way to write to the log
  - `metrics`, `controls`, `isPaused`, `isHalted`, `logs`, `ledger`
- **Integration point:** replace this hook with one fed by real data, keeping the same `Metrics` shape.

### 7.2 `src/App.tsx`: the layout
Header (title, SEV badge, Open timer, **SLA countdown** with its editable input), the SEV-1 banner, the signals panel, the **tab bar** (`selectedAsset` state), the Overview panels (kept mounted but hidden so the ruling answers survive tab switches), the asset panel, and the incident stream.

### 7.3 The panels
| File | What it shows | Worth studying for |
|---|---|---|
| `signal-node.tsx` | counters, BTC mark, sparklines, US-closed tag, stats strip | drawing SVG sparklines by hand |
| `live-signals-panel.tsx` | USD volume + ticket velocity, trigger bars, SEV-1 ESCALATION | thresholds, blink animation |
| `action-grid.tsx` | per-market control matrix, broadcast | reusable `ControlButton` |
| `comms-triage.tsx` | templates, `[ASSET]`/`[TIME]` filling, staging, copy | turning state into text; clipboard fallback |
| `decision-matrix.tsx` | two yes/no checks → ruling | a tiny decision tree (`rulingFor`) |
| `incident-log.tsx` | hash-chained ledger, notes, export | `verifyChain`, file download |
| `incident-stream.tsx` | live terminal feed, follows the tail | auto-scroll that respects the reader |
| `asset-tabs.tsx` | tab bar with status lights | accessible keyboard tabs |
| `cascade-panel.tsx` | asset view wrapper + buttons | lazy loading the 3D |
| `cascade-graph-3d.tsx` | the GLSL order-book surface | shaders, uniforms, noise |
| `cascade-dynamics.ts` | `collapseDepth()`, `CASCADE_LANES` | sharing one formula between 2D and 3D |

### 7.4 `src/index.css`
Colour tokens (`--color-crit`, `--color-ok`, …), fonts, and small animations (the moving packets on the connector lines, the escalation blink). Every animation turns off if the user prefers reduced motion.

---

# Part 8 · Hands-on experiments

Run `npm run dev`, open the page, then edit a number and save. The page reloads instantly. **Change one thing at a time**, and put it back afterwards.

| # | File → line to find | Change | What you'll learn |
|---|---|---|---|
| 1 | `use-incident-sim.ts` → `rand(1.08, 1.2)` | `rand(1.02, 1.05)` | Slower compounding: SEV-1 arrives much later (doubling time grows) |
| 2 | `use-incident-sim.ts` → `LIQUIDATION_THRESHOLD = 500` | `300` | Everything keyed to the threshold moves together, because it's one constant |
| 3 | `use-incident-sim.ts` → `STALE_REF_VOLATILITY = 1.8` | `4` | NVDA/TSLA prices dive far faster: the stale-reference risk |
| 4 | `use-incident-sim.ts` → `US_EQUITY_CLOSED = true` | `false` | The amber tag, STALE REF labels and multipliers all disappear |
| 5 | `cascade-dynamics.ts` → `-0.8 *` | `-2 *` | The 3D book collapses much harder at the same stress |
| 6 | `cascade-graph-3d.tsx` → `uTime * 0.06` | `uTime * 0.6` | The terrain churns 10× faster (why we slowed it down) |
| 7 | `cascade-graph-3d.tsx` → `EASE_DOWN = 0.6` | `6` | The cave-in becomes near-instant instead of 5 s |
| 8 | `cascade-graph-3d.tsx` → `SEG_X = 320`, `SEG_Z = 128` | `60`, `24` | Fewer vertices: blocky polygons (why density matters) |
| 9 | `use-incident-sim.ts` → `(broadcasted ? 0.35 : 1)` | `0.9` | Broadcasting barely helps: tickets keep climbing |
| 10 | `cascade-graph-3d.tsx` → `SHOCK_LIFE = 5` | `1` | Shockwaves vanish quickly: a tremor becomes a flicker |

**Tip:** run `npx tsc -b` after edits. If it prints nothing, the types are fine.

---

# Part 9 · Glossary

| Term | Meaning |
|---|---|
| **Ask / Bid** | Sell offer / buy offer in the order book |
| **Beta (β)** | How strongly an asset moves relative to BTC in this model |
| **Cascade** | Liquidations causing more liquidations |
| **Circuit breaker** | Pause or halt that stops the damage on one market |
| **Component** | A React function that returns part of the screen |
| **Cumulative depth** | Total liquidity from mid out to a given price level |
| **Drawdown** | % fall from the opening price |
| **Easing** | Moving smoothly toward a target instead of jumping |
| **fBM** | Layered noise that makes natural-looking terrain |
| **Fragment shader** | GPU program that picks each pixel's colour |
| **GLSL** | The language shaders are written in |
| **Hash / Hash chain** | Short fingerprint of data / fingerprints linked in sequence |
| **Hook** | React function for state/effects (`useState`, `useEffect`, …) |
| **Insurance Fund** | The exchange's money for covering losses |
| **Leverage** | Borrowing to take a bigger position |
| **Liquidation** | Forced close of a position below maintenance margin |
| **LOB** | Limit order book |
| **Maintenance margin** | Minimum collateral before liquidation |
| **Mark price** | The exchange's fair price for risk decisions |
| **Mid** | Halfway between best bid and best ask |
| **Orthographic** | Camera with no perspective shrinking |
| **Perp** | Perpetual futures contract; no expiry, can be leveraged |
| **Props** | Inputs passed to a component |
| **Ref** | Remembered value that doesn't trigger a redraw |
| **SEV-1 / SEV-2** | Critical / serious incident levels |
| **SLA** | Service Level Agreement: here, the time allowed to resolve |
| **Slippage** | Expected price vs actual fill price |
| **Snapshot** | This project's one function that computes every displayed number |
| **Stale reference** | A reference price that isn't updating (US market closed) |
| **State** | Changing data that redraws the screen |
| **Stress** | Liquidations ÷ the market's fair share of the threshold |
| **Uniform** | A value sent from JavaScript to a shader |
| **U(a, b)** | Random number between a and b, all equally likely |
| **Vertex / Vertex shader** | A 3D point / GPU program that positions each point |
| **Wireframe** | Drawing only the edges of a 3D shape |

---

# Part 10 · Test yourself

**Q1. Why does a liquidation cascade grow exponentially rather than linearly?**
<details><summary>Answer</summary>Each liquidation forces selling, which lowers the price and triggers more liquidations. The amount of new damage is proportional to the current damage, and anything that grows in proportion to itself grows exponentially. In the code: <code>L × g</code>, not <code>L + something</code>.</details>

**Q2. With an average growth of 1.174 per 2.5 s tick, roughly how long until liquidations double?**
<details><summary>Answer</summary>ln 2 / ln 1.174 ≈ 4.3 ticks ≈ 11 seconds.</details>

**Q3. What's the difference between Pause and Halt, and which is less harmful?**
<details><summary>Answer</summary>Pause stops forced liquidations but trading continues (less harmful). Halt freezes all trading on that market (last resort).</details>

**Q4. Why divide by <code>share</code> to get stress?**
<details><summary>Answer</summary>So small markets can be compared fairly with big ones. TSLA at stress 1.5 is as alarming as BTC at stress 1.5, even though BTC has far more liquidations in absolute terms.</details>

**Q5. Collapse depth at stress 2?**
<details><summary>Answer</summary>1 − e^(−1.6) ≈ 1 − 0.20 = 80%.</details>

**Q6. Why is every displayed number computed in <code>snapshot()</code>?**
<details><summary>Answer</summary>So every panel reads identical values and nothing on screen can disagree, which matters when a commander is under pressure.</details>

**Q7. Why do the simulation timers read from refs instead of state?**
<details><summary>Answer</summary>The timers start once. Without refs they would keep seeing the old values from when they started. The ref is updated in the same step as the state, so the timers always see current data.</details>

**Q8. What's the difference between the vertex and fragment shader here?**
<details><summary>Answer</summary>The vertex shader sets each point's height (ravines, cracks, shockwaves, the breaker flattening). The fragment shader sets each pixel's colour (heat scale, white meltdown, tearing, cyan).</details>

**Q9. What happens to the chain if someone edits log entry #5?**
<details><summary>Answer</summary>Entry 5's recomputed hash no longer matches its stored hash, and entry 6's "previous hash" no longer matches either, so verification fails from #5 onward and the header shows CHAIN BROKEN.</details>

**Q10. Why can the SLA timer never drift?**
<details><summary>Answer</summary>It doesn't count down by subtracting. Every second it recomputes remaining = deadline − now from the real clock.</details>

**Q11. Why does the USD-volume trigger usually fire before the liquidation-count SEV-1?**
<details><summary>Answer</summary>It's calibrated so $10M/min corresponds to about 400 liquidations/min, below the 500/min count threshold. That makes it an early warning.</details>

**Q12. Why is the 3D camera orthographic?**
<details><summary>Answer</summary>So heights and depths aren't distorted by perspective. It reads like a precise technical chart, not a video game.</details>

---

*If you can answer these 12 questions and explain the 5-step loop (detect → escalate → act → communicate → record), you understand the whole project.*
