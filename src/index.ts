import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config.js';
import { isSpamTweet } from './spamDetector.js';

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
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch (e) {
      console.error('Failed to parse history file, starting fresh:', e);
      return {};
    }
  }
  return {};
}

// 履歴の保存
function saveHistory(history: ScanHistory) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

// ランダムディレイ
function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  console.log(`Waiting for ${(ms / 1000).toFixed(1)} seconds...`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ログイン済みか確認（ログインページ等が表示されていればエラー）
async function ensureLoggedIn(page: Page) {
  console.log('Checking login status...');
  await page.goto('https://x.com/home');
  await page.waitForTimeout(3000);

  const isLoginRequired = await page.url().includes('login') || 
                          await page.locator('a[href="/login"]').isVisible().catch(() => false);

  if (isLoginRequired) {
    console.error('==================================================');
    console.error('ERROR: NOT LOGGED IN.');
    console.error('Please log in manually via the browser window first.');
    console.error('Once logged in, the session will be saved to your user data directory.');
    console.error('==================================================');
    throw new Error('Authentication required.');
  }
  console.log('Already logged in.');
}

// ログイン中の自分自身のユーザー名を取得する
async function getCurrentUser(page: Page): Promise<string | null> {
  const profileLinkEl = page.locator('a[data-testid="AppTabBar_Profile_Link"]');
  await profileLinkEl.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await profileLinkEl.isVisible()) {
    const href = await profileLinkEl.getAttribute('href');
    if (href) {
      return href.substring(1); // スラッシュを除去
    }
  }
  return null;
}

interface SearchTarget {
  username: string;
  tweetText: string;
}

// 検索ページからユーザーハンドルとツイートテキストを抽出する
async function extractTargetsFromSearch(page: Page, keyword: string, currentUser: string | null): Promise<SearchTarget[]> {
  const query = encodeURIComponent(keyword);
  const searchUrl = `https://x.com/search?q=${query}&f=live`;
  console.log(`Navigating to search page: ${searchUrl}`);
  await page.goto(searchUrl);

  // ツイート要素、または「Retry」ボタンがロードされるのを待つ
  let isLoaded = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // タイムライン要素、またはリトライボタンを待つ
      await Promise.race([
        page.waitForSelector('article[data-testid="tweet"]', { timeout: 8000 }),
        page.waitForSelector('button:has-text("Retry"), button:has-text("再読み込み"), [role="button"]:has-text("Retry")', { timeout: 8000 })
      ]);
      
      // リトライボタンが表示されている場合はクリックして再試行
      const retryButton = page.locator('button:has-text("Retry"), button:has-text("再読み込み"), [role="button"]:has-text("Retry")').first();
      if (await retryButton.isVisible()) {
        console.log('Detected "Something went wrong" screen. Clicking Retry button...');
        await retryButton.click();
        await page.waitForTimeout(3000);
        continue;
      }
      
      isLoaded = true;
      break;
    } catch (e) {
      console.log(`Load attempt ${attempt + 1} failed. Re-navigating...`);
      await page.goto(searchUrl);
      await page.waitForTimeout(3000);
    }
  }

  if (!isLoaded) {
    console.log('Failed to load search results timeline after retries.');
    const screenshotPath = path.join(LOG_DIR, `search_timeout_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    console.log(`Saved debug screenshot to ${screenshotPath}`);
  }

  // もし最新(Latest)タブが選択されていない場合は明示的にクリックする
  try {
    const latestTab = page.locator('div[role="tablist"] a').filter({
      hasText: /^(最新|Latest)$/i
    }).first();
    
    // selected状態ではない場合のみクリック
    const isSelected = await latestTab.getAttribute('aria-selected') === 'true';
    if (await latestTab.isVisible() && !isSelected) {
      console.log('Latest tab is not selected. Clicking "Latest" tab explicitly...');
      await latestTab.click();
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    // スルー
  }

  // より多くのツイートをロードするためにページをスクロールする（20回スクロールして深くスキャン）
  console.log('Scrolling to load more search results (20 scroll iterations)...');
  try {
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000); // ロード待ち
    }
  } catch (e) {
    console.log('Failed during scrolling:', e);
  }

  // タイムラインの各ツイートからユーザー名と本文をペアで抽出
  const targets = await page.evaluate(() => {
    const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const results: { username: string; tweetText: string }[] = [];

    for (const tweet of tweets) {
      // ユーザー名リンク
      const userLink = tweet.querySelector('div[data-testid="User-Name"] a[href^="/"]');
      if (!userLink) continue;

      const href = userLink.getAttribute('href');
      if (!href) continue;

      const username = href.replace(/^\//, '');

      // ツイート本文
      const textEl = tweet.querySelector('div[data-testid="tweetText"]');
      const tweetText = textEl ? textEl.textContent || '' : '';

      results.push({ username, tweetText });
    }

    return results;
  });

  const excludedPaths = [
    'home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings', 'tos', 'privacy',
    'status', 'hashtag', 'widgets'
  ];

  const usernameRegex = /^[a-zA-Z0-9_]{4,15}$/;
  const validTargets: SearchTarget[] = [];
  const processedUsernames = new Set<string>();

  for (const target of targets) {
    const usernameLower = target.username.toLowerCase();
    
    // 除外チェック
    if (processedUsernames.has(usernameLower)) continue;
    if (target.username.includes('/')) continue;
    if (excludedPaths.some(p => usernameLower === p)) continue;
    if (currentUser && usernameLower === currentUser.toLowerCase()) continue;
    if (!usernameRegex.test(target.username)) continue;

    processedUsernames.add(usernameLower);
    validTargets.push(target);
  }

  return validTargets;
}

// ユーザーをブロックする
async function blockUser(page: Page, username: string): Promise<boolean> {
  console.log(`Navigating to https://x.com/${username} for blocking...`);
  await page.goto(`https://x.com/${username}`);
  
  // ロード待ち
  try {
    await page.waitForSelector('div[data-testid="UserName"], div[data-testid="emptyState"]', { timeout: 15000 });
  } catch (e) {
    console.log(`Timeout waiting for page load of @${username}. Cannot block.`);
    return false;
  }

  // ブロック解除ボタンが表示されていれば既にブロック済み
  const isAlreadyBlocked = await page.locator('button:has-text("ブロック解除"), button:has-text("Unblock")').first().isVisible().catch(() => false);
  if (isAlreadyBlocked) {
    console.log(`@${username} is already blocked.`);
    return true;
  }

  // アクションメニュー(もっと見る/3点リーダー)を探してクリック
  const actionButton = page.locator('[data-testid="userActions"], [aria-label="もっと見る"], [aria-label="More"]').first();
  await actionButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  
  if (!(await actionButton.isVisible())) {
    console.error('More button (userActions) not found.');
    return false;
  }
  await actionButton.click();

  // メニュー内のブロックボタンを探してクリック
  const blockMenu = page.locator('div[role="menuitem"]').filter({ 
    hasText: new RegExp(`(ブロック|Block)`, 'i') 
  }).first();
  await blockMenu.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
 
  if (!(await blockMenu.isVisible())) {
    console.error('Block option not found in menu.');
    // メニュー外をクリックして閉じる
    await page.click('body', { position: { x: 10, y: 10 } });
    return false;
  }
  await blockMenu.click();

  // 確認ダイアログの「ブロック」ボタン
  const confirmButton = page.locator('[data-testid="confirmationSheetConfirm"], button:has-text("ブロック"), button:has-text("Block")').first();
  await confirmButton.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
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
  const maxIterations = 3;

  console.log('Starting Playwright X Spam Blocker...');
  
  let context: BrowserContext;

  // 永続的なコンテキストをロード
  if (config.userDataDir) {
    console.log(`Launching browser with user data directory: ${config.userDataDir}`);
    context = await chromium.launchPersistentContext(config.userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
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

  const page = context.pages()[0] || (await context.newPage());

  try {
    await ensureLoggedIn(page);

    const currentUser = await getCurrentUser(page);
    console.log(`Current logged in user: ${currentUser ? `@${currentUser}` : 'unknown'}`);

    for (let iter = 1; iter <= maxIterations; iter++) {
      console.log(`\n==================================================`);
      console.log(`=== RUNNING ITERATION ${iter}/${maxIterations} ===`);
      console.log(`==================================================\n`);

      if (blockCount >= config.maxBlocksPerRun) {
        console.log(`Reached limit of max blocks per run (${config.maxBlocksPerRun}). Exiting loop.`);
        break;
      }

      console.log(`=== Starting search scan for keyword: "${config.targetSearchQuery}" ===`);

      const targetUsers = await extractTargetsFromSearch(page, config.targetSearchQuery, currentUser);
      console.log(`Found ${targetUsers.length} potential targets for keyword "${config.targetSearchQuery}".`);

      let skipCount = 0;
      for (const target of targetUsers) {
        const { username, tweetText } = target;

        // すでに処理済みならスキップ
        if (history[username]) {
          skipCount++;
          continue;
        }

        if (blockCount >= config.maxBlocksPerRun) {
          break;
        }

        console.log('--------------------------------------------------');
        console.log(`Processing @${username}...`);
        console.log(`Tweet: "${tweetText.substring(0, 100).replace(/\n/g, ' ')}..."`);

        // スパム判定 (定型文マッチ)
        const isSpam = isSpamTweet(tweetText);
        if (isSpam) {
          console.log(`[SPAM DETECTED] @${username} matches spam template criteria.`);

          if (config.dryRun) {
            console.log(`[DRY RUN] Would block @${username}`);
            history[username] = {
              status: 'skipped',
              reasons: ['Tweet matches spam template'],
              timestamp: new Date().toISOString()
            };
          } else {
            const success = await blockUser(page, username);
            if (success) {
              blockCount++;
              history[username] = {
                status: 'blocked',
                reasons: ['Tweet matches spam template'],
                timestamp: new Date().toISOString()
              };
            } else {
              console.log(`Failed to block @${username}`);
            }
          }
        } else {
          console.log(`[SAFE] @${username} did not match spam template.`);
          history[username] = {
            status: 'skipped',
            timestamp: new Date().toISOString()
          };
        }

        saveHistory(history);
        await delay(config.minDelayMs, config.maxDelayMs);
      }
      
      if (skipCount > 0) {
        console.log(`Skipped ${skipCount} accounts because they were scanned previously.`);
      }

      if (iter < maxIterations && blockCount < config.maxBlocksPerRun) {
        console.log(`\nIteration ${iter} completed. Waiting 20 seconds before starting the next search iteration...`);
        await page.waitForTimeout(20000);
      }
    }

    console.log('--------------------------------------------------');
    console.log(`Scan completed. Blocked ${blockCount} accounts in this run.`);

  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    await context.close();
    console.log('Browser closed. Exit.');
  }
}

run().catch(console.error);
