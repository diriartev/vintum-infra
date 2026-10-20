# Observabilidad y respuesta a incidentes

## Fuentes

| Herramienta | Qué mide | Archivos |
|---|---|---|
| **Zabbix** server + proxy por sitio | Métricas de hosts y VMs, Proxmox por API, escenario web, ICMP de la malla, desfase de reloj, SMART | `observabilidad/zabbix/` |
| **Filebeat** en cada host | auth.log, journald, nginx, Docker | `observabilidad/filebeat/` |
| **Heartbeat** | Disponibilidad HTTP de cada servicio | `observabilidad/heartbeat/` |
| **Colector de Cloudflare** (Python) | Eventos del WAF, accesos de Access, auditoría, estado de túneles y tráfico | `observabilidad/cloudflare-collector/` |
| **Wazuh** | Integridad, reglas de host y alertas de seguridad (agentes en 7 equipos) | — |

## Kibana como código

- `gen_dashboard_v2.py`, `gen_dashboard_zabbix.py`, `gen_dashboard_cloudflare.py`: generan los dashboards
  (centro de operaciones, malla y latencia, borde de Cloudflare) por API, reproducibles.
- `reglas_alerta.py`: crea las reglas de detección (fuerza bruta web y SSH, servicio caído, túnel degradado,
  ráfaga de ataques en el WAF, acceso denegado en Access). Cada regla escribe en un índice de alertas que Zabbix
  vigila.

## Flujo de un incidente

```
Zabbix (métricas)  ─┐
Kibana (logs)  ─────┴─► trigger High ─► media type ─► ticket en GLPI (categoría + SLA)
                                         │                 ├─► correo al equipo
                                         │                 └─► espejo en Elastic (glpi-tickets)
                                         └─► al resolverse: seguimiento + estado "Resuelto" + cierre automático
Vigilantes de infraestructura (nodos) ──► glpi-ticket.sh ──► GLPI + Telegram (siempre, aunque GLPI esté caído)
```

| Situación | Detecta | SLA |
|---|---|---|
| Web o API caída, MariaDB detenida, Elasticsearch en rojo | Zabbix | Crítico |
| Malla perdida o sitio sin internet ≥ 3 min | Zabbix (ICMP) | Crítico |
| Servicio caído | Heartbeat → Kibana | Crítico |
| Túnel degradado | Colector de Cloudflare → Kibana | Crítico |
| Fuerza bruta web / SSH | Kibana | Crítico |
| Ráfaga de ataques en el borde (≥ 15 en 15 min) | Kibana (WAF) | Crítico |
| CPU, memoria o disco críticos | Zabbix | Normal |

**SLA crítico:** primera respuesta 30 min, resolución 4 h. **Normal:** 2 h / 1 día.

## Proceso (NIST SP 800-61)
1. **Tomar** el ticket (cuenta la primera respuesta).
2. **Analizar** en Kibana y Zabbix.
3. **Contener / corregir**, registrando cada acción como seguimiento.
4. **Verificar**: al recuperarse, el ticket se resuelve solo.
5. **Documentar** causa raíz y lección en la Wiki.

## Decisiones que redujeron el ruido
- Triggers de la malla con `max(icmpping,3m)=0` en vez de un solo ping perdido.
- Filebeat descarta las estadísticas de `warp-svc` (eran el 92 % de los documentos), pero conserva avisos y errores.
- Primer arranque de Filebeat limitado a las últimas 24 h del journal (enviar 1,3 GB saturó la malla: RTT de 150 ms a 6 s).
- Reglas locales de Wazuh (nivel 0) para eventos legítimos que se repetían.
