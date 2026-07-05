"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSpam = detectSpam;
const config_js_1 = require("./config.js");
/**
 * ユーザー情報からスパムアカウントかどうかを判定する
 */
function detectSpam(user) {
    const reasons = [];
    const bioLower = user.bio.toLowerCase();
    const screenNameLower = user.screenName.toLowerCase();
    const handleLower = user.handle.toLowerCase();
    // 1. キーワード判定
    for (const keyword of config_js_1.config.spamKeywords) {
        if (bioLower.includes(keyword)) {
            reasons.push(`Bio contains spam keyword: "${keyword}"`);
        }
        if (screenNameLower.includes(keyword)) {
            reasons.push(`Screen name contains spam keyword: "${keyword}"`);
        }
    }
    // 2. フォロワー数判定
    if (config_js_1.config.maxFollowerCount >= 0 && user.followerCount <= config_js_1.config.maxFollowerCount) {
        reasons.push(`Follower count (${user.followerCount}) is below limit (${config_js_1.config.maxFollowerCount})`);
    }
    // 3. リプライ内容の判定 (オプション)
    if (user.replyContent) {
        const replyLower = user.replyContent.toLowerCase();
        // プロフ誘導をチェック
        const profRedirectKeywords = ['プロフ', 'プロフィール', '固定', 'こっち', '見て'];
        const hasRedirect = profRedirectKeywords.some(kw => replyLower.includes(kw));
        const hasAdultKeywords = ['オナ', '動画', 'カジノ', '副業'].some(kw => replyLower.includes(kw));
        if (hasRedirect && hasAdultKeywords) {
            reasons.push(`Reply content looks like profile-redirect spam`);
        }
    }
    // 4. 最新ポスト内容の判定 (オプション)
    if (user.recentTweets && user.recentTweets.length > 0) {
        for (const tweet of user.recentTweets) {
            const tweetLower = tweet.toLowerCase();
            for (const keyword of config_js_1.config.spamTweetKeywords) {
                if (tweetLower.includes(keyword)) {
                    reasons.push(`Recent tweet contains spam keyword: "${keyword}" (Tweet: "${tweet.substring(0, 40).replace(/\n/g, ' ')}...")`);
                }
            }
        }
    }
    // 判定条件の評価：
    // 危険なキーワードがBio/表示名に含まれる、または最新ポストに含まれる場合、またはフォロワー数が閾値以下かつリプライ誘導がある場合をスパムとする。
    const hasSpamKeyword = reasons.some(r => r.startsWith('Bio contains') || r.startsWith('Screen name contains'));
    const isLowFollowers = reasons.some(r => r.startsWith('Follower count'));
    const hasSpamReply = reasons.some(r => r.startsWith('Reply content'));
    const hasSpamTweet = reasons.some(r => r.startsWith('Recent tweet contains'));
    let isSpam = false;
    if (hasSpamKeyword || hasSpamTweet) {
        isSpam = true;
    }
    else if (isLowFollowers && hasSpamReply) {
        isSpam = true;
    }
    return {
        isSpam,
        reasons
    };
}
