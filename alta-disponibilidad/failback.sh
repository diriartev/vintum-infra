#!/bin/bash
# Failback ORDENADO y OFFLINE de las 5 cargas a pve-01 (la migración en vivo no converge por el WAN)
L=/root/failback.log; : > $L; log(){ echo "$(date +%H:%M:%S) $*" | tee -a $L; }
SIDS="ct:101 vm:100 vm:102 vm:110 vm:111"
wait_state(){ # $1=nodo $2=estado
  for i in $(seq 1 60); do
    ok=1; for s in $SIDS; do ha-manager status | grep -qE "service $s \($1, $2\)" || ok=0; done
    [ $ok -eq 1 ] && return 0; sleep 5; done; return 1; }
log "== 1) detener las 5 cargas por HA"; for s in $SIDS; do ha-manager set $s --state stopped >/dev/null; done
wait_state pve-02 stopped && log "   todas detenidas" || { log "ERROR: no se detuvieron; ABORTO"; ha-manager status | grep service >> $L; exit 1; }
log "== 2) borrar cloudinit viejos en pve-01 (se regeneran al arrancar)"
for v in vm-110-cloudinit vm-111-cloudinit; do ssh -o ConnectTimeout=8 10.20.0.100 "zfs list -H -o name zfsha/$v >/dev/null 2>&1 && zfs destroy -r zfsha/$v && echo destruido-$v" | tee -a $L; done
log "== 3) migrar a pve-01"; for s in $SIDS; do ha-manager migrate $s pve-01 >/dev/null 2>&1; done
wait_state pve-01 stopped && log "   las 5 en pve-01 (paradas)" || { log "ERROR: migración incompleta"; ha-manager status | grep service >> $L; exit 1; }
log "== 4) arrancar en pve-01"; for s in $SIDS; do ha-manager set $s --state started >/dev/null; done
wait_state pve-01 started && log "   las 5 ARRANCADAS en pve-01" || log "AVISO: no todas reportan started aún"
ha-manager status | grep -E "^service" >> $L; log "FIN"
