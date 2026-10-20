#!/bin/bash
# Red de HA de Vintum — v2 con SDN de Proxmox (15-oct-2026, incidencia B2-60).
#
# Las 5 VMs/CT críticas viven en la VNet SDN "vintum" (zona VXLAN "vxvintum", VNI 100), que existe
# en los dos nodos y se une por VXLAN sobre el mesh WARP (100.96.0.1 <-> 100.96.0.2). En pve-01 la
# VNet está puenteada a vmbr0 (la LAN real del sitio 1) con el par veth-v0/veth-v1, así que una VM
# conserva su IP 10.20.0.x y su gateway real (el router del sitio 1) CORRA EN EL NODO QUE CORRA,
# y las VMs se ven entre sí aunque estén repartidas entre nodos (antes eso no funcionaba).
#
# Líder: pve-01 si está en línea en el clúster; si no, pve-02. El líder tiene la IP virtual del
# relay de Wazuh (10.20.0.250). Si el líder es pve-02 (pve-01 caído), además hace de gateway
# 10.20.0.1 con NAT para las VMs, porque el router del sitio 1 ya no es alcanzable. Solo un nodo
# puede tener esas IPs a la vez: con la red estirada, dos nodos con la misma IP serían un conflicto.
#
# Lo ejecuta vintum-ha-net.timer cada 30 s (y vintum-ha-net-boot.service al arrancar). Idempotente.
exec 9>/run/vintum-ha-net.lock; flock -w 120 9 || exit 0

NODE=$(hostname)
BR=vintum                                   # VNet del SDN
GW=10.20.0.1; WZ_VIP=10.20.0.250; WZ_DST=10.20.2.150
OTHER_WARP=100.96.0.2; [ "$NODE" = "pve-02" ] && OTHER_WARP=100.96.0.1
# IPs de las VMs/CT en la VNet. Una VM nueva en la VNet debe añadirse aquí (rutas del modo líder en pve-02).
VMS="10.20.0.30 10.20.0.40 10.20.0.50 10.20.0.60 10.20.0.70"
WZ_SRC=10.20.0.30,10.20.0.40,10.20.0.50,10.20.0.60,10.20.0.70
log() { logger -t vintum-ha-net "$*"; }

ip link show "$BR" >/dev/null 2>&1 || { log "la VNet $BR no existe (¿SDN sin aplicar?)"; exit 1; }

# ---------- ¿quién es el líder? ----------
# CANDADOS (B2-62): pve-02 solo asume que pve-01 está caído si lo SABE por tres vías a la vez:
#   1) /etc/pve legible y pve-01 marcado offline   2) este nodo con quórum   3) pve-01 no responde por el mesh
# Ante la duda (p. ej. al arrancar, antes de que pmxcfs monte /etc/pve) no se cambia nada. Tomar
# 10.20.0.1 con pve-01 vivo y el VXLAN arriba es un conflicto de IP con el router real en TODA la LAN del
# sitio 1: el 15-oct un error así envenenó el ARP de pve-01, le cortó el WARP y el watchdog lo reinició.
# Con el candado 3, si pve-02 toma el gateway es porque el mesh hacia pve-01 está caído, y entonces el
# VXLAN (que va por ese mesh) también: el gateway de pve-02 queda aislado y no puede chocar.
pve01_online=$(python3 -c 'import json;m=json.load(open("/etc/pve/.members"));print(m["nodelist"]["pve-01"]["online"])' 2>/dev/null)
quorum=$(corosync-quorumtool -s 2>/dev/null | grep -qE "Quorate: +Yes" && echo 1 || echo 0)
if [ "$NODE" = "pve-01" ]; then LIDER=1
elif [ "$pve01_online" = "1" ]; then LIDER=0
elif [ "$pve01_online" = "0" ] && [ "$quorum" = "1" ] && ! ping -c3 -W2 -q "$OTHER_WARP" >/dev/null 2>&1; then LIDER=1
else
  log "estado de pve-01 dudoso (online='$pve01_online' quórum=$quorum mesh=$(ping -c1 -W2 -q $OTHER_WARP >/dev/null 2>&1 && echo responde || echo no)): no se toca el gateway"
  LIDER=keep
fi

# ---------- pve-01: puente VNet <-> LAN del sitio 1 ----------
if [ "$NODE" = "pve-01" ]; then
  ip link show veth-v0 >/dev/null 2>&1 || ip link add veth-v0 type veth peer name veth-v1
  # una recarga de red (ifreload, p. ej. al aplicar el SDN) saca de los bridges los puertos que no
  # están en /etc/network/interfaces: se reenganchan SIEMPRE, no solo al crear el par
  ip link set veth-v0 master vmbr0 2>/dev/null; ip link set veth-v1 master "$BR" 2>/dev/null
  ip link set veth-v0 up; ip link set veth-v1 up
  for ip in $VMS; do ip route replace "$ip/32" dev vmbr0 table 65743 2>/dev/null; done
fi

# ---------- IP virtual del relay de Wazuh: solo en el líder ----------
if [ "$LIDER" = 1 ]; then
  ip addr show dev "$BR" | grep -q "inet $WZ_VIP/32" || ip addr add "$WZ_VIP/32" dev "$BR"
elif [ "$LIDER" = 0 ]; then
  ip addr del "$WZ_VIP/32" dev "$BR" 2>/dev/null
fi
iptables -t nat -C PREROUTING -s $WZ_SRC -d $WZ_VIP -p tcp -m multiport --dports 1514,1515 -j DNAT --to-destination $WZ_DST 2>/dev/null || \
  iptables -t nat -A PREROUTING -s $WZ_SRC -d $WZ_VIP -p tcp -m multiport --dports 1514,1515 -j DNAT --to-destination $WZ_DST
iptables -t nat -C POSTROUTING -s $WZ_SRC -d $WZ_DST -p tcp -m multiport --dports 1514,1515 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s $WZ_SRC -d $WZ_DST -p tcp -m multiport --dports 1514,1515 -j MASQUERADE

# ---------- pve-02 ----------
if [ "$NODE" = "pve-02" ] && [ "$LIDER" != keep ]; then
  if [ "$LIDER" = 1 ]; then
    # pve-01 caído: pve-02 es el gateway de las VMs y sale a Internet por el sitio 2
    if ! ip addr show dev "$BR" | grep -q "inet $GW/24"; then
      ip addr add "$GW/24" dev "$BR"; log "pve-01 fuera del clúster: pve-02 asume el gateway $GW"
      # ARP gratuito: las VMs que ya corrían en pve-02 tienen en caché la MAC del router del sitio 1
      # (inalcanzable ya); así la actualizan al momento en vez de esperar ~45 s a que caduque
      command -v arping >/dev/null && (arping -U -c 3 -I "$BR" "$GW" >/dev/null 2>&1 &)
    fi
    sysctl -qw net.ipv4.ip_forward=1
    iptables -t nat -C POSTROUTING -s 10.20.0.0/24 ! -d 10.20.0.0/24 -j MASQUERADE 2>/dev/null || \
      iptables -t nat -A POSTROUTING -s 10.20.0.0/24 ! -d 10.20.0.0/24 -j MASQUERADE
    for ch in input output; do
      d=$([ $ch = input ] && echo iifname || echo oifname)
      nft list chain inet cloudflare-warp $ch 2>/dev/null | grep -q "\"$BR\" accept" || nft insert rule inet cloudflare-warp $ch $d "$BR" accept
    done
    nft list chain inet cloudflare-warp forward 2>/dev/null | grep -q "\"$BR\" accept" || \
      { nft insert rule inet cloudflare-warp forward iifname "$BR" accept; nft insert rule inet cloudflare-warp forward oifname "$BR" accept; }
    for ip in $VMS; do ip route replace "$ip/32" dev "$BR" table 65743; ip route replace "$ip/32" dev "$BR"; done
  else
    # pve-01 vivo: el gateway es el router real del sitio 1 (alcanzable por el VXLAN); pve-02 no
    # tiene IPs en la VNet y llega a las VMs por el mesh a través de pve-01
    if ip addr show dev "$BR" | grep -q "inet $GW/24"; then
      ip addr del "$GW/24" dev "$BR"; log "pve-01 de vuelta: pve-02 suelta el gateway $GW"
    fi
    for ip in $VMS; do ip route del "$ip/32" dev "$BR" 2>/dev/null; ip route replace "$ip/32" via "$OTHER_WARP" dev CloudflareWARP table 65743 2>/dev/null; done
  fi
fi

# ---------- MESH_SNAT: el otro nodo y el nodo 3 llegan a las VMs por el mesh con origen 100.96.x.x;
# las VMs responderían por su gateway y la respuesta se perdería: se enmascara para que vuelva por el nodo.
iptables -t nat -C POSTROUTING -s 100.96.0.0/12 -d 10.20.0.0/24 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s 100.96.0.0/12 -d 10.20.0.0/24 -j MASQUERADE
exit 0
