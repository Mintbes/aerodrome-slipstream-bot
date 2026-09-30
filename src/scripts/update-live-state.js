const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../data/bot-state.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));

state.activePosition = {
  tokenId: '77245545',
  tickLower: -197600,
  tickUpper: -197200,
  priceLower: 2622.83,
  priceUpper: 2729.86,
  inRange: true
};
state.outOfRangeSince = null;
state.logs.unshift({
  timestamp: Date.now(),
  type: 'ACTION',
  message: '🚀 ¡Posición LP 50/50 (#77245545) ACTIVA en Base! Rango: $2,622.83 - $2,729.86. In Range (Snuggled).'
});

fs.writeFileSync(file, JSON.stringify(state, null, 2));
console.log('✅ bot-state.json updated with position #77245545!');
