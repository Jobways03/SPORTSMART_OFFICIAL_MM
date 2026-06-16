#!/usr/bin/env bash
# Wait for all services to warm up, then probe for internal server errors (5xx)
# and scan every log for stack traces / Prisma errors.
set -u
ROOT="/Users/devtest/Desktop/SM_Official/SPORTSMART_OFFICIAL_MM"
LOGDIR=/tmp/sm-boot

# name|port
SERVICES=(
  "api|8000" "logistics-facade|4100"
  "web-admin-storefront|4000" "web-d2c-seller-admin|4001" "web-franchise-admin|4002"
  "web-d2c-seller|4003" "web-franchise|4004" "web-storefront|4005"
  "web-affiliate-admin|4006" "web-affiliate|4007" "web-retail-seller-admin|4008"
  "web-retail-seller|4009" "web-admin|4010" "web-seller|4011"
)

# Extra deep endpoints to exercise real API/SSR paths (name|method|url|header)
ENDPOINTS=(
  "api-health|GET|http://localhost:8000/api/v1/health|"
  "api-products|GET|http://localhost:8000/api/v1/storefront/products|"
  "api-categories|GET|http://localhost:8000/api/v1/storefront/categories|"
  "store-home|GET|http://localhost:4005/|"
  "store-products|GET|http://localhost:4005/products|"
  "admin-login|GET|http://localhost:4000/login|"
)

echo "### Phase 1: wait for warm-up (each port, up to 90s, follow redirects) ###"
for s in "${SERVICES[@]}"; do
  IFS='|' read -r name port <<< "$s"
  code=000
  for _ in $(seq 1 18); do
    code=$(curl -s -L -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:$port/" 2>/dev/null)
    [ "$code" != "000" ] && [ -n "$code" ] && break
    sleep 5
  done
  printf "%-26s port %-5s -> %s\n" "$name" "$port" "$code"
done

echo
echo "### Phase 2: probe endpoints for 5xx ###"
fail=0
for e in "${ENDPOINTS[@]}"; do
  IFS='|' read -r name method url hdr <<< "$e"
  if [ -n "$hdr" ]; then
    code=$(curl -s -L -o /dev/null -w "%{http_code}" --max-time 30 -X "$method" -H "$hdr" "$url" 2>/dev/null)
  else
    code=$(curl -s -L -o /dev/null -w "%{http_code}" --max-time 30 -X "$method" "$url" 2>/dev/null)
  fi
  flag=""
  case "$code" in 5*) flag="  <== 5xx!"; fail=$((fail+1));; esac
  printf "%-18s %-4s %-55s -> %s%s\n" "$name" "$method" "$url" "$code" "$flag"
done

echo
echo "### Phase 3: scan all logs for errors / stack traces ###"
for s in "${SERVICES[@]}"; do
  IFS='|' read -r name port <<< "$s"
  log="$LOGDIR/$name.log"
  [ -f "$log" ] || continue
  hits=$(grep -ciE "Internal server error|\b500\b|P20[0-9][0-9]|PrismaClientKnownRequestError|Unhandled|UnhandledPromise|Cannot find module|Error: connect|ECONNREFUSED|TypeError|ReferenceError" "$log" 2>/dev/null)
  if [ "$hits" -gt 0 ]; then
    printf "%-26s %s error-ish lines:\n" "$name" "$hits"
    grep -niE "Internal server error|P20[0-9][0-9]|PrismaClientKnownRequestError|Cannot find module|ECONNREFUSED|ReferenceError|TypeError" "$log" 2>/dev/null | grep -viE "heartbeat|cron " | head -6 | sed 's/^/    /'
  else
    printf "%-26s clean\n" "$name"
  fi
done

echo
echo "### Summary: $fail endpoint(s) returned 5xx ###"
