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
      const pos = botState.activePosition;

      const inRange = this.service.isTickInRange(state.currentTick, pos.tickLower, pos.tickUpper);

      if (inRange) {
        // Price is inside range
        if (botState.outOfRangeSince !== null) {
          this.storage.updateState(s => {
            s.outOfRangeSince = null;
            s.activePosition.inRange = true;
          });
          this.storage.addLog('ACTION', `ETH returned inside range at $${state.currentPrice.toFixed(2)}. Anti-whipsaw delay timer cleared!`);
        } else if (!pos.inRange) {
          this.storage.updateState(s => {
            s.activePosition.inRange = true;
          });
        }
      } else {
        // Price is OUT of range
        const now = Date.now();
        if (botState.outOfRangeSince === null) {
          // Started leaving range right now
          this.storage.updateState(s => {
            s.outOfRangeSince = now;
            s.activePosition.inRange = false;
          });
          const dir = state.currentPrice > pos.priceUpper ? 'ABOVE' : 'BELOW';
          this.storage.addLog('WARN', `ETH exited range ${dir} ($${state.currentPrice.toFixed(2)} vs [${pos.priceLower.toFixed(0)} - ${pos.priceUpper.toFixed(0)}]). 1h delay timer started.`);
        } else {
          // Timer already running, check if 1h has passed
          const elapsedSec = Math.floor((now - botState.outOfRangeSince) / 1000);
          const remainingSec = Math.max(0, config.rebalanceDelaySeconds - elapsedSec);

          if (remainingSec === 0) {
            if (botState.autoSnuggle === false) {
              // Auto-Snuggle is paused by user
              return;
            }
            // Delay expired! Trigger Auto-Rebalance
            const dir = state.currentPrice > pos.priceUpper ? 'UP' : 'DOWN';
            this.storage.addLog('ACTION', `Delay timer expired. Triggering automated Zero-Swap rebalance (${dir})...`);

            const res = await this.service.executeZeroSwapRebalance(state.currentTick, dir, pos.tokenId || null);
            if (res.success) {
              const oldRange: [number, number] = [pos.priceLower, pos.priceUpper];
              const newRange: [number, number] = [res.newRange.priceLower, res.newRange.priceUpper];

              this.storage.updateState(s => {
                s.activePosition = {
                  tokenId: res.newTokenId || s.activePosition.tokenId,
                  tickLower: res.newRange.tickLower,
                  tickUpper: res.newRange.tickUpper,
                  priceLower: res.newRange.priceLower,
                  priceUpper: res.newRange.priceUpper,
                  inRange: true
                };
                s.outOfRangeSince = null;
                s.rebalancesCount += 1;
                s.rebalanceHistory.unshift({
                  timestamp: now,
                  direction: dir,
                  price: state.currentPrice,
                  oldRange,
                  newRange,
                  txHash: res.txHash || ''
                });
              });

              this.storage.addLog('ACTION', `🚀 Rebalance completed! New NFT: #${res.newTokenId || pos.tokenId}. Range: $${newRange[0].toFixed(2)} - $${newRange[1].toFixed(2)} (Tx: ${res.txHash?.slice(0, 10)}...)`);
            } else {
              this.storage.addLog('ERROR', `Rebalance failed: ${res.error}`);
            }
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
  public async manualRebalance(): Promise<boolean> {
    if (!this.lastPoolState) {
      this.lastPoolState = await this.service.getPoolState();
    }
    const state = this.lastPoolState;
    const pos = this.storage.getState().activePosition;
    const dir = state.currentPrice > pos.priceUpper ? 'UP' : 'DOWN';

    this.storage.addLog('ACTION', `User triggered manual Zero-Swap rebalance (${dir})...`);
    const res = await this.service.executeZeroSwapRebalance(state.currentTick, dir, pos.tokenId || null);

    if (res.success) {
      const oldRange: [number, number] = [pos.priceLower, pos.priceUpper];
      const newRange: [number, number] = [res.newRange.priceLower, res.newRange.priceUpper];

      this.storage.updateState(s => {
        s.activePosition = {
          tokenId: res.newTokenId || s.activePosition.tokenId,
          tickLower: res.newRange.tickLower,
          tickUpper: res.newRange.tickUpper,
          priceLower: res.newRange.priceLower,
          priceUpper: res.newRange.priceUpper,
          inRange: true
        };
        s.outOfRangeSince = null;
        s.rebalancesCount += 1;
        s.rebalanceHistory.unshift({
          timestamp: Date.now(),
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
}
