#!/bin/bash

# Quest 4: Cron job setup for automated crawling
# Run this script to add the crawler to crontab

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN=$(which node)
LOG_DIR="${SCRIPT_DIR}/logs"

mkdir -p "$LOG_DIR"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Quest 4: Cron Job Setup for Linux Crawler              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check for Node.js
if [ -z "$NODE_BIN" ]; then
    echo "[ERROR] Node.js not found. Please install Node.js first."
    exit 1
fi

echo "[INFO] Node.js found: $NODE_BIN"
echo "[INFO] Script directory: $SCRIPT_DIR"
echo "[INFO] Log directory: $LOG_DIR"
echo ""

# Define cron schedule (every 6 hours by default)
CRON_SCHEDULE="${1:-0 */6 * * *}"
CRON_CMD="cd ${SCRIPT_DIR}/.. && ${NODE_BIN} quest4-linux-crawling/index.js >> ${LOG_DIR}/cron-\$(date +\\%Y\\%m\\%d).log 2>&1"

echo "[INFO] Proposed cron schedule: ${CRON_SCHEDULE}"
echo "[INFO] Command: ${CRON_CMD}"
echo ""

read -p "Add this cron job? (y/N): " confirm
if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    # Add to crontab without duplicating
    (crontab -l 2>/dev/null | grep -v "quest4-linux-crawling"; echo "${CRON_SCHEDULE} ${CRON_CMD}") | crontab -
    echo "[SUCCESS] Cron job added!"
    echo ""
    echo "Current crontab:"
    crontab -l
else
    echo "[INFO] Cron job not added. You can add it manually:"
    echo ""
    echo "  crontab -e"
    echo "  # Add this line:"
    echo "  ${CRON_SCHEDULE} ${CRON_CMD}"
fi

echo ""
echo "[INFO] To run the crawler manually:"
echo "  cd ${SCRIPT_DIR}/.."
echo "  npm run quest4"
echo ""
echo "[INFO] To check logs:"
echo "  ls -la ${LOG_DIR}/"
echo "  tail -f ${LOG_DIR}/cron-\$(date +%Y%m%d).log"
