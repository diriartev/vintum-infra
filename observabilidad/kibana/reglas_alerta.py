# Reglas de detección de Kibana (Bloque 2) → índice vintum-alertas → Zabbix → GLPI
import json,base64,urllib.request, os
KB="http://127.0.0.1:15601"; A="Basic "+base64.b64encode(("elastic:"+os.environ["ES_PASSWORD"]).encode()).decode()   # export ES_PASSWORD=... (nunca en el código)
def req(m,path,body=None):
    r=urllib.request.Request(KB+path,data=json.dumps(body).encode() if body is not None else None,method=m,headers={"Content-Type":"application/json","kbn-xsrf":"true","Authorization":A})
    return json.load(urllib.request.urlopen(r,timeout=60))
cid=next(c["id"] for c in req("GET","/api/actions/connectors") if c["name"]=="Vintum · índice de alertas")
HIT_IP_HOST="{{#context.hits}}{{_source.source.address}}{{_source.source.ip}}@{{_source.host.name}} {{/context.hits}}"
RULES=[
 dict(slug="bf_web",name="Vintum · fuerza bruta contra el login web",idx=["filebeat-*"],win=5,thr=4,grupo=HIT_IP_HOST,
      q={"bool":{"filter":[{"term":{"event.dataset":"nginx.access"}},{"term":{"url.original":"/api/auth/login"}},{"terms":{"http.response.status_code":[401,429]}}]}}),
 dict(slug="bf_ssh",name="Vintum · fuerza bruta SSH / autenticación de sistema",idx=["filebeat-*"],win=5,thr=4,grupo=HIT_IP_HOST,
      q={"bool":{"filter":[{"term":{"event.dataset":"system.auth"}}],"should":[{"term":{"event.outcome":"failure"}},{"match_phrase":{"message":"invalid user"}},{"match_phrase":{"message":"Failed password"}},{"match_phrase":{"message":"authentication failure"}}],"minimum_should_match":1}}),
 dict(slug="servicio",name="Vintum · servicio caído (Heartbeat)",idx=["heartbeat-*"],win=5,thr=1,grupo="{{#context.hits}}{{_source.monitor.name}}@{{_source.url.full}} {{/context.hits}}",
      q={"bool":{"filter":[{"term":{"monitor.status":"down"}}]}}),
 dict(slug="tunel",name="Vintum · túnel de Cloudflare degradado o caído",idx=["filebeat-*"],win=5,thr=1,grupo="{{#context.hits}}{{_source.cloudflare.tunnel.name}}@{{_source.cloudflare.tunnel.status}} {{/context.hits}}",
      q={"bool":{"filter":[{"term":{"event.dataset":"cloudflare.tunnel"}}],"must_not":[{"term":{"cloudflare.tunnel.status":"healthy"}}]}}),
 dict(slug="borde",name="Vintum · ataque en el borde de Cloudflare (ráfaga)",idx=["filebeat-*"],win=15,thr=14,grupo="{{#context.hits}}{{_source.source.ip}}@{{_source.url.path}} {{/context.hits}}",
      q={"bool":{"filter":[{"term":{"event.dataset":"cloudflare.security"}}]}}),
 dict(slug="access",name="Vintum · acceso denegado en Cloudflare Access",idx=["filebeat-*"],win=15,thr=0,grupo="{{#context.hits}}{{_source.source.ip}}@{{_source.user.email}} {{/context.hits}}",
      q={"bool":{"filter":[{"term":{"event.dataset":"cloudflare.access"}},{"term":{"event.outcome":"failure"}}]}}),
]
if __name__=="__main__":
    existing={r["name"]:r for r in req("GET","/api/alerting/rules/_find?per_page=100&search=Vintum")["data"]}
    for r in RULES:
        doc={"documents":[{"@timestamp":"{{context.date}}","regla":r["name"],"slug":r["slug"],"severidad":"alta","grupo":r["grupo"],"valor":"{{context.value}}","conclusion":"{{context.conditions}}","enlace":"{{context.link}}"}]}
        body={"name":r["name"],"tags":["vintum","bloque2","ticket-glpi",r["slug"]],"schedule":{"interval":"1m"},
              "params":{"searchType":"esQuery","esQuery":json.dumps({"query":r["q"]}),"index":r["idx"],"timeField":"@timestamp","size":20,
                        "threshold":[r["thr"]],"thresholdComparator":">","timeWindowSize":r["win"],"timeWindowUnit":"m","excludeHitsFromPreviousRun":True,"aggType":"count","groupBy":"all"},
              "actions":[{"group":"query matched","id":cid,"params":doc,"frequency":{"summary":False,"notify_when":"onActionGroupChange","throttle":None}}]}
        if r["name"] in existing: req("PUT",f"/api/alerting/rule/{existing[r['name']]['id']}",body); print("actualizada:",r["name"])
        else: body.update({"rule_type_id":".es-query","consumer":"stackAlerts","enabled":True}); print("creada:",r["name"],req("POST","/api/alerting/rule",body)["id"])
    json.dump([{k:r[k] for k in ("slug","name")} for r in RULES],open("reglas_slugs.json","w"),ensure_ascii=False)
