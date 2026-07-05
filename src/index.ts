import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config.js';
import { detectSpam, UserInfo } from './spamDetector.js';

const LOG_DIR = path.resolve('logs');
const HISTORY_FILE = path.join(LOG_DIR, 'scanned_history.json');

interface HistoryEntry {
  status: 'blocked' | 'skipped';
  reasons?: string[];
  timestamp: string;
}

interface ScanHistory {
  [username: string]: HistoryEntry;
}

// 履歴の読み込み
function loadHistory(): ScanHistory {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to load history, starting fresh:', e);
    }
  }
  return {};
}

// 履歴の保存
function saveHistory(history: ScanHistory) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

// ランダムディレイ
async function delay(msMin: number, msMax: number) {
  const ms = Math.floor(Math.random() * (msMax - msMin + 1) + msMin);
  console.log(`Waiting for ${(ms / 1000).toFixed(1)} seconds...`);
  await new Promise(resolve => setTimeout(resolve, ms));
}

// フォロワー数のテキストを数値に変換する
// 例: "1,234", "1.2万", "12.3K", "1.5M"
function parseFollowers(text: string): number {
  // 不要な文字を削除し、数値を抽出
  const cleaned = text.replace(/フォロワー|Followers/gi, '').trim().replace(/,/g, '');
  
  if (cleaned.includes('万')) {
    const num = parseFloat(cleaned.replace('万', ''));
    return Math.floor(num * 10000);
  }
  if (cleaned.toLowerCase().includes('k')) {
    const num = parseFloat(cleaned.replace(/k/i, ''));
    return Math.floor(num * 1000);
  }
  if (cleaned.toLowerCase().includes('m')) {
    const num = parseFloat(cleaned.replace(/m/i, ''));
    return Math.floor(num * 1000000);
  }
  
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

// ログイン確認と待機
async function ensureLoggedIn(page: Page): Promise<void> {
  console.log('Checking login status...');
  await page.goto('https://x.com/notifications');

  // ログインページにリダイレクトされたかチェック
  if (page.url().includes('login') || page.url().includes('i/flow/login')) {
    console.log('--------------------------------------------------');
    console.log('WARNING: Not logged in.');
    console.log('Please log in manually in the opened browser window.');
    console.log('Waiting for you to complete login...');
    console.log('--------------------------------------------------');
    
    // 通知ページが表示されるまで待機（タイムアウトなし）
    await page.waitForURL('**/notifications', { timeout: 0 });
    console.log('Login detected! Proceeding...');
  } else {
    console.log('Already logged in.');
  }
}

// ログイン中のユーザー名を取得する
async function getCurrentUser(page: Page): Promise<string | null> {
  const profileLinkEl = page.locator('a[data-testid="AppTabBar_Profile_Link"]').first();
  // 表示されるのを最大5秒待つ
  await profileLinkEl.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await profileLinkEl.isVisible()) {
    const href = await profileLinkEl.getAttribute('href');
    if (href) {
      return href.substring(1); // スラッシュを除去
    }
  }
  return null;
}

// 通知ページからユーザーハンドルを抽出する
async function extractUsernamesFromNotifications(page: Page, currentUser: string | null): Promise<string[]> {
  console.log('Scanning notifications page for active accounts...');
  
  // 通知の要素がロードされるのを待つ
  await page.waitForSelector('div[data-testid="cellInnerDiv"]', { timeout: 15000 }).catch(() => {
    console.log('Timeout waiting for notification cells. Page might be empty or loading slowly.');
  });

  // 通知内のリンク要素から、ユーザー名らしきパスを抽出
  const hrefs = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('div[data-testid="cellInnerDiv"] a[href^="/"]'));
    return links.map(link => link.getAttribute('href')).filter(Boolean) as string[];
  });

  const excludedPaths = [
    '/home', '/explore', '/notifications', '/messages', '/search', '/i/', '/settings', '/tos', '/privacy',
    '/status', '/hashtag', '/widgets'
  ];

  const usernameRegex = /^[a-zA-Z0-9_]{4,15}$/;
  const usernames = new Set<string>();

  for (const href of hrefs) {
    const cleanPath = href.substring(1);
    if (cleanPath.includes('/')) continue;
    
    const isExcluded = excludedPaths.some(p => href.startsWith(p));
    if (isExcluded) continue;

    if (currentUser && cleanPath.toLowerCase() === currentUser.toLowerCase()) {
      continue;
    }

    if (usernameRegex.test(cleanPath)) {
      usernames.add(cleanPath);
    }
  }

  return Array.from(usernames);
}

// プロフィールページからユーザー情報を取得する
async function fetchUserInfo(page: Page, username: string): Promise<UserInfo | null> {
  console.log(`Navigating to https://x.com/${username} ...`);
  await page.goto(`https://x.com/${username}`);
  
  // 主要なプロフィール要素、またはアカウント非存在ステートが表示されるのを待つ
  try {
    await page.waitForSelector('div[data-testid="UserName"], div[data-testid="emptyState"]', { timeout: 15000 });
  } catch (e) {
    console.log(`Timeout waiting for page load of @${username}. Skipping.`);
    return null;
  }
  
  // アカウントが存在するか、ブロックされているかなどをチェック
  const isNotFound = await page.locator('div[data-testid="emptyState"]').filter({ hasText: 'このアカウントは存在しません' }).isVisible().catch(() => false);
  const isNotFoundEn = await page.locator('div[data-testid="emptyState"]').filter({ hasText: 'This account doesn’t exist' }).isVisible().catch(() => false);
  if (isNotFound || isNotFoundEn) {
    console.log(`Account @${username} does not exist.`);
    return null;
  }

  const isBlockedByUs = await page.locator('button:has-text("ブロック解除")').isVisible().catch(() => false);
  const isBlockedByUsEn = await page.locator('button:has-text("Unblock")').isVisible().catch(() => false);
  if (isBlockedByUs || isBlockedByUsEn) {
    console.log(`Account @${username} is already blocked.`);
    return null;
  }

  // 表示名（Screen Name）の取得
  let screenName = '';
  const nameEl = page.locator('div[data-testid="UserName"] span').first();
  if (await nameEl.isVisible()) {
    screenName = (await nameEl.innerText()) || '';
  }

  // 自己紹介（Bio）の取得
  let bio = '';
  const bioEl = page.locator('div[data-testid="UserDescription"]');
  if (await bioEl.isVisible()) {
    bio = (await bioEl.innerText()) || '';
  }

  // フォロワー数の取得
  let followerCount = 0;
  const followerEl = page.locator(`a[href$="/followers"]`).first();
  // 読み込みにラグがある場合があるため待つ
  await followerEl.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  if (await followerEl.isVisible()) {
    const text = await followerEl.innerText();
    followerCount = parseFollowers(text);
  } else {
    console.log('Follower element not found or hidden.');
  }

  // 最新のポスト（ツイート）の取得（最大2件）
  const recentTweets: string[] = [];
  try {
    // ツイートが表示されるのを待つ
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 5000 }).catch(() => {});
    const tweetTextElements = page.locator('article[data-testid="tweet"] div[data-testid="tweetText"]');
    const count = Math.min(await tweetTextElements.count(), 2);
    for (let i = 0; i < count; i++) {
      const text = await tweetTextElements.nth(i).innerText().catch(() => '');
      if (text) {
        recentTweets.push(text);
      }
    }
  } catch (e) {
    console.log(`Failed to fetch recent tweets for @${username}:`, e);
  }

  return {
    screenName,
    handle: `@${username}`,
    bio,
    followerCount,
    recentTweets
  };
}

// アカウントをブロックする
async function blockUser(page: Page, username: string): Promise<boolean> {
  console.log(`Attempting to block @${username}...`);

  // 3点リーダーボタン (More Actions)
  const actionButton = page.locator('div[data-testid="userActions"]');
  if (!(await actionButton.isVisible())) {
    console.error('Could not find user actions button (3-dots).');
    return false;
  }
  await actionButton.click();
  await page.waitForTimeout(1000); // メニュー表示を待つ

  // メニュー内のブロックボタンを探してクリック
  const blockMenu = page.locator('div[role="menuitem"]').filter({ 
    hasText: new RegExp(`(ブロック|Block @${username})`, 'i') 
  }).first();

  if (!(await blockMenu.isVisible())) {
    console.error('Block option not found in menu.');
    // メニュー外をクリックして閉じる
    await page.click('body', { position: { x: 10, y: 10 } });
    return false;
  }
  await blockMenu.click();
  await page.waitForTimeout(1000); // ダイアログ表示を待つ

  // 確認ダイアログの「ブロック」ボタン
  const confirmButton = page.locator('div[data-testid="confirmationSheetConfirm"]');
  if (!(await confirmButton.isVisible())) {
    console.error('Confirmation dialog block button not found.');
    return false;
  }
  
  await confirmButton.click();
  console.log(`Successfully blocked @${username}`);
  return true;
}

// メイン実行処理
async function run() {
  const history = loadHistory();
  let blockCount = 0;

  console.log('Starting Playwright X Spam Blocker...');
  
  let context: BrowserContext;

  // 永続的なコンテキストをロードするかどうか
  if (config.userDataDir) {
    console.log(`Launching browser with user data directory: ${config.userDataDir}`);
    context = await chromium.launchPersistentContext(config.userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      // Xの自動化検知を避けるための設定
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox'
      ]
    });
  } else {
    console.log('Launching browser with temporary profile...');
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox'
      ]
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
  }

  // 最初のページを取得
  const page = context.pages()[0] || (await context.newPage());

  try {
    // ログイン確認
    await ensureLoggedIn(page);

    // ログイン中の自身のユーザー名を取得する
    const currentUser = await getCurrentUser(page);
    console.log(`Current logged in user: ${currentUser ? `@${currentUser}` : 'unknown'}`);

    // スキャン対象ユーザーのリストを取得
    const targetUsers = await extractUsernamesFromNotifications(page, currentUser);
    console.log(`Found ${targetUsers.length} potential targets in notifications.`);

    for (const username of targetUsers) {
      // すでに処理済みならスキップ
      if (history[username]) {
        console.log(`Skipping @${username} (already scanned previously).`);
        continue;
      }

      if (blockCount >= config.maxBlocksPerRun) {
        console.log(`Reached limit of max blocks per run (${config.maxBlocksPerRun}). Exiting loop.`);
        break;
      }

      console.log('--------------------------------------------------');
      console.log(`Processing @${username}...`);

      const userInfo = await fetchUserInfo(page, username);
      if (!userInfo) {
        // アカウントが存在しない、または既にブロック済みの場合は履歴にスキップとして登録
        history[username] = {
          status: 'skipped',
          timestamp: new Date().toISOString(),
        };
        saveHistory(history);
        continue;
      }

      console.log(`User Info fetched:`, {
        ScreenName: userInfo.screenName,
        Handle: userInfo.handle,
        Followers: userInfo.followerCount,
        BioSnippet: userInfo.bio.substring(0, 50).replace(/\n/g, ' ') + '...',
        RecentTweetsCount: userInfo.recentTweets?.length || 0
      });

      // スパム判定
      const detection = detectSpam(userInfo);
      if (detection.isSpam) {
        console.log(`[SPAM DETECTED] @${username} matches spam criteria.`);
        console.log(`Reasons:`, detection.reasons);

        if (config.dryRun) {
          console.log(`[DRY RUN] Would block @${username}`);
          history[username] = {
            status: 'skipped', // ドライランなので実際はブロックしないが履歴に保存
            reasons: detection.reasons,
            timestamp: new Date().toISOString()
          };
        } else {
          const success = await blockUser(page, username);
          if (success) {
            blockCount++;
            history[username] = {
              status: 'blocked',
              reasons: detection.reasons,
              timestamp: new Date().toISOString()
            };
          } else {
            console.log(`Failed to block @${username}`);
          }
        }
      } else {
        console.log(`[SAFE] @${username} did not match spam criteria.`);
        history[username] = {
          status: 'skipped',
          timestamp: new Date().toISOString()
        };
      }

      // 履歴を即座に保存
      saveHistory(history);

      // ブロック間または巡回間のインターバルディレイ
      await delay(config.minDelayMs, config.maxDelayMs);
    }

    console.log('--------------------------------------------------');
    console.log(`Scan completed. Blocked ${blockCount} accounts in this run.`);

  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    // ブラウザを閉じる（PersistentContextの場合はクローズ）
    await context.close();
    console.log('Browser closed. Exit.');
  }
}

run().catch(console.error);
