#!/usr/bin/env bash
# Boot every HTTP service in the monorepo detached, log to /tmp/sm-<name>.log.
# Usage: boot-all.sh start | stop | status
set -u
ROOT="/Users/devtest/Desktop/SM_Official/SPORTSMART_OFFICIAL_MM"
LOGDIR=/tmp/sm-boot
PIDDIR=/tmp/sm-boot/pids
mkdir -p "$LOGDIR" "$PIDDIR"

# name|relative dir|port
SERVICES=(
  "api|apps/api|8000"
  "logistics-facade|apps/logistics-facade|4100"
  "web-admin-storefront|apps/web-admin-storefront|4000"
  "web-d2c-seller-admin|apps/web-d2c-seller-admin|4001"
  "web-franchise-admin|apps/web-franchise-admin|4002"
  "web-d2c-seller|apps/web-d2c-seller|4003"
  "web-franchise|apps/web-franchise|4004"
  "web-storefront|apps/web-storefront|4005"
  "web-affiliate-admin|apps/web-affiliate-admin|4006"
  "web-affiliate|apps/web-affiliate|4007"
  "web-retail-seller-admin|apps/web-retail-seller-admin|4008"
  "web-retail-seller|apps/web-retail-seller|4009"
  "web-admin|apps/web-admin|4010"
  "web-seller|apps/web-seller|4011"
)

start() {
  for s in "${SERVICES[@]}"; do
    IFS='|' read -r name dir port <<< "$s"
    log="$LOGDIR/$name.log"
    : > "$log"
    ( cd "$ROOT/$dir" && PORT="$port" nohup pnpm dev >> "$log" 2>&1 & echo $! > "$PIDDIR/$name.pid" )
    echo "started $name (port $port) pid=$(cat "$PIDDIR/$name.pid")"
    sleep 1   # stagger to avoid a CPU storm of simultaneous cold compiles
  done
}

stop() {
  for s in "${SERVICES[@]}"; do
    IFS='|' read -r name dir port <<< "$s"
    pidf="$PIDDIR/$name.pid"
    [ -f "$pidf" ] && pkill -P "$(cat "$pidf")" 2>/dev/null; kill "$(cat "$pidf" 2>/dev/null)" 2>/dev/null
  done
  # also reap anything still bound to our ports
  for p in 8000 4100 4000 4001 4002 4003 4004 4005 4006 4007 4008 4009 4010 4011; do
    lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | xargs -r kill 2>/dev/null
  done
  echo "stopped"
}

status() {
  printf "%-26s %-6s %-8s %s\n" SERVICE PORT HTTP STATE
  for s in "${SERVICES[@]}"; do
    IFS='|' read -r name dir port <<< "$s"
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$port/" 2>/dev/null)
    if [ "$code" = "000" ] || [ -z "$code" ]; then state="DOWN"; else state="UP"; fi
    printf "%-26s %-6s %-8s %s\n" "$name" "$port" "$code" "$state"
  done
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status" ;;
esac
