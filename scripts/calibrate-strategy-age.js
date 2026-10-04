const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../data/bot-state.json');
if (!fs.existsSync(dataFile)) {
  console.error('bot-state.json not found at', dataFile);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// September 28, 2026, 05:41:19 UTC (origin of the strategy deposit on Base, exactly 6 days ago)
const STRATEGY_START_TIME = 1790574079000;

if (Array.isArray(state.positions)) {
  for (const pos of state.positions) {
    pos.createdAt = STRATEGY_START_TIME;
    pos.rebalancesCount = 2;
  }
}
state.rebalancesCount = 2;

fs.writeFileSync(dataFile, JSON.stringify(state, null, 2), 'utf8');
console.log('✅ Updated bot-state.json: Strategy age calibrated to 6 days and rebalances to 2.');
