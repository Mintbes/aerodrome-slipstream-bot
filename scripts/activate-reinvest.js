const fs = require('fs');
const path = require('path');

const candidates = [
  path.join(__dirname, '../data/bot-state.json'),
  '/home/harmony/aerodrome-slipstream-bot/data/bot-state.json'
];
const file = candidates.find(f => fs.existsSync(f)) || candidates[0];
if (fs.existsSync(file)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  data.compound = true;
  data.compoundMode = 'reinvest';
  data.compoundThresholdUsd = 25;
  if (data.positions && data.positions.length) {
    data.positions.forEach(p => {
      p.compound = true;
      p.compoundMode = 'reinvest';
      p.compoundThresholdUsd = 25;
    });
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('Successfully updated bot-state.json to active reinvest mode (Option 1)!');
} else {
  console.error('File not found:', file);
}
