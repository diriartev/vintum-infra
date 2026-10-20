#!/bin/bash
# Uso: glpi-ticket.sh "<titulo>" "<contenido>" [urgencia 1-5]   |   glpi-ticket.sh --flush (solo reintenta la cola)
# 1) Reintenta tickets pendientes. 2) Crea el ticket en GLPI (si falla, lo deja en cola). 3) Avisa SIEMPRE por Telegram.
# El aviso a Telegram NO depende de que GLPI esté vivo (GLPI se cae con los mismos cortes que queremos avisar).
ENVF=/etc/vintum/glpi-api.env; [ -f "$ENVF" ] || ENVF=/tmp/glpi-api.env
. "$ENVF"
URL="${GLPI_URL_INT:-$GLPI_URL}"
SPOOL=/var/lib/vintum/ticket-spool; mkdir -p "$SPOOL"
jesc() { python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1"; }

# crea un ticket; deja el id en $TID (vacío si falla)
create_ticket() {  # $1 titulo  $2 contenido  $3 urgencia
  TID=""
  local ST BODY RES ST2 U
  ST=$(curl -s --max-time 12 "$URL/initSession" -H "Content-Type: application/json" -H "Authorization: user_token $GLPI_USER_TOKEN" \
       | sed -n 's/.*"session_token":"\([^"]*\)".*/\1/p')
  [ -z "$ST" ] && return 1
  BODY="{\"input\":{\"name\":$(jesc "$1"),\"content\":$(jesc "$2"),\"urgency\":$3,\"type\":1}}"
  RES=$(curl -s --max-time 15 -X POST "$URL/Ticket" -H "Content-Type: application/json" -H "Session-Token: $ST" -d "$BODY")
  curl -s --max-time 8 "$URL/killSession" -H "Session-Token: $ST" >/dev/null 2>&1
  TID=$(echo "$RES" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  [ -z "$TID" ] && return 1
  ST2=$(curl -s --max-time 12 "$URL/initSession" -H "Authorization: user_token $GLPI_USER_TOKEN" | sed -n 's/.*"session_token":"\([^"]*\)".*/\1/p')
  for U in ${GLPI_OBSERVERS:-7 9 10}; do
    curl -s --max-time 8 -X POST "$URL/Ticket_User" -H "Content-Type: application/json" -H "Session-Token: $ST2" \
      -d "{\"input\":{\"tickets_id\":$TID,\"users_id\":$U,\"type\":3}}" >/dev/null 2>&1
  done
  curl -s --max-time 8 "$URL/killSession" -H "Session-Token: $ST2" >/dev/null 2>&1
  return 0
}

# 1) pendientes de ejecuciones anteriores (el aviso de Telegram ya salió en su momento)
n=0
for f in $(ls "$SPOOL"/*.json 2>/dev/null | head -10); do
  mapfile -t F < <(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["t"]);print(d["c"].replace("\n","\\n"));print(d["u"])' "$f" 2>/dev/null)
  [ ${#F[@]} -lt 3 ] && { rm -f "$f"; continue; }
  if create_ticket "${F[0]}" "$(printf '%b' "${F[1]}")" "${F[2]}"; then rm -f "$f"; n=$((n+1)); else break; fi
done
[ "$n" -gt 0 ] && echo "reenviados $n ticket(s) pendiente(s)"
[ "$1" = "--flush" ] && exit 0   # modo solo-reintento (lo usa cron cada 5 min)

# 2) ticket nuevo
TITLE="$1"; CONTENT="$2"; URG="${3:-3}"
if create_ticket "$TITLE" "$CONTENT" "$URG"; then
  EST="GLPI #$TID"; echo "ticket #$TID creado (equipo notificado)"
else
  EST="GLPI no disponible: ticket en cola"
  python3 -c 'import json,sys,time;json.dump({"t":sys.argv[1],"c":sys.argv[2],"u":sys.argv[3]},open(sys.argv[4],"w"))' "$TITLE" "$CONTENT" "$URG" "$SPOOL/$(date +%s)-$$.json"
  echo "ERROR: GLPI no responde; ticket guardado en cola ($SPOOL)"
fi

# 3) Telegram, siempre
NF=/etc/vintum/alert-notify.env
if [ -f "$NF" ]; then
  . "$NF"
  [ -n "$WORKER_URL" ] && [ -n "$ALERT_SECRET" ] && \
    curl -s --max-time 12 -X POST "$WORKER_URL/glpi-webhook" -H "X-Alert-Secret: $ALERT_SECRET" -H "Content-Type: application/json" \
      -d "{\"titulo\":$(jesc "$TITLE"),\"descripcion\":$(jesc "$CONTENT"),\"urgencia\":\"$URG\",\"estado\":\"$EST\"}" >/dev/null 2>&1
fi
[ -n "$TID" ]
