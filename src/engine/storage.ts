import fs from 'fs';
import path from 'path';

export interface BotState {
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
  rebalanceHistory: Array<{
    timestamp: number;
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
        return JSON.parse(raw);
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
