"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
dotenv.config();
const parseKeywords = (val) => {
    if (!val)
        return [];
    return val.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
};
exports.config = {
    userDataDir: process.env.USER_DATA_DIR ? path.resolve(process.env.USER_DATA_DIR) : null,
    dryRun: process.env.DRY_RUN !== 'false', // デフォルトは true（ドライラン）
    maxBlocksPerRun: parseInt(process.env.MAX_BLOCKS_PER_RUN || '50', 10),
    minDelayMs: parseInt(process.env.MIN_DELAY_MS || '5000', 10),
    maxDelayMs: parseInt(process.env.MAX_DELAY_MS || '15000', 10),
    spamKeywords: parseKeywords(process.env.SPAM_KEYWORDS || '副業,オナ,プロフ見て,稼げる,裏アカ,固定ツイ,アフィリエイト,バイナリー,配り'),
    maxFollowerCount: parseInt(process.env.MAX_FOLLOWER_COUNT || '15', 10),
};
console.log('--- Configuration Loaded ---');
console.log(`DRY_RUN: ${exports.config.dryRun}`);
console.log(`User Data Dir: ${exports.config.userDataDir || 'Using temporary browser profile (needs manual login)'}`);
console.log(`Max Blocks Per Run: ${exports.config.maxBlocksPerRun}`);
console.log(`Delay Range: ${exports.config.minDelayMs}ms - ${exports.config.maxDelayMs}ms`);
console.log(`Spam Keywords: [${exports.config.spamKeywords.join(', ')}]`);
console.log(`Max Followers: ${exports.config.maxFollowerCount}`);
console.log('----------------------------');
