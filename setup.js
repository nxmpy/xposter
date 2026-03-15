#!/usr/bin/env node
/**
 * setup.js — Interactive setup wizard for X Poster agent
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, 'data');
const POSTS_DIR = path.join(DATA_DIR, 'posts');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

function header(text) {
  console.log('\n\x1b[36m' + '═'.repeat(50));
  console.log('  ' + text);
  console.log('═'.repeat(50) + '\x1b[0m\n');
}

async function main() {
  header('X POSTER AGENT — SETUP WIZARD');

  // 1. Username
  const username = await ask('\x1b[33m  X/Twitter username (without @): \x1b[0m');

  // 2. Cookies
  header('COOKIE SETUP');
  console.log('  To authenticate, paste your X/Twitter cookies.');
  console.log('  You need at minimum: auth_token, ct0, twid');
  console.log('  Paste the full JSON array (from browser dev tools),');
  console.log('  or press Enter to skip if you already have data/cookies.json\n');

  const cookieInput = await ask('  Paste cookies JSON (or Enter to skip): ');
  if (cookieInput.trim()) {
    try {
      const parsed = JSON.parse(cookieInput.trim());
      fs.writeFileSync(path.join(DATA_DIR, 'cookies.json'), JSON.stringify(parsed, null, 2));
      console.log('  \x1b[32m✓ Cookies saved to data/cookies.json\x1b[0m');
    } catch (e) {
      console.log('  \x1b[31m✗ Invalid JSON. Save manually to data/cookies.json\x1b[0m');
    }
  } else if (fs.existsSync(path.join(DATA_DIR, 'cookies.json'))) {
    console.log('  \x1b[32m✓ Existing cookies.json found\x1b[0m');
  } else {
    console.log('  \x1b[33m⚠ No cookies. Copy data/cookies.sample.json → data/cookies.json and fill in values\x1b[0m');
  }

  // 3. Community URL
  header('COMMUNITY');
  const community = await ask('  Community URL (or Enter to skip): ');

  // 4. Posting intervals
  header('POSTING SCHEDULE');
  const postMin = await ask('  Post interval min (minutes, default 55): ') || '55';
  const postMax = await ask('  Post interval max (minutes, default 65): ') || '65';

  // 5. Reply intervals
  header('REPLY SCHEDULE');
  const replyMin = await ask('  Reply interval min (minutes, default 5): ') || '5';
  const replyMax = await ask('  Reply interval max (minutes, default 25): ') || '25';

  // 6. Search tags for replies
  header('REPLY SEARCH TAGS');
  console.log('  Enter comma-separated search queries for finding tweets to reply to.');
  console.log('  Example: bitcoin, crypto, solana, HODL, diamond hands\n');
  const tagsInput = await ask('  Search tags (or Enter for defaults): ');

  if (tagsInput.trim()) {
    const queries = tagsInput.split(',').map(s => s.trim()).filter(Boolean);
    const tagsFile = path.join(DATA_DIR, 'search-tags.json');
    let existing = { reply_queries: [], reply_templates: { bullish: ['LFG', 'this is the way'], bearish: ['zoom out', 'buying opportunity'], general: ['interesting', 'good point', 'facts'] } };
    if (fs.existsSync(tagsFile)) existing = JSON.parse(fs.readFileSync(tagsFile, 'utf8'));
    existing.reply_queries = queries;
    fs.writeFileSync(tagsFile, JSON.stringify(existing, null, 2));
    console.log(`  \x1b[32m✓ Saved ${queries.length} search tags\x1b[0m`);
  } else if (!fs.existsSync(path.join(DATA_DIR, 'search-tags.json'))) {
    fs.copyFileSync(path.join(DATA_DIR, 'search-tags.sample.json'), path.join(DATA_DIR, 'search-tags.json'));
    console.log('  \x1b[32m✓ Copied defaults from sample\x1b[0m');
  }

  // 7. Write .env
  const envContent = `# X/Twitter Account
X_USERNAME=${username}

# Posting schedule (minutes)
POST_INTERVAL_MIN=${postMin}
POST_INTERVAL_MAX=${postMax}

# Reply schedule (minutes)
REPLY_INTERVAL_MIN=${replyMin}
REPLY_INTERVAL_MAX=${replyMax}

# Community URL
COMMUNITY_URL=${community}

# User agent
USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36
`;
  fs.writeFileSync(path.join(__dirname, '.env'), envContent);
  console.log('\n  \x1b[32m✓ .env saved\x1b[0m');

  header('SETUP COMPLETE');
  console.log('  Files created:');
  console.log('    .env                    — configuration');
  console.log('    data/cookies.json       — X authentication');
  console.log('    data/search-tags.json   — reply search queries & templates');
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Add posts:  Place daily-YYYY-MM-DD.json or posts.json in data/posts/');
  console.log('    2. Launch:     ./x-poster.sh start');
  console.log('    3. Monitor:    ./x-poster.sh');
  console.log('');

  rl.close();
}

main().catch(e => { console.error(e); rl.close(); });
