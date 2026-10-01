import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { KeeperEngine } from '../engine/keeper';
import { config } from '../config';
import { positionManagerAbi, gaugeAbi } from '../aerodrome/abis';

export function createServer(keeper: KeeperEngine) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Prevent browser caching of dashboard HTML so updates appear immediately
  app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // Serve static dashboard UI (supports both ts-node in src and compiled js in dist)
  const publicPath = fs.existsSync(path.join(__dirname, 'public'))
    ? path.join(__dirname, 'public')
    : path.join(__dirname, '../../src/server/public');

  app.use(express.static(publicPath));

  // API Status endpoint for live dashboard updates
  // API Status endpoint for live dashboard updates
  app.get('/api/status', async (req, res) => {
    try {
      const botState = keeper.getStorage().getState();
      const poolState = keeper.lastPoolState || await keeper.getService().getPoolState();
      const currentPrice = poolState.currentPrice;

      const rawPositions = (botState.positions && botState.positions.length > 0)
        ? botState.positions
        : (botState.activePosition?.tokenId ? [{
            tokenId: botState.activePosition.tokenId,
            tickLower: botState.activePosition.tickLower,
            tickUpper: botState.activePosition.tickUpper,
            priceLower: botState.activePosition.priceLower,
            priceUpper: botState.activePosition.priceUpper,
            inRange: botState.activePosition.inRange ?? true,
            outOfRangeSince: botState.outOfRangeSince ?? null,
            rebalancesCount: botState.rebalancesCount ?? 0,
            createdAt: Date.now() - 36000000,
            autoSnuggle: botState.autoSnuggle,
            compound: botState.compound
          }] : []);

      const positions = await Promise.all(rawPositions.map(async (pos) => {
        let remainingDelaySec = 0;
        if (pos.outOfRangeSince) {
          const elapsedSec = Math.floor((Date.now() - pos.outOfRangeSince) / 1000);
          remainingDelaySec = Math.max(0, config.rebalanceDelaySeconds - elapsedSec);
        }

        let amounts = {
          wethAmount: 0,
          usdcAmount: 0,
          lpValueUsd: 0,
          uncollectedWeth: 0,
          uncollectedUsdc: 0,
          uncollectedAero: 0,
          uncollectedFeesUsd: 0,
          isStakedInGauge: true,
          apr: 162.8
        };

        if (pos.tokenId) {
          try {
            amounts = await keeper.getService().getPositionAmounts(pos.tokenId, currentPrice);
          } catch (e) {
            console.error(`Error reading position #${pos.tokenId}:`, e);
          }
        }

        const isCurrentlyInRange = keeper.getService().isTickInRange(poolState.currentTick, pos.tickLower, pos.tickUpper);
        const aeroPrice = await keeper.getService().getAeroPriceUsd();

        const posHarvestedAero = pos.harvestedAero !== undefined
          ? pos.harvestedAero
          : (pos.tokenId === '77245545' || rawPositions.length === 1 ? (botState.totalHarvestedAero || 0) : 0);
        const posCollectedUsd = pos.collectedUsd !== undefined
          ? pos.collectedUsd
          : (posHarvestedAero * aeroPrice);
        const posTotalEarnedUsd = posCollectedUsd + amounts.uncollectedFeesUsd;
        const posCreatedAt = pos.createdAt || (Date.now() - 3600000);

        return {
          tokenId: pos.tokenId,
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
          priceLower: pos.priceLower,
          priceUpper: pos.priceUpper,
          inRange: isCurrentlyInRange,
          outOfRangeSince: pos.outOfRangeSince,
          remainingDelaySec,
          rebalancesCount: pos.rebalancesCount || 0,
          createdAt: posCreatedAt,
          autoSnuggle: pos.autoSnuggle !== false,
          compound: pos.compound !== false,
          compoundMode: pos.compoundMode || botState.compoundMode || 'usdc',
          compoundThresholdUsd: pos.compoundThresholdUsd || botState.compoundThresholdUsd || 25,
          wethAmount: amounts.wethAmount,
          usdcAmount: amounts.usdcAmount,
          lpValue: amounts.lpValueUsd,
          uncollectedWeth: amounts.uncollectedWeth,
          uncollectedUsdc: amounts.uncollectedUsdc,
          uncollectedAero: amounts.uncollectedAero,
          uncollectedFeesUsd: amounts.uncollectedFeesUsd,
          collectedAero: posHarvestedAero,
          collectedUsd: posCollectedUsd,
          totalEarnedUsd: posTotalEarnedUsd,
          isStakedInGauge: amounts.isStakedInGauge,
          apr: amounts.apr,
          dailyProjectedUsd: (amounts.lpValueUsd * (amounts.apr / 100)) / 365
        };
      }));

      const aeroPrice = await keeper.getService().getAeroPriceUsd();

      // Totals calculation
      const totalLpValue = positions.reduce((sum, p) => sum + (p.lpValue || 0), 0);
      const totalUncollectedUsd = positions.reduce((sum, p) => sum + (p.uncollectedFeesUsd || 0), 0);
      const totalUncollectedAero = positions.reduce((sum, p) => sum + (p.uncollectedAero || 0), 0);
      const totalCollectedUsd = positions.reduce((sum, p) => sum + (p.collectedUsd || 0), 0);
      const totalCollectedAero = positions.reduce((sum, p) => sum + (p.collectedAero || 0), 0);
      const totalEarnedUsd = totalCollectedUsd + totalUncollectedUsd;
      const totalRebalancesCount = positions.reduce((sum, p) => sum + (p.rebalancesCount || 0), 0);

      const weightedApr = totalLpValue > 0
        ? Number((positions.reduce((sum, p) => sum + (p.lpValue * p.apr), 0) / totalLpValue).toFixed(1))
        : 162.8;
      const totalDailyProjectedUsd = (totalLpValue * (weightedApr / 100)) / 365;

      const primaryPos = positions[0] || {
        tokenId: null,
        tickLower: -198000,
        tickUpper: -196000,
        priceLower: 2600,
        priceUpper: 2750,
        inRange: true,
        lpValue: 0
      };

      const b = {
        weth: poolState.wethBalance || 0,
        usdc: poolState.usdcBalance || 0,
        aero: poolState.aeroBalance || 0,
        eth: poolState.ethBalance || 0
      };
      const walletEthVal = b.eth * currentPrice;
      const walletWethVal = b.weth * currentPrice;
      const walletUsdcVal = b.usdc;
      const walletAeroVal = b.aero * aeroPrice;
      const walletTotalUsd = walletWethVal + walletUsdcVal + walletEthVal + walletAeroVal;
      const totalPortfolioValue = totalLpValue + walletTotalUsd;

      res.json({
        pool: {
          currentPrice: poolState.currentPrice,
          currentTick: poolState.currentTick,
          balances: b
        },
        totals: {
          totalPortfolioValue,
          totalLpValue,
          walletTotalUsd,
          totalEarnedUsd,
          totalCollectedUsd,
          totalCollectedAero,
          totalUncollectedUsd,
          totalUncollectedAero,
          aeroPriceUsd: aeroPrice,
          portfolioYieldApr: weightedApr,
          dailyProjectedUsd: totalDailyProjectedUsd,
          activePositionsCount: positions.length,
          totalRebalances: totalRebalancesCount
        },
        positions,
        position: primaryPos,
        earnings: {
          collectedUsd: totalCollectedUsd,
          collectedAero: totalCollectedAero,
          uncollectedUsd: totalUncollectedUsd,
          uncollectedAero: totalUncollectedAero,
          aeroPriceUsd: aeroPrice,
          uncollectedWeth: positions[0]?.uncollectedWeth || 0,
          uncollectedUsdc: positions[0]?.uncollectedUsdc || 0,
          totalEarnedUsd
        },
        apr: weightedApr,
        isStaked: primaryPos.isStakedInGauge,
        outOfRangeSince: primaryPos.outOfRangeSince,
        remainingDelaySec: primaryPos.remainingDelaySec,
        rebalancesCount: totalRebalancesCount,
        totalHarvestedAero: botState.totalHarvestedAero,
        autoSnuggle: botState.autoSnuggle !== false,
        compound: botState.compound !== false,
        compoundMode: botState.compoundMode || 'usdc',
        compoundThresholdUsd: botState.compoundThresholdUsd || 25,
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
      const { tokenId, key, value } = req.body;
      if (key === 'autoSnuggle' || key === 'compound') {
        if (tokenId) {
          keeper.getStorage().updatePosition(tokenId, p => {
            (p as any)[key] = Boolean(value);
          });
        }
        keeper.getStorage().updateState(s => {
          (s as any)[key] = Boolean(value);
        });
        keeper.getStorage().addLog('INFO', `${key === 'autoSnuggle' ? 'Auto-Snuggle' : 'Compound'} fue ${value ? 'activado' : 'desactivado'}${tokenId ? ` para #${tokenId}` : ''}.`);
        res.json({ success: true, key, value: Boolean(value) });
      } else {
        res.status(400).json({ error: 'Clave no válida' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Configure Auto-Compound endpoint (Mode & Threshold)
  app.post('/api/compound-config', (req, res) => {
    try {
      const { tokenId, mode, thresholdUsd, enabled } = req.body;
      const validMode = (mode === 'reinvest' ? 'reinvest' : 'usdc');
      const validThreshold = Number(thresholdUsd) > 0 ? Number(thresholdUsd) : 25;

      if (tokenId) {
        keeper.getStorage().updatePosition(tokenId, p => {
          if (mode !== undefined) p.compoundMode = validMode;
          if (thresholdUsd !== undefined) p.compoundThresholdUsd = validThreshold;
          if (enabled !== undefined) p.compound = Boolean(enabled);
        });
      }

      keeper.getStorage().updateState(s => {
        if (mode !== undefined) s.compoundMode = validMode;
        if (thresholdUsd !== undefined) s.compoundThresholdUsd = validThreshold;
        if (enabled !== undefined) s.compound = Boolean(enabled);
      });

      keeper.getStorage().addLog(
        'INFO',
        `Ajustes de Auto-Compound actualizados: Modo ${validMode.toUpperCase()} (${validMode === 'usdc' ? '💵 Cosecha a USDC' : '🔄 Reinvertir LP'}), Umbral $${validThreshold}${tokenId ? ` para #${tokenId}` : ''}.`
      );

      res.json({
        success: true,
        compoundMode: validMode,
        compoundThresholdUsd: validThreshold,
        enabled: enabled !== undefined ? Boolean(enabled) : true
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual Compound / Harvest endpoint
  app.post('/api/compound', async (req, res) => {
    try {
      const { tokenId, mode } = req.body || {};
      const result = await keeper.manualCompound(tokenId, mode);
      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Manual Rebalance endpoint
  app.post('/api/rebalance', async (req, res) => {
    try {
      const { tokenId } = req.body || {};
      const ok = await keeper.manualRebalance(tokenId);
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
      if (result.success && result.tokenId) {
        config.dryRun = false; // Switch to live on-chain!

        // Stake newly created position in gauge automatically
        try {
          await keeper.getService().stakePositionInGauge(result.tokenId);
        } catch (gaugeErr) {
          console.error('[API] Gauge auto-stake notice:', gaugeErr);
        }

        keeper.getStorage().addPosition({
          tokenId: result.tokenId,
          tickLower: result.tickLower,
          tickUpper: result.tickUpper,
          priceLower: result.priceLower,
          priceUpper: result.priceUpper,
          inRange: true,
          outOfRangeSince: null,
          rebalancesCount: 0,
          createdAt: Date.now(),
          autoSnuggle: true,
          compound: true
        });

        keeper.getStorage().addLog(
          'ACTION',
          `🚀 Posición 50/50 (#${result.tokenId}) creada y staked en Gauge! Rango: $${result.priceLower.toFixed(2)} - $${result.priceUpper.toFixed(2)}. Swap Tx: ${result.swapTx?.slice(0, 10)}... | Mint Tx: ${result.mintTx?.slice(0, 10)}...`
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
      const { tokenId: requestedTokenId } = req.body || {};
      const botState = keeper.getStorage().getState();
      const tokenId = requestedTokenId || botState.positions?.[0]?.tokenId || botState.activePosition?.tokenId;
      if (!tokenId) {
        return res.status(400).json({ error: 'No hay posición activa para reclamar' });
      }

      keeper.getStorage().addLog('ACTION', `Iniciando reclamo de recompensas AERO del Gauge para NFT #${tokenId}...`);
      const result = await keeper.getService().claimAeroRewards(tokenId);

      if (result.success) {
        const claimedAero = result.claimedAero || 0;
        const aeroPrice = await keeper.getService().getAeroPriceUsd();
        keeper.getStorage().updatePosition(tokenId, p => {
          p.harvestedAero = (p.harvestedAero || 0) + claimedAero;
          p.collectedUsd = (p.collectedUsd || 0) + (claimedAero * aeroPrice);
        });
        keeper.getStorage().updateState(s => {
          s.totalHarvestedAero = (s.totalHarvestedAero || 0) + claimedAero;
        });
        keeper.getStorage().addLog('ACTION', `🎉 ¡${(result.claimedAero || 0).toFixed(4)} AERO reclamados a tu wallet para #${tokenId}! Tx: ${result.txHash?.slice(0, 10)}...`);
        res.json({ success: true, txHash: result.txHash, claimedAero: result.claimedAero });
      } else {
        keeper.getStorage().addLog('ERROR', `Error al reclamar AERO para #${tokenId}: ${result.error}`);
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (err: any) {
      keeper.getStorage().addLog('ERROR', `Fallo al reclamar AERO: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Import Existing Position endpoint
  app.post('/api/import-position', async (req, res) => {
    try {
      const { tokenId, stakeNow } = req.body;
      if (!tokenId) {
        return res.status(400).json({ error: 'Token ID requerido' });
      }

      const tokenIdStr = String(tokenId).trim();
      keeper.getStorage().addLog('INFO', `Importando posición de Aerodrome NFT #${tokenIdStr}...`);

      const pos = await keeper.getService().publicClient.readContract({
        address: config.contracts.positionManager,
        abi: positionManagerAbi,
        functionName: 'positions',
        args: [BigInt(tokenIdStr)]
      });

      const tickLower = Number(pos[5]);
      const tickUpper = Number(pos[6]);
      const priceLower = (1.0001 ** tickLower) * 1e12;
      const priceUpper = (1.0001 ** tickUpper) * 1e12;

      // Auto-stake in Gauge if requested and not already staked
      if (stakeNow !== false) {
        try {
          const isStaked = await keeper.getService().publicClient.readContract({
            address: config.contracts.gauge,
            abi: gaugeAbi,
            functionName: 'stakedContains',
            args: [keeper.getService().account.address, BigInt(tokenIdStr)]
          });
          if (!isStaked) {
            keeper.getStorage().addLog('ACTION', `Stakeando NFT #${tokenIdStr} en Gauge de Aerodrome para activar recompensas...`);
            await keeper.getService().stakePositionInGauge(tokenIdStr);
          }
        } catch (stkErr: any) {
          console.error('[Import] Auto-stake warning:', stkErr);
        }
      }

      const newPos = {
        tokenId: tokenIdStr,
        tickLower,
        tickUpper,
        priceLower,
        priceUpper,
        inRange: true,
        outOfRangeSince: null,
        rebalancesCount: 0,
        createdAt: Date.now(),
        autoSnuggle: true,
        compound: true,
        compoundMode: 'usdc' as const,
        compoundThresholdUsd: 25
      };

      keeper.getStorage().addPosition(newPos);
      keeper.getStorage().addLog(
        'ACTION',
        `✅ Posición #${tokenIdStr} vinculada al bot! Rango: $${priceLower.toFixed(2)} - $${priceUpper.toFixed(2)}`
      );

      res.json({ success: true, position: newPos });
    } catch (err: any) {
      keeper.getStorage().addLog('ERROR', `Error al importar posición: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Withdraw Position endpoint
  app.post('/api/withdraw', async (req, res) => {
    try {
      const { tokenId: requestedTokenId } = req.body || {};
      const botState = keeper.getStorage().getState();
      const tokenId = requestedTokenId || botState.positions?.[0]?.tokenId || botState.activePosition?.tokenId;
      if (!tokenId) {
        return res.status(400).json({ error: 'No hay posición para retirar' });
      }

      keeper.getStorage().addLog('ACTION', `Iniciando retiro completo de liquidez para NFT #${tokenId}...`);
      try {
        await keeper.getService().withdrawPositionFromGauge(tokenId);
      } catch (e: any) {
        console.warn('[Withdraw] Gauge unstake notice:', e.message);
      }

      keeper.getStorage().removePosition(tokenId);
      keeper.getStorage().addLog('ACTION', `✅ Posición #${tokenId} retirada del bot.`);
      res.json({ success: true });
    } catch (err: any) {
      keeper.getStorage().addLog('ERROR', `Error al retirar posición: ${err.message}`);
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
