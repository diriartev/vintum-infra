#!/bin/bash
# Instala el conector Cloudflare propio del hipervisor (Vintum, incidencia B2-46).
#
# Por qué: las consolas de Proxmox se publicaban desde conectores que viven dentro de
# VMs gestionadas por HA (svc-01 y el LXC de Zabbix). Al migrar esas VMs al otro sitio
# dejaban de alcanzar la IP de gestión de los nodos, y pve1/pve2.vintum.example se caían.
# Con este conector cada nodo publica su consola, su SSH y su estado contra 127.0.0.1,
# así que no depende de dónde corran las VMs ni del mesh, y arranca solo tras un reinicio.
#
# Uso (el .deb de cloudflared ya copiado a /root del nodo):
#   printf '%s' "$TOKEN_DEL_TUNEL" > /root/token.tmp
#   bash instalar_conector_hipervisor.sh < /root/token.tmp && rm -f /root/token.tmp
#
# Tokens de los túneles pve-01-host / pve-02-host:
#   un archivo local fuera del repositorio (chmod 600)
# El ingress se gestiona desde Cloudflare (config_src: cloudflare), no en fichero local.
set -euo pipefail
TOKEN=$(cat)
[ -n "$TOKEN" ] || { echo "sin token"; exit 1; }
dpkg -i /root/cloudflared_2026.9.1_amd64.deb >/dev/null 2>&1 || apt-get -y -f install >/dev/null
install -d -m 700 /etc/cloudflared
printf 'TUNNEL_TOKEN=%s\n' "$TOKEN" > /etc/cloudflared/env
chmod 600 /etc/cloudflared/env
cat > /etc/systemd/system/cloudflared.service <<'UNIT'
[Unit]
Description=Conector Cloudflare propio del hipervisor (GUI 8006 + SSH + estado) - Vintum
Documentation=https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
EnvironmentFile=/etc/cloudflared/env
ExecStart=/usr/bin/cloudflared --no-autoupdate --metrics 127.0.0.1:20241 tunnel run
Restart=always
RestartSec=5
TimeoutStartSec=0
NoNewPrivileges=true
ProtectHome=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now cloudflared
sleep 12
systemctl is-enabled cloudflared
systemctl is-active cloudflared
/usr/bin/cloudflared --version
