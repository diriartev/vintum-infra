#!/bin/bash
# Ejecuta el comando SOLO si este nodo es el master del CRM de HA (un único master en el clúster).
# cron trae PATH=/usr/bin:/bin y ha-manager/qm/pvecm viven en /usr/sbin: se fija explícitamente.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
M=$(timeout 15 ha-manager status 2>/dev/null | awk '/^master /{print $2}')
[ -n "$M" ] && [ "$M" = "$(hostname)" ] && exec "$@"
exit 0
