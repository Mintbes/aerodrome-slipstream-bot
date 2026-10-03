const fs = require('fs');
const path = require('path');

const candidates = [
  path.join(__dirname, '../data/bot-state.json'),
  '/home/harmony/aerodrome-slipstream-bot/data/bot-state.json'
];
const file = candidates.find(f => fs.existsSync(f)) || candidates[0];

if (fs.existsSync(file)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  
  // Total AERO actually harvested on wallet: 99.30 AERO = $79.30 USD
  data.totalHarvestedAero = 99.30;
  
  if (data.positions && data.positions.length) {
    data.positions.forEach(p => {
      if (p.tokenId === '77375885') {
        p.harvestedAero = 94.78;
        p.collectedUsd = 75.69;
      } else if (p.tokenId === '77375873') {
        p.harvestedAero = 4.52;
        p.collectedUsd = 3.61;
      }
    });
  }
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('Successfully recalibrated earnings to exact on-chain reality!');
} else {
  console.error('File not found:', file);
}
