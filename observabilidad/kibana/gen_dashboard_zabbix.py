# Dashboard "Vintum — Mesh y Latencia (Zabbix)": réplica en Kibana del dashboard 408 de Zabbix + velocímetros de la vista global.
import json
LOGS="vintum-logs"; objs=[]
HIST="event.dataset:zabbix.history"
def static(v,label): return {"label":label,"customLabel":True,"dataType":"number","operationType":"static_value","isStaticValue":True,"isBucketed":False,"scale":"ratio","params":{"value":str(v)},"references":[]}
def lastv(label,unit,dec=1): return {"label":label,"customLabel":True,"dataType":"number","operationType":"last_value","sourceField":"zabbix.valor","isBucketed":False,"scale":"ratio",
        "params":{"sortField":"@timestamp","showArrayValues":False,"format":{"id":"number","params":{"decimals":dec,"suffix":" "+unit}}}}
def gpal(mx,bands):  # bands=[(desde,"#hex"),...]
    cs=[{"color":c,"stop":s} for s,c in bands]; st=[{"color":c,"stop":(bands[i+1][0] if i+1<len(bands) else mx)} for i,(s,c) in enumerate(bands)]
    return {"type":"palette","name":"custom","params":{"name":"custom","reverse":False,"rangeType":"number","rangeMin":0,"rangeMax":mx,"progression":"fixed","continuity":"none","maxSteps":5,"steps":len(bands),"colorStops":cs,"stops":st}}
def gauge(id,title,itemq,unit,mx,bands,dec=1,sub=""):
    cols={"v":lastv(title,unit,dec),"mn":static(0,"Mínimo"),"mx":static(mx,"Máximo")}
    vis=lambda L:{"layerId":L,"layerType":"data","shape":"semiCircle","metricAccessor":"v","minAccessor":"mn","maxAccessor":"mx","ticksPosition":"bands",
                  "labelMajorMode":"custom","labelMajor":sub or title,"labelMinor":"","colorMode":"palette","palette":gpal(mx,bands)}
    objs.append({"type":"lens","id":id,"attributes":{"title":title,"visualizationType":"lnsGauge","state":{"datasourceStates":{"formBased":{"layers":{"L1":{"columns":cols,"columnOrder":["v","mn","mx"],"incompleteColumns":{}}}}},
      "visualization":vis("L1"),"query":{"query":f"{HIST} and {itemq}","language":"kuery"},"filters":[],"adHocDataViews":{},"internalReferences":[]}},
      "references":[{"type":"index-pattern","id":LOGS,"name":"indexpattern-datasource-layer-L1"}]})
def cmap(assign): return {"assignments":[{"rules":[{"type":"raw","value":v}],"color":{"type":"colorCode","colorCode":c},"touched":True} for v,c in assign],
        "specialAssignments":[{"rules":[{"type":"other"}],"color":{"type":"loop"},"touched":False}],"paletteId":"eui_amsterdam_color_blind","colorMode":{"type":"categorical"}}
def line(id,title,metricq,ytitle,unit,colors=None,split="zabbix.serie",agg="average"):
    cols={"x":{"label":"Hora","customLabel":True,"dataType":"date","operationType":"date_histogram","sourceField":"@timestamp","isBucketed":True,"scale":"interval","params":{"interval":"auto","includeEmptyRows":False,"dropPartials":False}},
          "y":{"label":ytitle,"customLabel":True,"dataType":"number","operationType":agg,"sourceField":"zabbix.valor","isBucketed":False,"scale":"ratio","params":{"format":{"id":"number","params":{"decimals":1,"suffix":" "+unit}}}},
          "s":{"label":"Serie","customLabel":True,"dataType":"string","operationType":"terms","sourceField":split,"isBucketed":True,"scale":"ordinal","params":{"size":12,"orderBy":{"type":"alphabetical","fallback":True},"orderDirection":"asc","otherBucket":False,"missingBucket":False}}}
    lay={"layerId":"L1","layerType":"data","accessors":["y"],"position":"top","seriesType":"line","showGridlines":False,"xAccessor":"x","splitAccessor":"s"}
    if colors: lay["colorMapping"]=cmap(colors)
    vis={"legend":{"isVisible":True,"position":"bottom","shouldTruncate":False},"valueLabels":"hide","fittingFunction":"Linear","preferredSeriesType":"line","curveType":"CURVE_MONOTONE_X",
         "axisTitlesVisibilitySettings":{"x":False,"yLeft":True,"yRight":True},"yTitle":ytitle,"gridlinesVisibilitySettings":{"x":False,"yLeft":True,"yRight":True},"emphasizeFitting":True,"layers":[lay]}
    objs.append({"type":"lens","id":id,"attributes":{"title":title,"visualizationType":"lnsXY","state":{"datasourceStates":{"formBased":{"layers":{"L1":{"columns":cols,"columnOrder":["x","s","y"],"incompleteColumns":{}}}}},
      "visualization":vis,"query":{"query":f"{HIST} and {metricq}","language":"kuery"},"filters":[],"adHocDataViews":{},"internalReferences":[]}},
      "references":[{"type":"index-pattern","id":LOGS,"name":"indexpattern-datasource-layer-L1"}]})
def md(id,text): objs.append({"type":"visualization","id":id,"attributes":{"title":"","visState":json.dumps({"title":"","type":"markdown","params":{"markdown":text,"fontSize":11,"openLinksInNewTab":True},"aggs":[]}),"uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{}"}},"references":[]})

G,RD,BL,OR,CY,TL,PU="#33CC33","#FF3333","#4169E1","#FF9933","#00BCD4","#00838F","#8E44AD"   # colores del dashboard original de Zabbix
# Fila 1
gauge("zbx-g-inet-pve1","Latencia a Internet · PVE1","zabbix.itemid:70631","ms",300,[(0,G),(150,RD)],sub="8.8.8.8")
gauge("zbx-g-inet-pve2","Latencia a Internet · PVE2","zabbix.itemid:70635","ms",300,[(0,G),(150,RD)],sub="8.8.8.8")
gauge("zbx-g-edge-pve1","Latencia Edge Cloudflare · PVE1","zabbix.itemid:71198","ms",300,[(0,OR)],sub="BOG 162.159.197.2")
gauge("zbx-g-edge-pve2","Latencia Edge Cloudflare · PVE2","zabbix.itemid:71200","ms",300,[(0,OR)],sub="BOG 162.159.197.2")
gauge("zbx-g-mbps-pve1","Mbps a Internet · PVE1","zabbix.itemid:71201","Mbps",100,[(0,BL)],sub="speedtest")
gauge("zbx-g-mbps-pve2","Mbps a Internet · PVE2","zabbix.itemid:71202","Mbps",100,[(0,BL)],sub="speedtest")
# Fila 2
gauge("zbx-g-mesh-pve1","Latencia Mesh · PVE1 → PVE2","zabbix.itemid:70633","ms",400,[(0,CY),(250,RD)],sub="vía WARP")
gauge("zbx-g-mesh-pve2","Latencia Mesh · PVE2 → PVE1","zabbix.itemid:70637","ms",400,[(0,CY),(250,RD)],sub="vía WARP")
gauge("zbx-g-mesh-avg","Latencia Mesh · Promedio","zabbix.itemid:71239","ms",400,[(0,TL),(250,RD)],sub="ambos sentidos")
gauge("zbx-g-cluster","Velocidad del clúster (mín.)","zabbix.itemid:71240","Mbps",100,[(0,PU)],sub="cuello de botella")
gauge("zbx-g-mem-zbx","Memoria · Zabbix server","zabbix.itemid:42270","%",100,[(0,"#42A5F5"),(20,"#9CCC65"),(40,"#FFEE58"),(60,"#FFA726"),(80,"#FF7043")],sub="ZABBIX_PVE1")
gauge("zbx-g-cpu-web1","CPU · WebServer1","zabbix.itemid:69823","%",100,[(0,"#9CCC65"),(60,"#FFA726"),(85,"#FF7043")],sub="WEBSERVER_PVE1")
# Gráficas (colores de las gráficas originales de Zabbix)
c2=[("PVE1","#1A7C11"),("PVE2","#2774A4")]
c4=[("PVE1 recibido","#1A7C11"),("PVE1 enviado","#2774A4"),("PVE2 recibido","#F63100"),("PVE2 enviado","#A54F10")]
line("zbx-l-inet","Latencia a Internet (ms)","zabbix.metric:latencia_internet","Latencia","ms",c2)
line("zbx-l-mesh","Latencia inter-nodo Mesh (ms)","zabbix.metric:latencia_mesh","Latencia","ms",[("PVE1 → PVE2","#1A7C11"),("PVE2 → PVE1","#2774A4")])
line("zbx-l-tmesh","Throughput Mesh CloudflareWARP (kbps)","zabbix.metric:throughput_mesh","Throughput","kbps",c4)
line("zbx-l-tinet","Throughput Internet · interfaz física (kbps)","zabbix.metric:throughput_internet","Throughput","kbps",c4)
line("zbx-l-cpu","CPU por servidor (%)","zabbix.metric:cpu_util","CPU","%",None,"zabbix.host_name")
line("zbx-l-mem","Memoria por servidor (%)","zabbix.metric:mem_util","Memoria","%",None,"zabbix.host_name")

md("zbx-md-cabecera","""## 📡 Vintum — Mesh y Latencia (métricas de Zabbix en Kibana)
Réplica del dashboard **«Vintum - Mesh y Latencia»** de Zabbix (y de los velocímetros de su vista global). Los valores llegan por la **exportación en tiempo real de Zabbix** (`ExportType=history`) → Filebeat → pipeline `vintum-zabbix-history` (latencias en ms, tráfico en kbps); los 7 días previos se cargaron desde la API de Zabbix. Velocímetros = **último valor** del periodo; mismos rangos, umbrales y colores que en Zabbix.
⬅️ [Volver al Centro de operaciones](/app/dashboards#/view/vintum-centro-operaciones) · [Cloudflare](/app/dashboards#/view/vintum-cloudflare)""")
md("zbx-md-s1","#### 🎯 Velocímetros (último valor)")
md("zbx-md-s2","#### 📈 Gráficas históricas")
md("zbx-md-s3","#### 🖥️ Recursos de los servidores")
L=[("zbx-md-cabecera","visualization",0,0,48,5,True),("zbx-md-s1","visualization",0,5,48,2,True)]
g1=["zbx-g-inet-pve1","zbx-g-inet-pve2","zbx-g-edge-pve1","zbx-g-edge-pve2","zbx-g-mbps-pve1","zbx-g-mbps-pve2"]
g2=["zbx-g-mesh-pve1","zbx-g-mesh-pve2","zbx-g-mesh-avg","zbx-g-cluster","zbx-g-mem-zbx","zbx-g-cpu-web1"]
L+=[(g,"lens",i*8,7,8,9,False) for i,g in enumerate(g1)]+[(g,"lens",i*8,16,8,9,False) for i,g in enumerate(g2)]
L+=[("zbx-md-s2","visualization",0,25,48,2,True),("zbx-l-inet","lens",0,27,24,12,False),("zbx-l-mesh","lens",24,27,24,12,False),
    ("zbx-l-tmesh","lens",0,39,24,12,False),("zbx-l-tinet","lens",24,39,24,12,False),
    ("zbx-md-s3","visualization",0,51,48,2,True),("zbx-l-cpu","lens",0,53,24,13,False),("zbx-l-mem","lens",24,53,24,13,False)]
panels=[];refs=[]
for i,(oid,t,x,y,w,h,hide) in enumerate(L):
    pi=f"p{i}"; ec={"enhancements":{}}
    if hide: ec["hidePanelTitles"]=True
    panels.append({"type":t,"panelIndex":pi,"gridData":{"x":x,"y":y,"w":w,"h":h,"i":pi},"panelRefName":f"panel_{pi}","embeddableConfig":ec}); refs.append({"name":f"panel_{pi}","type":t,"id":oid})
objs.append({"type":"dashboard","id":"vintum-zabbix-mesh","attributes":{"title":"Vintum — Mesh y Latencia (Zabbix)","description":"Réplica en Kibana del dashboard de Zabbix: velocímetros de latencia/velocidad del mesh y gráficas históricas",
  "panelsJSON":json.dumps(panels),"optionsJSON":json.dumps({"useMargins":True,"syncColors":False,"syncCursor":True,"syncTooltips":True,"hidePanelTitles":False}),
  "timeRestore":True,"timeFrom":"now-24h","timeTo":"now","refreshInterval":{"pause":False,"value":30000},
  "kibanaSavedObjectMeta":{"searchSourceJSON":json.dumps({"query":{"query":"","language":"kuery"},"filter":[]})}},"references":refs})
json.dump(objs,open("dashboard-zabbix-mesh-objetos.json","w"),ensure_ascii=False,indent=1); print(len(objs),"objetos")
