import dotenv from 'dotenv';
dotenv.config();

export interface BotConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  rangeWidthPercent: number;
  rebalanceDelaySeconds: number;
  checkIntervalSeconds: number;
  dryRun: boolean;
  port: number;
  // Aerodrome Slipstream WETH/USDC (CL100) addresses on Base
  contracts: {
    weth: `0x${string}`;
    usdc: `0x${string}`;
    aero: `0x${string}`;
    pool: `0x${string}`;
    positionManager: `0x${string}`;
    voter: `0x${string}`;
    router: `0x${string}`;
    gauge: `0x${string}`;
    v2Router: `0x${string}`;
    v2Factory: `0x${string}`;
  };
}

const rawKey = process.env.PRIVATE_KEY?.trim() || '';
const isAllZeros = /^0x?0{64}$/.test(rawKey);
const isValidKey = /^0x[0-9a-fA-F]{64}$/.test(rawKey) && !isAllZeros;
const safePrivateKey: `0x${string}` = isValidKey
  ? (rawKey as `0x${string}`)
  : '0x0000000000000000000000000000000000000000000000000000000000000001';

export const config: BotConfig = {
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  privateKey: safePrivateKey,
  rangeWidthPercent: parseFloat(process.env.RANGE_WIDTH_PERCENT || '4.1'),
  rebalanceDelaySeconds: parseInt(process.env.REBALANCE_DELAY_SECONDS || '3600', 10),
  checkIntervalSeconds: parseInt(process.env.CHECK_INTERVAL_SECONDS || '15', 10),
  dryRun: process.env.DRY_RUN !== 'false',
  port: parseInt(process.env.PORT || '3000', 10),
  contracts: {
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    aero: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    pool: '0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59', // WETH/USDC CL100
    positionManager: '0x827922686190790b37229fd06084350E74485b72',
    voter: '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5',
    router: '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5',
    gauge: '0xF33a96b5932D9E9B9A0eDA447AbD8C9d48d2e0c8',
    v2Router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    v2Factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da'
  }
};
