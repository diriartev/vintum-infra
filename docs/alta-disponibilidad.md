# Alta disponibilidad

## Diseño

| Pieza | Configuración | Por qué |
|---|---|---|
| Clúster | `pve-01` + `pve-02` + **QDevice** en el nodo 3 → 3 votos | Con dos nodos, la caída de uno deja al otro sin mayoría |
| Corosync | `token = 10000` ms sobre la malla | Tolera la latencia; **no más alto** (ver lecciones) |
| Almacenamiento | Pool ZFS `zfsha` en ambos nodos | Requisito de la replicación nativa de Proxmox |
| Replicación | `pvesr` de las 5 cargas **cada 5 min** | RPO ≤ 5 min |
| HA Manager | Afinidad `pve-01:2, pve-02:1` (no estricta), `failback=0`, `max_workers=1` | Prefiere el nodo SSD; tras un failover **no** intenta volver solo |
| Fencing | Watchdog de HA | Un nodo sin quórum se reinicia para no corromper datos |
| QDevice | `Restart=always` | Un QDevice caído en silencio anula el failover |
| Respaldos | Semanal (domingo 23:00) a NFS en pve-02, `keep-last=2`, **`bwlimit 3000`** | Sin límite, el respaldo ahoga a corosync |

## Scripts propios (`alta-disponibilidad/`)

| Script | Cuándo corre | Qué hace |
|---|---|---|
| `vintum-ha-net.sh` | Cada 30 s y al arrancar (antes de HA) | Reconciliador de red: puente VNet ↔ LAN, rutas, líder, IP virtual del relay de Wazuh y, solo en emergencia, el gateway del sitio 1 |
| `vintum-failback.sh` / `failback.sh` | A mano | Vuelve las cargas al nodo preferido **offline**, una por una, con reintentos |
| `vintum-cloudinit-huerfanos.*` | Cada 5 min | Borra discos cloud-init de VMs que viven en el otro nodo (si no, las migraciones abortan) |
| `vintum-arranque-suave.*` | Cada 30 s | Si Elastic arranca en el nodo HDD, le limita el disco 10 min para que primero arranquen web y servicios |
| `vintum-docker-heal.sh` | Al arrancar las VMs | Si Docker no arranca por una base de redes corrupta, la aparta (con copia) y recrea los stacks |
| `vintum-leader.sh` | En los vigilantes | Solo el nodo líder ejecuta los vigilantes; cambia solo si el otro cae |
| `glpi-ticket.sh` | Vigilantes de infraestructura | Crea el ticket en GLPI **y** avisa por Telegram siempre; si GLPI no responde, encola y reintenta |
| `persist-check.sh` | A mano | Verifica que todo lo anterior sobrevive a un reinicio |

### Los tres candados del gateway
Con la red estirada entre sitios, **dos nodos con la misma IP de gateway envenenan el ARP de toda la LAN**
(pasó, ver B2-62). Por eso `pve-02` solo toma `10.20.0.1` si se cumplen **las tres** condiciones:

1. La lista de miembros del clúster es legible y marca a `pve-01` como *offline*.
2. `pve-02` tiene quórum propio (con el QDevice).
3. `pve-01` no responde por la malla.

Ante la duda, no hace nada y lo registra (`journalctl -t vintum-ha-net`).

## Pruebas reales (medidas)

**Nodo muerto** (pve-01 reiniciado con corosync retenido 10 min):

| Tiempo | Evento |
|---|---|
| +31 s | pve-02 + QDevice = 2 votos → quórum |
| +82 s | HA marca *fence* a pve-01 |
| +130 s | Las 5 cargas en `starting` en pve-02 |
| +156 s | Las 5 cargas en `started` |
| +953 s | La web responde 200 (cuello de botella: Docker sobre HDD) |

Datos perdidos: **≤ 43 s** (última réplica 22:40:00, caída 22:40:43).

**Reinicio corto** (pve-01 vuelve en ~17 s): HA no llega a darlo por muerto → **no hay failover** (correcto).

**Failback offline**: parar 3,6 min + migrar 3,8 min + arrancar ≈ **9 min** de corte planificado.

## Limitaciones conocidas

- Un parpadeo de la malla de más de ~40 s reinicia al nodo (fencing). La mitigación real sería un segundo
  enlace de corosync por otro camino.
- El arranque en frío en el nodo HDD es lento (web en 9–16 min tras un failover).
- Replicación asíncrona: RPO de hasta 5 min.
- El nodo preferido trabaja cerca del 95 % de RAM con las cinco cargas: no cabe otra VM.

## Reglas de operación (cada una nació de una caída)

1. Nunca dos gateways `10.20.0.1`.
2. Nunca migración en caliente entre sitios y nunca `failback=1`.
3. Nunca publicar el plano de gestión desde una VM con HA.
4. Un solo conector por túnel (al clonar una VM con `cloudflared`, quitarle el token).
5. No quitar el `bwlimit` del respaldo ni lanzar transferencias grandes por la malla.
6. Ningún sincronizador debe borrar por diferencia sin validar que el origen trajo datos.
