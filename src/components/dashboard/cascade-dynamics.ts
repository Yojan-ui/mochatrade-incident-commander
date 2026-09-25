// Shared by the 3D order-book view and the panel readout, so the numbers on
// screen are exactly the ones driving the geometry. Kept free of three.js so
// importing it doesn't pull the 3D chunk into the main bundle.
import type { Market } from './use-incident-sim'

/** Markets drawn as lanes in the 3D limit-order-book surface, front to back */
export const CASCADE_LANES: readonly Market[] = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP']

/** A lane's circuit-breaker state: live, liquidations paused, or trading halted */
export type LaneState = 'live' | 'paused' | 'halted'

/**
 * Share of bid-side liquidity lost near mid, 0 (intact book) to 1 (gone).
 * Saturating in the market's stress: at threshold pace (stress 1) the lane is
 * ~55% collapsed, at double pace ~80%. A lane behind a circuit breaker is 0.
 */
export function collapseDepth(stress: number, state: LaneState) {
  if (state !== 'live') return 0
  return 1 - Math.exp(-0.8 * Math.max(0, stress))
}
