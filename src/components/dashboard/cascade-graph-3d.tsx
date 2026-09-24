import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { vortexOmega, vortexStrength } from './cascade-dynamics'
import { LIQUIDATION_THRESHOLD, MARKET_LIST, type Market, type Metrics } from './use-incident-sim'

/*
 * Utilitarian 3D view of the cascade. Hard rules:
 *   - orthographic camera only, no lights, no shadows
 *   - MeshBasicMaterial (wireframe) plus Basic line/point materials, flat semantic colours
 *   - nothing solid or shaded; all motion is a deterministic function of the data and time
 */

const WHITE = new THREE.Color('#ffffff')
const AMBER = new THREE.Color('#ffb020')
const RED = new THREE.Color('#ff3b30')

const TICK_GAP = 0.75
const ROW_GAP = 1.9
const HEIGHT = 4.2
const ROWS = ['ALL', ...MARKET_LIST] as const
const CAMERA_POSITION = new THREE.Vector3(3.5, 6, 13)
const MAX_POINTS = 360

type Layout = ReturnType<typeof useLayout>

// Row 0 (ALL) sits nearest the camera
const zOf = (row: number) => ((ROWS.length - 1) / 2 - row) * ROW_GAP

// Keyed on the series arrays, which only change on counter ticks, so price
// updates between ticks don't rebuild geometry or refit the camera.
function useLayout({ liqHistory, liqByMarket }: Metrics) {
  return useMemo(() => {
    const n = liqHistory.length
    const width = (n - 1) * TICK_GAP
    const yScale = HEIGHT / Math.max(...liqHistory, LIQUIDATION_THRESHOLD * 1.15)
    return {
      n,
      width,
      x0: -width / 2,
      zOf,
      yScale,
      seriesOf: (row: number) => (row === 0 ? liqHistory : liqByMarket[MARKET_LIST[row - 1]]),
    }
  }, [liqHistory, liqByMarket])
}

function segmentGeometry(positions: number[], colors?: number[]) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geo
}

// Mesh resolution: columns along time, two segments per row gap. Kept coarse
// so every wire stays distinct at dashboard size.
const SEG_X = 44
const SEG_Z = 8

// Vortex shape, in the vertical (x-y) plane facing the camera, centred on the
// leading edge of the data. A vertex at distance r from the centre is rotated
// by strength * TWIST * ln(R / r), which curls the surface into a logarithmic
// spiral. A radial wave rolls along arms of constant (angle + PITCH * ln(r / R)),
// which are also log spirals; each market row rolls ROW_LAG radians behind the
// one in front, so the rows wind like a feedback loop.
const VORTEX_R = 3.4
const TWIST = 1.6
const ARMS = 3
const PITCH = 2.2
const RADIAL_AMPLITUDE = 0.28
const ROW_LAG = 0.6
const R_MIN = 0.3
// How fast the mesh eases toward new data and a new vortex strength (per second)
const DATA_EASE = 8
const STRENGTH_EASE = 2.5

/**
 * The cascade as a wireframe surface. Resting height is the liquidation data
 * (time along x, markets across z). While liquidations compound, vertices around
 * the newest data are twisted into a rolling logarithmic spiral whose strength
 * comes from the compounded growth factor. The spiral unwinds when growth stops.
 */
function VortexMesh({ layout, metrics, animate }: { layout: Layout; metrics: Metrics; animate: boolean }) {
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const invalidate = useThree((s) => s.invalidate)
  const latest = useRef(metrics)
  latest.current = metrics

  // The unit grid is copied once: useFrame overwrites the live position buffer
  // with world-space vertices every frame, so it can't be read back as the grid.
  const { geometry, unit } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1, SEG_X, SEG_Z)
    geo.rotateX(-Math.PI / 2)
    return { geometry: geo, unit: Float32Array.from(geo.attributes.position.array) }
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // Grid coordinates in world space, plus the data height each vertex rests at
  const grid = useMemo(() => {
    const src = unit
    const count = src.length / 3
    const x = new Float32Array(count)
    const z = new Float32Array(count)
    const target = new Float32Array(count)
    const { n, x0, width, yScale, seriesOf } = layout
    const lastRow = ROWS.length - 1
    for (let i = 0; i < count; i++) {
      const u = src[i * 3] + 0.5 // 0..1 along time
      const rowPos = (0.5 - src[i * 3 + 2]) * lastRow // 0 = ALL (front) .. 3 = SOL (back)
      x[i] = x0 + u * width
      z[i] = zOf(rowPos)
      const t = u * (n - 1)
      const i0 = Math.floor(t)
      const i1 = Math.min(i0 + 1, n - 1)
      const f = t - i0
      const r0 = Math.floor(rowPos)
      const r1 = Math.min(r0 + 1, lastRow)
      const g = rowPos - r0
      const at = (row: number) => {
        const s = seriesOf(row)
        return s[i0] + (s[i1] - s[i0]) * f
      }
      target[i] = (at(r0) + (at(r1) - at(r0)) * g) * yScale
    }
    return { count, x, z, target }
  }, [unit, layout])

  const dyn = useRef({ heights: null as Float32Array | null, strength: 0, phase: 0 })

  // With reduced motion the loop only renders on demand, so ask for a frame per data change
  useEffect(() => {
    if (!animate) invalidate()
  }, [animate, grid, metrics.critical, metrics.growth, invalidate])

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05)
    const m = latest.current
    const d = dyn.current
    const { count, x, z, target } = grid
    if (!d.heights || d.heights.length !== count) d.heights = Float32Array.from(target)

    // SEV-1 snaps the colour in the same frame; no blending
    material.current?.color.copy(m.critical ? RED : AMBER)

    const targetStrength = vortexStrength(m.growth)
    if (animate) {
      d.strength += (targetStrength - d.strength) * (1 - Math.exp(-STRENGTH_EASE * dt))
      d.phase += vortexOmega(m.critical) * dt
      const k = 1 - Math.exp(-DATA_EASE * dt)
      for (let i = 0; i < count; i++) d.heights[i] += (target[i] - d.heights[i]) * k
    } else {
      d.strength = targetStrength
      d.heights.set(target)
    }

    const { x0, width } = layout
    const cx = x0 + width - VORTEX_R * 0.45 // on the leading (newest) edge
    const cy = HEIGHT * 0.5
    const lnR = Math.log(VORTEX_R)
    const pos = geometry.attributes.position.array as Float32Array
    const S = d.strength

    for (let i = 0; i < count; i++) {
      let px = x[i]
      let py = d.heights[i]
      const pz = z[i]
      const dx = px - cx
      const dy = py - cy
      const r = Math.max(Math.hypot(dx, dy), R_MIN)
      if (S > 0 && r < VORTEX_R) {
        const lnr = Math.log(r)
        const angle = Math.atan2(dy, dx) + S * TWIST * (lnR - lnr)
        const falloff = 1 - r / VORTEX_R
        const wave = Math.cos(ARMS * (angle + PITCH * (lnr - lnR)) - d.phase - pz * ROW_LAG)
        const rr = r * (1 + S * RADIAL_AMPLITUDE * falloff * wave)
        px = cx + rr * Math.cos(angle)
        py = cy + rr * Math.sin(angle)
      }
      pos[i * 3] = px
      pos[i * 3 + 1] = py
      pos[i * 3 + 2] = pz
    }
    geometry.attributes.position.needsUpdate = true
  })

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial ref={material} wireframe color={AMBER} />
    </mesh>
  )
}

/** Floor frame, row baselines and time gridlines every 7 ticks */
function Floor({ layout }: { layout: Layout }) {
  const geometry = useMemo(() => {
    const { n, x0, width, zOf } = layout
    const x1 = x0 + width
    const zFront = zOf(0) + ROW_GAP / 2
    const zBack = zOf(ROWS.length - 1) - ROW_GAP / 2
    const pos: number[] = []
    ROWS.forEach((_, row) => pos.push(x0, 0, zOf(row), x1, 0, zOf(row)))
    for (let i = 0; i < n; i += 7) {
      const x = x0 + i * TICK_GAP
      pos.push(x, 0, zFront, x, 0, zBack)
    }
    pos.push(x0, 0, zFront, x1, 0, zFront, x1, 0, zFront, x1, 0, zBack, x1, 0, zBack, x0, 0, zBack, x0, 0, zBack, x0, 0, zFront)
    return segmentGeometry(pos)
  }, [layout])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={WHITE} transparent opacity={0.14} />
    </lineSegments>
  )
}

/** Red wireframe plane at the SEV-1 threshold over the ALL row */
function ThresholdPlane({ layout }: { layout: Layout }) {
  const { x0, width, zOf, yScale } = layout
  const y = LIQUIDATION_THRESHOLD * yScale
  const z = zOf(0)
  const geometry = useMemo(() => {
    const x1 = x0 + width
    const h = ROW_GAP * 0.35
    const pos: number[] = []
    // outline plus cross-hatching every 4 ticks
    pos.push(x0, y, z - h, x1, y, z - h, x1, y, z - h, x1, y, z + h, x1, y, z + h, x0, y, z + h, x0, y, z + h, x0, y, z - h)
    for (let x = x0; x <= x1 + 1e-6; x += TICK_GAP * 4) pos.push(x, y, z - h, x, y, z + h)
    return segmentGeometry(pos)
  }, [x0, width, y, z])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={RED} />
    </lineSegments>
  )
}

interface LabelAnchor {
  key: string
  text: string
  at: [number, number, number]
  /** right-aligned labels sit to the left of their anchor */
  align: 'left' | 'right'
  tone: string
}

function labelAnchors({ x0, width, yScale }: Layout): LabelAnchor[] {
  return [
    ...ROWS.map((row, i) => ({
      key: row,
      text: row.replace('-PERP', ''),
      at: [x0 - 0.3, 0, zOf(i)] as [number, number, number],
      align: 'right' as const,
      tone: 'text-gray-400',
    })),
    {
      key: 'threshold',
      text: `${LIQUIDATION_THRESHOLD}/min`,
      at: [x0 + width + 0.25, LIQUIDATION_THRESHOLD * yScale, zOf(0)],
      align: 'left',
      tone: 'text-crit',
    },
  ]
}

/**
 * Positions plain DOM labels over the canvas by projecting their 3D anchors.
 * The camera is fixed, so this only reruns when the layout or canvas size changes.
 * Declared after FitCamera so it projects through the already-fitted camera.
 */
function ProjectLabels({ anchors, nodes }: { anchors: LabelAnchor[]; nodes: RefObject<Map<string, HTMLElement>> }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    const v = new THREE.Vector3()
    const placed: { x: number; y: number }[] = []
    for (const a of anchors) {
      const el = nodes.current.get(a.key)
      if (!el) continue
      v.set(...a.at).project(camera)
      const px = ((v.x + 1) / 2) * size.width
      const py = ((1 - v.y) / 2) * size.height
      el.style.transform = `translate(${px}px, ${py}px) translate(${a.align === 'right' ? '-100%' : '0'}, -50%)`
      // Hide a label rather than let it overlap one already placed (narrow canvases)
      const collides = placed.some((p) => Math.abs(p.y - py) < 12 && Math.abs(p.x - px) < 40)
      el.style.visibility = collides ? 'hidden' : 'visible'
      if (!collides) placed.push({ x: px, y: py })
    }
  }, [anchors, camera, size, nodes])
  return null
}

/**
 * Live liquidations as points falling from the newest column of each market
 * row. Spawn rate follows each market's current rate; a market with pause or
 * halt engaged stops spawning, so its stream visibly drains while others continue.
 */
function FallingPoints({
  layout,
  metrics,
  engaged,
  animate,
}: {
  layout: Layout
  metrics: Metrics
  engaged: Record<Market, boolean>
  animate: boolean
}) {
  const points = useRef<THREE.Points>(null)
  const material = useRef<THREE.PointsMaterial>(null)
  const latest = useRef({ layout, metrics, engaged })
  latest.current = { layout, metrics, engaged }

  const state = useMemo(
    () => ({
      pos: new Float32Array(MAX_POINTS * 3).fill(-1000),
      vel: new Float32Array(MAX_POINTS),
      alive: new Uint8Array(MAX_POINTS),
      carry: 0,
    }),
    [],
  )
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(state.pos, 3))
    return geo
  }, [state])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((_, rawDelta) => {
    if (!animate) return
    const delta = Math.min(rawDelta, 0.05)
    const { layout: l, metrics: m, engaged: e } = latest.current
    const last = l.n - 1
    material.current?.color.copy(m.critical ? RED : AMBER)

    // One point per liquidation (per minute → per second) from markets still liquidating
    const activeRates = MARKET_LIST.map((mk) => (e[mk] ? 0 : m.liqByMarket[mk][last]))
    const activeTotal = activeRates.reduce((a, b) => a + b, 0)
    state.carry += Math.min(activeTotal / 60, 90) * delta
    while (state.carry >= 1) {
      state.carry -= 1
      const slot = state.alive.indexOf(0)
      if (slot === -1) break
      let r = Math.random() * activeTotal
      const row = 1 + Math.max(0, activeRates.findIndex((rate) => (r -= rate) < 0))
      state.alive[slot] = 1
      state.vel[slot] = 0.5
      state.pos[slot * 3] = l.x0 + last * TICK_GAP + (Math.random() - 0.5) * 0.3
      state.pos[slot * 3 + 1] = l.seriesOf(row)[last] * l.yScale
      state.pos[slot * 3 + 2] = l.zOf(row) + (Math.random() - 0.5) * 0.3
    }

    for (let i = 0; i < MAX_POINTS; i++) {
      if (!state.alive[i]) continue
      state.vel[i] += 9 * delta
      state.pos[i * 3 + 1] -= state.vel[i] * delta
      state.pos[i * 3] += 0.35 * delta // drift forward in time as they fall
      if (state.pos[i * 3 + 1] <= 0) {
        state.alive[i] = 0
        state.pos[i * 3 + 1] = -1000
      }
    }
    geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial ref={material} size={2.5} sizeAttenuation={false} color={AMBER} />
    </points>
  )
}

/** Fits the fixed isometric view to the canvas: zoom to the scene's projected bounds, then recentre */
function FitCamera({ layout }: { layout: Layout }) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const { x0, width, zOf } = layout

  useLayoutEffect(() => {
    const zMin = zOf(ROWS.length - 1) - ROW_GAP / 2
    const zMax = zOf(0) + ROW_GAP / 2
    camera.position.copy(CAMERA_POSITION)
    camera.lookAt(0, HEIGHT / 2, 0)
    camera.updateMatrixWorld()
    const min = new THREE.Vector2(Infinity, Infinity)
    const max = new THREE.Vector2(-Infinity, -Infinity)
    const v = new THREE.Vector3()
    for (const x of [x0 - 1.2, x0 + width + 1.4])
      for (const y of [-0.8, HEIGHT + 0.8]) // room for the curl to dip below the floor and rise over the peak
        for (const z of [zMin, zMax]) {
          v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse)
          min.min(new THREE.Vector2(v.x, v.y))
          max.max(new THREE.Vector2(v.x, v.y))
        }
    camera.translateX((min.x + max.x) / 2)
    camera.translateY((min.y + max.y) / 2)
    camera.zoom = Math.min(size.width / (max.x - min.x), size.height / (max.y - min.y)) * 0.94
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, size, x0, width, zOf, invalidate])

  return null
}

export default function CascadeGraph3D({
  metrics,
  engaged,
  className,
}: {
  metrics: Metrics
  /** Markets with pause or halt engaged */
  engaged: Record<Market, boolean>
  className?: string
}) {
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const layout = useLayout(metrics)
  const anchors = useMemo(() => labelAnchors(layout), [layout])
  const labelNodes = useRef(new Map<string, HTMLElement>())
  const last = metrics.liqHistory.length - 1
  const summary = `Liquidation cascade over the last ${metrics.liqHistory.length} ticks. Latest: ${metrics.liquidations.toLocaleString('en-US')} per minute total; ${MARKET_LIST.map(
    (m) => `${m.replace('-PERP', '')} ${metrics.liqByMarket[m][last].toLocaleString('en-US')}`,
  ).join(', ')}. Compounding at ×${metrics.growth.toFixed(2)} per tick; vortex at ${Math.round(vortexStrength(metrics.growth) * 100)}%.`

  return (
    <div className={cn('relative', className)} role="img" aria-label={summary}>
      <Canvas
        orthographic
        camera={{ position: CAMERA_POSITION.toArray(), zoom: 30, near: -200, far: 200 }}
        frameloop={reducedMotion ? 'demand' : 'always'}
        dpr={[1, 2]}
        flat
        linear
        gl={{ antialias: true, alpha: true }}
        fallback={<p className="p-3 font-mono text-[11px] text-gray-500">WebGL unavailable. {summary}</p>}
      >
        <FitCamera layout={layout} />
        <Floor layout={layout} />
        <ThresholdPlane layout={layout} />
        <VortexMesh layout={layout} metrics={metrics} animate={!reducedMotion} />
        <FallingPoints layout={layout} metrics={metrics} engaged={engaged} animate={!reducedMotion} />
        <ProjectLabels anchors={anchors} nodes={labelNodes} />
      </Canvas>
      {anchors.map((a) => (
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
