const { createPublicClient, http, parseAbi } = require('viem');
const { base } = require('viem/chains');

async function test() {
  const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const gaugeAbi = parseAbi([
    'function rewardRate() external view returns (uint256)',
    'function rewardGrowthGlobalX128() external view returns (uint256)',
    'function totalLiquidity() external view returns (uint256)',
    'function totalSupply() external view returns (uint256)',
    'function stakedLiquidity() external view returns (uint256)',
    'function pool() external view returns (address)'
  ]);
  const gauge = '0xF33a96b5932D9E9B9A0eDA447AbD8C9d48d2e0c8';
  for (const fn of ['rewardRate', 'rewardGrowthGlobalX128', 'totalLiquidity', 'totalSupply', 'stakedLiquidity']) {
    try {
      const res = await client.readContract({ address: gauge, abi: gaugeAbi, functionName: fn });
      console.log(`${fn}:`, res.toString());
    } catch (e) {
      console.log(`${fn}: (not present)`);
    }
  }
}

test().catch(console.error);
