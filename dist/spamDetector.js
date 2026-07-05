"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSpamTweet = isSpamTweet;
const config_js_1 = require("./config.js");
/**
 * ツイート本文がスパムのコピペ定型文に該当するか判定する
 * 設定された「TARGET_SPAM_CONTAINS」のキーワードがすべて含まれている場合にスパムとみなす（AND判定）
 */
function isSpamTweet(text) {
    const textLower = text.toLowerCase();
    if (config_js_1.config.targetSpamContains.length === 0) {
        return false;
    }
    // すべてのキーワードが含まれているか確認
    return config_js_1.config.targetSpamContains.every(keyword => textLower.includes(keyword));
}
