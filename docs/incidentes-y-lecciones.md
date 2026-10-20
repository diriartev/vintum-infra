# Incidentes reales y lecciones aprendidas

Bitácora resumida de los problemas que aparecieron **en la plataforma real**, con su causa raíz y la corrección.
Cada fila tiene su código de bitácora (B2-xx) del informe técnico del proyecto.

## Las caídas grandes

### 1 · Web caída ~5,5 horas sin ningún aviso (3-oct)
- **Qué pasó:** la malla WARP parpadeó ~45 s (el túnel WireGuard no renovó su sesión). pve-01 se quedó sin
  quórum y el watchdog de HA lo reinició. pve-02 levantó las cargas, pero al volver pve-01 una regla de
  «preferir pve-01» intentó devolverlas **en caliente**, lo que no converge por ese enlace. Después pve-02 se
  apagó y pve-01 recuperó desde una réplica.
- **Por qué nadie se enteró:** el script de avisos creaba primero el ticket en GLPI y, si GLPI no respondía,
  salía sin avisar; además todos los vigilantes vivían en el nodo caído.
- **Cambios:** Telegram siempre y cola de tickets con reintento; **vigilante externo** en un Worker de
  Cloudflare (cada minuto, desde fuera de la infraestructura); guardia de líder para los vigilantes; retorno
  manual y offline; réplicas cada 5 min; auto-reparador de Docker.
- **Lección:** *el sistema de alertas no puede depender de lo que vigila.*

### 2 · El failover no levantó nada (2-oct)
- **Causa:** `corosync-qdevice` llevaba 14 h muerto en pve-02 (habilitado pero detenido). Al caer pve-01 quedó
  un solo voto: sin quórum, HA no arranca nada.
- **Cambio:** `Restart=always` en ambos nodos y vigilancia del QDevice.
- **Lección:** *un componente de respaldo que no se monitorea no existe.*

### 3 · Subir el `token` de corosync reinició un nodo
- **Causa:** con `token=60000`, al reiniciar pve-02 de forma ordenada, pve-01 esperó el token más de 45 s y el
  watchdog de HA (60 s fijos) lo reinició.
- **Regla:** `token + 1,2 × token` debe quedar muy por debajo de 60 s. Se dejó en 10 s.
- **Lección:** *más tolerancia en una capa puede romper otra.*

### 4 · Bucle de migraciones durante 20 horas (B2-52)
- **Causa:** tras reiniciarse ambos nodos, HA intentó devolver dos VMs al nodo preferido con migración en
  caliente; cada intento abortaba por un disco cloud-init ya existente en el destino y HA reintentaba cada minuto.
- **Cambios:** `failback=0`, script de failback offline y limpiador de discos cloud-init huérfanos.

### 5 · Toda la LAN del sitio 1 sin red (B2-62)
- **Causa:** una prueba del reconciliador hizo que pve-02 tomara la IP del gateway con el VXLAN activo: dos
  equipos anunciando `10.20.0.1` envenenaron el ARP de la LAN.
- **Cambios:** gateway retirado en 12 s y ARP correctivo; el reconciliador ahora exige **tres candados**
  independientes antes de tomar el gateway.
- **Lección:** *las pruebas de failover también necesitan su propio plan de contención.*

### 6 · Apagón real de pve-01 (B2-58/59)
- **Resultado:** el failover funcionó (~2,5 min para levantar las 5 cargas), pero el nodo HDD se saturó.
- **Cambios:** límite temporal de IOPS a Elastic (luego automatizado como *arranque suave*), ARC de ZFS limitado,
  ajuste de memoria de las VMs. La causa del apagón apuntó a energía/hardware (registro cortado en seco).

## Problemas de configuración que enseñaron algo

| Código | Síntoma | Causa raíz | Corrección |
|---|---|---|---|
| B2-01 | `lvextend -r` dijo «éxito» pero el disco seguía al 100 % | Sin espacio, LVM no pudo escribir sus metadatos y revirtió | Liberar espacio primero y repetir |
| B2-04 | Dos servidores respondían el mismo dominio | Un clon tenía el mismo token de túnel y `unless-stopped` lo revivía | Perfiles de Compose y un conector por túnel |
| B2-05 | Wiki.js expuesto en `0.0.0.0` con la contraseña del ejemplo | Docker antepone sus reglas a UFW | Puerto ligado a la LAN, contraseña aleatoria, reglas `DOCKER-USER` |
| B2-06 | Elasticsearch no leía sus certificados | En la imagen oficial el proceso corre como `1000:0`, no `1000:1000` | `chown 1000:0` y permisos 640 |
| B2-11/18 | GLPI y Heartbeat en bucle `exit 126` | Con `cap_drop: ALL`, un binario con *file capabilities* no puede ejecutarse | Devolver solo la capacidad necesaria |
| B2-13 | La malla pasó de 150 ms a **6 s** de RTT | Filebeat empezó a enviar 1,3 GB de journal histórico | Primer arranque limitado a 24 h |
| B2-16 | Cortes en un solo sentido entre sitios | El demonio WARP se colgaba por presión de memoria en pve-02 | `swappiness`, journal limitado, watchdog del conector |
| B2-20 | El token de API de GLPI no funcionaba escrito en la BD | GLPI 11 cifra los tokens con su clave | Cifrar igual que GLPI (libsodium) leyendo su código fuente |
| B2-31 | Un nodo dejó de enviar logs 3 días | Pila CMOS agotada: arrancó con fecha de abril y todos los certificados «aún no eran válidos» | Hora corregida y guardada en el RTC; alerta de desfase de reloj |
| B2-33 | Tickets que se abrían y cerraban en 30 s | Un solo ping perdido abría un incidente | `max(icmpping,3m)=0` |
| B2-36 | Los tickets no pasaban a «Resuelto» | El seguimiento se añadía después de resolver y GLPI reabría | Primero el seguimiento, después el estado |
| B2-38 | Las VMs tenían IPv6 pública del ISP | SLAAC aceptado por defecto | IPv6 desactivado en tres capas |
| B2-46 | Sin acceso a las consolas de Proxmox tras un failover | Sus conectores vivían dentro de VMs con HA | Conector propio en cada hipervisor |
| B2-49 | El índice de tickets quedó en 0 documentos | El sincronizador borraba por diferencia con un export vacío | Purga solo si el export trae datos y el `_bulk` no falló |
| B2-50 | No había ningún respaldo programado | Nunca se creó el trabajo | Respaldo semanal con `bwlimit` |
| B2-53 | GLPI dejó de enviar correos 5 días (772 en cola) | Un envío SMTP colgado dejó la tarea «ejecutándose» para siempre | Vigilante que desbloquea tareas colgadas |
| B2-54 | Zabbix cerraba la sesión cada poco | Un LXC clonado duplicaba el conector del túnel | Conector desactivado en el clon |

## Lecciones transversales

1. **Las alertas deben vivir fuera de lo que vigilan** y no depender de un solo canal.
2. **Probar el failover de verdad** (y con plan de contención): dos de los fallos más graves solo aparecieron así.
3. **Un enlace lento cambia todas las decisiones**: migraciones, respaldos, logs y quórum.
4. **Clonar una VM clona sus identidades** (tokens de túnel, hostnames): hay que limpiarlas.
5. **Nada que borre por diferencia sin validar el origen.**
6. **Documentar cada cambio con causa y reversión**: esta bitácora permitió recuperar cada caída sin perder datos.
