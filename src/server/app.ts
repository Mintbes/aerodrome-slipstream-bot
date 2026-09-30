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

      let positionData: any = { ...botState.activePosition };
      let uncollectedFeesUsd = 0;
      let uncollectedWeth = 0;
      let uncollectedUsdc = 0;
      let uncollectedAero = 0;
      let isStaked = true;
      let aprPct = 183.3;

      if (botState.activePosition && botState.activePosition.tokenId) {
        const amounts = await keeper.getService().getPositionAmounts(botState.activePosition.tokenId, poolState.currentPrice);
        uncollectedFeesUsd = amounts.uncollectedFeesUsd;
        uncollectedWeth = amounts.uncollectedWeth;
        uncollectedUsdc = amounts.uncollectedUsdc;
        uncollectedAero = amounts.uncollectedAero;
        isStaked = amounts.isStakedInGauge;
        aprPct = amounts.apr || 183.3;
        positionData = {
          ...positionData,
          wethAmount: amounts.wethAmount,
          usdcAmount: amounts.usdcAmount,
          lpValue: amounts.lpValueUsd,
          uncollectedWeth: amounts.uncollectedWeth,
          uncollectedUsdc: amounts.uncollectedUsdc,
          uncollectedAero: amounts.uncollectedAero,
          uncollectedFeesUsd: amounts.uncollectedFeesUsd,
          isStakedInGauge: isStaked
        };
      }

      const collectedFeesUsd = (botState.totalHarvestedAero || 0) * 0.81;
      const totalEarnedUsd = collectedFeesUsd + uncollectedFeesUsd;

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
        position: positionData,
        earnings: {
          collectedUsd: collectedFeesUsd,
          uncollectedUsd: uncollectedFeesUsd,
          uncollectedWeth,
          uncollectedUsdc,
          uncollectedAero,
          totalEarnedUsd
        },
        apr: aprPct,
        isStaked,
        outOfRangeSince: botState.outOfRangeSince,
        remainingDelaySec,
        rebalancesCount: botState.rebalancesCount,
        totalHarvestedAero: botState.totalHarvestedAero,
        autoSnuggle: botState.autoSnuggle !== false,
        compound: botState.compound !== false,
        dryRun: config.dryRun,
        rangeWidthPercent: config.rangeWidthPercent,
        rebalanceDelaySeconds: config.rebalanceDelaySeconds,
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

  // Create 50/50 Centered Position endpoint
  app.post('/api/create-5050', async (req, res) => {
    try {
      const amountUsdc = parseFloat(req.body.amount || '500');
      keeper.getStorage().addLog('INFO', `Iniciando creación automática de LP 50/50 (${amountUsdc} USDC)...`);

      const result = await keeper.getService().createCentered5050Position(amountUsdc);
      if (result.success) {
        config.dryRun = false; // Switch to live on-chain!
        keeper.getStorage().updateState(s => {
          s.activePosition = {
            tokenId: result.tokenId || 'NEW_LP',
            tickLower: result.tickLower,
            tickUpper: result.tickUpper,
            priceLower: result.priceLower,
            priceUpper: result.priceUpper,
            inRange: true
          };
          s.outOfRangeSince = null;
        });

        keeper.getStorage().addLog(
          'ACTION',
          `🚀 Posición 50/50 (#${result.tokenId || 'LP'}) creada en Base! Rango: $${result.priceLower.toFixed(2)} - $${result.priceUpper.toFixed(2)}. Swap Tx: ${result.swapTx?.slice(0, 10)}... | Mint Tx: ${result.mintTx?.slice(0, 10)}...`
        );

        res.json(result);
      } else {
        keeper.getStorage().addLog('ERROR', `Error al crear posición 50/50: ${result.error}`);
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (err: any) {
      keeper.getStorage().addLog('ERROR', `Fallo crítico al crear posición: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
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

  // Live Claim AERO endpoint
  app.post('/api/claim', async (req, res) => {
    try {
      const botState = keeper.getStorage().getState();
      const tokenId = botState.activePosition?.tokenId;
      if (!tokenId) {
        return res.status(400).json({ error: 'No hay posición activa para reclamar' });
      }

      keeper.getStorage().addLog('ACTION', `Iniciando reclamo de recompensas AERO del Gauge para NFT #${tokenId}...`);
      const result = await keeper.getService().claimAeroRewards(tokenId);

      if (result.success) {
        keeper.getStorage().updateState(s => {
          s.totalHarvestedAero = (s.totalHarvestedAero || 0) + (result.claimedAero || 0);
        });
        keeper.getStorage().addLog('ACTION', `🎉 ¡${(result.claimedAero || 0).toFixed(4)} AERO reclamados a tu wallet! Tx: ${result.txHash?.slice(0, 10)}...`);
        res.json({ success: true, txHash: result.txHash, claimedAero: result.claimedAero });
      } else {
        keeper.getStorage().addLog('ERROR', `Error al reclamar AERO: ${result.error}`);
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (err: any) {
      keeper.getStorage().addLog('ERROR', `Fallo al reclamar AERO: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Stake into Gauge endpoint
  app.post('/api/stake', async (req, res) => {
    try {
      const botState = keeper.getStorage().getState();
      const tokenId = botState.activePosition?.tokenId;
      if (!tokenId) return res.status(400).json({ error: 'No active position' });

      const result = await keeper.getService().stakePositionInGauge(tokenId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Unstake from Gauge endpoint
  app.post('/api/unstake', async (req, res) => {
    try {
      const botState = keeper.getStorage().getState();
      const tokenId = botState.activePosition?.tokenId;
      if (!tokenId) return res.status(400).json({ error: 'No active position' });

      const result = await keeper.getService().withdrawPositionFromGauge(tokenId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Self-restart endpoint (systemd Restart=always will reboot the process cleanly)
  app.post('/api/restart', (req, res) => {
    keeper.getStorage().addLog('ACTION', 'Reinicio del servicio solicitado.');
    res.json({ success: true, message: 'Reiniciando bot...' });
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });

  return app;
}
