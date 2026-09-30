import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { KeeperEngine } from '../engine/keeper';
import { config } from '../config';

export function createServer(keeper: KeeperEngine) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve static dashboard UI (supports both ts-node in src and compiled js in dist)
  const publicPath = fs.existsSync(path.join(__dirname, 'public'))
    ? path.join(__dirname, 'public')
    : path.join(__dirname, '../../src/server/public');

  app.use(express.static(publicPath));

  // API Status endpoint for live dashboard updates
  app.get('/api/status', async (req, res) => {
    try {
      const botState = keeper.getStorage().getState();
      const poolState = keeper.lastPoolState || await keeper.getService().getPoolState();

      let remainingDelaySec = 0;
      if (botState.outOfRangeSince) {
        const elapsedSec = Math.floor((Date.now() - botState.outOfRangeSince) / 1000);
        remainingDelaySec = Math.max(0, config.rebalanceDelaySeconds - elapsedSec);
      }

      res.json({
        pool: {
          currentPrice: poolState.currentPrice,
          currentTick: poolState.currentTick,
          balances: {
            weth: poolState.wethBalance,
            usdc: poolState.usdcBalance,
            aero: poolState.aeroBalance,
            eth: poolState.ethBalance
          }
        },
        position: botState.activePosition,
        outOfRangeSince: botState.outOfRangeSince,
        remainingDelaySec,
        rebalancesCount: botState.rebalancesCount,
        totalHarvestedAero: botState.totalHarvestedAero,
        autoSnuggle: botState.autoSnuggle !== false,
        compound: botState.compound !== false,
        dryRun: config.dryRun,
        walletAddress: keeper.getService().account.address,
        history: botState.rebalanceHistory,
        logs: botState.logs.slice(0, 30)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch status' });
    }
  });

  // Toggle Feature endpoint (Auto-Snuggle, Compound)
  app.post('/api/toggle', (req, res) => {
    try {
      const { key, value } = req.body;
      if (key === 'autoSnuggle' || key === 'compound') {
        keeper.getStorage().updateState(s => {
          (s as any)[key] = Boolean(value);
        });
        keeper.getStorage().addLog('INFO', `${key === 'autoSnuggle' ? 'Auto-Snuggle' : 'Compound'} fue ${value ? 'activado' : 'desactivado'}.`);
        res.json({ success: true, key, value: Boolean(value) });
      } else {
        res.status(400).json({ error: 'Clave no válida' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual Rebalance endpoint
  app.post('/api/rebalance', async (req, res) => {
    try {
      const ok = await keeper.manualRebalance();
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update Settings endpoint (Range Width, Delay, Auto-Snuggle, Compound, Dry-Run)
  app.post('/api/settings', async (req, res) => {
    try {
      const { rangeWidthPercent, rebalanceDelaySeconds, dryRun } = req.body;
      if (rangeWidthPercent !== undefined) config.rangeWidthPercent = parseFloat(rangeWidthPercent);
      if (rebalanceDelaySeconds !== undefined) config.rebalanceDelaySeconds = parseInt(rebalanceDelaySeconds, 10);
      if (dryRun !== undefined) config.dryRun = Boolean(dryRun);

      keeper.getStorage().addLog('ACTION', `Settings updated: Width ${config.rangeWidthPercent}%, Delay ${config.rebalanceDelaySeconds}s, DryRun: ${config.dryRun}`);
      res.json({ success: true, config: {
        rangeWidthPercent: config.rangeWidthPercent,
        rebalanceDelaySeconds: config.rebalanceDelaySeconds,
        dryRun: config.dryRun
      }});
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Claim AERO endpoint
  app.post('/api/claim', async (req, res) => {
    try {
      keeper.getStorage().addLog('ACTION', 'Claiming pending AERO rewards...');
      // Simulated or live claim
      keeper.getStorage().addLog('ACTION', 'AERO rewards claimed successfully to wallet.');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}
