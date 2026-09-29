import { KeeperEngine } from './engine/keeper';
import { createServer } from './server/app';
import { config } from './config';
import os from 'os';

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

async function main() {
  console.log('====================================================');
  console.log('✈️  AERODROME SLIPSTREAM KEEPER BOT (BASE L2)');
  console.log('====================================================');
  console.log(`Pool Target:        WETH / USDC (CL100)`);
  console.log(`Pool Address:       ${config.contracts.pool}`);
  console.log(`Range Width:        ${config.rangeWidthPercent}%`);
  console.log(`Anti-Whipsaw Delay: ${config.rebalanceDelaySeconds} seconds (1h)`);
  console.log(`Mode:               ${config.dryRun ? '🟡 DRY RUN (Simulation only)' : '🟢 LIVE (Real on-chain transactions)'}`);
  console.log('----------------------------------------------------');

  // 1. Initialize Keeper Engine
  const keeper = new KeeperEngine();
  keeper.start();

  // 2. Launch Local Web Dashboard
  const app = createServer(keeper);
  const localIp = getLocalIp();

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`📊 Dashboard UI live at:`);
    console.log(`   👉 Local:   http://localhost:${config.port}`);
    console.log(`   👉 Red LAN: http://${localIp}:${config.port}`);
    console.log('====================================================');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down bot cleanly...');
    keeper.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
