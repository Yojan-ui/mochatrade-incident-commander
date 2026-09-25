import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-800-normal.woff?url'
import { cn } from '@/lib/utils'
import type { LaneState } from './cascade-dynamics'
import type { Market, Metrics } from './use-incident-sim'

/*
 * Single-asset limit-order-book (LOB) surface.
 *
 *   x  price level on the bid side: mid at the right edge, 2% below mid at the left
 *   z  across the book (order queue position)
 *   y  cumulative bid liquidity resting at or above that level
 *
 * A healthy book follows the standard cumulative-depth curve: thin at mid,
 * thickening deeper into the book. During a cascade, liquidity near mid is
 * pulled. Severity comes from the historical crash replay
 * (src/data/historical-crash.json): each tick's severity is fed into uSeverity,
 * which scales multi-octave simplex fBM exponentially in amplitude, so the
 * floor caves into wide canyons that churn slowly on a slowed clock exactly
 * when the recorded timeline says. Each liquidation spike sends a slow
 * shockwave out from mid.
 *
 * Heat is the share of the drop to the floor: green, yellow, then #EF4444.
 * Wires that hit the floor turn white (liquidations executing); the deepest
 * red wires lose opacity and shred into holes. A circuit breaker hard-zeroes
 * severity, snapping the surface flat and cyan in the same frame.
 *
 * Hard rules: orthographic camera, no lights, no shadows, wireframe only, and
 * no lighting terms anywhere in the shader.
 */

const WIDTH = 24 // x: price levels
const DEPTH = 9 // z: across the book
// Extreme density for razor-edged ravines, with square cells on the 24×9 surface
// (320/24 ≈ 128/9 ≈ 13.3 segments per unit). ~41k vertices.
const SEG_X = 320
const SEG_Z = 128
/** Height of a fully healthy book at its deepest level */
const BOOK_HEIGHT = 2.6
/** How far a total loss cuts below the floor */
const RAVINE_DEPTH = 5
/** Bid levels shown, as % below mid */
const BOOK_SPAN_PCT = 2
/**
 * Severity follows the replay closely: ~1 s to 95% of each new tick's value
 * (ticks arrive every 0.5 s), which hides the steps without lagging the
 * timeline. Only the circuit breaker is instant.
 */
const SEVERITY_EASE = 2.5
/** Shockwave: travel speed across the surface (uv units/s) and lifetime (s) */
const SHOCK_SPEED = 0.2
const SHOCK_LIFE = 5
/** Circuit-breaker banner: hard on/off at 1.25 Hz, under the 3-flashes-per-second limit */
const FLASH_HZ = 1.25
const CAMERA_POSITION = new THREE.Vector3(3.5, 7, 12)

const X_LEFT = -WIDTH / 2
const X_RIGHT = WIDTH / 2
const Z_FRONT = DEPTH / 2
const Z_BACK = -DEPTH / 2

const BANNER_FONT = 1.15
const BANNER_W = 22
const BANNER_H = 1.9
const BANNER_Y = 0.6

const COLORS = {
  green: new THREE.Color('#22c55e'),
  yellow: new THREE.Color('#eab308'),
  red: new THREE.Color('#ef4444'),
  cyan: new THREE.Color('#06b6d4'),
}

/** Distinct fracture pattern per asset */
const SEEDS: Partial<Record<Market, number>> = { 'BTC-PERP': 3.7, 'ETH-PERP': 21.4, 'SOL-PERP': 38.9 }

// 3D simplex noise: Ashima Arts / Stefan Gustavson (MIT licence)
const simplex3d = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`

const vertexShader = /* glsl */ `
  uniform float uSeverity; // 0..1, the historical replay's severity; hard-zeroed by a breaker
  uniform float uBreaker;
  uniform float uTime;
  uniform float uSeed;
  uniform float uHeight;
  uniform float uRavine;
  uniform float uAspect;
  uniform float uShockAge;
  uniform float uShockAmp;
  uniform float uShockSpeed;
  uniform float uShockLife;
  varying float vHeat; // share of the drop from healthy depth to the floor, 0..1; -1 = breaker
  varying float vCore; // 1 where the surface has hit the floor: liquidations executing
  varying float vTear; // noise field that decides where the deepest wires shred

  ${simplex3d}

  // Fractal Brownian motion: 5 octaves of simplex, roughly [-1, 1]
  float fbm(vec3 p) {
    float sum = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += a * snoise(p);
      p = p * 2.03 + vec3(17.1, 3.3, 5.9);
      a *= 0.42; // damped fine octaves: fewer, wider, more massive features
    }
    return sum;
  }

  // Ridged fBM: sharp creases where the noise crosses zero, roughly [0, 1]
  float ridged(vec3 p) {
    float sum = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      float n = 1.0 - abs(snoise(p));
      sum += a * n * n;
      p = p * 2.11 + vec3(9.7, 1.3, 4.1);
      a *= 0.42; // damped fine octaves: fewer, wider, more massive features
    }
    return sum;
  }

  void main() {
    vec3 p = position;
    float d = 1.0 - uv.x; // distance from mid: 0 at mid, 1 at the deepest level shown
    float sev = uSeverity;

    // Cumulative bid depth of a healthy book
    float healthy = uHeight * (0.22 + 0.78 * (1.0 - exp(-d / 0.28)));

    // All noise runs on a slowed clock so the surface churns deliberately,
    // like a structure giving way, not static
    float t = uTime * 0.06;
    float amp = (exp(2.4 * sev) - 1.0) / (exp(2.4) - 1.0);
    float freq = 1.1 * exp2(1.2 * sev); // low and gently climbing: wide canyons
    float speed = 0.3 + 1.5 * sev * sev;
    vec3 q = vec3(d * uAspect * freq * 0.3, uv.y * freq * 0.3, t * speed) + vec3(uSeed);

    float churn = fbm(q);
    float crack = ridged(q * 1.15 + vec3(0.0, 0.0, t * speed * 0.5));
    float nearMid = exp(-d / 0.38);

    // Share of liquidity lost at this level
    float loss = clamp(sev * nearMid * (0.35 + 0.9 * crack) + amp * nearMid * 0.45 * churn, 0.0, 1.0);

    // Shockwave: a ring expanding from mid (right edge, centre of the book)
    vec2 rq = vec2(d * uAspect, uv.y - 0.5);
    float front = uShockAge * uShockSpeed * uAspect;
    float fade = clamp(1.0 - uShockAge / uShockLife, 0.0, 1.0);
    float ring = uShockAmp * fade * exp(-pow((length(rq) - front) / 0.35, 2.0));
    // A tremor, not a collapse: the slow ease on severity carries the cave-in
    loss = clamp(loss + ring * 0.3 * nearMid + ring * 0.12, 0.0, 1.0);

    float h = healthy * (1.0 - loss) - uRavine * loss * loss;

    // Settling: a slow, low-frequency sag that only ever pushes downward
    float settle = snoise(vec3(uv.x * 18.0, uv.y * 7.0, t * 4.0));
    h -= amp * nearMid * 0.25 * abs(settle);
    // Broken slabs jutting up from the ravine walls
    h += amp * nearMid * 0.45 * pow(max(churn, 0.0), 3.0);

    // The floor: anything that reaches it is liquidations executing. White marks
    // the rim where the collapse first meets the floor (the last 0.35 units of
    // the drop) and sparse sparks across it; the rest of the floor shreds red.
    float floorY = -uRavine;
    float rim = 1.0 - smoothstep(floorY, floorY + 0.35, h);
    h = max(h, floorY);
    vHeat = clamp((healthy - h) / (healthy + uRavine), 0.0, 1.0);
    vTear = snoise(vec3(uv.x * 45.0, uv.y * 20.0, t * 3.0)) * 0.5 + 0.5;
    float onFloor = h <= floorY + 0.001 ? 1.0 : 0.0;
    vCore = max(rim * (1.0 - onFloor), onFloor * step(0.78, vTear));

    // Circuit breaker: severity is already zero; the surface is rigid, flat and cyan
    if (uBreaker > 0.5) {
      h = 0.0;
      vHeat = -1.0;
      vCore = 0.0;
    }

    p.z = h; // plane is rotated so local z is world y
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uGreen;
  uniform vec3 uYellow;
  uniform vec3 uRed;
  uniform vec3 uCyan;
  varying float vHeat;
  varying float vCore;
  varying float vTear;

  void main() {
    if (vHeat < 0.0) {
      gl_FragColor = vec4(uCyan, 1.0);
      return;
    }
    // Core meltdown: the surface has hit the floor
    if (vCore > 0.5) {
      gl_FragColor = vec4(1.0);
      return;
    }
    vec3 c = vHeat < 0.35
      ? mix(uGreen, uYellow, vHeat / 0.35)
      : mix(uYellow, uRed, clamp((vHeat - 0.35) / 0.4, 0.0, 1.0));

    // Thermal tearing: the deepest red wires thin out and shred into holes
    float deep = smoothstep(0.7, 1.0, vHeat);
    if (vTear < deep * 0.55) discard;
    gl_FragColor = vec4(c, 1.0 - 0.45 * deep);
  }
`

function Surface({
  assetId,
  target,
  state,
  shock,
  animate,
}: {
  assetId: Market
  /** Severity to track: the historical replay's current tick, 0..1 */
  target: number
  state: LaneState
  /** Bumped per liquidation spike: { id, amp } starts a new shockwave */
  shock: { id: unknown; amp: number }
  animate: boolean
}) {
  const invalidate = useThree((s) => s.invalidate)
  const geometry = useMemo(() => new THREE.PlaneGeometry(WIDTH, DEPTH, SEG_X, SEG_Z), [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        wireframe: true,
        transparent: true, // alpha tear on the deepest wires
        uniforms: {
          uSeverity: { value: 0 },
          uBreaker: { value: 0 },
          uTime: { value: 0 },
          uSeed: { value: 0 },
          uHeight: { value: BOOK_HEIGHT },
          uRavine: { value: RAVINE_DEPTH },
          uAspect: { value: WIDTH / DEPTH },
          uShockAge: { value: SHOCK_LIFE },
          uShockAmp: { value: 0 },
          uShockSpeed: { value: SHOCK_SPEED },
          uShockLife: { value: SHOCK_LIFE },
          uGreen: { value: COLORS.green },
          uYellow: { value: COLORS.yellow },
          uRed: { value: COLORS.red },
          uCyan: { value: COLORS.cyan },
        },
      }),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  // Switching asset: new fracture pattern (same replay timeline)
  useEffect(() => {
    material.uniforms.uSeed.value = SEEDS[assetId] ?? 0
    material.uniforms.uShockAge.value = SHOCK_LIFE
    invalidate()
  }, [assetId, material, invalidate])

  // New spike: restart the shockwave. A tab switch also changes the series, so
  // only fire for new ticks on the asset already on screen.
  const shownAsset = useRef(assetId)
  useEffect(() => {
    const sameAsset = shownAsset.current === assetId
    shownAsset.current = assetId
    if (!sameAsset || shock.amp <= 0) return
    material.uniforms.uShockAge.value = 0
    material.uniforms.uShockAmp.value = shock.amp
  }, [shock, assetId, material])

  const latest = useRef({ target, state })
  latest.current = { target, state }

  useEffect(() => {
    if (!animate) invalidate()
  }, [animate, target, state, invalidate])

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05)
    const u = material.uniforms
    const { target: t, state: s } = latest.current
    const breaker = s !== 'live'
    u.uBreaker.value = breaker ? 1 : 0
    if (breaker) {
      // Hard stop: severity zeroes this frame, so all fBM churn vanishes at once.
      // On release the book rebuilds from flat toward the replay's current tick.
      u.uSeverity.value = 0
      u.uShockAge.value = SHOCK_LIFE
    } else {
      const k = animate ? 1 - Math.exp(-SEVERITY_EASE * dt) : 1
      u.uSeverity.value += (t - u.uSeverity.value) * k
    }
    if (animate) {
      u.uTime.value += dt
      u.uShockAge.value = Math.min(SHOCK_LIFE, u.uShockAge.value + dt)
    } else {
      u.uShockAge.value = SHOCK_LIFE // no moving shockwaves with reduced motion
    }
  })

  return <mesh geometry={geometry} material={material} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} />
}

const PLATE_OUTLINE = (() => {
  const w = BANNER_W / 2
  const h = BANNER_H / 2
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-w, -h, 0.01, w, -h, 0.01, w, h, 0.01, -w, h, 0.01], 3))
  return geo
})()

/**
 * Brutalist plate over the surface while a circuit breaker is on: black slab,
 * 1px cyan rule, cyan stencil text. Faces the camera, hard-blinks, no fade.
 * Always mounted (hidden while live) so the font is ready before the first trip,
 * and drawn over the terrain because it is a warning, not part of the book.
 */
function BreakerBanner({ state, animate }: { state: LaneState; animate: boolean }) {
  const group = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  const latest = useRef(state)
  latest.current = state
  useEffect(() => {
    if (!animate) invalidate()
  }, [animate, state, invalidate])
  useFrame(({ clock }) => {
    if (!group.current) return
    const blinkOn = !animate || Math.floor(clock.elapsedTime * FLASH_HZ * 2) % 2 === 0
    group.current.visible = latest.current !== 'live' && blinkOn
  })
  return (
    <Billboard position={[0, BANNER_Y, 0]} ref={group} visible={false}>
      {/* transparent (at full opacity) puts the plate in the same render pass as the
          surface, which is transparent for its alpha tear; renderOrder then draws it last */}
      <mesh renderOrder={10}>
        <planeGeometry args={[BANNER_W, BANNER_H]} />
        <meshBasicMaterial color="#000000" transparent depthTest={false} depthWrite={false} />
      </mesh>
      <lineLoop geometry={PLATE_OUTLINE} renderOrder={11}>
        <lineBasicMaterial color={COLORS.cyan} transparent depthTest={false} depthWrite={false} />
      </lineLoop>
      <Text
        renderOrder={12}
        material-depthTest={false}
        material-depthWrite={false}
        font={monoFont}
        fontSize={BANNER_FONT}
        letterSpacing={0.04}
        color={COLORS.cyan}
        anchorX="center"
        anchorY="middle"
        position={[0, 0, 0.02]}
      >
        {`CIRCUIT BREAKER // ${state === 'paused' ? 'PAUSED' : 'HALTED'}`}
      </Text>
    </Billboard>
  )
}

/** Floor outline, mid-price line and price-level ticks, as reference geometry */
function Frame() {
  const geometry = useMemo(() => {
    const pos: number[] = []
    pos.push(X_LEFT, 0, Z_BACK, X_RIGHT, 0, Z_BACK, X_RIGHT, 0, Z_BACK, X_RIGHT, 0, Z_FRONT)
    pos.push(X_RIGHT, 0, Z_FRONT, X_LEFT, 0, Z_FRONT, X_LEFT, 0, Z_FRONT, X_LEFT, 0, Z_BACK)
    for (let i = 0; i <= 4; i++) {
      const x = X_RIGHT - (i / 4) * WIDTH
      pos.push(x, 0, Z_FRONT, x, 0, Z_FRONT + 0.35) // tick marks along the front edge
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return geo
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.25} />
    </lineSegments>
  )
}

interface LabelAnchor {
  key: string
  text: string
  at: [number, number, number]
  align: 'left' | 'right' | 'center'
  tone: string
}

// Price-level ticks along the front edge: mid on the right, deeper bids to the left
const ANCHORS: LabelAnchor[] = Array.from({ length: 5 }, (_, i) => ({
  key: `tick-${i}`,
  text: i === 0 ? 'mid' : `−${((i / 4) * BOOK_SPAN_PCT).toFixed(1)}%`,
  at: [X_RIGHT - (i / 4) * WIDTH, 0, Z_FRONT + 0.9] as [number, number, number],
  align: 'center' as const,
  tone: i === 0 ? 'text-gray-300' : 'text-gray-500',
}))

/**
 * Positions plain DOM labels over the canvas by projecting their 3D anchors.
 * Declared after FitCamera so it projects through the already-fitted camera.
 */
function ProjectLabels({ nodes }: { nodes: RefObject<Map<string, HTMLElement>> }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    const v = new THREE.Vector3()
    for (const a of ANCHORS) {
      const el = nodes.current.get(a.key)
      if (!el) continue
      v.set(...a.at).project(camera)
      const px = ((v.x + 1) / 2) * size.width
      const py = ((1 - v.y) / 2) * size.height
      const shift = a.align === 'right' ? '-100%' : a.align === 'center' ? '-50%' : '0'
      el.style.transform = `translate(${px}px, ${py}px) translate(${shift}, -50%)`
      el.style.visibility = 'visible'
    }
  }, [camera, size, nodes])
  return null
}

/** Fits the fixed axonometric view to the canvas: zoom to the scene's projected bounds, then recentre */
function FitCamera() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)

  useLayoutEffect(() => {
    camera.position.copy(CAMERA_POSITION)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const min = new THREE.Vector2(Infinity, Infinity)
    const max = new THREE.Vector2(-Infinity, -Infinity)
    const v = new THREE.Vector3()
    for (const x of [X_LEFT - 1, X_RIGHT]) // left margin keeps the −2.0% tick label on canvas
      for (const y of [-RAVINE_DEPTH, BOOK_HEIGHT + 0.2])
        for (const z of [Z_BACK, Z_FRONT + 1.2]) {
          v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse)
          min.min(new THREE.Vector2(v.x, v.y))
          max.max(new THREE.Vector2(v.x, v.y))
        }
    camera.translateX((min.x + max.x) / 2)
    camera.translateY((min.y + max.y) / 2)
    camera.zoom = Math.min(size.width / (max.x - min.x), size.height / (max.y - min.y)) * 0.98
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, size, invalidate])

  return null
}

export default function CascadeGraph3D({
  assetId,
  metrics,
  state,
  className,
}: {
  assetId: Market
  metrics: Metrics
  state: LaneState
  className?: string
}) {
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const labelNodes = useRef(new Map<string, HTMLElement>())
  const severity = metrics.severity

  // One shockwave per liquidation spike in this market, sized by the relative jump
  const series = metrics.liqByMarket[assetId]
  const shock = useMemo(() => {
    const now = series[series.length - 1]
    const prev = series[series.length - 2] ?? now
    const rel = prev > 0 ? (now - prev) / prev : 0
    return { id: series, amp: rel > 0.02 ? Math.min(1, 0.3 + rel * 3) : 0 }
  }, [series])

  const summary =
    state === 'live'
      ? `${assetId} bid-side order book, historical replay tick ${metrics.replayTick} (${metrics.replayPhase}): severity ${severity.toFixed(2)}.`
      : `${assetId} bid-side order book: circuit breaker, ${state}. Surface flat.`

  return (
    <div className={cn('relative bg-black', className)} role="img" aria-label={summary}>
      <Canvas
        orthographic
        camera={{ position: CAMERA_POSITION.toArray(), zoom: 30, near: -200, far: 200 }}
        frameloop={reducedMotion ? 'demand' : 'always'}
        dpr={[1, 2]}
        flat
        linear
        gl={{ antialias: true }}
        fallback={<p className="p-3 font-mono text-[11px] text-gray-500">WebGL unavailable. {summary}</p>}
      >
        <color attach="background" args={['#000000']} />
        <FitCamera />
        <Frame />
        <Surface assetId={assetId} target={severity} state={state} shock={shock} animate={!reducedMotion} />
        {/* Text suspends while its font loads; keep that from blanking the surface */}
        <Suspense fallback={null}>
          <BreakerBanner state={state} animate={!reducedMotion} />
        </Suspense>
        <ProjectLabels nodes={labelNodes} />
      </Canvas>
      {ANCHORS.map((a) => (
        <span
          key={a.key}
          ref={(el) => {
            if (el) labelNodes.current.set(a.key, el)
            else labelNodes.current.delete(a.key)
          }}
          aria-hidden
          className={cn('pointer-events-none invisible absolute top-0 left-0 font-mono text-[10px] whitespace-nowrap', a.tone)}
        >
          {a.text}
        </span>
      ))}
    </div>
  )
}
