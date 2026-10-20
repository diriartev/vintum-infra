# Generador del dashboard "Vintum — Centro de operaciones" (v2). Salida: dashboard-vintum-objetos.json
import json
LOGS,UP="vintum-logs","vintum-uptime"
GREEN,RED,YEL,BLUE,ORG,DRED,GREY="#54B399","#E7664C","#D6BF57","#6092C0","#DA8B45","#BD271E","#98A2B3"
objs=[]
def C(op,label,**kw):
    c={"label":label,"customLabel":True,"operationType":op,"isBucketed":False,"scale":"ratio","dataType":"number"}; c.update(kw); return c
def cnt(label,kql=None):
    c=C("count",label,sourceField="___records___")
    if kql: c["filter"]={"query":kql,"language":"kuery"}
    return c
def dh(): return {"label":"Hora","customLabel":True,"dataType":"date","operationType":"date_histogram","sourceField":"@timestamp","isBucketed":True,"scale":"interval","params":{"interval":"auto","includeEmptyRows":True,"dropPartials":False}}
def terms(f,label,order,size=10,dtype="string",other=False,missing=False):
    return {"label":label,"customLabel":True,"dataType":dtype,"operationType":"terms","sourceField":f,"isBucketed":True,"scale":"ordinal",
            "params":{"size":size,"orderBy":{"type":"column","columnId":order},"orderDirection":"desc","otherBucket":other,"missingBucket":missing,"parentFormat":{"id":"terms"}}}
def pal(stops):  # stops=[(desde,color),...] continuo hacia arriba
    cs=[{"color":c,"stop":s} for s,c in stops]; ends=[{"color":c,"stop":(stops[i+1][0] if i+1<len(stops) else stops[i][0]+1)} for i,(s,c) in enumerate(stops)]
    return {"type":"palette","name":"custom","params":{"name":"custom","reverse":False,"rangeType":"number","rangeMin":stops[0][0],"rangeMax":None,"progression":"fixed","continuity":"above","maxSteps":5,"steps":len(stops),"colorStops":cs,"stops":ends}}
def cmap(assign):  # asignaciones de color categórico
    return {"assignments":[{"rules":[{"type":"raw","value":v}],"color":{"type":"colorCode","colorCode":c},"touched":True} for v,c in assign],
            "specialAssignments":[{"rules":[{"type":"other"}],"color":{"type":"loop"},"touched":False}],"paletteId":"eui_amsterdam_color_blind","colorMode":{"type":"categorical"}}
def lens(id,title,vtype,dv,cols,order,vis,query="",desc=""):
    objs.append({"type":"lens","id":id,"attributes":{"title":title,"description":desc,"visualizationType":vtype,
      "state":{"datasourceStates":{"formBased":{"layers":{"L1":{"columns":cols,"columnOrder":order,"incompleteColumns":{}}}}},
               "visualization":vis("L1"),"query":{"query":query,"language":"kuery"},"filters":[],"adHocDataViews":{},"internalReferences":[]}},
      "references":[{"type":"index-pattern","id":dv,"name":"indexpattern-datasource-layer-L1"}]})
def metric(c,palette=None,color=None,sub=None):
    def v(L):
        d={"layerId":L,"layerType":"data","metricAccessor":c,"showBar":False,"titlesTextAlign":"left","valuesTextAlign":"right"}
        if palette: d["palette"]=palette
        if color: d["color"]=color
        if sub: d["subtitle"]=sub
        return d
    return v
def xy(x,y,split=None,series="bar_stacked",ytitle="",colors=None,legend="right"):
    def v(L):
        lay={"layerId":L,"layerType":"data","accessors":[y],"position":"top","seriesType":series,"showGridlines":False,"xAccessor":x}
        if split: lay["splitAccessor"]=split
        if colors: lay["colorMapping"]=cmap(colors)
        return {"legend":{"isVisible":True,"position":legend,"shouldTruncate":True,"maxLines":1},"valueLabels":"hide","fittingFunction":"Linear","preferredSeriesType":series,
                "axisTitlesVisibilitySettings":{"x":False,"yLeft":True,"yRight":True},"yTitle":ytitle,"xTitle":"","gridlinesVisibilitySettings":{"x":False,"yLeft":True,"yRight":True},
                "curveType":"CURVE_MONOTONE_X","layers":[lay]}
    return v
def table(cols,cfg={}):
    return lambda L:{"layerId":L,"layerType":"data","rowHeight":"single","headerRowHeight":"auto","paging":{"size":10,"enabled":True},
                     "columns":[dict({"columnId":c,"isTransposed":False},**cfg.get(c,{})) for c in cols]}
def pie(g,m,colors=None,shape="donut"):
    def v(L):
        lay={"layerId":L,"layerType":"data","primaryGroups":[g],"metrics":[m],"numberDisplay":"value","categoryDisplay":"default","legendDisplay":"show","nestedLegend":False,"legendPosition":"right"}
        if colors: lay["colorMapping"]=cmap(colors)
        return {"shape":shape,"layers":[lay]}
    return v
def md(id,text): objs.append({"type":"visualization","id":id,"attributes":{"title":"","visState":json.dumps({"title":"","type":"markdown","params":{"markdown":text,"fontSize":11,"openLinksInNewTab":True},"aggs":[]}),"uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{}"}},"references":[]})

MS={"id":"duration","params":{"decimals":0,"fromUnit":"microseconds","toUnit":"asMilliseconds"}}
PCT={"id":"percent","params":{"decimals":1}}
AUTHFAIL='(event.dataset:system.auth and (event.outcome:failure or message:"invalid user" or message:"Failed password")) or message:"authentication failure"'
SUSP='event.dataset:nginx.access and (url.original:*.env* or url.original:*wp-* or url.original:*.git* or url.original:*phpmyadmin* or url.original:*xmlrpc* or url.original:*/cgi-bin/* or url.original:*.php*)'
HTTPC=[("200",GREEN),("204",GREEN),("301",BLUE),("302",BLUE),("304",BLUE),("400",YEL),("401",ORG),("403",ORG),("404",YEL),("409",YEL),("429",ORG),("500",RED),("502",RED),("503",RED),("504",RED)]
SEVC=[("Information",BLUE),("Warning",YEL),("Average",ORG),("High",RED),("Disaster",DRED),("Not classified",GREY)]
ZERO_OK=pal([(0,GREEN),(1,RED)])

# ---------- Fila KPI ----------
lens("vintum-kpi-peticiones","Peticiones web","lnsMetric",LOGS,{"c":cnt("Peticiones web")},["c"],metric("c",color=BLUE,sub="web.vintum.example"),"event.dataset:nginx.access")
lens("vintum-kpi-visitantes","Visitantes únicos","lnsMetric",LOGS,{"c":C("unique_count","Visitantes únicos",sourceField="source.address")},["c"],metric("c",color=BLUE,sub="IPs de origen reales"),"event.dataset:nginx.access")
lens("vintum-kpi-disponibilidad","Disponibilidad","lnsMetric",UP,{"c":C("average","Disponibilidad",sourceField="summary.up",params={"format":PCT})},["c"],metric("c",palette=pal([(0,RED),(0.95,YEL),(0.99,GREEN)]),sub="12 servicios · Heartbeat"),"")
lens("vintum-kpi-caidos","Sondas fallidas","lnsMetric",UP,{"c":cnt("Sondas fallidas")},["c"],metric("c",palette=ZERO_OK,sub="en el periodo"),"monitor.status:down")
lens("vintum-kpi-authfail","Autenticaciones fallidas","lnsMetric",LOGS,{"c":cnt("Autenticaciones fallidas")},["c"],metric("c",palette=ZERO_OK,sub="SSH / sistema"),AUTHFAIL)
lens("vintum-kpi-zabbix","Problemas Zabbix","lnsMetric",LOGS,{"c":cnt("Problemas Zabbix")},["c"],metric("c",palette=pal([(0,GREEN),(1,YEL),(10,RED)]),sub="triggers disparados"),"event.dataset:zabbix.events and event.action:trigger-problema")
# ---------- Estado ----------
lens("vintum-estado-servicios","Estado de los servicios","lnsDatatable",UP,
  {"n":terms("monitor.name","Servicio","d",20),"s":{"label":"Último estado","customLabel":True,"dataType":"string","operationType":"last_value","sourceField":"monitor.status","isBucketed":False,"scale":"ordinal","params":{"sortField":"@timestamp"}},
   "d":C("average","Disponibilidad",sourceField="summary.up",params={"format":PCT}),"t":C("average","Latencia media",sourceField="monitor.duration.us",params={"format":MS})},
  ["n","s","d","t"],table(["n","s","d","t"],{"d":{"colorMode":"cell","palette":pal([(0,RED),(0.95,YEL),(0.99,GREEN)])},"t":{"colorMode":"text","palette":pal([(0,GREEN),(300000,YEL),(1000000,RED)])}}),"")
lens("vintum-disponibilidad-tiempo","Comprobaciones por estado","lnsXY",UP,{"x":dh(),"y":cnt("Comprobaciones"),"s":terms("monitor.status","Estado","y",3)},["x","s","y"],
  xy("x","y","s","bar_stacked","Comprobaciones",[("up",GREEN),("down",RED)],"bottom"),"")
# ---------- Web ----------
lens("vintum-web-codigos","Peticiones por código HTTP","lnsXY",LOGS,{"x":dh(),"y":cnt("Peticiones"),"s":terms("http.response.status_code","Código HTTP","y",10,"number")},["x","s","y"],
  xy("x","y","s","bar_stacked","Peticiones",HTTPC,"right"),"event.dataset:nginx.access")
lens("vintum-web-ips","Top IPs de origen","lnsDatatable",LOGS,{"ip":terms("source.address","IP de origen (real)","c",10),"p":terms("source.geo.country_iso_code","País","c",1),"c":cnt("Peticiones")},["ip","p","c"],
  table(["ip","p","c"],{"ip":{"width":300}}),"event.dataset:nginx.access")
lens("vintum-web-rutas","Rutas más solicitadas","lnsDatatable",LOGS,{"u":terms("url.original","Ruta","c",10),"c":cnt("Peticiones")},["u","c"],table(["u","c"],{"u":{"width":380}}),
  "event.dataset:nginx.access and not url.original:/assets/* and not url.original:/avatars/*")
lens("vintum-web-paises","Peticiones por país","lnsPie",LOGS,{"g":terms("source.geo.country_iso_code","País","m",8,other=True),"m":cnt("Peticiones")},["g","m"],pie("g","m"),"event.dataset:nginx.access")
lens("vintum-web-sospechosas","Rutas sospechosas","lnsMetric",LOGS,{"c":cnt("Rutas sospechosas")},["c"],metric("c",palette=ZERO_OK,sub=".env, wp-*, .git, *.php…"),SUSP)
lens("vintum-web-5xx","Errores 5xx","lnsMetric",LOGS,{"c":cnt("Errores 5xx")},["c"],metric("c",palette=ZERO_OK,sub="respuestas del servidor"),"event.dataset:nginx.access and http.response.status_code >= 500")
# ---------- Seguridad ----------
lens("vintum-ssh-fallidos","Autenticaciones fallidas en el tiempo","lnsXY",LOGS,{"x":dh(),"y":cnt("Fallos"),"s":terms("host.name","Host","y",10)},["x","s","y"],xy("x","y","s","bar_stacked","Fallos",None,"right"),AUTHFAIL)
lens("vintum-auth-detalle","Detalle de autenticaciones fallidas","lnsDatatable",LOGS,{"h":terms("host.name","Host","c",10,missing=True),"u":terms("user.name","Usuario","c",5,missing=True),"i":terms("source.ip","IP de origen","c",5,"ip",missing=True),"c":cnt("Intentos")},["h","u","i","c"],
  table(["h","u","i","c"],{"c":{"colorMode":"text","palette":pal([(0,GREEN),(3,YEL),(10,RED)])}}),AUTHFAIL)
lens("vintum-pve-accesos","Accesos al panel de Proxmox (8006)","lnsDatatable",LOGS,{"u":terms("user.name","Usuario / token","c",10),"h":terms("host.name","Nodo","c",2),"o":terms("event.outcome","Resultado","c",2),"c":cnt("Peticiones")},["u","h","o","c"],
  table(["u","h","o","c"],{"u":{"width":260}}),"event.dataset:proxmox.pveproxy")
lens("vintum-db-denegados","MariaDB: accesos denegados","lnsMetric",LOGS,{"c":cnt("Accesos denegados")},["c"],metric("c",palette=ZERO_OK,sub="db1 · journald"),'event.dataset:mariadb.log and message:"Access denied"')
# ---------- Zabbix ----------
lens("vintum-zabbix-severidad","Problemas por severidad","lnsPie",LOGS,{"g":terms("zabbix.severity_name","Severidad","m",6),"m":cnt("Problemas")},["g","m"],pie("g","m",SEVC),"event.dataset:zabbix.events and event.action:trigger-problema")
lens("vintum-zabbix-problemas","Triggers disparados","lnsDatatable",LOGS,
  {"r":terms("rule.name","Trigger","c",20),"h":terms("zabbix.host","Host","c",3),"s":terms("zabbix.severity_name","Severidad","c",1),"c":cnt("Veces"),
   "l":{"label":"Último","customLabel":True,"dataType":"date","operationType":"max","sourceField":"@timestamp","isBucketed":False,"scale":"ratio"}},
  ["r","h","s","c","l"],table(["r","h","s","c","l"],{"r":{"width":420}}),"event.dataset:zabbix.events and event.action:trigger-problema")
lens("vintum-zabbix-tiempo","Problemas y recuperaciones en el tiempo","lnsXY",LOGS,{"x":dh(),"y":cnt("Eventos"),"s":terms("event.action","Tipo","y",2)},["x","s","y"],
  xy("x","y","s","bar_stacked","Eventos",[("trigger-problema",RED),("trigger-recuperacion",GREEN)],"bottom"),"event.dataset:zabbix.events")
# ---------- Infraestructura ----------
lens("vintum-logs-volumen","Volumen de eventos por host","lnsXY",LOGS,{"x":dh(),"y":cnt("Eventos"),"s":terms("host.name","Host","y",12)},["x","s","y"],xy("x","y","s","area_stacked","Eventos",None,"right"),
  "not event.dataset:zabbix.events and not event.dataset:zabbix.server_log")
lens("vintum-logs-fuentes","Eventos por tipo de fuente","lnsPie",LOGS,{"g":terms("event.dataset","Fuente","m",10,other=True),"m":cnt("Eventos")},["g","m"],pie("g","m"),"")

md("vintum-md-cabecera","""## 🛡️ Vintum — Centro de operaciones
**Métricas** (Zabbix) · **logs** (Filebeat → Elasticsearch) · **disponibilidad** (Heartbeat) en una sola vista — Bloque 2 · Gestión de Incidentes y Seguridad de Infraestructura I.
Sitio 1 `10.20.0.0/24` (nodo activo) · Sitio 2 `10.20.1.0/24` (respaldo) · mesh Cloudflare WARP · IP real de visitantes vía `CF-Connecting-IP` · retención 30 días.
➡️ [Velocímetros y gráficas de Zabbix (Mesh y Latencia)](/app/dashboards#/view/vintum-zabbix-mesh) · [Cloudflare: borde, WAF y Zero Trust](/app/dashboards#/view/vintum-cloudflare)""")
for sid,txt in [("s-estado","#### 🟢 Estado de los servicios"),("s-web","#### 🌐 Tráfico web — web.vintum.example"),("s-seg","#### 🔐 Seguridad y accesos"),("s-zbx","#### 📟 Alertas de Zabbix (métricas)"),("s-infra","#### 🗄️ Centralización de logs")]:
    md("vintum-md-"+sid,txt)

L=[("vintum-md-cabecera","visualization",0,0,48,5,True),
 ("vintum-kpi-peticiones","lens",0,5,8,6,True),("vintum-kpi-visitantes","lens",8,5,8,6,True),("vintum-kpi-disponibilidad","lens",16,5,8,6,True),
 ("vintum-kpi-caidos","lens",24,5,8,6,True),("vintum-kpi-authfail","lens",32,5,8,6,True),("vintum-kpi-zabbix","lens",40,5,8,6,True),
 ("vintum-md-s-estado","visualization",0,11,48,2,True),
 ("vintum-estado-servicios","lens",0,13,26,15,False),("vintum-disponibilidad-tiempo","lens",26,13,22,15,False),
 ("vintum-md-s-web","visualization",0,28,48,2,True),
 ("vintum-web-codigos","lens",0,30,30,13,False),("vintum-web-5xx","lens",30,30,8,6,True),("vintum-web-sospechosas","lens",30,36,8,7,True),("vintum-web-paises","lens",38,30,10,13,False),
 ("vintum-web-ips","lens",0,43,24,12,False),("vintum-web-rutas","lens",24,43,24,12,False),
 ("vintum-md-s-seg","visualization",0,55,48,2,True),
 ("vintum-ssh-fallidos","lens",0,57,24,12,False),("vintum-auth-detalle","lens",24,57,24,12,False),
 ("vintum-pve-accesos","lens",0,69,38,12,False),("vintum-db-denegados","lens",38,69,10,12,True),
 ("vintum-md-s-zbx","visualization",0,81,48,2,True),
 ("vintum-zabbix-severidad","lens",0,83,14,14,False),("vintum-zabbix-problemas","lens",14,83,34,14,False),
 ("vintum-zabbix-tiempo","lens",0,97,48,10,False),
 ("vintum-md-s-infra","visualization",0,107,48,2,True),
 ("vintum-logs-volumen","lens",0,109,32,12,False),("vintum-logs-fuentes","lens",32,109,16,12,False)]
panels=[];refs=[]
for i,(oid,t,x,y,w,h,hide) in enumerate(L):
    pi=f"p{i}"; ec={"enhancements":{}}
    if hide: ec["hidePanelTitles"]=True
    panels.append({"type":t,"panelIndex":pi,"gridData":{"x":x,"y":y,"w":w,"h":h,"i":pi},"panelRefName":f"panel_{pi}","embeddableConfig":ec})
    refs.append({"name":f"panel_{pi}","type":t,"id":oid})
objs.append({"type":"dashboard","id":"vintum-centro-operaciones","attributes":{"title":"Vintum — Centro de operaciones","description":"Bloque 2: estado de servicios, tráfico web, seguridad, alertas de Zabbix y centralización de logs",
  "panelsJSON":json.dumps(panels),"optionsJSON":json.dumps({"useMargins":True,"syncColors":False,"syncCursor":True,"syncTooltips":False,"hidePanelTitles":False}),
  "timeRestore":True,"timeFrom":"now-24h","timeTo":"now","refreshInterval":{"pause":False,"value":60000},
  "kibanaSavedObjectMeta":{"searchSourceJSON":json.dumps({"query":{"query":"","language":"kuery"},"filter":[]})}},"references":refs})
json.dump(objs,open("dashboard-vintum-objetos.json","w"),ensure_ascii=False,indent=1); print(len(objs),"objetos")
