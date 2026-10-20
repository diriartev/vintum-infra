#!/bin/bash
# vintum-docker-heal: tras un corte sucio, deja Docker y sus stacks funcionando SIN intervención.
#  1) Si dockerd no arranca por la base de redes corrupta (local-kv.db), la aparta (con copia) y arranca.
#  2) Si había que reparar la red, recrea los contenedores (siguen ligados al ID de red viejo).
#  3) Si dockerd corre pero hay contenedores caídos de forma sucia (exit 255/created/dead), hace `compose up -d`.
# Uso: vintum-docker-heal.sh [--dry-run]   (corre cada minuto por timer; con flock; espera 2 min tras el arranque)
DRY=0; [ "$1" = "--dry-run" ] && DRY=1
exec 9>/run/vintum-docker-heal.lock; flock -n 9 || exit 0
LOG=/var/log/vintum-docker-heal.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG" >/dev/null; logger -t vintum-heal "$*"; [ $DRY -eq 1 ] && echo "$*"; }
run(){ if [ $DRY -eq 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
up=$(cut -d. -f1 /proc/uptime); [ "$up" -lt 120 ] && [ $DRY -eq 0 ] && exit 0
NETDIR=/var/lib/docker/network/files; KV=$NETDIR/local-kv.db

projects(){ # imprime "proyecto|directorio|archivo" por cada stack conocido (lee la config en disco, no necesita dockerd)
python3 - <<'PY'
import json,glob,os
seen={}
for f in glob.glob("/var/lib/docker/containers/*/config.v2.json"):
    try: l=json.load(open(f)).get("Config",{}).get("Labels") or {}
    except Exception: continue
    p=l.get("com.docker.compose.project"); d=l.get("com.docker.compose.project.working_dir"); cf=(l.get("com.docker.compose.project.config_files") or "").split(",")[0]
    if p and d and os.path.isdir(d): seen[p]=(d,cf if cf and os.path.exists(cf) else "")
for p,(d,cf) in sorted(seen.items()): print("%s|%s|%s"%(p,d,cf))
PY
}
compose_up(){ # $1=proyecto $2=dir $3=archivo $4=--force-recreate|""
  local a=(compose -p "$1"); [ -n "$3" ] && a+=(-f "$3"); a+=(up -d); [ -n "$4" ] && a+=("$4")
  ( cd "$2" && run docker "${a[@]}" ) >>"$LOG" 2>&1
}
force=0
if ! timeout 25 docker info >/dev/null 2>&1; then
  log "dockerd no responde (estado: $(systemctl is-active docker))"
  if [ $DRY -eq 0 ]; then systemctl reset-failed docker docker.socket 2>/dev/null; systemctl start docker; sleep 10; fi
  if [ $DRY -eq 1 ] || ! timeout 25 docker info >/dev/null 2>&1; then
    if journalctl -u docker -n 120 --no-pager 2>/dev/null | grep -qE "Error initializing network controller|same bridge name|local-kv"; then
      log "causa: base de redes de Docker corrupta -> cuarentena de local-kv.db"
      TS=$(date +%Y%m%d-%H%M%S)
      run systemctl stop docker.socket docker
      run cp -a /var/lib/docker/network "/var/lib/docker/network.bak-$TS"
      run mv "$KV" "$KV.cuarentena-$TS"
      ls -dt /var/lib/docker/network.bak-* 2>/dev/null | tail -n +4 | while read -r old; do run rm -rf "$old"; done
      run systemctl reset-failed docker docker.socket
      run systemctl start docker; [ $DRY -eq 0 ] && sleep 10
      force=1
    else
      # ¿está solo inicializando despacio? (tras un failover el disco está frío: dockerd puede tardar >8 min)
      st=$(systemctl is-active docker); since=$(systemctl show docker -p ActiveEnterTimestampMonotonic --value 2>/dev/null); ents=$(( ${since:-0} / 1000000 )); now=$(cut -d. -f1 /proc/uptime)
      if { [ "$st" = "active" ] || [ "$st" = "activating" ]; } && [ $(( now - ents )) -lt 1200 ]; then
        log "docker inicializando despacio (estado $st, lleva $(( now - ents ))s): espero, no toco nada"; exit 0
      fi
      log "docker no arranca y NO es la base de redes: no toco nada (revisar journalctl -u docker)"; exit 1
    fi
  fi
  [ $DRY -eq 0 ] && ! timeout 25 docker info >/dev/null 2>&1 && { log "docker sigue caído tras la reparación"; exit 1; }
fi
# ¿hay contenedores caídos de forma sucia?
dirty=0
if [ $DRY -eq 0 ]; then
  for id in $(docker ps -aq --filter "status=exited" --filter "status=created" --filter "status=dead"); do
    rp=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$id"); ec=$(docker inspect -f '{{.State.ExitCode}}' "$id"); st=$(docker inspect -f '{{.State.Status}}' "$id")
    case "$rp" in always|unless-stopped) [ "$ec" = "255" ] || [ "$st" != "exited" ] && dirty=1;; esac
  done
fi
if [ $force -eq 1 ] || [ $dirty -eq 1 ]; then
  [ $force -eq 1 ] && log "recreando todos los stacks (red nueva)" || log "contenedores caídos de forma sucia: compose up -d"
  projects | while IFS='|' read -r p d cf; do
    [ -z "$p" ] && continue
    if [ $force -eq 1 ]; then compose_up "$p" "$d" "$cf" --force-recreate
    else compose_up "$p" "$d" "$cf" "" || compose_up "$p" "$d" "$cf" --force-recreate; fi
    log "stack $p: up -d terminado"
  done
else
  [ $DRY -eq 1 ] && { echo "[dry-run] docker OK; stacks detectados:"; projects | sed 's/^/   /'; }
fi
exit 0
