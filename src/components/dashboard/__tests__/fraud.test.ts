import { describe, expect, it } from 'vitest'
import { generateAccounts, median, robustZ, scoreAccounts, screenClaim, summarizeClaims, type Claim, type LiquidationEvent } from '../fraud'

const OPEN = Date.UTC(2026, 10, 7, 9, 0, 0)

describe('robust statistics', () => {
  it('computes the median', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
  it('scores an outlier far above 3.5 and ordinary values below it', () => {
    const z = robustZ([10, 11, 9, 10, 12, 8, 10, 11, 9, 500])
    expect(z[9]).toBeGreaterThan(3.5)
    z.slice(0, 9).forEach((v) => expect(Math.abs(v)).toBeLessThan(3.5))
  })
})

describe('scoreAccounts', () => {
  const accounts = generateAccounts(2417, 240, OPEN)
  const flags = scoreAccounts(accounts)

  it('is deterministic for a seed', () => {
    expect(scoreAccounts(generateAccounts(2417, 240, OPEN))).toEqual(flags)
  })
  it('finds exactly the planted hunters and spoofers', () => {
    expect(flags.filter((f) => f.pattern === 'liquidation-hunting')).toHaveLength(2)
    expect(flags.filter((f) => f.pattern === 'spoofing')).toHaveLength(2)
    flags.forEach((f) => expect(f.score).toBeGreaterThanOrEqual(3.5))
  })
  it('flags nobody in a population with no bad actors', () => {
    const clean = generateAccounts(7, 240, OPEN).map((a) =>
      a.cancelRatio > 0.9 || a.shortNotionalUsd > 5e6 ? { ...a, cancelRatio: 0.3, shortNotionalUsd: 0, pnlUsd: -1000 } : a,
    )
    expect(scoreAccounts(clean)).toEqual([])
  })
})

describe('screenClaim', () => {
  const liqs: LiquidationEvent[] = [{ account: 'a1', market: 'BTC-PERP', notionalUsd: 100_000, lossUsd: 10_000, ts: OPEN + 1000 }]
  const claim = (over: Partial<Claim>): Claim => ({
    id: 'CLM-1',
    account: 'a1',
    market: 'BTC-PERP',
    claimedUsd: 10_000,
    ts: OPEN + 5000,
    accountCreatedAt: OPEN - 90 * 86_400_000,
    ...over,
  })

  it('clears a genuine claim', () => {
    expect(screenClaim(claim({}), liqs, [], OPEN).reasons).toEqual([])
  })
  it('holds a claim with no matching liquidation', () => {
    expect(screenClaim(claim({ account: 'zz' }), liqs, [], OPEN).reasons).toContain('NO_LIQUIDATION')
  })
  it('holds an inflated claim', () => {
    expect(screenClaim(claim({ claimedUsd: 25_000 }), liqs, [], OPEN).reasons).toEqual(['INFLATED'])
  })
  it('holds a duplicate claim', () => {
    expect(screenClaim(claim({ id: 'CLM-2' }), liqs, [claim({})], OPEN).reasons).toEqual(['DUPLICATE'])
  })
  it('holds a claim from an account opened during the incident', () => {
    expect(screenClaim(claim({ accountCreatedAt: OPEN + 1 }), liqs, [], OPEN).reasons).toContain('NEW_ACCOUNT')
  })
  it('summarises held value', () => {
    const s = summarizeClaims([screenClaim(claim({}), liqs, [], OPEN), screenClaim(claim({ claimedUsd: 25_000 }), liqs, [], OPEN)])
    expect(s).toMatchObject({ screened: 2, flagged: 1, claimedUsd: 35_000, heldUsd: 25_000 })
  })
})
