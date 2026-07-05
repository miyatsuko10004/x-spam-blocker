import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export interface Config {
  userDataDir: string | null;
  dryRun: boolean;
  maxBlocksPerRun: number;
  minDelayMs: number;
  maxDelayMs: number;
  targetSearchQuery: string;
  targetSpamContains: string[];
}

const parseKeywords = (val?: string): string[] => {
  if (!val) return [];
  return val.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
};

export const config: Config = {
  userDataDir: process.env.USER_DATA_DIR ? path.resolve(process.env.USER_DATA_DIR) : null,
  dryRun: process.env.DRY_RUN !== 'false', // デフォルトは true（ドライラン）
  maxBlocksPerRun: parseInt(process.env.MAX_BLOCKS_PER_RUN || '50', 10),
  minDelayMs: parseInt(process.env.MIN_DELAY_MS || '5000', 10),
  maxDelayMs: parseInt(process.env.MAX_DELAY_MS || '15000', 10),
  targetSearchQuery: process.env.TARGET_SEARCH_QUERY || '銘柄情報を希望',
  targetSpamContains: parseKeywords(process.env.TARGET_SPAM_CONTAINS || '銘柄情報を希望,資料をまとめました'),
};

console.log('--- Configuration Loaded ---');
console.log(`DRY_RUN: ${config.dryRun}`);
console.log(`User Data Dir: ${config.userDataDir || 'Using temporary browser profile (needs manual login)'}`);
console.log(`Max Blocks Per Run: ${config.maxBlocksPerRun}`);
console.log(`Delay Range: ${config.minDelayMs}ms - ${config.maxDelayMs}ms`);
console.log(`Target Search Query: "${config.targetSearchQuery}"`);
console.log(`Target Spam Contains: [${config.targetSpamContains.join(', ')}]`);
console.log('----------------------------');
