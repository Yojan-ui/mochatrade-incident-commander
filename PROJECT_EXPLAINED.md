# MochaTrade Flash-Crash Incident Response Dashboard

## The one-line pitch

> "When a crypto exchange's prices crash, forced liquidations snowball and the support team gets flooded. This dashboard puts the incident commander's controls on one screen: it **detects** the cascade, **escalates** it automatically, lets them **act** with one click, and **logs** every decision."

---

## 1. The problem it solves

MochaTrade is a fictional crypto exchange that offers leveraged trading. In a **flash crash**:

1. The price drops sharply.
2. Traders who borrowed money (margin) fall below the required collateral, so the exchange **force-closes** their positions. That is a *liquidation*.
3. Those forced sales push the price down further, which triggers more liquidations. This feedback loop is a **liquidation cascade**.
4. Angry users flood support with tickets.

The person in charge, the **incident commander**, has to see this happening, decide fast, act, and tell users what's going on. The dashboard is built around those four steps.

---

## 2. What's on the screen

```
┌──────────────────────── Header: INC-2417 · SEV level · timer · commander ─────────────┐
│ [ red SEV-1 banner, only appears when liquidations > 500/min ]                        │
├────────────────────────────────────────────────────────┬──────────────────────────────┤
│  MELTDOWN SIGNALS                                      │  INCIDENT STREAM             │
│  [Liquidations] ── [BTC price] ── [Support tickets]     │  live terminal-style log     │
│  stats strip: load % · peak · avg · Δtickets · engine  │  timestamp  LIQ/SEV/OPS/…    │
├────────────────────────────────────────────────────────┤                              │
│  RESPONSE ACTIONS                                      │                              │
│  [Pause liquidations] [Halt trading] [Broadcast status]│  risk@mocha:~$ ▌             │
└────────────────────────────────────────────────────────┴──────────────────────────────┘
```

### A. Meltdown signals (the "sense" part)

- **Liquidations per minute**: the main danger number, with a sparkline (a tiny chart) of the last 28 readings. A dashed red line on the chart marks the 500 threshold.
- **BTC-PERP mark price** in the centre, with its % drop.
- **Open support tickets**, with its own sparkline.
- A **stats strip**: threshold load (e.g. 198% means about double the limit), peak, average, ticket change, whether the liquidation engine is running or paused, and whether order entry is open or halted.

### B. Automatic escalation

When liquidations cross **500/min**, the incident flips to **SEV-1 CRITICAL** on its own:

- a solid red banner appears across the top;
- the panel header turns red and the borders turn bright red;
- the header badge changes from SEV-2 to SEV-1;
- the log records "escalated to SEV-1, paging head of risk".

When the rate drops back under 500, it de-escalates and logs that too.

### C. Response actions (the "act" part)

The actions are styled like hardware switches with a status lamp.

| Button | What it does in the simulation |
|---|---|
| **Pause margin liquidations** | Stops force-closing positions. Liquidations fall 25–45% each update, and prices stop falling. |
| **Halt trading** | Freezes all markets. Liquidations collapse fastest and prices freeze. |
| **Broadcast incident status** | Posts an update to users. New support tickets slow down sharply. |

- Each button goes **STANDBY → EXECUTING → ENGAGED/SENT**, with a timestamp.
- Pause and Halt can be switched back off.
- The **broadcast message draft writes itself** from the live data. For example, once you've paused liquidations it adds "Margin liquidations are paused."

### D. Incident stream (the "record" part)

A live terminal-style log. Every line has a timestamp and a colour-coded tag:

| Tag | Colour | Meaning |
|---|---|---|
| `LIQ` | amber | Individual liquidation events, e.g. `BTC-PERP long 12.4 BTC @ 60,358.4 acct 7f3a…c91 slip 3.1%` |
| `SEV` | red | Escalations |
| `OPS` | green | Actions the commander took |
| `TKT` | blue | Support ticket surges |
| `SYS` | gray | System messages |

- It follows new lines automatically. If you scroll up to read, it stops following and shows a "Jump to latest" button.
- **Why it matters:** this is the audit trail. Real incident post-mortems need to know *who did what, when*.

---

## 3. How it works under the hood

### Tech stack

- **React 19 + TypeScript**: the UI and type safety.
- **Vite**: the dev server and build tool.
- **Tailwind CSS v4**: styling.
- **motion** (Framer Motion): small animations such as log lines fading in.
- **lucide-react**: icons.
- The layout follows **shadcn** conventions (`components/ui`, `@/` import paths, `cn()` helper).

### File map

```
src/
├── App.tsx                         → page layout, header, SEV-1 banner; wires everything together
├── index.css                       → colour tokens (black, red, green…), fonts
└── components/dashboard/
    ├── use-incident-sim.ts         → THE BRAIN: simulation engine (all data + logic)
    ├── signal-node.tsx             → the signals panel, sparklines, stats strip
    ├── action-grid.tsx             → the three action switches + auto-drafted message
    └── incident-stream.tsx         → the terminal log
```

### The key architecture idea: one brain, many displays

All data lives in a single custom React hook, `useIncidentSim()`. The components never calculate anything themselves; they only display what the hook gives them.

```
             useIncidentSim()  ← the only place data changes
                    │
     returns { metrics, actions, logs, runAction }
                    │
   ┌────────────────┼──────────────────┬─────────────────┐
 SignalNode      ActionGrid       IncidentStream       App (banner)
 (displays)      (displays +      (displays)           (displays)
                  calls runAction)
```

**Why this matters (a good point for judges):** in a real incident, if the banner said 612 and the counter said 598, the commander would stop trusting the dashboard. So every figure (current value, change, peak, average, load %, SEV-1 status, drawdown) is calculated once, in one `snapshot()` function, and delivered together. In testing, over 120 samples, the counter, banner, header and message draft never disagreed.

### The simulation engine: two clocks

There's no real exchange behind this, so the hook generates realistic data with two timers.

#### Clock 1, every 2–3 seconds (random): the counters

- Liquidations are **multiplied** by a growth factor each update:
  - normally ×1.08–1.20, i.e. 8–20% growth;
  - a 22% chance of a spike on top;
  - a 12% chance of a brief lull.
- Because it multiplies rather than adds, growth **compounds**, which is exactly how a real cascade behaves. That's why the sparkline curves steeply upward instead of rising in a straight line.
- Support tickets increase in proportion to liquidations, so they compound too.
- If an action is active, it changes the maths:
  - **Pause**: ×0.55–0.75 (shrinks)
  - **Halt**: ×0.35–0.55
  - **Broadcast**: ticket growth mostly stops
- It checks whether liquidations crossed 500, and logs escalation or de-escalation.

#### Clock 2, every 0.85 seconds: prices and liquidation events

- BTC, ETH and SOL prices each drop a little. The drop is bigger when liquidations are higher (more forced selling means more price pressure).
- ETH falls 1.25× as hard as BTC and SOL 1.6×, because altcoins crash harder. That's real market behaviour.
- The fall slows as the crash deepens but never reverses on its own. **Only Pause or Halt stops it.**
- It then may log a liquidation event at the *current* price. So logged prices always go down in sequence, and they match the BTC price shown in the centre.

#### Why use refs?

The timers are created once and keep running. To read the latest data without restarting, they read it through React `useRef` values, which are updated in the same step as the React state. This keeps the timers and the screen in sync.

---

## 4. A worked example to demo

1. **0s:** The page loads. Liquidations are at 184/min, SEV-2, and BTC is falling.
2. **~20–30s:** The cascade compounds and crosses 500. The screen turns red, SEV-1 triggers, and the log says "paging head of risk".
3. **Click "Pause margin liquidations":** the lamp goes amber, then green (ENGAGED). The log records it, BTC stops falling immediately, liquidation events stop, and the counter falls over the next few updates.
4. **Click "Broadcast":** the draft already mentions the pause. It's sent and logged, and ticket growth slows.
5. **The rate drops under 500:** it de-escalates automatically and the log notes it.

That is the full sequence in about a minute: **detect → escalate → act → communicate → recover**.

---

## 5. Design decisions worth mentioning

- **Utilitarian look** (inspired by Bloomberg terminals and Linear): pure black, sharp corners, 1px borders, no glows. In a crisis, clarity matters more than decoration.
- **Colour means something:**
  - red = danger or destructive action;
  - green = safe or executed;
  - amber = warning or in progress;
  - gray = labels.
  - Only the actual data is bright white, so your eye goes straight to the numbers.
- **Monospace font for every number**, so digits line up and don't jump around as they change.
- **No animated counters.** Numbers snap to their new value, because a rolling number briefly shows a false value.
- **Accessibility:**
  - visible keyboard focus;
  - the log is announced to screen readers (`role="log"`, `aria-live`);
  - the banner uses `role="alert"`;
  - animations respect the "reduce motion" setting;
  - the layout works on phones.

---

## 6. Questions judges might ask

**"Is this real data?"**
No. It's a realistic simulation, so the demo runs anywhere. It's built so a real data source could replace the simulation hook: the display components only read the `metrics` and `logs` it returns, so they wouldn't need to change.

**"Why 500 per minute?"**
It's the configurable SEV-1 threshold (`LIQUIDATION_THRESHOLD`). A real exchange would tune it.

**"Why pause liquidations instead of always halting?"**
Pausing stops the cascade but keeps trading open, which does less harm to users. Halting is the last resort, which is why it's the red button.

**"How do you avoid the numbers disagreeing?"**
Everything is calculated once and delivered as a single state object.

**"Why do the charts curve upward?"**
Cascades compound: each liquidation pushes the price down, which causes more. The simulation models this with multiplicative growth.

---

## 7. Honest limitations (good to acknowledge if asked)

- It's frontend only, with no backend, login, or real alerts (the "paging" and "broadcast" are simulated).
- The data resets when you reload the page.
- There's no confirmation step before Halt. A production version should add one for destructive actions.

---

## Running it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).
