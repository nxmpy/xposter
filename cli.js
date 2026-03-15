#!/usr/bin/env node
/**
 * cli.js — Interactive terminal for X Poster agent
 *
 * Shows status, activity, controls, and config management.
 * Doesn't stop the agent when closed.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ACTIVITY_LOG = path.join(DATA_DIR, 'activity.log');
const POSTS_DIR = path.join(DATA_DIR, 'posts');
const TAGS_FILE = path.join(DATA_DIR, 'search-tags.json');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};

// ── Data helpers ──

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { running: false }; }
}

function sendCmd(cmd) {
  try {
    const s = readState();
    s._cmd = cmd;
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
    return true;
  } catch { return false; }
}

function loadTags() {
  try { return JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8')); }
  catch { return { reply_queries: [], community_targets: [], reply_templates: {}, sentiment_rules: {} }; }
}

function saveTags(tags) {
  fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2));
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return Math.round(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm ago';
  return Math.round(ms / 3600000) + 'h ago';
}

function timeUntil(iso) {
  if (!iso) return '-';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  return Math.round(ms / 60000) + 'min';
}

function clearScreen() { process.stdout.write('\x1b[2J\x1b[H'); }

// ── Display functions ──

function banner() {
  console.log(C.cyan + C.bold);
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║         X POSTER AGENT — CONTROL         ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(C.reset);
}

function showStatus() {
  const s = readState();
  const status = s.running ? C.green + 'RUNNING' + C.reset : C.red + 'STOPPED' + C.reset;
  const postStatus = s.postsPaused ? C.yellow + 'PAUSED' + C.reset : C.green + 'ACTIVE' + C.reset;
  const replyStatus = s.repliesPaused ? C.yellow + 'PAUSED' + C.reset : C.green + 'ACTIVE' + C.reset;

  console.log(`  ${C.bold}Agent:${C.reset}    ${status}`);
  if (s.startedAt) console.log(`  ${C.bold}Uptime:${C.reset}   Started ${timeAgo(s.startedAt)}`);
  console.log('');
  console.log(`  ${C.bold}Posts:${C.reset}     ${postStatus}  |  Sent: ${C.bold}${s.totalPosted || 0}${C.reset}  |  Failed: ${s.totalFailed || 0}`);
  console.log(`  ${C.bold}Replies:${C.reset}   ${replyStatus}  |  Sent: ${C.bold}${s.totalReplied || 0}${C.reset}`);
  console.log('');
  console.log(`  ${C.dim}Last post:${C.reset}    ${s.lastPosted ? timeAgo(s.lastPosted) : '-'}`);
  console.log(`  ${C.dim}Last reply:${C.reset}   ${s.lastReplied ? timeAgo(s.lastReplied) : '-'}`);
  console.log(`  ${C.dim}Next post:${C.reset}    ${timeUntil(s.nextPost)}`);
  console.log(`  ${C.dim}Next reply:${C.reset}   ${timeUntil(s.nextReply)}`);
  if (s.currentFile) console.log(`  ${C.dim}Posts file:${C.reset}   ${s.currentFile}`);
  if (s.lastError) console.log(`  ${C.red}Last error:${C.reset}  ${s.lastError}`);
  console.log('');
}

function showQueue() {
  const file = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const daily = path.join(POSTS_DIR, `daily-${today}.json`);
    if (fs.existsSync(daily)) return daily;
    const general = path.join(POSTS_DIR, 'posts.json');
    if (fs.existsSync(general)) return general;
    return null;
  })();

  if (!file) { console.log(`  ${C.yellow}No posts file found.${C.reset}\n`); return; }

  const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
  const posted = posts.filter(p => p.posted);
  const pending = posts.filter(p => !p.posted);

  console.log(`  ${C.bold}Posts file:${C.reset} ${path.basename(file)}`);
  console.log(`  ${C.bold}Progress:${C.reset}  ${posted.length}/${posts.length} posted\n`);

  console.log(`  ${C.bold}Next up:${C.reset}`);
  pending.slice(0, 5).forEach((p, i) => {
    const tag = p.target === 'community' ? C.blue + '[COM]' + C.reset : C.cyan + '[PRO]' + C.reset;
    const media = p.media ? C.magenta + ' [IMG]' + C.reset : '';
    console.log(`  ${C.dim}${i + 1}.${C.reset} ${tag}${media} ${p.text.slice(0, 70)}...`);
  });
  if (pending.length > 5) console.log(`  ${C.dim}  ... and ${pending.length - 5} more${C.reset}`);
  console.log('');
}

function showActivity(lines) {
  if (!fs.existsSync(ACTIVITY_LOG)) { console.log(`  ${C.yellow}No activity yet.${C.reset}\n`); return; }
  const content = fs.readFileSync(ACTIVITY_LOG, 'utf8').trim().split('\n');
  const show = content.slice(-lines);
  console.log(`  ${C.bold}Recent activity (last ${show.length} entries):${C.reset}\n`);
  show.forEach(line => {
    let colored = line;
    if (line.includes('ERROR')) colored = C.red + line + C.reset;
    else if (line.includes('[reply]')) colored = C.blue + line + C.reset;
    else if (line.includes('done')) colored = C.green + line + C.reset;
    else colored = C.dim + line + C.reset;
    console.log('  ' + colored);
  });
  console.log('');
}

// ── Config: Search Tags ──

function showTags() {
  const tags = loadTags();
  console.log(`  ${C.bold}Search queries${C.reset} (${tags.reply_queries?.length || 0}):\n`);
  (tags.reply_queries || []).forEach((q, i) => {
    console.log(`    ${C.dim}${i + 1}.${C.reset} ${q}`);
  });
  console.log('');
}

function addTag(tag) {
  const tags = loadTags();
  if (!tags.reply_queries) tags.reply_queries = [];
  if (tags.reply_queries.includes(tag)) {
    console.log(`\n  ${C.yellow}Already exists: ${tag}${C.reset}\n`);
    return;
  }
  tags.reply_queries.push(tag);
  saveTags(tags);
  console.log(`\n  ${C.green}+ Added search tag: ${tag}${C.reset}\n`);
}

function removeTag(tag) {
  const tags = loadTags();
  const idx = (tags.reply_queries || []).findIndex(q => q.toLowerCase() === tag.toLowerCase());
  if (idx === -1) {
    console.log(`\n  ${C.red}Not found: ${tag}${C.reset}\n`);
    return;
  }
  tags.reply_queries.splice(idx, 1);
  saveTags(tags);
  console.log(`\n  ${C.red}- Removed search tag: ${tag}${C.reset}\n`);
}

// ── Config: Community Targets ──

function showCommunities() {
  const tags = loadTags();
  const communities = tags.community_targets || [];
  console.log(`  ${C.bold}Community targets${C.reset} (${communities.length}):\n`);
  if (communities.length === 0) {
    console.log(`    ${C.dim}(none)${C.reset}`);
  } else {
    communities.forEach((url, i) => {
      console.log(`    ${C.dim}${i + 1}.${C.reset} ${C.blue}${url}${C.reset}`);
    });
  }
  console.log('');
}

function addCommunity(url) {
  const tags = loadTags();
  if (!tags.community_targets) tags.community_targets = [];
  if (tags.community_targets.includes(url)) {
    console.log(`\n  ${C.yellow}Already exists${C.reset}\n`);
    return;
  }
  tags.community_targets.push(url);
  saveTags(tags);
  console.log(`\n  ${C.green}+ Added community: ${url}${C.reset}\n`);
}

function removeCommunity(indexOrUrl) {
  const tags = loadTags();
  if (!tags.community_targets) { console.log(`\n  ${C.red}No communities${C.reset}\n`); return; }
  const idx = parseInt(indexOrUrl);
  if (!isNaN(idx) && idx >= 1 && idx <= tags.community_targets.length) {
    const removed = tags.community_targets.splice(idx - 1, 1)[0];
    saveTags(tags);
    console.log(`\n  ${C.red}- Removed: ${removed}${C.reset}\n`);
  } else {
    const i = tags.community_targets.indexOf(indexOrUrl);
    if (i !== -1) {
      tags.community_targets.splice(i, 1);
      saveTags(tags);
      console.log(`\n  ${C.red}- Removed: ${indexOrUrl}${C.reset}\n`);
    } else {
      console.log(`\n  ${C.red}Not found: ${indexOrUrl}${C.reset}\n`);
    }
  }
}

// ── Config: Reply Categories ──

function showReplies(category) {
  const tags = loadTags();
  const templates = tags.reply_templates || {};

  if (category) {
    const pool = templates[category];
    if (!pool) {
      console.log(`\n  ${C.red}Category not found: ${category}${C.reset}`);
      console.log(`  ${C.dim}Available: ${Object.keys(templates).join(', ')}${C.reset}\n`);
      return;
    }
    console.log(`\n  ${C.bold}Replies — ${C.cyan}${category}${C.reset} ${C.bold}(${pool.length}):${C.reset}\n`);
    pool.forEach((r, i) => {
      console.log(`    ${C.dim}${i + 1}.${C.reset} ${r}`);
    });
  } else {
    console.log(`\n  ${C.bold}Reply categories:${C.reset}\n`);
    for (const [cat, pool] of Object.entries(templates)) {
      console.log(`    ${C.cyan}${cat}${C.reset} ${C.dim}(${pool.length} replies)${C.reset}`);
    }
    const rules = tags.sentiment_rules || {};
    if (Object.keys(rules).length) {
      console.log(`\n  ${C.bold}Sentiment rules:${C.reset}\n`);
      for (const [cat, keywords] of Object.entries(rules)) {
        console.log(`    ${C.cyan}${cat}${C.reset}: ${C.dim}${keywords.slice(0, 5).join(', ')}${keywords.length > 5 ? ', ...' : ''}${C.reset}`);
      }
    }
  }
  console.log('');
}

function addReply(category, text) {
  const tags = loadTags();
  if (!tags.reply_templates) tags.reply_templates = {};
  if (!tags.reply_templates[category]) tags.reply_templates[category] = [];
  tags.reply_templates[category].push(text);
  saveTags(tags);
  console.log(`\n  ${C.green}+ Added to ${category}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"${C.reset}\n`);
}

function removeReply(category, index) {
  const tags = loadTags();
  const pool = tags.reply_templates?.[category];
  if (!pool) { console.log(`\n  ${C.red}Category not found: ${category}${C.reset}\n`); return; }
  const i = parseInt(index) - 1;
  if (isNaN(i) || i < 0 || i >= pool.length) {
    console.log(`\n  ${C.red}Invalid index. Range: 1-${pool.length}${C.reset}\n`);
    return;
  }
  const removed = pool.splice(i, 1)[0];
  saveTags(tags);
  console.log(`\n  ${C.red}- Removed from ${category}: "${removed.slice(0, 60)}"${C.reset}\n`);
}

function addCategory(name) {
  const tags = loadTags();
  if (!tags.reply_templates) tags.reply_templates = {};
  if (tags.reply_templates[name]) {
    console.log(`\n  ${C.yellow}Category already exists: ${name} (${tags.reply_templates[name].length} replies)${C.reset}\n`);
    return;
  }
  tags.reply_templates[name] = [];
  if (!tags.sentiment_rules) tags.sentiment_rules = {};
  tags.sentiment_rules[name] = [];
  saveTags(tags);
  console.log(`\n  ${C.green}+ Created category: ${name}${C.reset}`);
  console.log(`  ${C.dim}Add replies: reply add ${name} <text>${C.reset}`);
  console.log(`  ${C.dim}Add keywords: rule add ${name} <keyword>${C.reset}\n`);
}

function removeCategory(name) {
  const tags = loadTags();
  if (!tags.reply_templates?.[name]) {
    console.log(`\n  ${C.red}Category not found: ${name}${C.reset}\n`);
    return;
  }
  if (name === 'general') {
    console.log(`\n  ${C.red}Cannot delete 'general' — it's the fallback category${C.reset}\n`);
    return;
  }
  delete tags.reply_templates[name];
  if (tags.sentiment_rules?.[name]) delete tags.sentiment_rules[name];
  saveTags(tags);
  console.log(`\n  ${C.red}- Deleted category: ${name}${C.reset}\n`);
}

// ── Config: Sentiment Rules ──

function addRule(category, keyword) {
  const tags = loadTags();
  if (!tags.sentiment_rules) tags.sentiment_rules = {};
  if (!tags.sentiment_rules[category]) tags.sentiment_rules[category] = [];
  if (tags.sentiment_rules[category].includes(keyword)) {
    console.log(`\n  ${C.yellow}Already exists in ${category}: ${keyword}${C.reset}\n`);
    return;
  }
  tags.sentiment_rules[category].push(keyword);
  saveTags(tags);
  console.log(`\n  ${C.green}+ Added rule: ${category} ← "${keyword}"${C.reset}\n`);
}

function removeRule(category, keyword) {
  const tags = loadTags();
  const rules = tags.sentiment_rules?.[category];
  if (!rules) { console.log(`\n  ${C.red}No rules for: ${category}${C.reset}\n`); return; }
  const idx = rules.indexOf(keyword);
  if (idx === -1) { console.log(`\n  ${C.red}Keyword not found in ${category}: ${keyword}${C.reset}\n`); return; }
  rules.splice(idx, 1);
  saveTags(tags);
  console.log(`\n  ${C.red}- Removed rule: ${category} ← "${keyword}"${C.reset}\n`);
}

// ── Help ──

function showHelp() {
  console.log(`  ${C.bold}Agent Controls:${C.reset}`);
  console.log(`    ${C.cyan}status${C.reset}                       Agent status & stats`);
  console.log(`    ${C.cyan}start${C.reset} / ${C.cyan}stop${C.reset}                  Start/stop agent`);
  console.log(`    ${C.cyan}pause posts${C.reset} / ${C.cyan}resume posts${C.reset}    Toggle posting`);
  console.log(`    ${C.cyan}pause replies${C.reset} / ${C.cyan}resume replies${C.reset}  Toggle replies`);
  console.log('');
  console.log(`  ${C.bold}Content:${C.reset}`);
  console.log(`    ${C.cyan}queue${C.reset}                        Show upcoming posts`);
  console.log(`    ${C.cyan}activity [n]${C.reset}                 Last n activity lines (default 20)`);
  console.log('');
  console.log(`  ${C.bold}Search Tags:${C.reset}`);
  console.log(`    ${C.cyan}tags${C.reset}                         List all search tags`);
  console.log(`    ${C.cyan}tag add <query>${C.reset}              Add search tag`);
  console.log(`    ${C.cyan}tag rm <query>${C.reset}               Remove search tag`);
  console.log('');
  console.log(`  ${C.bold}Communities:${C.reset}`);
  console.log(`    ${C.cyan}communities${C.reset}                  List community targets`);
  console.log(`    ${C.cyan}community add <url>${C.reset}          Add community URL`);
  console.log(`    ${C.cyan}community rm <#|url>${C.reset}         Remove by index or URL`);
  console.log('');
  console.log(`  ${C.bold}Reply Templates:${C.reset}`);
  console.log(`    ${C.cyan}replies${C.reset}                      List all categories & counts`);
  console.log(`    ${C.cyan}replies <category>${C.reset}           List replies in category`);
  console.log(`    ${C.cyan}reply add <cat> <text>${C.reset}       Add reply to category`);
  console.log(`    ${C.cyan}reply rm <cat> <#>${C.reset}           Remove reply by index`);
  console.log(`    ${C.cyan}category add <name>${C.reset}          Create new category`);
  console.log(`    ${C.cyan}category rm <name>${C.reset}           Delete category`);
  console.log('');
  console.log(`  ${C.bold}Sentiment Rules:${C.reset}`);
  console.log(`    ${C.cyan}rules${C.reset}                        Show all rules (via replies cmd)`);
  console.log(`    ${C.cyan}rule add <cat> <keyword>${C.reset}     Add keyword trigger for category`);
  console.log(`    ${C.cyan}rule rm <cat> <keyword>${C.reset}      Remove keyword trigger`);
  console.log('');
  console.log(`  ${C.bold}Other:${C.reset}`);
  console.log(`    ${C.cyan}clear${C.reset}                        Clear screen`);
  console.log(`    ${C.cyan}help${C.reset}                         This help`);
  console.log(`    ${C.cyan}exit${C.reset}                         Exit CLI (agent keeps running)`);
  console.log('');
}

// ── Command parser ──

function handleCommand(raw, rl) {
  const input = raw.trim();
  if (!input) return;

  // Preserve original case for values, lowercase for command matching
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const cmd2 = parts.length > 1 ? parts[1].toLowerCase() : '';

  // ── Agent controls ──
  if (input.toLowerCase() === 'status') { console.log(''); showStatus(); }
  else if (input.toLowerCase() === 'start') { sendCmd('start'); console.log(`\n  ${C.green}+ Start command sent${C.reset}\n`); }
  else if (input.toLowerCase() === 'stop') { sendCmd('stop'); console.log(`\n  ${C.red}- Stop command sent${C.reset}\n`); }
  else if (input.toLowerCase() === 'pause posts') { sendCmd('pause_posts'); console.log(`\n  ${C.yellow}Posts paused${C.reset}\n`); }
  else if (input.toLowerCase() === 'resume posts') { sendCmd('resume_posts'); console.log(`\n  ${C.green}Posts resumed${C.reset}\n`); }
  else if (input.toLowerCase() === 'pause replies') { sendCmd('pause_replies'); console.log(`\n  ${C.yellow}Replies paused${C.reset}\n`); }
  else if (input.toLowerCase() === 'resume replies') { sendCmd('resume_replies'); console.log(`\n  ${C.green}Replies resumed${C.reset}\n`); }

  // ── Content ──
  else if (cmd === 'queue' || cmd === 'q') { console.log(''); showQueue(); }
  else if (cmd === 'activity' || cmd === 'log' || cmd === 'a') {
    const n = parseInt(parts[1]) || 20;
    console.log('');
    showActivity(n);
  }

  // ── Search tags ──
  else if (cmd === 'tags') { console.log(''); showTags(); }
  else if (cmd === 'tag' && cmd2 === 'add' && parts.length > 2) {
    addTag(parts.slice(2).join(' '));
  }
  else if (cmd === 'tag' && (cmd2 === 'rm' || cmd2 === 'remove' || cmd2 === 'del') && parts.length > 2) {
    removeTag(parts.slice(2).join(' '));
  }

  // ── Communities ──
  else if (cmd === 'communities' || cmd === 'community' && parts.length === 1) { console.log(''); showCommunities(); }
  else if (cmd === 'community' && cmd2 === 'add' && parts.length > 2) {
    addCommunity(parts.slice(2).join(' '));
  }
  else if (cmd === 'community' && (cmd2 === 'rm' || cmd2 === 'remove' || cmd2 === 'del') && parts.length > 2) {
    removeCommunity(parts.slice(2).join(' '));
  }

  // ── Reply templates ──
  else if (cmd === 'replies' && parts.length === 1) { showReplies(); }
  else if (cmd === 'replies' && parts.length > 1) { showReplies(parts[1]); }
  else if (cmd === 'reply' && cmd2 === 'add' && parts.length > 3) {
    const cat = parts[2];
    const text = input.slice(input.indexOf(parts[2]) + parts[2].length).trim();
    if (text) addReply(cat, text);
    else console.log(`\n  ${C.red}Usage: reply add <category> <text>${C.reset}\n`);
  }
  else if (cmd === 'reply' && (cmd2 === 'rm' || cmd2 === 'remove' || cmd2 === 'del') && parts.length > 3) {
    removeReply(parts[2], parts[3]);
  }

  // ── Categories ──
  else if (cmd === 'category' && cmd2 === 'add' && parts.length > 2) {
    addCategory(parts[2].toLowerCase());
  }
  else if (cmd === 'category' && (cmd2 === 'rm' || cmd2 === 'remove' || cmd2 === 'del') && parts.length > 2) {
    removeCategory(parts[2].toLowerCase());
  }

  // ── Sentiment rules ──
  else if (cmd === 'rules') { showReplies(); }
  else if (cmd === 'rule' && cmd2 === 'add' && parts.length > 3) {
    const cat = parts[2];
    const keyword = input.slice(input.indexOf(parts[3])).trim();
    addRule(cat, keyword);
  }
  else if (cmd === 'rule' && (cmd2 === 'rm' || cmd2 === 'remove' || cmd2 === 'del') && parts.length > 3) {
    const cat = parts[2];
    const keyword = input.slice(input.indexOf(parts[3])).trim();
    removeRule(cat, keyword);
  }

  // ── Other ──
  else if (cmd === 'clear' || cmd === 'cls') { clearScreen(); banner(); showStatus(); }
  else if (cmd === 'help' || cmd === 'h' || cmd === '?') { console.log(''); showHelp(); }
  else if (cmd === 'exit' || cmd === 'quit') {
    console.log(`\n  ${C.dim}Agent keeps running in the background.${C.reset}\n`);
    rl.close();
    process.exit(0);
  }
  else {
    console.log(`\n  ${C.red}Unknown command: ${input}${C.reset}`);
    console.log(`  ${C.dim}Type 'help' for commands${C.reset}\n`);
  }
}

// ── Main ──

async function main() {
  clearScreen();
  banner();
  showStatus();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: C.yellow + '  x-poster> ' + C.reset,
  });

  rl.prompt();

  rl.on('line', (input) => {
    handleCommand(input, rl);
    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
}

main();
