# 📘 Guía paso a paso

Cómo montar una plataforma como Vintum desde cero, **en el mismo orden en que se construyó**. Cada fase tiene:

> 🎯 **Objetivo** · 🧠 **Por qué así** · ⌨️ **Comandos clave** · ✅ **Comprobación** · ⚠️ **Trampas conocidas**

Las IPs y nombres son de ejemplo (rangos privados genéricos); cámbialos por los tuyos. Las credenciales **nunca** van en
archivos del repositorio: usa variables de entorno o archivos `600`.

## Índice
1. [Hipervisores Proxmox](#fase-1--hipervisores-proxmox)
2. [Malla entre sitios](#fase-2--malla-entre-sitios-cloudflare-warp)
3. [Base de datos y aplicación](#fase-3--base-de-datos-y-aplicación)
4. [Publicación Zero Trust](#fase-4--publicación-zero-trust)
5. [Observabilidad](#fase-5--observabilidad)
6. [Mesa de ayuda y alertas](#fase-6--mesa-de-ayuda-y-alertas)
7. [Clúster y quórum](#fase-7--clúster-y-quórum)
8. [Replicación y HA](#fase-8--replicación-y-ha)
9. [SDN VXLAN y reconciliador](#fase-9--sdn-vxlan-y-reconciliador)
10. [Respaldos, endurecimiento y verificación](#fase-10--respaldos-endurecimiento-y-verificación)

---

## Fase 1 · Hipervisores Proxmox
🎯 Dos hipervisores (uno por sitio) listos para alojar VMs.

🧠 El nodo con **SSD** será el preferido; el de **HDD**, el de respaldo. Desde el principio se crea un pool
**ZFS**, porque la replicación nativa de Proxmox lo exige (migrar de LVM a ZFS después cuesta un backup y una
restauración completos).

⌨️
```bash
# en cada nodo, tras instalar Proxmox VE
zpool create -o ashift=12 zfsha /dev/<disco-o-lv>
pvesm add zfspool zfsha --pool zfsha --sparse 1      # --sparse 1: si no, ZFS reserva el tamaño completo
echo "options zfs zfs_arc_max=536870912" > /etc/modprobe.d/zfs.conf   # ARC ≤ 512 MB en equipos con poca RAM
```
✅ `pvesm status` muestra `zfsha` activo en ambos nodos.

⚠️ Instala `qemu-guest-agent` en cada VM y activa `agent` en Proxmox desde el inicio.

---

## Fase 2 · Malla entre sitios (Cloudflare WARP)
🎯 Que los sitios se vean entre sí **sin abrir puertos** ni tener IP pública.

🧠 Con doble NAT no se puede montar una VPN clásica sin tocar los routers. Un **WARP Connector** en cada
hipervisor anuncia la red de su sitio a Cloudflare, que enruta entre ellos.

⌨️
1. Zero Trust → *Networks → WARP Connector*: crea uno por sitio e instálalo en cada hipervisor.
2. Agrega las redes de cada sitio al *split tunnel* del perfil.
3. Rutas a la IP de malla de cada vecino y, en las VMs, ruta hacia los otros sitios **vía su hipervisor**
   (`proxmox/60-mesh-sitio*.yaml`, con netplan).

✅ `ping` entre las IPs de malla (~150 ms) y entre VMs de sitios distintos.

⚠️ El estado `Connected` del cliente puede mentir: vigila el **tráfico real** por la malla. MTU efectiva 1280.

---

## Fase 3 · Base de datos y aplicación
🎯 MariaDB endurecida y la app web con autenticación robusta.

🧠 La base de datos exige **TLS mutuo**: aunque alguien alcance el puerto, sin certificado de cliente no entra.
La app usa **sesiones opacas** en el servidor (revocables al instante, a diferencia de un JWT) y **2FA por
correo obligatoria**.

⌨️ Usuarios de MariaDB con `REQUIRE X509` y limitados por IP. Revisa los extractos en `app/`:
`api/auth.ts` (registro, login sin enumeración), `api/mfa.ts` (reto en cookie `HttpOnly` + `SameSite=Strict`),
`web/UrlUtils.ts` (`safeHttpUrl`), `edge/nginx.conf` (cabeceras).

✅ `python3 seguridad/scan_vintum.py` (con `VINTUM_TEST_EMAIL`/`VINTUM_TEST_PASSWORD` de una cuenta de prueba).

---

## Fase 4 · Publicación Zero Trust
🎯 Publicar la web y los paneles sin puertos abiertos y con login delante de cada panel.

🧠 Un túnel por grupo de servicios, con **un solo conector** cada uno. Todo panel va detrás de **Cloudflare
Access**. El plano de gestión (consolas de Proxmox, SSH) usa un conector **propio en cada hipervisor**, nunca
dentro de una VM con HA.

⌨️
```bash
# en cada hipervisor; el token se pasa por stdin, nunca en la línea de comandos
printf '%s' "$TOKEN_DEL_TUNEL" | sudo bash proxmox/instalar_conector_hipervisor.sh
```
Después: aplicación de Access para los paneles, otra para SSH y tokens de servicio para lo automatizado.

✅ Cada panel redirige al login de Access en una ventana privada; solo la web pública responde sin login.

⚠️ El WAF bloquea agentes de usuario genéricos de scripts (error 1010): tus automatizaciones deben declarar el suyo.

---

## Fase 5 · Observabilidad
🎯 Ver métricas, logs y disponibilidad de todo en un solo lugar.

⌨️
1. **Elastic** en su VM: `observabilidad/elastic/elk-docker-compose.yml` (TLS, `kibana_system` como cuenta de
   servicio, `vm.max_map_count` de `sysctl-y-instances.txt`). Certificados con propietario `1000:0`.
2. **Filebeat** en cada host (`observabilidad/filebeat/`), con primer arranque limitado a 24 h.
3. **Heartbeat** para la disponibilidad HTTP (`observabilidad/heartbeat/`).
4. **Colector de Cloudflare** (`observabilidad/cloudflare-collector/`, credenciales en `.env` con permisos 600).
5. **Zabbix** server en el sitio 1 y proxy en el sitio 2; hosts y triggers de `observabilidad/zabbix/`.
6. Dashboards y reglas como código:
   ```bash
   export ES_PASSWORD=...        # nunca en el código
   python3 observabilidad/kibana/gen_dashboard_v2.py
   python3 observabilidad/kibana/reglas_alerta.py
   ```

✅ Kibana muestra logs de todos los hosts; el clúster de Elastic en verde; Zabbix sin hosts en rojo.

⚠️ Filtra el ruido desde el inicio (las estadísticas de `warp-svc` eran el 92 % de los documentos).

---

## Fase 6 · Mesa de ayuda y alertas
🎯 Que todo problema relevante termine en un ticket con SLA y en el celular del equipo.

⌨️
1. GLPI con categorías (Disponibilidad, Seguridad, Rendimiento) y SLA (crítico 30 min / 4 h; normal 2 h / 1 día).
2. *Media type* de Zabbix → GLPI (`mediatype-glpi.json` + `mediatype-glpi-script.js`): **primero el seguimiento,
   después el cambio de estado** (al revés, GLPI reabre el ticket).
3. Espejo de tickets en Elastic: `servicios/glpi/vintum-glpi-sync.sh` (purga solo si el export trae datos).
4. Telegram: un Worker de Cloudflare recibe los avisos firmados con un secreto; `glpi-ticket.sh` avisa siempre y
   encola tickets si GLPI no responde.

✅ Un trigger de prueba crea el ticket, envía el correo, llega a Telegram y se cierra solo al resolverse.

---

## Fase 7 · Clúster y quórum
🎯 Unir los dos nodos con un tercer voto.

🧠 Con dos nodos, si uno cae el otro pierde la mayoría y HA no puede actuar. El **QDevice** en un tercer sitio
aporta el voto que desempata, sin alojar cargas.

⌨️
```bash
pvecm create vintum --link0 <ip-malla-pve01>             # en pve-01
pvecm add <ip-malla-pve01> --link0 <ip-malla-pve02>      # en pve-02
apt install corosync-qnetd                                # en el nodo 3
apt install corosync-qdevice && pvecm qdevice setup <ip-nodo3>   # en los nodos
# token de corosync = 10000 ms; y Restart=always en corosync-qdevice (drop-in de systemd)
```
✅ `pvecm status` → `Expected votes: 3`, `Quorate: Yes`, flag `Qdevice`.

⚠️ No subas el `token` cerca del watchdog de HA (60 s): reinicia nodos.

---

## Fase 8 · Replicación y HA
🎯 Que las cargas críticas se levanten solas en el otro nodo.

⌨️
```bash
pvesr create-local-job 100-0 pve-02 --schedule "*/5"      # una por carga
ha-manager rules add node-affinity prefer-pve1 --nodes "pve-01:2,pve-02:1" --resources vm:100,vm:102,vm:110,vm:111,ct:101
ha-manager add vm:100 --state started --failback 0          # failback=0 en todas
# datacenter.cfg: max_workers: 1   (HA arranca las cargas de una en una)
```
Instala los timers de `alta-disponibilidad/` (cloud-init huérfanos, arranque suave) en ambos nodos.

✅ Simula un nodo muerto en una ventana planificada: quórum ~30 s y cargas arriba en ~2,5 min.

⚠️ Nunca migración en caliente por un enlace lento; para volver usa `vintum-failback.sh` (offline).

---

## Fase 9 · SDN VXLAN y reconciliador
🎯 Que las VMs conserven su IP y su gateway en cualquier nodo.

⌨️
1. *Datacenter → SDN*: zona **VXLAN** con las IPs de malla como peers, VNet con VNI 100; aplica.
2. Cuelga las NICs de las cargas de la VNet.
3. Instala `alta-disponibilidad/vintum-ha-net.sh` + timer (30 s) + `vintum-ha-net-boot.service` (antes de HA).

✅ Una VM en pve-02 responde con su IP de siempre y ve a las que siguen en pve-01.

⚠️ Tras cualquier `ifreload` (aplicar el SDN), ejecuta el reconciliador. Nunca pruebes la toma del gateway con
el VXLAN activo: dos gateways envenenan el ARP de toda la LAN.

---

## Fase 10 · Respaldos, endurecimiento y verificación
⌨️
- Respaldo semanal de las cargas a NFS con **`bwlimit`** y `keep-last=2`.
- SSH solo con llave y `MaxAuthTries 3` en todos los equipos; contraseñas aleatorias por nodo.
- Contenedores con `cap_drop: ALL` y reglas en `DOCKER-USER`.
- Zona DNS: SSL `strict`, HSTS con subdominios, SPF/DMARC/CAA.
- Wazuh con credenciales de fábrica rotadas y API solo en localhost.

✅ Una batería de comprobaciones de solo lectura (túneles, Access, quórum, réplicas, SDN, servicios, colas)
después de cada cambio, y una prueba de punta a punta de la cadena de alertas.

---

Si algo sale mal, revisa primero [incidentes-y-lecciones.md](incidentes-y-lecciones.md): es muy probable que ya
nos haya pasado.
