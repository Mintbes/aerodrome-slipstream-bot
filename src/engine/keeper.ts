import { AerodromeService, PoolState } from '../aerodrome/service';
import { StorageService } from './storage';
import { config } from '../config';

export class KeeperEngine {
  private service: AerodromeService;
  private storage: StorageService;
  private isRunning: boolean = false;
  private isChecking: boolean = false;
  private lastWalletCompoundTime: Map<string, number> = new Map();
  private timer: NodeJS.Timeout | null = null;
  public lastPoolState: PoolState | null = null;

  constructor() {
    this.service = new AerodromeService();
    this.storage = new StorageService();
  }

  public getStorage(): StorageService {
    return this.storage;
  }

  public getService(): AerodromeService {
    return this.service;
  }

  /**
   * Starts the background monitoring loop
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.storage.addLog('INFO', `Bot engine started. Check interval: ${config.checkIntervalSeconds}s. Delay: ${config.rebalanceDelaySeconds}s. Dry Run: ${config.dryRun}`);
    
    // Run immediately, then interval
    this.check();
    this.timer = setInterval(() => this.check(), config.checkIntervalSeconds * 1000);
  }

  /**
   * Stops the background monitoring loop
   */
  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.storage.addLog('WARN', 'Bot engine stopped.');
  }

  /**
   * Main strategy check cycle
   */
  public async check(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      const state = await this.service.getPoolState();
      this.lastPoolState = state;
      const botState = this.storage.getState();

      const positions = (botState.positions && botState.positions.length > 0)
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

      for (const pos of positions) {
        // Watchdog: Ensure active position is always Staked in Aerodrome Gauge
        if (pos.tokenId && !config.dryRun) {
          try {
            const isStaked = await this.service.isPositionStakedInGauge(pos.tokenId, pos.walletAddress);
            if (!isStaked) {
              const now = Date.now();
              const lastStakeAttempt = (pos as any).lastStakeAttempt || 0;
              if (now - lastStakeAttempt > 45000) {
                (pos as any).lastStakeAttempt = now;
                this.storage.addLog(
                  'ACTION',
                  `🛡️ Watchdog: Posición #${pos.tokenId} detectada en Wallet (sin stakear). Stakeando automáticamente en Gauge de Aerodrome...`
                );
                const stakeRes = await this.service.stakePositionInGauge(pos.tokenId, pos.walletAddress);
                if (stakeRes.success) {
                  this.storage.addLog('ACTION', `✅ ¡Posición #${pos.tokenId} auto-stakeada con éxito en Gauge! Tx: ${stakeRes.txHash?.slice(0, 10)}...`);
                } else {
                  this.storage.addLog('WARN', `Aviso watchdog al auto-stakear #${pos.tokenId}: ${stakeRes.error}`);
                }
              }
            }
          } catch (stkErr: any) {
            console.error(`[Keeper] Gauge watchdog error for #${pos.tokenId}:`, stkErr);
          }
        }

        const inRange = this.service.isTickInRange(state.currentTick, pos.tickLower, pos.tickUpper);

        if (inRange) {
          if (pos.outOfRangeSince !== null) {
            this.storage.updatePosition(pos.tokenId, p => {
              p.outOfRangeSince = null;
              p.inRange = true;
            });
            this.storage.addLog('ACTION', `ETH returned inside range for #${pos.tokenId} at $${state.currentPrice.toFixed(2)}. Anti-whipsaw delay timer cleared!`);
          } else if (!pos.inRange) {
            this.storage.updatePosition(pos.tokenId, p => {
              p.inRange = true;
            });
          }
        } else {
          const now = Date.now();
          if (pos.outOfRangeSince === null) {
            this.storage.updatePosition(pos.tokenId, p => {
              p.outOfRangeSince = now;
              p.inRange = false;
            });
            const dir = state.currentPrice > pos.priceUpper ? 'ABOVE' : 'BELOW';
            this.storage.addLog('WARN', `ETH exited range ${dir} for #${pos.tokenId} ($${state.currentPrice.toFixed(2)} vs [${pos.priceLower.toFixed(0)} - ${pos.priceUpper.toFixed(0)}]). 1h delay timer started.`);
          } else {
            const elapsedSec = Math.floor((now - pos.outOfRangeSince) / 1000);
            const remainingSec = Math.max(0, config.rebalanceDelaySeconds - elapsedSec);

            if (remainingSec === 0) {
              const isAuto = pos.autoSnuggle !== false && botState.autoSnuggle !== false;
              if (!isAuto) {
                continue;
              }
              const dir = state.currentPrice > pos.priceUpper ? 'UP' : 'DOWN';

              // Bull Run Mode: Only rebalance UP. If price fell below range, hold 100% WETH and wait for recovery.
              const isUpOnly = pos.upOnlyRebalance !== false && botState.upOnlyRebalance !== false;
              if (dir === 'DOWN' && isUpOnly) {
                if (!(pos as any).lastUpOnlyLog || (Date.now() - (pos as any).lastUpOnlyLog > 300000)) {
                  this.storage.addLog('INFO', `🐂 Modo Bull Run (Solo al Alza) activo para #${pos.tokenId}: ETH cayó bajo el rango ($${state.currentPrice.toFixed(2)} < $${pos.priceLower.toFixed(0)}). Rebalanceo a la baja bloqueado. Manteniendo 100% WETH a la espera de recuperación para no vender en el fondo.`);
                  (pos as any).lastUpOnlyLog = Date.now();
                }
                continue;
              }

              const targetRange = this.service.calculateRebalanceRange(state.currentTick, dir);
              if (targetRange.tickLower === pos.tickLower && targetRange.tickUpper === pos.tickUpper) {
                if (!(pos as any).lastRedundantLog || (Date.now() - (pos as any).lastRedundantLog > 300000)) {
                  this.storage.addLog('INFO', `ETH ($${state.currentPrice.toFixed(2)}) está entre ticks CL100. El rango óptimo Zero-Swap [${pos.priceLower.toFixed(0)} - ${pos.priceUpper.toFixed(0)}] ya coincide con el actual. Esperando movimiento de precio para no gastar gas inútilmente.`);
                  (pos as any).lastRedundantLog = Date.now();
                }
                continue;
              }

              this.storage.addLog('ACTION', `Delay timer expired for #${pos.tokenId}. Triggering automated Zero-Swap rebalance (${dir})...`);

              const isCompoundEnabled = pos.compound !== false && botState.compound !== false;
              const mode = pos.compoundMode || botState.compoundMode || 'usdc';
              const isReinvestMode = isCompoundEnabled && mode === 'reinvest';

              const res = await this.service.executeZeroSwapRebalance(state.currentTick, dir, pos.tokenId || null, isReinvestMode, pos.walletAddress);
              if (res.success) {
                const oldRange: [number, number] = [pos.priceLower, pos.priceUpper];
                const newRange: [number, number] = [res.newRange.priceLower, res.newRange.priceUpper];

                if (res.reinvestedAero && res.reinvestedAero > 0) {
                  this.storage.updatePosition(pos.tokenId, p => {
                    p.harvestedAero = (p.harvestedAero || 0) + res.reinvestedAero!;
                    p.collectedUsd = (p.collectedUsd || 0) + (res.reinvestedUsdc || 0);
                  });
                  this.storage.updateState(s => {
                    s.totalHarvestedAero = (s.totalHarvestedAero || 0) + res.reinvestedAero!;
                  });
                }

                this.storage.updatePosition(pos.tokenId, p => {
                  p.tokenId = res.newTokenId || p.tokenId;
                  if (res.walletAddress) p.walletAddress = res.walletAddress;
                  p.tickLower = res.newRange.tickLower;
                  p.tickUpper = res.newRange.tickUpper;
                  p.priceLower = res.newRange.priceLower;
                  p.priceUpper = res.newRange.priceUpper;
                  p.inRange = true;
                  p.outOfRangeSince = null;
                  p.rebalancesCount = (p.rebalancesCount || 0) + 1;
                });

                this.storage.updateState(s => {
                  s.rebalancesCount = (s.rebalancesCount || 0) + 1;
                  s.rebalanceHistory.unshift({
                    timestamp: now,
                    tokenId: res.newTokenId || pos.tokenId,
                    direction: dir,
                    price: state.currentPrice,
                    oldRange,
                    newRange,
                    txHash: res.txHash || ''
                  });
                });

                const compoundMsg = (res.reinvestedUsdc && res.reinvestedUsdc > 0)
                  ? ` (🔄 Auto-Compound: +$${res.reinvestedUsdc.toFixed(2)} USDC de AERO reinvertidos en la posición LP!)`
                  : '';
                this.storage.addLog('ACTION', `🚀 Rebalance completed for #${pos.tokenId}! New NFT: #${res.newTokenId || pos.tokenId}. Range: $${newRange[0].toFixed(2)} - $${newRange[1].toFixed(2)}${compoundMsg}`);
              } else {
                this.storage.addLog('ERROR', `Rebalance failed for #${pos.tokenId}: ${res.error}`);
              }
            }
          }
        }

        // Check Auto-Compound / Auto-Harvest condition
        const isCompoundEnabled = pos.compound !== false && botState.compound !== false;
        if (isCompoundEnabled && pos.tokenId) {
          const mode = pos.compoundMode || botState.compoundMode || 'usdc';
          const threshold = pos.compoundThresholdUsd || botState.compoundThresholdUsd || 25;

          const walletKey = (pos.walletAddress || 'default').toLowerCase();
          const lastCompound = this.lastWalletCompoundTime.get(walletKey) || 0;
          if (Date.now() - lastCompound < 180_000) {
            continue;
          }

          try {
            const amounts = await this.service.getPositionAmounts(pos.tokenId, state.currentPrice, pos.walletAddress);
            const pendingGaugeUsd = amounts.uncollectedFeesUsd || 0;
            const walletAero = await this.service.getWalletAeroBalance(pos.walletAddress);
            const aeroPrice = await this.service.getAeroPriceUsd();
            const walletAeroUsd = walletAero * aeroPrice;
            const totalAvailableRewardsUsd = pendingGaugeUsd + walletAeroUsd;

            if (totalAvailableRewardsUsd >= threshold || walletAeroUsd >= threshold) {
              this.lastWalletCompoundTime.set(walletKey, Date.now());
              const harvestTypeLabel = mode === 'reinvest'
                ? '🔄 Bola de Nieve (Asegurando a USDC para próximo rebalanceo)'
                : '💵 Cosecha a USDC (Toma de beneficios)';

              this.storage.addLog(
                'ACTION',
                `🎯 Umbral de cosecha alcanzado para #${pos.tokenId}: $${totalAvailableRewardsUsd.toFixed(2)} acumulados ($${pendingGaugeUsd.toFixed(2)} en Gauge + $${walletAeroUsd.toFixed(2)} en Wallet) >= umbral $${threshold}. Ejecutando: ${harvestTypeLabel}...`
              );
              const compRes = await this.service.executeCompound(pos.tokenId, mode, pos.walletAddress);
              const claimedAero = compRes.claimedAero || 0;
              if (claimedAero > 0) {
                const aeroPrice = await this.service.getAeroPriceUsd();
                const recUsd = claimedAero * aeroPrice;
                this.storage.updatePosition(pos.tokenId, p => {
                  p.harvestedAero = (p.harvestedAero || 0) + claimedAero;
                  p.collectedUsd = (p.collectedUsd || 0) + recUsd;
                });
                this.storage.updateState(s => {
                  s.totalHarvestedAero = (s.totalHarvestedAero || 0) + claimedAero;
                });
              }
              if (compRes.success) {
                if (mode === 'reinvest') {
                  this.storage.addLog(
                    'ACTION',
                    `🔄 ¡Bola de Nieve: ${(compRes.claimedAero || 0).toFixed(4)} AERO cambiados a +$${(compRes.usdcReceived || 0).toFixed(2)} USDC protegidos en wallet! Se sumarán al LP en el próximo rebalanceo al alza. Tx: ${compRes.txHash?.slice(0, 10)}...`
                  );
                } else {
                  this.storage.addLog(
                    'ACTION',
                    `💵 ¡Auto-Cosecha exitosa para #${pos.tokenId}! ${(compRes.claimedAero || 0).toFixed(4)} AERO cambiados a $${(compRes.usdcReceived || 0).toFixed(2)} USDC en tu wallet! Tx: ${compRes.txHash?.slice(0, 10)}...`
                  );
                }
              } else {
                this.storage.addLog('ERROR', `Error en auto-compound para #${pos.tokenId}: ${compRes.error}`);
              }
            }
          } catch (compErr: any) {
            console.error(`[Keeper] Error checking compound threshold for #${pos.tokenId}:`, compErr);
          }
        }
      }
    } catch (err: any) {
      const msg = err.shortMessage || err.message || String(err);
      console.error(`[Keeper] Check warning: ${msg}`);
      this.storage.addLog('ERROR', `Keeper check failed: ${msg}`);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Manual Force Rebalance triggered by user from Dashboard
   */
  public async manualRebalance(targetTokenId?: string): Promise<boolean> {
    if (!this.lastPoolState) {
      this.lastPoolState = await this.service.getPoolState();
    }
    const state = this.lastPoolState;
    const botState = this.storage.getState();
    const pos = (targetTokenId && botState.positions?.length)
      ? (botState.positions.find(p => p.tokenId === targetTokenId) || botState.positions[0])
      : (botState.positions?.[0] || botState.activePosition);

    const dir = state.currentPrice > pos.priceUpper ? 'UP' : 'DOWN';

    this.storage.addLog('ACTION', `User triggered manual Zero-Swap rebalance for NFT #${pos.tokenId} (${dir})...`);
    const isCompoundEnabled = pos.compound !== false && botState.compound !== false;
    const mode = pos.compoundMode || botState.compoundMode || 'usdc';
    const isReinvestMode = isCompoundEnabled && mode === 'reinvest';

    const res = await this.service.executeZeroSwapRebalance(state.currentTick, dir, pos.tokenId || null, isReinvestMode, pos.walletAddress);

    if (res.success) {
      const oldRange: [number, number] = [pos.priceLower, pos.priceUpper];
      const newRange: [number, number] = [res.newRange.priceLower, res.newRange.priceUpper];

      if (pos.tokenId) {
        if (res.reinvestedAero && res.reinvestedAero > 0) {
          this.storage.updatePosition(pos.tokenId, p => {
            p.harvestedAero = (p.harvestedAero || 0) + res.reinvestedAero!;
            p.collectedUsd = (p.collectedUsd || 0) + (res.reinvestedUsdc || 0);
          });
          this.storage.updateState(s => {
            s.totalHarvestedAero = (s.totalHarvestedAero || 0) + res.reinvestedAero!;
          });
        }

        this.storage.updatePosition(pos.tokenId, p => {
          p.tokenId = res.newTokenId || p.tokenId;
          if (res.walletAddress) p.walletAddress = res.walletAddress;
          p.tickLower = res.newRange.tickLower;
          p.tickUpper = res.newRange.tickUpper;
          p.priceLower = res.newRange.priceLower;
          p.priceUpper = res.newRange.priceUpper;
          p.inRange = true;
          p.outOfRangeSince = null;
          p.rebalancesCount = (p.rebalancesCount || 0) + 1;
        });
      }

      this.storage.updateState(s => {
        s.outOfRangeSince = null;
        s.rebalancesCount = (s.rebalancesCount || 0) + 1;
        s.rebalanceHistory.unshift({
          timestamp: Date.now(),
          tokenId: res.newTokenId || pos.tokenId || '',
          direction: dir,
          price: state.currentPrice,
          oldRange,
          newRange,
          txHash: res.txHash || ''
        });
      });
      this.storage.addLog('ACTION', `🚀 Manual rebalance completed! New NFT: #${res.newTokenId || pos.tokenId}. Range: $${newRange[0].toFixed(2)} - $${newRange[1].toFixed(2)}`);
      return true;
    } else {
      this.storage.addLog('ERROR', `Manual rebalance failed: ${res.error}`);
      return false;
    }
  }

  /**
   * Manual Compound / Harvest triggered from Dashboard
   */
  public async manualCompound(targetTokenId?: string, overrideMode?: 'usdc' | 'reinvest'): Promise<{
    success: boolean;
    mode: 'usdc' | 'reinvest';
    claimedAero?: number;
    usdcReceived?: number;
    txHash?: string;
    error?: string;
  }> {
    const botState = this.storage.getState();
    const pos = (targetTokenId && botState.positions?.length)
      ? (botState.positions.find(p => p.tokenId === targetTokenId) || botState.positions[0])
      : (botState.positions?.[0] || botState.activePosition);

    if (!pos || !pos.tokenId) {
      return { success: false, mode: 'usdc', error: 'No hay posición activa para compound' };
    }

    const mode = overrideMode || pos.compoundMode || botState.compoundMode || 'usdc';
    this.storage.addLog('ACTION', `Iniciando compound manual (${mode === 'usdc' ? '💵 Cosecha a USDC' : '🔄 Reinversión LP'}) para #${pos.tokenId}...`);

    const res = await this.service.executeCompound(pos.tokenId, mode, pos.walletAddress);
    if (res.success) {
      const claimedAero = res.claimedAero || 0;
      const aeroPrice = await this.service.getAeroPriceUsd();
      const recUsd = claimedAero * aeroPrice;
      if (pos.tokenId) {
        this.storage.updatePosition(pos.tokenId, p => {
          p.harvestedAero = (p.harvestedAero || 0) + claimedAero;
          p.collectedUsd = (p.collectedUsd || 0) + recUsd;
        });
      }
      this.storage.updateState(s => {
        s.totalHarvestedAero = (s.totalHarvestedAero || 0) + claimedAero;
      });
      if (mode === 'usdc') {
        this.storage.addLog(
          'ACTION',
          `💵 ¡Cosecha manual exitosa para #${pos.tokenId}! ${(res.claimedAero || 0).toFixed(4)} AERO cambiados a $${(res.usdcReceived || 0).toFixed(2)} USDC en tu wallet! Tx: ${res.txHash?.slice(0, 10)}...`
        );
      } else {
        this.storage.addLog(
          'ACTION',
          `🔄 ¡Bola de Nieve manual: ${(res.claimedAero || 0).toFixed(4)} AERO cambiados a +$${(res.usdcReceived || 0).toFixed(2)} USDC protegidos en wallet! Se sumarán al LP en el próximo rebalanceo al alza. Tx: ${res.txHash?.slice(0, 10)}...`
        );
      }
    } else {
      this.storage.addLog('ERROR', `Compound manual falló para #${pos.tokenId}: ${res.error}`);
    }
    return res;
  }
}
