// Shared by the 3D mesh and the panel readout, so the numbers on screen are
// exactly the ones driving the geometry. Kept free of three.js so importing it
// doesn't pull the 3D chunk into the main bundle.

/** Compounded per-tick growth at which the vortex reaches full strength */
export const FULL_VORTEX_GROWTH = 1.35

/** Angular velocity of the rolling spiral, radians per second */
export const BASE_OMEGA = 1.2
export const SEV1_OMEGA_MULTIPLIER = 3

/** 0 when the cascade is flat or shrinking, 1 at FULL_VORTEX_GROWTH or above */
export function vortexStrength(growth: number) {
  if (growth <= 1) return 0
  return Math.min(1, Math.log(growth) / Math.log(FULL_VORTEX_GROWTH))
}

export function vortexOmega(critical: boolean) {
  return BASE_OMEGA * (critical ? SEV1_OMEGA_MULTIPLIER : 1)
}
