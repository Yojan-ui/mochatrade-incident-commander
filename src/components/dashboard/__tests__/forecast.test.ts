import { describe, expect, it } from 'vitest'
import { MEAN_TICK_S, backtest, fitLogLinear, forecastCascade } from '../forecast'

const geometric = (start: number, g: number, n: number) => Array.from({ length: n }, (_, i) => start * g ** i)

describe('fitLogLinear', () => {
  it('recovers the exact growth rate of a clean exponential', () => {
    const fit = fitLogLinear(geometric(100, 1.2, 8))!
    expect(Math.exp(fit.b)).toBeCloseTo(1.2, 10)
    expect(fit.r2).toBeCloseTo(1, 10)
    expect(fit.se).toBeCloseTo(0, 10)
  })
  it('needs at least three points', () => {
    expect(fitLogLinear([1, 2])).toBeNull()
  })
})

describe('forecastCascade', () => {
  it('projects the time to breach a threshold', () => {
    // 1000 → 4000 at ×2 per tick is exactly two ticks away
    const f = forecastCascade(geometric(1000 / 2 ** 7, 2, 8), 4000)!
    expect(f.regime).toBe('accelerating')
    expect(f.breachInS!.mid).toBeCloseTo(2 * MEAN_TICK_S, 6)
    expect(f.doublingS).toBeCloseTo(MEAN_TICK_S, 6)
    expect(f.clearInS).toBeNull()
  })
  it('projects recovery when above threshold and decaying', () => {
    const f = forecastCascade(geometric(1600 * 2 ** 7, 0.5, 8), 400)!
    expect(f.regime).toBe('decaying')
    expect(f.breachInS).toBeNull()
    expect(f.clearInS!.mid).toBeCloseTo(2 * MEAN_TICK_S, 6)
    expect(f.halfLifeS).toBeCloseTo(MEAN_TICK_S, 6)
  })
  it('does not project a breach for a falling series below threshold', () => {
    expect(forecastCascade(geometric(300, 0.9, 8), 500)!.breachInS).toBeNull()
  })
  it('keeps the projection inside its 95% band', () => {
    const noisy = [100, 118, 131, 160, 171, 210, 236, 270]
    const f = forecastCascade(noisy, 500)!
    f.projection.mid.forEach((m, i) => {
      expect(f.projection.low[i]).toBeLessThan(m)
      expect(f.projection.high[i]).toBeGreaterThan(m)
    })
    expect(f.growthLow).toBeLessThan(f.growth)
    expect(f.growthHigh).toBeGreaterThan(f.growth)
  })
})

describe('backtest', () => {
  it('is error-free on a perfect exponential', () => {
    expect(backtest(geometric(10, 1.15, 20))).toBeCloseTo(0, 10)
  })
  it('returns null without enough history', () => {
    expect(backtest([1, 2, 3])).toBeNull()
  })
})
