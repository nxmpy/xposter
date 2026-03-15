#!/bin/bash
#
# x-poster.sh — X/Twitter Posting Agent Launcher
#
# Usage:
#   ./x-poster.sh              Open interactive CLI terminal
#   ./x-poster.sh start        Start agent in background (screen session)
#   ./x-poster.sh stop         Stop agent
#   ./x-poster.sh status       Quick status check
#   ./x-poster.sh setup        Run interactive setup wizard
#   ./x-poster.sh logs [n]     Show last n lines of activity log
#   ./x-poster.sh help         Show this help
#
# Files:
#   .env                       Configuration (intervals, username, community URL)
#   data/cookies.json          X/Twitter authentication cookies (SENSITIVE)
#   data/search-tags.json      Reply search queries and response templates
#   data/posts/posts.json      General posts queue
#   data/posts/daily-YYYY-MM-DD.json   Daily scheduled posts (takes priority)
#   data/state.json            Agent runtime state (auto-managed)
#   data/activity.log          Activity log
#
# Samples (safe to commit):
#   .env.sample                Sample configuration
#   data/cookies.sample.json   Sample cookie format
#   data/search-tags.sample.json  Sample search tags
#   data/posts.sample.json     Sample posts format
#

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

SESSION_NAME="x-poster-agent"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

show_help() {
    echo ""
    echo -e "${CYAN}${BOLD}  X POSTER AGENT${NC}"
    echo -e "${CYAN}  ═══════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}Usage:${NC}"
    echo -e "    ${GREEN}./x-poster.sh${NC}              Open interactive CLI"
    echo -e "    ${GREEN}./x-poster.sh start${NC}        Start agent in background"
    echo -e "    ${GREEN}./x-poster.sh stop${NC}         Stop agent"
    echo -e "    ${GREEN}./x-poster.sh restart${NC}      Restart agent"
    echo -e "    ${GREEN}./x-poster.sh status${NC}       Quick status check"
    echo -e "    ${GREEN}./x-poster.sh setup${NC}        Run setup wizard"
    echo -e "    ${GREEN}./x-poster.sh logs [n]${NC}     Show last n activity lines"
    echo -e "    ${GREEN}./x-poster.sh help${NC}         Show this help"
    echo ""
    echo -e "  ${BOLD}Config files:${NC}"
    echo -e "    ${YELLOW}.env${NC}                       Username, intervals, community URL"
    echo -e "    ${YELLOW}data/cookies.json${NC}          Auth cookies (from browser dev tools)"
    echo -e "    ${YELLOW}data/search-tags.json${NC}      Search queries + reply templates"
    echo -e "    ${YELLOW}data/posts/posts.json${NC}      Posts queue"
    echo -e "    ${YELLOW}data/posts/daily-*.json${NC}    Daily scheduled posts"
    echo ""
    echo -e "  ${BOLD}Sample files${NC} (copy and fill in):"
    echo -e "    .env.sample → .env"
    echo -e "    data/cookies.sample.json → data/cookies.json"
    echo -e "    data/search-tags.sample.json → data/search-tags.json"
    echo -e "    data/posts.sample.json → data/posts/posts.json"
    echo ""
}

is_running() {
    screen -ls 2>/dev/null | grep -q "$SESSION_NAME"
}

case "${1:-cli}" in
    start)
        if is_running; then
            echo -e "  ${YELLOW}Agent is already running.${NC}"
            echo -e "  Use ${GREEN}./x-poster.sh${NC} to open the CLI."
        else
            if [ ! -f ".env" ]; then
                echo -e "  ${RED}No .env file found. Run: ./x-poster.sh setup${NC}"
                exit 1
            fi
            if [ ! -f "data/cookies.json" ]; then
                echo -e "  ${RED}No cookies.json found. Run: ./x-poster.sh setup${NC}"
                exit 1
            fi
            screen -dmS "$SESSION_NAME" node agent.js
            sleep 1
            if is_running; then
                echo -e "  ${GREEN}✓ Agent started in background session '${SESSION_NAME}'${NC}"
                echo -e "  Use ${CYAN}./x-poster.sh${NC} to open the CLI."
                echo -e "  Use ${CYAN}screen -r ${SESSION_NAME}${NC} to see raw output."
            else
                echo -e "  ${RED}✗ Agent failed to start. Check logs: cat data/activity.log${NC}"
            fi
        fi
        ;;
    stop)
        if is_running; then
            # Send stop command via state file
            if [ -f "data/state.json" ]; then
                node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('data/state.json','utf8'));s._cmd='stop';fs.writeFileSync('data/state.json',JSON.stringify(s,null,2));"
                sleep 2
            fi
            screen -S "$SESSION_NAME" -X quit 2>/dev/null
            echo -e "  ${GREEN}✓ Agent stopped${NC}"
        else
            echo -e "  ${YELLOW}Agent is not running.${NC}"
        fi
        ;;
    restart)
        $0 stop
        sleep 2
        $0 start
        ;;
    status)
        if is_running; then
            echo -e "  ${GREEN}● Agent is RUNNING${NC}"
        else
            echo -e "  ${RED}● Agent is STOPPED${NC}"
        fi
        if [ -f "data/state.json" ]; then
            node -e "
                const s=JSON.parse(require('fs').readFileSync('data/state.json','utf8'));
                console.log('  Posts sent:  '+s.totalPosted);
                console.log('  Replies:     '+s.totalReplied);
                console.log('  Failed:      '+s.totalFailed);
                if(s.nextPost)console.log('  Next post:   '+s.nextPost);
                if(s.nextReply)console.log('  Next reply:  '+s.nextReply);
                if(s.lastError)console.log('  Last error:  '+s.lastError);
            " 2>/dev/null
        fi
        ;;
    setup)
        node setup.js
        ;;
    logs|log)
        N="${2:-30}"
        if [ -f "data/activity.log" ]; then
            tail -n "$N" data/activity.log
        else
            echo -e "  ${YELLOW}No activity log yet.${NC}"
        fi
        ;;
    help|-h|--help)
        show_help
        ;;
    cli|"")
        if ! is_running; then
            echo -e "\n  ${YELLOW}⚠ Agent is not running.${NC}"
            echo -e "  ${CYAN}Start it first:${NC} ./x-poster.sh start\n"
        fi
        node cli.js
        ;;
    *)
        echo -e "  ${RED}Unknown command: $1${NC}"
        show_help
        ;;
esac
