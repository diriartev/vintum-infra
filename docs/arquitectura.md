# Arquitectura

## Restricciones de partida

| Restricción | Consecuencia de diseño |
|---|---|
| 3 sitios en redes domésticas, **doble NAT**, sin IP pública | Nada se publica abriendo puertos: todo sale por **Cloudflare Tunnel** y los sitios se unen con **Cloudflare WARP Connector** |
| Enlace entre sitios de **~150 ms y ~4,5 MB/s** (MTU 1280) | Nada de migración en caliente; replicación asíncrona; respaldos con límite de ancho de banda |
| Hipervisores = portátiles (11–12 GB de RAM; uno con SSD, otro con HDD) | Nodo preferido (SSD) + nodo de respaldo (HDD); memoria ajustada al uso real; arranque suave en el HDD |
| Dos hipervisores no forman quórum por sí solos | Tercer voto: **QDevice** en un tercer sitio |

## Inventario

| Equipo | Tipo | Red | Función |
|---|---|---|---|
| **pve-01** | Proxmox VE 9, SSD | Sitio 1 · `10.20.0.100` · malla `100.96.0.1` | Hipervisor preferido |
| **pve-02** | Proxmox VE 9, HDD | Sitio 2 · `10.20.1.200` · malla `100.96.0.2` | Hipervisor de respaldo + NFS de respaldos |
| **nodo 3** | Ubuntu Server | Sitio 3 · `10.20.2.150` · malla `100.96.0.3` | QDevice (`corosync-qnetd`) + Wazuh |
| db1 (VM 100) | Ubuntu | `10.20.0.60` | MariaDB con mTLS (app + GLPI) |
| web1 (VM 102) | Ubuntu + Docker | `10.20.0.50` | App Vintum, Wiki.js, Portainer |
| svc-01 (VM 110) | Ubuntu + Docker | `10.20.0.70` | GLPI, Homarr, Heartbeat, colector de Cloudflare |
| elastic-01 (VM 111) | Ubuntu + Docker | `10.20.0.40` | Elasticsearch + Kibana |
| zabbix (CT 101) | LXC | `10.20.0.30` | Zabbix Server |
| zbx-proxy (CT 201) | LXC | `10.20.1.31` | Zabbix Proxy del sitio 2 (fuera de HA) |

Las cinco cargas críticas (`vm:100,102,110,111`, `ct:101`) están protegidas por HA.

## Red

### Malla entre sitios
Cada hipervisor ejecuta un **WARP Connector**; Cloudflare enruta entre ellos las redes de cada sitio.
Por la malla viajan **corosync**, la **replicación ZFS** y el **VXLAN** del SDN. Las VMs alcanzan otros sitios a
través de su hipervisor (`proxmox/60-mesh-*.yaml`).

### SDN VXLAN
```
router sitio 1 ── vmbr0 ─ veth ═ VNet "vintum" ══ VXLAN VNI 100 (por la malla) ══ VNet "vintum" ── VMs en pve-02
                  pve-01         VMs en pve-01                                       pve-02
```
- Zona VXLAN `vxvintum` (peers = IPs de la malla) y VNet `vintum` (VNI 100).
- Las cinco cargas cuelgan de la VNet: **conservan su IP y su gateway corran en el nodo que corran**, y se ven
  entre sí aunque estén repartidas.
- El reconciliador (`alta-disponibilidad/vintum-ha-net.sh`) mantiene el puente con la LAN y decide quién tiene
  el gateway si el sitio 1 cae (ver [alta-disponibilidad.md](alta-disponibilidad.md)).

### Publicación
| Túnel | Conector | Publica |
|---|---|---|
| `webserver` | contenedor en web1 | la web pública (único servicio público) |
| `svc-01` | contenedor en svc-01 | GLPI, Homarr, Wiki, Kibana, Portainer |
| `zabbix` | CT 101 | Zabbix, Wazuh, SSH del nodo 3 |
| `pve-01-host` / `pve-02-host` | systemd en cada hipervisor | consola de Proxmox, SSH y estado del nodo |

Todo lo que no es la web pública pasa por **Cloudflare Access**. Las consolas de Proxmox tienen un conector
**propio en cada hipervisor**: si viviera dentro de una VM con HA, se perdería justo cuando más se necesita
(ver incidente B2-46 en [incidentes-y-lecciones.md](incidentes-y-lecciones.md)).

## Aplicación Vintum

| Capa | Tecnología | Notas de seguridad |
|---|---|---|
| Borde | nginx | Cabeceras CSP, HSTS, COOP, Permissions-Policy |
| API | Node.js + Fastify | Sesiones opacas de 256 bits en servidor, CSRF, 2FA por correo obligatoria |
| Web | React | Saneamiento de URLs en buscadores y fuentes RSS |
| Datos | MariaDB | TLS mutuo (certificado de cliente), usuarios limitados por IP |

Extractos del código en [`app/`](../app).
