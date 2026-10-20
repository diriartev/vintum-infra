#!/bin/bash
# Vintum (incidencia B2-52): elimina volúmenes cloudinit huérfanos del pool zfsha.
# Proxmox regenera el disco cloudinit en cada arranque/migración y deja la copia vieja en
# el nodo de origen. La siguiente migración hacia ese nodo aborta con
# "volume 'zfsha/vm-XXX-cloudinit' already exists", y HA entra en un bucle de reintentos.
# Un cloudinit es huérfano si la VM no tiene su configuración en ESTE nodo.
# Salvaguardas: no toca nada con migraciones en curso ni volúmenes de menos de 15 min.
set -u
pgrep -f "qmigrate|pvesm import" >/dev/null && exit 0
ahora=$(date +%s)
zfs list -H -p -o name,creation -r zfsha 2>/dev/null | while read -r vol creado; do
  [[ "$vol" =~ ^zfsha/vm-([0-9]+)-cloudinit$ ]] || continue
  id=${BASH_REMATCH[1]}
  [ -f "/etc/pve/qemu-server/$id.conf" ] && continue          # la VM vive aquí: no es huérfano
  [ -f "/etc/pve/nodes/$(hostname)/qemu-server/$id.conf" ] && continue
  [ $((ahora - creado)) -lt 900 ] && continue                   # recién creado: puede ser una migración
  ls /etc/pve/nodes/*/qemu-server/$id.conf >/dev/null 2>&1 || continue   # VM inexistente: no tocar
  zfs destroy "$vol" && logger -t vintum-cloudinit "eliminado $vol (huérfano: VM $id vive en otro nodo)"
done
