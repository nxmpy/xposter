#!/usr/bin/env node
/**
 * agent.js — X/Twitter autonomous posting agent
 *
 * Runs as a background daemon. Posts tweets on schedule, replies to trending tweets.
 * Controlled via CLI (cli.js) through a Unix socket or state file.
 *
 * State is persisted in data/state.json so CLI can read it.
 * Activity log in data/activity.log.
 */

require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ── Paths ──
const DATA_DIR = path.join(__dirname, 'data');
const COOKIE_FILE = path.join(DATA_DIR, 'cookies.json');
const TAGS_FILE = path.join(DATA_DIR, 'search-tags.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ACTIVITY_LOG = path.join(DATA_DIR, 'activity.log');
const POSTS_DIR = path.join(DATA_DIR, 'posts');

// ── Config from env ──
const CONFIG = {
  username: process.env.X_USERNAME || 'unknown',
  profileUrl: process.env.X_PROFILE_URL || '',
  postIntervalMin: parseInt(process.env.POST_INTERVAL_MIN) || 55,
  postIntervalMax: parseInt(process.env.POST_INTERVAL_MAX) || 65,
  replyIntervalMin: parseInt(process.env.REPLY_INTERVAL_MIN) || 5,
  replyIntervalMax: parseInt(process.env.REPLY_INTERVAL_MAX) || 25,
  repliesEnabled: process.env.REPLIES_ENABLED !== 'false',
  communityUrl: process.env.COMMUNITY_URL || '',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  headless: process.env.HEADLESS !== 'false',
};

// ── State ──
let state = {
  running: false,
  postsPaused: false,
  repliesPaused: false,
  totalPosted: 0,
  totalReplied: 0,
  totalFailed: 0,
  lastPosted: null,
  lastReplied: null,
  lastError: null,
  nextPost: null,
  nextReply: null,
  currentFile: null,
  startedAt: null,
};

let postHandle = null;
let replyHandle = null;
let stopRequested = false;
const repliedTo = new Set();

// ── Ensure dirs ──
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomBetween(min, max) { return Math.floor(Math.random() * (max - min)) + min; }

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(ACTIVITY_LOG, line + '\n'); } catch {}
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

function getPostsFile() {
  const today = new Date().toISOString().slice(0, 10);
  const daily = path.join(POSTS_DIR, `daily-${today}.json`);
  if (fs.existsSync(daily)) return daily;
  const general = path.join(POSTS_DIR, 'posts.json');
  if (fs.existsSync(general)) return general;
  return null;
}

function loadPosts() {
  const file = getPostsFile();
  if (!file) return [];
  state.currentFile = path.basename(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function savePosts(posts) {
  const file = getPostsFile();
  if (file) fs.writeFileSync(file, JSON.stringify(posts, null, 2));
}

function loadTags() {
  if (!fs.existsSync(TAGS_FILE)) return { reply_queries: ['bitcoin', 'crypto'], reply_templates: { general: ['interesting', 'good point'] } };
  return JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8'));
}

// ── Browser ──
async function openBrowser() {
  const browser = await puppeteer.launch({
    headless: CONFIG.headless ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.setUserAgent(CONFIG.userAgent);
  await page.setViewport({ width: 1280, height: 900 });

  if (!fs.existsSync(COOKIE_FILE)) throw new Error('cookies.json not found. Run setup first.');
  const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  await page.setCookie(...raw.map(c => ({
    name: c.name || c.key, value: c.value,
    domain: c.domain || '.x.com', path: c.path || '/',
    httpOnly: Boolean(c.httpOnly), secure: Boolean(c.secure), sameSite: 'None'
  })));
  return { browser, page };
}

async function closeBrowser(b) { try { await b.close(); } catch {} }

async function dismissCookieBanner(page) {
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && /refuse|reject|decline/i.test(text)) { await btn.click(); await sleep(1500); return; }
    }
  } catch {}
}

async function findPostButton(page) {
  let btn = await page.$('[data-testid="tweetButton"]') || await page.$('[data-testid="tweetButtonInline"]') || await page.$('button[data-testid*="tweet"]');
  if (!btn) {
    const all = await page.$$('button');
    for (const b of all) { const t = await page.evaluate(el => el.textContent?.trim(), b); if (t === 'Post') { btn = b; break; } }
  }
  return btn;
}

async function typeText(page, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) { await page.keyboard.press('Enter'); await sleep(80); }
    if (lines[i].length > 0) { await page.keyboard.type(lines[i], { delay: 30 + Math.random() * 20 }); await sleep(150); }
  }
}

// ── Media upload helper ──
async function attachMedia(page, mediaPath) {
  if (!mediaPath || !fs.existsSync(mediaPath)) return false;
  try {
    const fileInput = await page.$('input[data-testid="fileInput"]');
    if (!fileInput) { log('No file input found'); return false; }
    await fileInput.uploadFile(mediaPath);
    await sleep(3000);
    try { await page.waitForSelector('[data-testid="attachments"]', { timeout: 10000 }); } catch {}
    log(`Media attached: ${path.basename(mediaPath)}`);
    return true;
  } catch (err) { log(`Media upload failed: ${err.message}`); return false; }
}

function resolveMedia(mediaFile) {
  if (!mediaFile) return null;
  // Check absolute path first
  if (path.isAbsolute(mediaFile) && fs.existsSync(mediaFile)) return mediaFile;
  // Check relative to data/media
  const inMedia = path.join(DATA_DIR, 'media', mediaFile);
  if (fs.existsSync(inMedia)) return inMedia;
  // Check relative to data/media/general
  const inGeneral = path.join(DATA_DIR, 'media', 'general', mediaFile);
  if (fs.existsSync(inGeneral)) return inGeneral;
  return null;
}

// ── Post to profile ──
async function postToProfile(text, mediaFile) {
  const { browser, page } = await openBrowser();
  try {
    await page.goto('https://x.com/compose/post', { waitUntil: 'networkidle2', timeout: 30000 });
    await dismissCookieBanner(page);
    await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 15000 });
    await sleep(1500);
    const ta = await page.$('[data-testid="tweetTextarea_0"]');
    await ta.click(); await sleep(500);
    await typeText(page, text); await sleep(1500);
    const resolved = resolveMedia(mediaFile);
    if (resolved) await attachMedia(page, resolved);
    const btn = await findPostButton(page);
    if (!btn) throw new Error('No Post button');
    await btn.click(); await sleep(5000);
    return true;
  } finally { await closeBrowser(browser); }
}

// ── Post to community ──
async function postToCommunity(text, mediaFile) {
  if (!CONFIG.communityUrl) { await postToProfile(text, mediaFile); return true; }
  const { browser, page } = await openBrowser();
  try {
    await page.goto(CONFIG.communityUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await dismissCookieBanner(page); await sleep(4000);
    let found = false;
    const existing = await page.$('[data-testid="tweetTextarea_0"]');
    if (existing) found = true;
    if (!found) { try { const p = await page.$$('[role="textbox"]'); if (p.length) { await p[0].click(); await sleep(1500); found = true; } } catch {} }
    if (!found) { try { const btns = await page.$$('button'); for (const b of btns) { const l = await page.evaluate(el => el.getAttribute('aria-label') || el.textContent?.trim(), b); if (l && /^post$|compose|what.?s happening/i.test(l)) { await b.click(); await sleep(2000); found = true; break; } } } catch {} }
    if (!found) { log('Community compose not found — fallback to profile'); await closeBrowser(browser); await postToProfile(text, mediaFile); return true; }
    await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 }); await sleep(1000);
    const ta = await page.$('[data-testid="tweetTextarea_0"]');
    await ta.click(); await sleep(500);
    await typeText(page, text); await sleep(1500);
    const resolved = resolveMedia(mediaFile);
    if (resolved) await attachMedia(page, resolved);
    const btn = await findPostButton(page);
    if (!btn) throw new Error('No Post button in community');
    await btn.click(); await sleep(5000);
    return true;
  } finally { await closeBrowser(browser); }
}

// ── Reply to one tweet ──
async function replyToOneTweet() {
  const tags = loadTags();
  const queries = tags.reply_queries || ['bitcoin'];
  const templates = tags.reply_templates || { general: ['interesting'] };

  const { browser, page } = await openBrowser();
  try {
    const query = queries[Math.floor(Math.random() * queries.length)];
    log(`[reply] Searching: "${query}"`);
    await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await dismissCookieBanner(page); await sleep(4000);
    await page.evaluate(() => window.scrollBy(0, 400)); await sleep(2000);

    const tweets = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, 15).map(a => {
        const t = a.querySelector('[data-testid="tweetText"]');
        const l = a.querySelector('a[href*="/status/"]');
        return { text: t ? t.textContent.slice(0, 200) : '', url: l ? l.href : '' };
      });
    });

    const candidates = tweets.filter(t => t.text.length > 20 && t.url && !repliedTo.has(t.url) && !/^RT @/.test(t.text));
    if (!candidates.length) { log('[reply] No candidates'); return false; }

    const target = candidates[Math.floor(Math.random() * candidates.length)];

    // Pick reply based on sentiment rules from tags file
    const lower = target.text.toLowerCase();
    const rules = tags.sentiment_rules || {};
    let matchedCategory = 'general';
    for (const [category, keywords] of Object.entries(rules)) {
      if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
        matchedCategory = category;
        break;
      }
    }
    const pool = templates[matchedCategory] || templates.general || ['interesting take'];
    const reply = pool[Math.floor(Math.random() * pool.length)];

    log(`[reply] → "${target.text.slice(0, 50)}..." → "${reply}"`);

    const articles = await page.$$('article[data-testid="tweet"]');
    let targetArticle = null;
    for (const a of articles) {
      const txt = await page.evaluate(el => { const t = el.querySelector('[data-testid="tweetText"]'); return t ? t.textContent.slice(0, 60) : ''; }, a);
      if (txt && target.text.startsWith(txt.slice(0, 30))) { targetArticle = a; break; }
    }
    if (!targetArticle) { log('[reply] Article not found'); return false; }

    const replyBtn = await targetArticle.$('[data-testid="reply"]');
    if (!replyBtn) { log('[reply] No reply button'); return false; }
    await replyBtn.click(); await sleep(2500);

    let ta = null;
    try { await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 5000 }); ta = await page.$('[data-testid="tweetTextarea_0"]'); } catch {}
    if (!ta) { log('[reply] No textarea'); try { await page.keyboard.press('Escape'); } catch {} return false; }

    await ta.click(); await sleep(500);
    await page.keyboard.type(reply, { delay: 35 + Math.random() * 25 }); await sleep(1500);
    const btn = await findPostButton(page);
    if (!btn) { log('[reply] No post button'); try { await page.keyboard.press('Escape'); } catch {} return false; }
    await btn.click(); await sleep(4000);

    repliedTo.add(target.url);
    log('[reply] Sent');
    return true;
  } catch (err) {
    log(`[reply] Error: ${err.message}`);
    return false;
  } finally { await closeBrowser(browser); }
}

// ── Post cycle ──
async function postCycle() {
  if (stopRequested || state.postsPaused) {
    if (!stopRequested && state.postsPaused) {
      postHandle = setTimeout(() => postCycle(), 60000);
    }
    return;
  }

  const posts = loadPosts();
  const next = posts.find(p => !p.posted);
  if (!next) { log('All posts sent.'); state.nextPost = null; saveState(); return; }

  const target = next.target || 'profile';
  try {
    log(`POST ${target.toUpperCase()} #${next.id}: ${next.text.slice(0, 70)}...`);
    if (target === 'community') await postToCommunity(next.text, next.media);
    else await postToProfile(next.text, next.media);

    next.posted = true;
    next.postedAt = new Date().toISOString();
    savePosts(posts);
    state.totalPosted++;
    state.lastPosted = next.postedAt;
    log(`#${next.id} done (${target})`);
  } catch (err) {
    log(`ERROR posting #${next.id}: ${err.message}`);
    next.posted = true; next.postedAt = new Date().toISOString(); next.error = err.message;
    savePosts(posts);
    state.totalFailed++;
    state.lastError = err.message;
  }

  if (!stopRequested) {
    const delay = randomBetween(CONFIG.postIntervalMin * 60000, CONFIG.postIntervalMax * 60000);
    state.nextPost = new Date(Date.now() + delay).toISOString();
    log(`Next post in ${Math.round(delay / 60000)}min`);
    saveState();
    postHandle = setTimeout(() => postCycle(), delay);
  }
}

// ── Reply cycle ──
async function replyCycle() {
  if (stopRequested || state.repliesPaused) {
    if (!stopRequested && state.repliesPaused) {
      replyHandle = setTimeout(() => replyCycle(), 60000);
    }
    return;
  }

  try {
    const ok = await replyToOneTweet();
    if (ok) { state.totalReplied++; state.lastReplied = new Date().toISOString(); }
  } catch (err) { log(`Reply error: ${err.message}`); }

  if (!stopRequested) {
    const delay = randomBetween(CONFIG.replyIntervalMin * 60000, CONFIG.replyIntervalMax * 60000);
    state.nextReply = new Date(Date.now() + delay).toISOString();
    log(`[reply] Next in ${Math.round(delay / 60000)}min`);
    saveState();
    replyHandle = setTimeout(() => replyCycle(), delay);
  }
}

// ── Start / Stop ──
function start() {
  if (state.running) { log('Already running'); return; }
  stopRequested = false;
  state.running = true;
  state.startedAt = new Date().toISOString();
  log(`Agent started for @${CONFIG.username}`);

  // Check prerequisites
  if (!fs.existsSync(COOKIE_FILE)) { log('ERROR: cookies.json not found. Run: node setup.js'); process.exit(1); }

  // Post cycle starts in 5s
  postHandle = setTimeout(() => postCycle(), 5000);

  // Reply cycle starts offset 10-20 min (if enabled)
  if (CONFIG.repliesEnabled) {
    const replyDelay = randomBetween(CONFIG.replyIntervalMin * 60000, CONFIG.replyIntervalMax * 60000);
    log(`Reply loop starts in ${Math.round(replyDelay / 60000)}min`);
    replyHandle = setTimeout(() => replyCycle(), replyDelay);
  } else {
    log('Replies disabled (REPLIES_ENABLED=false)');
  }

  saveState();
}

function stop() {
  stopRequested = true;
  if (postHandle) { clearTimeout(postHandle); postHandle = null; }
  if (replyHandle) { clearTimeout(replyHandle); replyHandle = null; }
  state.running = false;
  state.nextPost = null;
  state.nextReply = null;
  log('Agent stopped');
  saveState();
}

// ── Main ──
start();
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });

// Watch for control commands via state file
setInterval(() => {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const disk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (disk._cmd === 'stop') { stop(); delete disk._cmd; fs.writeFileSync(STATE_FILE, JSON.stringify(disk, null, 2)); }
      if (disk._cmd === 'start') { start(); delete disk._cmd; fs.writeFileSync(STATE_FILE, JSON.stringify(disk, null, 2)); }
      if (disk._cmd === 'pause_posts') { state.postsPaused = true; delete disk._cmd; saveState(); log('Posts paused'); }
      if (disk._cmd === 'resume_posts') { state.postsPaused = false; delete disk._cmd; saveState(); log('Posts resumed'); }
      if (disk._cmd === 'pause_replies') { state.repliesPaused = true; delete disk._cmd; saveState(); log('Replies paused'); }
      if (disk._cmd === 'resume_replies') { state.repliesPaused = false; delete disk._cmd; saveState(); log('Replies resumed'); }
    }
  } catch {}
}, 3000);
