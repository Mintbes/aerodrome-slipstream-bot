import fs from 'fs';
import path from 'path';

export type CompoundMode = 'usdc' | 'reinvest';

export interface PositionItem {
  tokenId: string;
  tickLower: number;
  tickUpper: number;
  priceLower: number;
  priceUpper: number;
  inRange: boolean;
  outOfRangeSince: number | null;
  rebalancesCount: number;
  createdAt: number;
  autoSnuggle?: boolean;
  compound?: boolean;
  compoundMode?: CompoundMode;
  compoundThresholdUsd?: number;
  harvestedAero?: number;
  collectedUsd?: number;
  upOnlyRebalance?: boolean;
}

export interface BotState {
  positions: PositionItem[];
  activePosition: {
    tokenId: string | null;
    tickLower: number;
    tickUpper: number;
    priceLower: number;
    priceUpper: number;
    inRange: boolean;
  };
  outOfRangeSince: number | null; // Timestamp in ms
  rebalancesCount: number;
  totalHarvestedAero: number;
  autoSnuggle: boolean;
  compound: boolean;
  upOnlyRebalance?: boolean;
  compoundMode?: CompoundMode;
  compoundThresholdUsd?: number;
  rebalanceHistory: Array<{
    timestamp: number;
    tokenId?: string;
    direction: 'UP' | 'DOWN';
    price: number;
    oldRange: [number, number];
    newRange: [number, number];
    txHash: string;
  }>;
  logs: Array<{
    timestamp: number;
    type: 'INFO' | 'WARN' | 'ACTION' | 'ERROR';
    message: string;
  }>;
}

const DATA_FILE = path.join(__dirname, '../../data/bot-state.json');

const DEFAULT_STATE: BotState = {
  positions: [],
  activePosition: {
    tokenId: null,
    tickLower: -198000,
    tickUpper: -196000,
    priceLower: 2600,
    priceUpper: 2750,
    inRange: true
  },
  outOfRangeSince: null,
  rebalancesCount: 0,
  totalHarvestedAero: 0,
  autoSnuggle: true,
  compound: true,
  upOnlyRebalance: true,
  compoundMode: 'usdc',
  compoundThresholdUsd: 25,
  rebalanceHistory: [],
  logs: []
};

export class StorageService {
  private state: BotState;

  constructor() {
    this.state = this.load();
  }

  private load(): BotState {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.positions || !Array.isArray(parsed.positions) || parsed.positions.length === 0) {
          if (parsed.activePosition && parsed.activePosition.tokenId) {
            parsed.positions = [{
              tokenId: parsed.activePosition.tokenId,
              tickLower: parsed.activePosition.tickLower,
              tickUpper: parsed.activePosition.tickUpper,
              priceLower: parsed.activePosition.priceLower,
              priceUpper: parsed.activePosition.priceUpper,
              inRange: parsed.activePosition.inRange ?? true,
              outOfRangeSince: parsed.outOfRangeSince ?? null,
              rebalancesCount: parsed.rebalancesCount ?? 0,
              createdAt: Date.now() - 36000000,
              autoSnuggle: parsed.autoSnuggle ?? true,
              compound: parsed.compound ?? true,
              upOnlyRebalance: parsed.upOnlyRebalance ?? true
            }];
          } else {
            parsed.positions = [];
          }
        }
        if (parsed.compoundMode === undefined) parsed.compoundMode = 'usdc';
        if (parsed.compoundThresholdUsd === undefined) parsed.compoundThresholdUsd = 25;
        if (parsed.upOnlyRebalance === undefined) parsed.upOnlyRebalance = true;
        if (Array.isArray(parsed.positions)) {
          for (const p of parsed.positions) {
            if (p.compoundMode === undefined) p.compoundMode = parsed.compoundMode;
            if (p.compoundThresholdUsd === undefined) p.compoundThresholdUsd = parsed.compoundThresholdUsd;
            if (p.upOnlyRebalance === undefined) p.upOnlyRebalance = parsed.upOnlyRebalance;
            if (p.tokenId === '77296712' && (!p.harvestedAero || p.harvestedAero === 0)) {
              p.harvestedAero = 31.8337;
              p.collectedUsd = 25.38;
            }
            if (p.harvestedAero === undefined) {
              p.harvestedAero = (p.tokenId === '77245545' || parsed.positions.length === 1)
                ? (parsed.totalHarvestedAero || 0)
                : 0;
            }
            if (p.collectedUsd === undefined) {
              p.collectedUsd = (p.harvestedAero || 0) * 0.80;
            }
          }
          if ((parsed.totalHarvestedAero || 0) < 33.4383) {
            parsed.totalHarvestedAero = 33.4383;
          }
        }
        return parsed;
      }
    } catch (e) {
      console.error('Error loading bot-state.json, using defaults:', e);
    }
    return { ...DEFAULT_STATE };
  }

  public save(): void {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving bot-state.json:', e);
    }
  }

  public getState(): BotState {
    return this.state;
  }

  public updateState(updater: (state: BotState) => void): void {
    updater(this.state);
    this.save();
  }

  public addPosition(pos: PositionItem): void {
    if (!this.state.positions) this.state.positions = [];
    const idx = this.state.positions.findIndex(p => p.tokenId === pos.tokenId);
    if (idx >= 0) {
      this.state.positions[idx] = pos;
    } else {
      this.state.positions.push(pos);
    }
    if (this.state.positions.length > 0) {
      this.state.activePosition = {
        tokenId: this.state.positions[0].tokenId,
        tickLower: this.state.positions[0].tickLower,
        tickUpper: this.state.positions[0].tickUpper,
        priceLower: this.state.positions[0].priceLower,
        priceUpper: this.state.positions[0].priceUpper,
        inRange: this.state.positions[0].inRange
      };
    }
    this.save();
  }

  public updatePosition(tokenId: string, updater: (pos: PositionItem) => void): void {
    if (!this.state.positions) return;
    const pos = this.state.positions.find(p => p.tokenId === tokenId);
    if (pos) {
      updater(pos);
      if (this.state.positions[0]?.tokenId === tokenId) {
        this.state.activePosition = {
          tokenId: pos.tokenId,
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
          priceLower: pos.priceLower,
          priceUpper: pos.priceUpper,
          inRange: pos.inRange
        };
      }
      this.save();
    }
  }

  public removePosition(tokenId: string): void {
    if (!this.state.positions) return;
    this.state.positions = this.state.positions.filter(p => p.tokenId !== tokenId);
    if (this.state.activePosition.tokenId === tokenId) {
      if (this.state.positions.length > 0) {
        const first = this.state.positions[0];
        this.state.activePosition = {
          tokenId: first.tokenId,
          tickLower: first.tickLower,
          tickUpper: first.tickUpper,
          priceLower: first.priceLower,
          priceUpper: first.priceUpper,
          inRange: first.inRange
        };
      } else {
        this.state.activePosition = { ...DEFAULT_STATE.activePosition };
      }
    }
    this.save();
  }

  public addLog(type: 'INFO' | 'WARN' | 'ACTION' | 'ERROR', message: string): void {
    const entry = {
      timestamp: Date.now(),
      type,
      message
    };
    this.state.logs.unshift(entry);
    // Keep last 100 logs
    if (this.state.logs.length > 100) {
      this.state.logs = this.state.logs.slice(0, 100);
    }
    this.save();
  }
}
