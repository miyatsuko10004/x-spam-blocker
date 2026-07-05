import { config } from './config.js';

/**
 * ツイート本文がスパムのコピペ定型文に該当するか判定する
 * 設定された「TARGET_SPAM_CONTAINS」のキーワードがすべて含まれている場合にスパムとみなす（AND判定）
 */
export function isSpamTweet(text: string): boolean {
  const textLower = text.toLowerCase();
  
  if (config.targetSpamContains.length === 0) {
    return false;
  }
  
  // すべてのキーワードが含まれているか確認
  return config.targetSpamContains.every(keyword => textLower.includes(keyword));
}
