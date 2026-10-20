#!/bin/bash
# Vintum: lleva los 5 recursos de HA a un nodo, OFFLINE y de uno en uno (procedimiento §14 de HA_Proxmox_Estado.md).
# Uso:  vintum-failback.sh [pve-01|pve-02]      (por defecto pve-01)
# Reintenta si una migración choca con un ciclo de replicación ("can't lock file pve-migrate-N").
# Con el SDN las VMs funcionan aunque queden repartidas, así que un fallo a mitad no deja nada roto.
DEST=${1:-pve-01}; ORDEN="vm:111 vm:100 vm:102 vm:110 ct:101"
/usr/local/sbin/vintum-cloudinit-huerfanos.sh
ssh -o BatchMode=yes root@$([ "$DEST" = pve-01 ] && echo 10.20.0.100 || echo 10.20.1.200) /usr/local/sbin/vintum-cloudinit-huerfanos.sh 2>/dev/null
for s in $ORDEN; do
  for intento in 1 2 3; do
    ha-manager status | grep -q "$s ($DEST, started)" && break
    echo "$(date +%T) $s → $DEST (intento $intento)"
    ha-manager crm-command relocate "$s" "$DEST" >/dev/null 2>&1
    for i in $(seq 1 45); do
      sleep 8; st=$(ha-manager status | sed -n "s/^service $s (\(.*\))/\1/p")
      [ "$st" = "$DEST, started" ] && break 2
      case "$st" in *", started") [ $i -gt 3 ] && break;; esac   # volvió a arrancar en el origen: reintentar
    done
    sleep 20
  done
  echo "$(date +%T)   $(ha-manager status | grep "service $s")"
done
echo "Listo. Comprueba con Bloque2/probar_todo.py"
