#!/bin/bash
# Vintum (B2-61): arranque suave de elastic-01 tras un failover al nodo HDD (pve-02).
# El 15-oct, al arrancar las 5 VMs a la vez en pve-02, Elasticsearch acaparó el disco (99 % de presión
# de E/S): los servicios tardaron ~20 min en volver y Kibana ~40. Limitando el disco de elastic-01
# sus primeros 10 min, web1/svc-01/db1/Zabbix arrancan primero. Después se libera solo.
# Usa el valor marca 15 para quitar SOLO su propio límite (nunca uno puesto a mano).
# Corre en los dos nodos: si el nodo cae con el límite puesto, el otro lo retira al recibir la VM.
VM=111; HDD=pve-02; MARCA=15; VENTANA=600
[ -f /etc/pve/qemu-server/$VM.conf ] || exit 0                 # la VM no vive en este nodo
qm status $VM 2>/dev/null | grep -q running || exit 0
up=$(qm status $VM --verbose 2>/dev/null | sed -n 's/^uptime: //p'); up=${up:-0}
disk=$(qm config $VM | sed -n 's/^scsi0: //p')
puesto=0; echo "$disk" | grep -q "iops_rd=$MARCA" && echo "$disk" | grep -q "iops_wr=$MARCA" && puesto=1
if [ "$(hostname)" = "$HDD" ] && [ "$up" -lt "$VENTANA" ] && [ "$puesto" = 0 ]; then
  echo "$disk" | grep -q "iops_" && exit 0                     # ya tiene un límite manual: no tocar
  qm set $VM --scsi0 "$disk,iops_rd=$MARCA,iops_wr=$MARCA" >/dev/null 2>&1 && \
    logger -t vintum-arranque-suave "elastic-01 arrancó en $HDD: disco limitado a $MARCA IOPS durante $((VENTANA/60)) min"
elif [ "$puesto" = 1 ] && { [ "$up" -ge "$VENTANA" ] || [ "$(hostname)" != "$HDD" ]; }; then
  limpio=$(echo "$disk" | sed -E "s/,?iops_rd=$MARCA//; s/,?iops_wr=$MARCA//")
  qm set $VM --scsi0 "$limpio" >/dev/null 2>&1 && logger -t vintum-arranque-suave "elastic-01: límite de disco retirado (uptime ${up}s)"
fi
