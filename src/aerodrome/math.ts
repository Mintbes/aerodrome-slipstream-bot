/**
 * Math utilities for Aerodrome Slipstream CL100 (WETH/USDC)
 * token0: WETH (18 decimals, 0x4200000000000000000000000000000000000006)
 * token1: USDC (6 decimals,  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 */

export const TICK_SPACING = 100;
export const DECIMALS_DIFF = 12; // 18 - 6

/**
 * Converts a Uniswap V3 / Slipstream tick to WETH/USDC human price
 */
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick) * Math.pow(10, DECIMALS_DIFF);
}

/**
 * Converts a WETH/USDC human price to the nearest tick
 */
export function priceToTick(price: number): number {
  const rawPrice = price / Math.pow(10, DECIMALS_DIFF);
  return Math.round(Math.log(rawPrice) / Math.log(1.0001));
}

/**
 * Aligns a tick to the nearest valid tickSpacing
 */
export function alignTick(tick: number, spacing: number = TICK_SPACING): number {
  return Math.round(tick / spacing) * spacing;
}

/**
 * Aligns tick downwards
 */
export function alignTickFloor(tick: number, spacing: number = TICK_SPACING): number {
  return Math.floor(tick / spacing) * spacing;
}

/**
 * Aligns tick upwards
 */
export function alignTickCeil(tick: number, spacing: number = TICK_SPACING): number {
  return Math.ceil(tick / spacing) * spacing;
}

/**
 * Calculate tick span for a given range percentage (e.g. 4.1%)
 */
export function calculateTickSpan(widthPercent: number, spacing: number = TICK_SPACING): number {
  const multiplier = 1 + widthPercent / 100;
  const rawSpan = Math.log(multiplier) / Math.log(1.0001);
  return Math.max(spacing, Math.round(rawSpan / spacing) * spacing);
}

/**
 * Calculates a Zero-Swap range for 100% USDC (placed immediately below current price)
 * When price rises out of range, position holds 100% USDC.
 */
export function calculateZeroSwapUsdcRange(currentTick: number, widthPercent: number = 4.1): { tickLower: number; tickUpper: number; priceLower: number; priceUpper: number } {
  const span = calculateTickSpan(widthPercent);
  const tickUpper = alignTickFloor(currentTick, TICK_SPACING);
  const tickLower = tickUpper - span;

  return {
    tickLower,
    tickUpper,
    priceLower: tickToPrice(tickLower),
    priceUpper: tickToPrice(tickUpper)
  };
}

/**
 * Calculates a Zero-Swap range for 100% WETH (placed immediately above current price)
 * When price drops out of range, position holds 100% WETH.
 */
export function calculateZeroSwapWethRange(currentTick: number, widthPercent: number = 4.1): { tickLower: number; tickUpper: number; priceLower: number; priceUpper: number } {
  const span = calculateTickSpan(widthPercent);
  const tickLower = alignTickCeil(currentTick, TICK_SPACING);
  const tickUpper = tickLower + span;

  return {
    tickLower,
    tickUpper,
    priceLower: tickToPrice(tickLower),
    priceUpper: tickToPrice(tickUpper)
  };
}

/**
 * Converts sqrtPriceX96 to human price
 */
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  const Q96 = 2n ** 96n;
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  return sqrtPrice * sqrtPrice * Math.pow(10, DECIMALS_DIFF);
}
