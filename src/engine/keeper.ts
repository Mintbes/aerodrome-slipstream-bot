import { AerodromeService, PoolState } from '../aerodrome/service';
import { StorageService } from './storage';
import { config } from '../config';

export class KeeperEngine {
  private service: AerodromeService;
  private storage: StorageService;
  private isRunning: boolean = false;
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
              const targetRange = this.service.calculateRebalanceRange(state.currentTick, dir);
              if (targetRange.tickLower === pos.tickLower && targetRange.tickUpper === pos.tickUpper) {
                if (!(pos as any).lastRedundantLog || (Date.now() - (pos as any).lastRedundantLog > 300000)) {
                  this.storage.addLog('INFO', `ETH ($${state.currentPrice.toFixed(2)}) está entre ticks CL100. El rango óptimo Zero-Swap [${pos.priceLower.toFixed(0)} - ${pos.priceUpper.toFixed(0)}] ya coincide con el actual. Esperando movimiento de precio para no gastar gas inútilmente.`);
                  (pos as any).lastRedundantLog = Date.now();
                }
                continue;
              }

              this.storage.addLog('ACTION', `Delay timer expired for #${pos.tokenId}. Triggering automated Zero-Swap rebalance (${dir})...`);

              const res = await this.service.executeZeroSwapRebalance(state.currentTick, dir, pos.tokenId || null);
              if (res.success) {
                const oldRange: [number, number] = [pos.priceLower, pos.priceUpper];
                const newRange: [number, number] = [res.newRange.priceLower, res.newRange.priceUpper];

                this.storage.updatePosition(pos.tokenId, p => {
                  p.tokenId = res.newTokenId || p.tokenId;
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

                this.storage.addLog('ACTION', `🚀 Rebalance completed for #${pos.tokenId}! New NFT: #${res.newTokenId || pos.tokenId}. Range: $${newRange[0].toFixed(2)} - $${newRange[1].toFixed(2)}`);
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

          try {
            const amounts = await this.service.getPositionAmounts(pos.tokenId, state.currentPrice);
            const pendingUsd = amounts.uncollectedFeesUsd || 0;

            if (pendingUsd >= threshold) {
              this.storage.addLog(
                'ACTION',
                `🎯 Umbral de cosecha alcanzado para #${pos.tokenId}: $${pendingUsd.toFixed(2)} acumulados >= umbral $${threshold}. Ejecutando Auto-Compound (${mode === 'usdc' ? '💵 Cosecha a USDC' : '🔄 Reinversión LP'})...`
              );
              const compRes = await this.service.executeCompound(pos.tokenId, mode);
              const claimedAero = compRes.claimedAero || 0;
              if (claimedAero > 0) {
                const aeroPrice = await this.service.getAeroPriceUsd();
                const recUsd = compRes.usdcReceived || (claimedAero * aeroPrice);
                this.storage.updatePosition(pos.tokenId, p => {
                  p.harvestedAero = (p.harvestedAero || 0) + claimedAero;
                  p.collectedUsd = (p.collectedUsd || 0) + recUsd;
                });
                this.storage.updateState(s => {
                  s.totalHarvestedAero = (s.totalHarvestedAero || 0) + claimedAero;
                });
              }
              if (compRes.success) {
                if (mode === 'usdc') {
                  this.storage.addLog(
                    'ACTION',
                    `💵 ¡Auto-Cosecha exitosa para #${pos.tokenId}! ${(compRes.claimedAero || 0).toFixed(4)} AERO cambiados a $${(compRes.usdcReceived || 0).toFixed(2)} USDC en tu wallet! Tx: ${compRes.txHash?.slice(0, 10)}...`
                  );
                } else {
                  this.storage.addLog(
                    'ACTION',
                    `🔄 ¡Auto-Compound exitoso para #${pos.tokenId}! ${(compRes.claimedAero || 0).toFixed(4)} AERO reinvertidos en la posición LP. Tx: ${compRes.txHash?.slice(0, 10)}...`
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
    const res = await this.service.executeZeroSwapRebalance(state.currentTick, dir, pos.tokenId || null);

    if (res.success) {
      const oldRange: [number, number] = [pos.priceLower, pos.priceUpper];
      const newRange: [number, number] = [res.newRange.priceLower, res.newRange.priceUpper];

      if (pos.tokenId) {
        this.storage.updatePosition(pos.tokenId, p => {
          p.tokenId = res.newTokenId || p.tokenId;
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

    const res = await this.service.executeCompound(pos.tokenId, mode);
    if (res.success) {
      const claimedAero = res.claimedAero || 0;
      const aeroPrice = await this.service.getAeroPriceUsd();
      const recUsd = res.usdcReceived || (claimedAero * aeroPrice);
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
          `🔄 ¡Compound manual exitoso para #${pos.tokenId}! ${(res.claimedAero || 0).toFixed(4)} AERO reinvertidos en LP. Tx: ${res.txHash?.slice(0, 10)}...`
        );
      }
    } else {
      this.storage.addLog('ERROR', `Compound manual falló para #${pos.tokenId}: ${res.error}`);
    }
    return res;
  }
}
