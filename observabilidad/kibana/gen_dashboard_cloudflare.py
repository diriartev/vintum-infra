# Dashboard "Vintum — Cloudflare (borde y Zero Trust)"
import json
LOGS="vintum-logs"; objs=[]
GREEN,RED,YEL,BLUE,ORG,GREY,PUR="#54B399","#E7664C","#D6BF57","#6092C0","#DA8B45","#98A2B3","#9170B8"
def C(op,label,**kw):
    c={"label":label,"customLabel":True,"operationType":op,"isBucketed":False,"scale":"ratio","dataType":"number"}; c.update(kw); return c
def cnt(label): return C("count",label,sourceField="___records___")
def sm(f,label,fmt=None):
    c=C("sum",label,sourceField=f,params={"emptyAsNull":False})
    if fmt: c["params"]["format"]=fmt
    return c
def dh(): return {"label":"Hora","customLabel":True,"dataType":"date","operationType":"date_histogram","sourceField":"@timestamp","isBucketed":True,"scale":"interval","params":{"interval":"auto","includeEmptyRows":True,"dropPartials":False}}
def terms(f,label,order,size=10,dtype="string",other=False):
    return {"label":label,"customLabel":True,"dataType":dtype,"operationType":"terms","sourceField":f,"isBucketed":True,"scale":"ordinal",
            "params":{"size":size,"orderBy":{"type":"column","columnId":order},"orderDirection":"desc","otherBucket":other,"missingBucket":False}}
def lastv(f,label,dtype="string"): return {"label":label,"customLabel":True,"dataType":dtype,"operationType":"last_value","sourceField":f,"isBucketed":False,"scale":"ordinal" if dtype=="string" else "ratio","params":{"sortField":"@timestamp","showArrayValues":True}}
def maxt(label): return {"label":label,"customLabel":True,"dataType":"date","operationType":"max","sourceField":"@timestamp","isBucketed":False,"scale":"ratio"}
def pal(stops):
    cs=[{"color":c,"stop":s} for s,c in stops]; ends=[{"color":c,"stop":(stops[i+1][0] if i+1<len(stops) else stops[i][0]+1)} for i,(s,c) in enumerate(stops)]
    return {"type":"palette","name":"custom","params":{"name":"custom","reverse":False,"rangeType":"number","rangeMin":stops[0][0],"rangeMax":None,"progression":"fixed","continuity":"above","maxSteps":5,"steps":len(stops),"colorStops":cs,"stops":ends}}
def cmap(a): return {"assignments":[{"rules":[{"type":"raw","value":v}],"color":{"type":"colorCode","colorCode":c},"touched":True} for v,c in a],
        "specialAssignments":[{"rules":[{"type":"other"}],"color":{"type":"loop"},"touched":False}],"paletteId":"eui_amsterdam_color_blind","colorMode":{"type":"categorical"}}
def lens(id,title,vtype,cols,order,vis,query):
    objs.append({"type":"lens","id":id,"attributes":{"title":title,"visualizationType":vtype,"state":{"datasourceStates":{"formBased":{"layers":{"L1":{"columns":cols,"columnOrder":order,"incompleteColumns":{}}}}},
      "visualization":vis("L1"),"query":{"query":query,"language":"kuery"},"filters":[],"adHocDataViews":{},"internalReferences":[]}},
      "references":[{"type":"index-pattern","id":LOGS,"name":"indexpattern-datasource-layer-L1"}]})
def metric(c,palette=None,color=None,sub=None):
    def v(L):
        d={"layerId":L,"layerType":"data","metricAccessor":c,"showBar":False}
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
        return {"legend":{"isVisible":True,"position":legend},"valueLabels":"hide","preferredSeriesType":series,"axisTitlesVisibilitySettings":{"x":False,"yLeft":True,"yRight":True},"yTitle":ytitle,"curveType":"CURVE_MONOTONE_X","layers":[lay]}
    return v
def table(cols,cfg={}): return lambda L:{"layerId":L,"layerType":"data","paging":{"size":10,"enabled":True},"columns":[dict({"columnId":c},**cfg.get(c,{})) for c in cols]}
def pie(g,m,colors=None):
    def v(L):
        lay={"layerId":L,"layerType":"data","primaryGroups":[g],"metrics":[m],"numberDisplay":"percent","categoryDisplay":"default","legendDisplay":"show","nestedLegend":False}
        if colors: lay["colorMapping"]=cmap(colors)
        return {"shape":"donut","layers":[lay]}
    return v
def md(id,text): objs.append({"type":"visualization","id":id,"attributes":{"title":"","visState":json.dumps({"title":"","type":"markdown","params":{"markdown":text,"fontSize":11,"openLinksInNewTab":True},"aggs":[]}),"uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{}"}},"references":[]})

HTTP="event.dataset:cloudflare.http"; SEC="event.dataset:cloudflare.security"; ACC="event.dataset:cloudflare.access"; TUN="event.dataset:cloudflare.tunnel"; AUD="event.dataset:cloudflare.audit"; HR="event.dataset:cloudflare.http_hourly"
ACTC=[("block",RED),("drop",RED),("managed_challenge",ORG),("challenge",ORG),("jschallenge",YEL),("log",GREY),("skip",GREY)]
HTTPC=[("200",GREEN),("204",GREEN),("206",GREEN),("301",BLUE),("302",BLUE),("304",BLUE),("400",YEL),("401",ORG),("403",RED),("404",YEL),("429",ORG),("500",RED),("502",RED),("503",RED),("530",RED)]
ZERO_OK=pal([(0,GREEN),(1,RED)])
# KPIs
lens("cf-kpi-req","Peticiones en el borde","lnsMetric",{"c":sm("cloudflare.hourly.requests","Peticiones en el borde")},["c"],metric("c",color=BLUE,sub="todas las zonas *.vintum.example"),HR)
lens("cf-kpi-cache","Servidas desde caché","lnsMetric",{"c":sm("cloudflare.hourly.cached_requests","Servidas desde caché")},["c"],metric("c",color=PUR,sub="no llegan al servidor"),HR)
lens("cf-kpi-block","Amenazas bloqueadas","lnsMetric",{"c":cnt("Amenazas bloqueadas")},["c"],metric("c",palette=ZERO_OK,sub="WAF / reglas administradas"),SEC+" and event.action:(block or drop)")
lens("cf-kpi-chal","Desafíos a bots","lnsMetric",{"c":cnt("Desafíos a bots")},["c"],metric("c",palette=pal([(0,GREEN),(1,YEL)]),sub="Bot Fight Mode / challenge"),SEC+" and event.action:(managed_challenge or challenge or jschallenge)")
lens("cf-kpi-accfail","Logins denegados (Access)","lnsMetric",{"c":cnt("Logins denegados")},["c"],metric("c",palette=ZERO_OK,sub="Zero Trust"),ACC+" and event.outcome:failure")
lens("cf-kpi-tun","Túneles degradados","lnsMetric",{"c":cnt("Comprobaciones no sanas")},["c"],metric("c",palette=ZERO_OK,sub="estado ≠ healthy en el periodo"),TUN+" and not cloudflare.tunnel.status:healthy")
# Borde
lens("cf-http-host","Peticiones en el borde por aplicación","lnsXY",{"x":dh(),"y":sm("cloudflare.requests","Peticiones"),"s":terms("url.domain","Aplicación","y",10)},["x","s","y"],xy("x","y","s","bar_stacked","Peticiones"),HTTP)
lens("cf-http-codes","Códigos de respuesta en el borde","lnsPie",{"g":terms("http.response.status_code","Código","m",10,"number",True),"m":sm("cloudflare.requests","Peticiones")},["g","m"],pie("g","m",HTTPC),HTTP)
lens("cf-http-cache","Estado de caché","lnsPie",{"g":terms("cloudflare.cache_status","Caché","m",6),"m":sm("cloudflare.requests","Peticiones")},["g","m"],pie("g","m",[("hit",GREEN),("dynamic",BLUE),("miss",YEL),("none",GREY),("revalidated",PUR)]),HTTP)
lens("cf-http-paises","Peticiones por país","lnsDatatable",{"p":terms("source.geo.country_iso_code","País","r",15),"r":sm("cloudflare.requests","Peticiones")},["p","r"],table(["p","r"]),HTTP)
lens("cf-hourly","Visitantes únicos y amenazas por hora","lnsXY",{"x":dh(),"y":sm("cloudflare.hourly.uniques","Visitantes únicos")},["x","y"],xy("x","y",None,"line","Visitantes únicos"),HR)
# Seguridad
lens("cf-sec-tiempo","Acciones de seguridad en el borde","lnsXY",{"x":dh(),"y":cnt("Eventos"),"s":terms("event.action","Acción","y",6)},["x","s","y"],xy("x","y","s","bar_stacked","Eventos",ACTC,"bottom"),SEC)
lens("cf-sec-ips","IPs bloqueadas o desafiadas","lnsDatatable",{"ip":terms("source.ip","IP de origen","c",15,"ip"),"p":terms("source.geo.country_iso_code","País","c",1),"o":terms("source.as.organization.name","Organización (AS)","c",1),"r":terms("rule.ruleset","Motor","c",2),"c":cnt("Eventos")},
     ["ip","p","o","r","c"],table(["ip","p","o","r","c"],{"c":{"colorMode":"text","palette":pal([(0,GREEN),(3,YEL),(10,RED)])}}),SEC)
lens("cf-sec-rutas","Rutas objetivo de los ataques","lnsDatatable",{"u":terms("url.path","Ruta","c",15),"d":terms("url.domain","Host","c",2),"a":terms("event.action","Acción","c",2),"c":cnt("Eventos")},["u","d","a","c"],table(["u","d","a","c"],{"u":{"width":300}}),SEC)
lens("cf-sec-ua","Clientes (user-agent) filtrados","lnsDatatable",{"u":terms("user_agent.original","User-agent","c",10),"c":cnt("Eventos")},["u","c"],table(["u","c"],{"u":{"width":650}}),SEC)
# Zero Trust
lens("cf-acc-tabla","Logins de Cloudflare Access","lnsDatatable",{"e":terms("user.email","Usuario","c",10),"a":terms("url.domain","Aplicación","c",10),"o":terms("event.outcome","Resultado","c",2),"i":terms("source.ip","IP","c",3,"ip"),"c":cnt("Logins"),"l":maxt("Último")},
     ["e","a","o","i","c","l"],table(["e","a","o","i","c","l"]),ACC)
lens("cf-acc-tiempo","Logins de Access en el tiempo","lnsXY",{"x":dh(),"y":cnt("Logins"),"s":terms("event.outcome","Resultado","y",2)},["x","s","y"],xy("x","y","s","bar_stacked","Logins",[("success",GREEN),("failure",RED)],"bottom"),ACC)
# Túneles
lens("cf-tun-estado","Estado de los túneles (último)","lnsDatatable",{"n":terms("cloudflare.tunnel.name","Túnel","q",10),"s":lastv("cloudflare.tunnel.status","Estado"),"k":lastv("cloudflare.tunnel.connections","Conexiones","number"),"c":lastv("cloudflare.tunnel.colos","Datacenters"),"q":cnt("Comprobaciones")},
     ["n","s","k","c","q"],table(["n","s","k","c","q"]),TUN)
lens("cf-tun-conns","Conexiones activas por túnel","lnsXY",{"x":dh(),"y":C("min","Conexiones (mín.)",sourceField="cloudflare.tunnel.connections"),"s":terms("cloudflare.tunnel.name","Túnel","y",10)},["x","s","y"],xy("x","y","s","line","Conexiones",None,"bottom"),TUN)
# Auditoría
lens("cf-audit","Cambios de configuración en la cuenta","lnsDatatable",{"r":terms("cloudflare.audit.resource_type","Recurso","c",15),"a":terms("event.action","Acción","c",3),"u":terms("user.email","Quién","c",3),"c":cnt("Cambios"),"l":maxt("Último")},["r","a","u","c","l"],table(["r","a","u","c","l"]),AUD)

md("cf-md-cabecera","""## ☁️ Vintum — Cloudflare (borde y Zero Trust)
Datos de la **API de Cloudflare** (plan Free, token de solo lectura) recogidos cada 1–5 min por el recolector de svc-01 → Filebeat → Elasticsearch. Cloudflare Free retiene los logs de Zero Trust **24 h**; aquí se conservan **30 días**.
⬅️ [Centro de operaciones](/app/dashboards#/view/vintum-centro-operaciones) · [Mesh y Latencia (Zabbix)](/app/dashboards#/view/vintum-zabbix-mesh)""")
secs=[("cf-md-s1","#### 🌐 Tráfico en el borde de Cloudflare"),("cf-md-s2","#### 🛡️ Seguridad en el borde (WAF, reglas administradas, Bot Fight Mode)"),("cf-md-s3","#### 🔑 Zero Trust — Cloudflare Access"),("cf-md-s4","#### 🚇 Túneles y 📝 auditoría de la cuenta")]
for i,t in secs: md(i,t)
L=[("cf-md-cabecera","visualization",0,0,48,5,True)]
L+=[(k,"lens",i*8,5,8,6,True) for i,k in enumerate(["cf-kpi-req","cf-kpi-cache","cf-kpi-block","cf-kpi-chal","cf-kpi-accfail","cf-kpi-tun"])]
L+=[("cf-md-s1","visualization",0,11,48,2,True),("cf-http-host","lens",0,13,30,12,False),("cf-http-codes","lens",30,13,9,12,False),("cf-http-cache","lens",39,13,9,12,False),
    ("cf-hourly","lens",0,25,32,10,False),("cf-http-paises","lens",32,25,16,10,False),
    ("cf-md-s2","visualization",0,35,48,2,True),("cf-sec-tiempo","lens",0,37,20,13,False),("cf-sec-ips","lens",20,37,28,13,False),
    ("cf-sec-rutas","lens",0,50,20,12,False),("cf-sec-ua","lens",20,50,28,12,False),
    ("cf-md-s3","visualization",0,62,48,2,True),("cf-acc-tabla","lens",0,64,32,11,False),("cf-acc-tiempo","lens",32,64,16,11,False),
    ("cf-md-s4","visualization",0,75,48,2,True),("cf-tun-estado","lens",0,77,24,10,False),("cf-tun-conns","lens",24,77,24,10,False),("cf-audit","lens",0,87,48,11,False)]
panels=[];refs=[]
for i,(oid,t,x,y,w,h,hide) in enumerate(L):
    pi=f"p{i}"; ec={"enhancements":{}}
    if hide: ec["hidePanelTitles"]=True
    panels.append({"type":t,"panelIndex":pi,"gridData":{"x":x,"y":y,"w":w,"h":h,"i":pi},"panelRefName":f"panel_{pi}","embeddableConfig":ec}); refs.append({"name":f"panel_{pi}","type":t,"id":oid})
objs.append({"type":"dashboard","id":"vintum-cloudflare","attributes":{"title":"Vintum — Cloudflare (borde y Zero Trust)","description":"Tráfico y seguridad en el borde, logins de Access, túneles y auditoría (API de Cloudflare)",
  "panelsJSON":json.dumps(panels),"optionsJSON":json.dumps({"useMargins":True,"syncColors":False,"syncCursor":True,"hidePanelTitles":False}),
  "timeRestore":True,"timeFrom":"now-3d","timeTo":"now","refreshInterval":{"pause":False,"value":60000},"kibanaSavedObjectMeta":{"searchSourceJSON":json.dumps({"query":{"query":"","language":"kuery"},"filter":[]})}},"references":refs})
json.dump(objs,open("dashboard-cloudflare-objetos.json","w"),ensure_ascii=False,indent=1); print(len(objs),"objetos")
