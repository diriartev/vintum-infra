# Seguridad

## Modelo Zero Trust

- **Ningún puerto abierto** en ningún router: los servicios salen por túneles de Cloudflare y los sitios se unen
  por WARP Connector.
- **Cloudflare Access** delante de cada panel (GLPI, Kibana, Zabbix, Portainer, Homarr, Wiki, Wazuh, Proxmox) y
  del SSH; los servicios máquina a máquina usan **tokens de servicio**.
- Un solo conector por túnel y conectores propios para el plano de gestión.

## Aplicación

| Control | Implementación (ver `app/`) |
|---|---|
| Segundo factor | Código por correo **obligatorio** en el registro y en cada inicio de sesión; la sesión solo nace tras verificar el código |
| Sesiones | Identificadores opacos de 256 bits guardados en el servidor (sin JWT), cookies `HttpOnly`/`Secure`/`SameSite`, CSRF |
| Enumeración de cuentas | Misma respuesta y mismo código para cuentas existentes e inexistentes (login y recuperación) |
| Fuerza bruta | Límite de intentos (`429`) + detección en Kibana |
| SSRF / XSS | `safeHttpUrl`: solo http/https, sin credenciales ni esquemas peligrosos; validado en front **y** servidor |
| Base de datos | MariaDB con **TLS mutuo** y usuarios limitados por IP |
| Borde | nginx con CSP, HSTS, COOP y Permissions-Policy |

## Infraestructura

| Área | Antes | Después |
|---|---|---|
| SSH | root con contraseña en hipervisores y LXC | **Solo llave** en 8 equipos, `MaxAuthTries 3`, sin X11 |
| Proxmox | contraseña predecible | Contraseñas aleatorias por nodo |
| Wazuh | 5 cuentas con contraseña de fábrica; API expuesta en `0.0.0.0` | Rotadas, cuentas demo eliminadas, API e indexer solo en localhost |
| Wiki.js | Puerto en `0.0.0.0` con la contraseña del ejemplo oficial | Ligado a la LAN y contraseña aleatoria |
| Contenedores | — | `cap_drop: ALL`, devolviendo solo la capacidad necesaria (`NET_BIND_SERVICE`, `NET_RAW`) |
| Docker vs. firewall | Docker antepone sus reglas a UFW | Reglas en `DOCKER-USER` (`*/ufw-after.rules-DOCKER-USER.txt`) |
| IPv6 | Las VMs recibían IPv6 pública del ISP por SLAAC | Desactivado en VMs y LXC (el proyecto no lo usa) |
| Zona DNS | SSL `full`, HSTS sin subdominios, sin SPF/DMARC/CAA | SSL `strict`, HSTS 1 año + subdominios, SPF `-all`, DMARC `reject`, CAA |

## Verificación

- `seguridad/scan_vintum.py`: escáner propio no destructivo (cabeceras, TLS, enumeración de cuentas, bypass de
  2FA, SSRF/XSS en buscadores y RSS). Las credenciales de prueba se pasan por variables de entorno.
- 89 comprobaciones automáticas de solo lectura sobre toda la plataforma (túneles, Access, nodos, SDN, servicios,
  colas de correo, bot).
- Análisis forense documentado de un incidente de acceso (INC-2026-09-25-01): cuatro fuentes de evidencia,
  volcado con hash y cierre con causa raíz (no hubo compromiso).

## Secretos

Ningún secreto vive en este repositorio: los scripts los leen de variables de entorno o de archivos `600`
fuera del árbol del proyecto; los tokens del bot y del relay viven como secretos del Worker de Cloudflare.
