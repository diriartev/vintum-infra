#!/bin/bash
# Sincroniza los tickets de GLPI hacia Elasticsearch (índice glpi-tickets). Idempotente (id del documento = id del ticket) y elimina los tickets que ya no existen en GLPI.
#
# Salvaguarda (14-oct-2026, incidencia B2-49): la purga SOLO se ejecuta si el export trajo
# al menos un ticket y el bulk no devolvió errores. Antes, si GLPI respondía pero su base de
# datos no (p. ej. db1 en el otro nodo durante un failover), el export salía sin tickets, la
# lista de ids quedaba vacía y el `must_not ids:[]` borraba el índice entero (pasó: 356 docs).
exec 9>/run/vintum-glpi-sync.lock; flock -n 9 || exit 0
. /etc/vintum/glpi-sync.env
OUT=$(docker exec -i glpi sh -c 'cat > ./vsync.php; php ./vsync.php; rm -f ./vsync.php' < /usr/local/lib/vintum/glpi-export.php 2>/dev/null)
[ -z "$OUT" ] && { echo "export vacío"; exit 1; }
N=$(printf '%s\n' "$OUT" | grep -c '^{"index"')
if [ "$N" -eq 0 ]; then
  echo "export sin tickets ($N): no se indexa ni se purga nada (¿GLPI sin base de datos?)"
  exit 1
fi
RES=$(printf '%s\n' "$OUT" | curl -sk --max-time 60 -X POST "$ES_URL/_bulk" -H "Authorization: ApiKey $ES_KEY" -H 'Content-Type: application/x-ndjson' --data-binary @-)
ERRORES=$(echo "$RES" | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: print("si"); sys.exit()
print("si" if d.get("errors") or not d.get("items") else "no")' 2>/dev/null)
echo "$RES" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("sync glpi->elastic: docs=%d errores=%s"%(len(d.get("items",[])),d.get("errors")))' 2>&1
if [ "$ERRORES" != "no" ]; then
  echo "el bulk falló o vino incompleto: no se purga nada"
  exit 1
fi
IDS=$(printf '%s\n' "$OUT" | python3 -c 'import sys,json
ids=[]
for l in sys.stdin:
    l=l.strip()
    if l.startswith("{\"index\""): ids.append(str(json.loads(l)["index"]["_id"]))
print(json.dumps(ids))')
curl -sk --max-time 60 -X POST "$ES_URL/glpi-tickets/_delete_by_query?conflicts=proceed" -H "Authorization: ApiKey $ES_KEY" -H 'Content-Type: application/json' -d "{\"query\":{\"bool\":{\"must_not\":{\"ids\":{\"values\":$IDS}}}}}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("eliminados de Elastic (ya no existen en GLPI):",d.get("deleted",d))'
