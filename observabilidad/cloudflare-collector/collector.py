#!/usr/bin/env python3
"""Recolector Cloudflare -> NDJSON (ECS) para Filebeat/Elasticsearch — Vintum Bloque 2.
Fuentes (plan Free, token de solo lectura):
  cloudflare.tunnel       estado de los túneles (cada 60 s)
  cloudflare.access       logins de Cloudflare Access (Zero Trust; Cloudflare Free solo retiene 24 h)
  cloudflare.audit        registro de auditoría de la cuenta (cambios de configuración)
  cloudflare.security     eventos del firewall/WAF/Bot Fight (GraphQL firewallEventsAdaptive)
  cloudflare.http         tráfico del borde agregado cada 5 min (GraphQL httpRequestsAdaptiveGroups)
  cloudflare.http_hourly  resumen horario: peticiones, caché, amenazas, visitantes únicos (httpRequests1hGroups)
Cursores y deduplicación en /state/state.json; salida diaria en /data/cloudflare-AAAAMMDD.ndjson."""
import json, os, time, datetime as dt, urllib.request, urllib.parse, glob, sys
TOKEN=os.environ["CF_API_TOKEN"]; ACC=os.environ["CF_ACCOUNT_ID"]; ZONE=os.environ["CF_ZONE_ID"]
API="https://api.cloudflare.com/client/v4"; STATE="/state/state.json"; OUT="/data"; BACKFILL_H=int(os.environ.get("BACKFILL_HOURS","70"))
UTC=dt.timezone.utc
def now(): return dt.datetime.now(UTC).replace(microsecond=0)
def iso(t): return t.strftime("%Y-%m-%dT%H:%M:%SZ")
def parse(s): return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
def log(*a): print(time.strftime("%H:%M:%S"),*a,flush=True)
def http(method,url,body=None):
    req=urllib.request.Request(url,data=json.dumps(body).encode() if body else None,method=method,headers={"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=40) as r: return json.load(r)
def gql(q):
    d=http("POST",API+"/graphql",{"query":q})
    if d.get("errors"): raise RuntimeError(d["errors"][0]["message"][:200])
    return d["data"]["viewer"]["zones"][0]
def load():
    try: return json.load(open(STATE))
    except Exception: return {}
def save(st): json.dump(st,open(STATE+".tmp","w")); os.replace(STATE+".tmp",STATE)
def emit(docs):
    if not docs: return
    with open(f"{OUT}/cloudflare-{now():%Y%m%d}.ndjson","a") as f:
        for d in docs: d.setdefault("event",{})["module"]="cloudflare"; d["labels"]={"proyecto":"vintum","origen":"cloudflare-api"}; f.write(json.dumps(d,ensure_ascii=False)+"\n")
def seen(st,key,ids,keep=3000):
    s=st.setdefault(key,[]); new=[i for i in ids if i not in s]; s.extend(new); del s[:-keep]; return set(new)

def tunnels(st):
    r=http("GET",f"{API}/accounts/{ACC}/cfd_tunnel?is_deleted=false&per_page=50")["result"]; t=iso(now())
    emit([{"@timestamp":t,"event":{"dataset":"cloudflare.tunnel","kind":"state","outcome":"success" if x["status"]=="healthy" else "failure"},
           "cloudflare":{"tunnel":{"name":x["name"],"id":x["id"],"status":x["status"],"connections":len(x.get("connections") or []),
           "colos":sorted({c["colo_name"] for c in x.get("connections") or []}),"origin_ips":sorted({c.get("origin_ip","") for c in x.get("connections") or []})}}} for x in r])
def access(st):
    r=http("GET",f"{API}/accounts/{ACC}/access/logs/access_requests")["result"] or []
    new=seen(st,"access_ids",[x.get("ray_id") or x["created_at"]+x.get("user_email","") for x in r])
    emit([{"@timestamp":x["created_at"],"event":{"dataset":"cloudflare.access","kind":"event","category":["authentication"],"action":x.get("action","login"),
           "outcome":"success" if x.get("allowed") else "failure"},"user":{"email":x.get("user_email")},"url":{"domain":x.get("app_domain")},
           "source":{"ip":x.get("ip_address"),"geo":{"country_iso_code":(x.get("country") or "").upper()}},
           "cloudflare":{"access":{"ray_id":x.get("ray_id"),"app_uid":x.get("app_uid"),"connection":x.get("connection"),"allowed":x.get("allowed")}}}
          for x in r if (x.get("ray_id") or x["created_at"]+x.get("user_email","")) in new])
def audit(st):
    since=st.get("audit_since",iso(now()-dt.timedelta(hours=BACKFILL_H)))
    r=http("GET",f"{API}/accounts/{ACC}/audit_logs?per_page=200&direction=asc&since={urllib.parse.quote(since)}")["result"] or []
    new=seen(st,"audit_ids",[x["id"] for x in r])
    emit([{"@timestamp":x["when"],"event":{"dataset":"cloudflare.audit","kind":"event","category":["configuration"],"action":x["action"]["type"],
           "outcome":"success" if x["action"].get("result") else "failure"},"user":{"email":(x.get("actor") or {}).get("email")},
           "source":{"ip":(x.get("actor") or {}).get("ip")},"cloudflare":{"audit":{"id":x["id"],"resource_type":(x.get("resource") or {}).get("type"),
           "resource_id":(x.get("resource") or {}).get("id"),"interface":x.get("interface")}}} for x in r if x["id"] in new])
    if r: st["audit_since"]=r[-1]["when"]
def security(st):
    since=st.get("sec_since",iso(now()-dt.timedelta(hours=BACKFILL_H))); until=iso(now())
    q=f'{{viewer{{zones(filter:{{zoneTag:"{ZONE}"}}){{firewallEventsAdaptive(limit:1000,filter:{{datetime_geq:"{since}",datetime_leq:"{until}"}},orderBy:[datetime_ASC]){{datetime action source rayName clientIP clientCountryName clientASNDescription clientRequestHTTPHost clientRequestHTTPMethodName clientRequestPath clientRequestQuery userAgent ruleId edgeResponseStatus}}}}}}}}'
    r=gql(q)["firewallEventsAdaptive"]; new=seen(st,"sec_ids",[x["rayName"]+x["datetime"] for x in r],5000)
    emit([{"@timestamp":x["datetime"],"event":{"dataset":"cloudflare.security","kind":"alert" if x["action"] in ("block","drop") else "event","category":["network","intrusion_detection"],
           "action":x["action"],"outcome":"failure" if x["action"] in ("block","drop","managed_challenge","challenge","jschallenge") else "success"},
           "rule":{"id":x["ruleId"],"ruleset":x["source"]},"source":{"ip":x["clientIP"],"geo":{"country_iso_code":x["clientCountryName"]},"as":{"organization":{"name":x["clientASNDescription"]}}},
           "url":{"domain":x["clientRequestHTTPHost"],"path":x["clientRequestPath"],"query":x["clientRequestQuery"] or None},"http":{"request":{"method":x["clientRequestHTTPMethodName"]},"response":{"status_code":x["edgeResponseStatus"]}},
           "user_agent":{"original":x["userAgent"]},"cloudflare":{"ray_id":x["rayName"]}} for x in r if x["rayName"]+x["datetime"] in new])
    if r: st["sec_since"]=r[-1]["datetime"]
def http5m(st):
    end=now().replace(second=0); end=end-dt.timedelta(minutes=end.minute%5)-dt.timedelta(minutes=5)   # ventana cerrada (Cloudflare consolida con retraso)
    start=parse(st.get("http_since",iso(end-dt.timedelta(hours=BACKFILL_H))))
    while start<end:
        stop=min(end,start+dt.timedelta(hours=12))
        q=f'{{viewer{{zones(filter:{{zoneTag:"{ZONE}"}}){{httpRequestsAdaptiveGroups(limit:10000,filter:{{datetime_geq:"{iso(start)}",datetime_lt:"{iso(stop)}"}}){{count sum{{edgeResponseBytes}} avg{{sampleInterval}} dimensions{{datetimeFiveMinutes clientRequestHTTPHost edgeResponseStatus clientCountryName cacheStatus clientRequestHTTPMethodName}}}}}}}}}}'
        r=gql(q)["httpRequestsAdaptiveGroups"]; d=[]
        for x in r:
            m=x["dimensions"]; n=round(x["count"]*(x["avg"]["sampleInterval"] or 1))
            d.append({"@timestamp":m["datetimeFiveMinutes"],"event":{"dataset":"cloudflare.http","kind":"metric"},"url":{"domain":m["clientRequestHTTPHost"]},
                      "http":{"request":{"method":m["clientRequestHTTPMethodName"]},"response":{"status_code":m["edgeResponseStatus"]}},"source":{"geo":{"country_iso_code":m["clientCountryName"]}},
                      "cloudflare":{"cache_status":m["cacheStatus"],"requests":n,"bytes":x["sum"]["edgeResponseBytes"]}})
        emit(d); st["http_since"]=iso(stop); start=stop; save(st)
def hourly(st):
    end=now().replace(minute=0,second=0); start=parse(st.get("hour_since",iso(end-dt.timedelta(hours=min(BACKFILL_H,70)))))
    if start>=end: return
    q=f'{{viewer{{zones(filter:{{zoneTag:"{ZONE}"}}){{httpRequests1hGroups(limit:100,filter:{{datetime_geq:"{iso(start)}",datetime_lt:"{iso(end)}"}}){{dimensions{{datetime}} sum{{requests cachedRequests threats bytes cachedBytes encryptedRequests pageViews}} uniq{{uniques}}}}}}}}}}'
    emit([{"@timestamp":x["dimensions"]["datetime"],"event":{"dataset":"cloudflare.http_hourly","kind":"metric"},
           "cloudflare":{"hourly":{"requests":x["sum"]["requests"],"cached_requests":x["sum"]["cachedRequests"],"threats":x["sum"]["threats"],"bytes":x["sum"]["bytes"],
           "cached_bytes":x["sum"]["cachedBytes"],"encrypted_requests":x["sum"]["encryptedRequests"],"page_views":x["sum"]["pageViews"],"uniques":x["uniq"]["uniques"]}}}
          for x in gql(q)["httpRequests1hGroups"]])
    st["hour_since"]=iso(end)
def cleanup():
    for f in glob.glob(f"{OUT}/cloudflare-*.ndjson"):
        if os.path.getmtime(f)<time.time()-5*86400: os.remove(f)

JOBS=[("tunnels",tunnels,60),("access",access,120),("audit",audit,300),("security",security,120),("http",http5m,300),("hourly",hourly,1800)]
if __name__=="__main__":
    st=load(); last={}
    log("recolector iniciado; backfill",BACKFILL_H,"h")
    while True:
        for name,fn,every in JOBS:
            if time.time()-last.get(name,0)>=every:
                try: fn(st); save(st); last[name]=time.time()
                except Exception as e: log("ERROR",name,type(e).__name__,str(e)[:200]); last[name]=time.time()-every+60
        cleanup(); time.sleep(15)
