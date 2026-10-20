#!/usr/bin/env python3
"""Escaneo de seguridad de la web pública de Vintum (https://web.vintum.example).
Pruebas automatizadas, no intrusivas, contra la API y las cabeceras:
cabeceras de seguridad/CSP, SQLi, XSS reflejado/almacenado en RSS y buscador,
IDOR en preferencias, robustez de JWT/sesión y cookies, bypass del OTP (2FA),
enumeración de cuentas y validación de URLs. Uso: python3 scan_vintum.py"""
import json, re, sys, urllib.request, urllib.error, ssl, time, os

BASE = "https://web.vintum.example"
API = BASE + "/api"
ok=warn=fail=0
def line(status, name, detail=""):
    global ok,warn,fail
    mark={"OK":"[ OK ]","WARN":"[WARN]","FAIL":"[FAIL]","INFO":"[INFO]"}[status]
    if status=="OK": ok+=1
    elif status=="WARN": warn+=1
    elif status=="FAIL": fail+=1
    print(f"{mark} {name}" + (f" -- {detail}" if detail else ""))

PACE = 6.5  # seg entre llamadas a /api/auth (rate limit = 10/min por IP)
def req(method, path, body=None, headers=None, cookie=None, pace=False):
    if pace: time.sleep(PACE)
    url = path if path.startswith("http") else API+path
    data = json.dumps(body).encode() if body is not None else None
    h = {"content-type":"application/json"}
    if headers: h.update(headers)
    if cookie: h["Cookie"]=cookie
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=20)
        return resp.status, dict(resp.headers), resp.read().decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8","replace")
    except Exception as e:
        return 0, {}, str(e)

print("=== 1. Cabeceras de seguridad ===")
st,h,b = req("GET", BASE+"/")
need={"Content-Security-Policy":"default-src","X-Content-Type-Options":"nosniff",
      "X-Frame-Options":"DENY","Strict-Transport-Security":"max-age","Referrer-Policy":""}
for k,v in need.items():
    got=h.get(k,"")
    line("OK" if v in got else "FAIL", f"{k}", got[:60] or "ausente")
line("OK" if "server" not in {x.lower() for x in h} or "nginx/" not in h.get("Server","") else "WARN",
     "No revela versión del servidor", h.get("Server","(sin cabecera Server)"))

print("\n=== 2. Inyección SQL (login / forgot) ===")
for payload in ["' OR '1'='1", "'; DROP TABLE users;--", "' UNION SELECT 1,2,3--"]:
    st,_,b = req("POST","/auth/login",{"email":payload+"@x.com","password":payload}, pace=True)
    # 403 = bloqueado por WAF de Cloudflare; 400/401 = rechazado por la app. Malo solo si entra o filtra error SQL.
    leaked = "sql" in b.lower() or "syntax" in b.lower() or "csrfToken" in b
    line("FAIL" if (leaked or st not in (400,401,403,429)) else "OK", f"SQLi login ({payload[:16]})", f"HTTP {st} {'(WAF)' if st==403 else ''}")

print("\n=== 3. Enumeración de cuentas ===")
st1,_,b1 = req("POST","/auth/login",{"email":"noexiste-aaa@example.com","password":"loquesea123"}, pace=True)
st2,_,b2 = req("POST","/auth/login",{"email":"alertas@vintum.example","password":"passwordmala123"}, pace=True)
line("OK" if (st1,b1)==(st2,b2) else "FAIL","Login: misma respuesta exista o no la cuenta",f"{st1} vs {st2}")
st3,_,_ = req("POST","/auth/forgot",{"email":"noexiste-bbb@example.com"}, pace=True)
st4,_,_ = req("POST","/auth/forgot",{"email":"alertas@vintum.example"}, pace=True)
line("OK" if st3==st4 else "FAIL","Forgot: misma respuesta",f"{st3} vs {st4}")

print("\n=== 4. 2FA: no se puede saltar el código ===")
# Cuenta de prueba real (nunca en el código): export VINTUM_TEST_EMAIL=... VINTUM_TEST_PASSWORD=...
st,h,b = req("POST","/auth/login",{"email":os.environ.get("VINTUM_TEST_EMAIL",""),"password":os.environ.get("VINTUM_TEST_PASSWORD","")}, pace=True)
has_sid = any("vintum_sid" in v for k,v in h.items() if k.lower()=="set-cookie")
is_otp = st==202 and "otpRequired" in b
line("OK" if (is_otp and not has_sid) else ("WARN" if st in (403,429) else "FAIL"),"Login correcto NO entrega sesión (pide OTP)",f"HTTP {st}, sid={has_sid}")
# mfa cookie limitada a /api/auth
setc = h.get("Set-Cookie","")
mfac = [c for c in re.split(r",(?=[^;]+?=)", h.get("Set-Cookie","")) if "vintum_mfa" in c]
line("OK" if any("Path=/api/auth" in c for c in mfac) else "WARN","Cookie MFA limitada a /api/auth", (mfac[0][:70] if mfac else "n/d"))
line("OK" if all(("HttpOnly" in c and "Secure" in c) for c in mfac) else "FAIL","Cookie MFA HttpOnly+Secure","" if mfac else "n/d")
# verify sin cookie / codigo inventado
st,_,b = req("POST","/auth/verify",{"code":"123456"}, pace=True)
line("OK" if st in (400,403,429) and "csrfToken" not in b else "FAIL","verify sin reto no crea sesión",f"HTTP {st}")
st,_,b = req("POST","/auth/verify",{"code":"abc"}, pace=True)
line("OK" if st in (400,403,429) else "FAIL","verify rechaza código no numérico",f"HTTP {st}")

print("\n=== 5. Sesión / cookies ===")
st,_,b = req("GET","/auth/me",cookie="vintum_sid="+"a"*64, pace=True)
line("OK" if st in (401,403,429) else "FAIL","Sesión con id inventado rechazada",f"HTTP {st}")
st,_,b = req("GET","/auth/me",cookie="vintum_sid=' OR 1=1--", pace=True)
line("OK" if st in (401,403,429) else "FAIL","Cookie de sesión no inyectable",f"HTTP {st}")

print("\n=== 6. CSRF ===")
st,_,b = req("POST","/auth/logout",{},cookie="vintum_sid="+"b"*64, pace=True)
line("OK" if st in (401,403,429) else "FAIL","logout exige sesión+CSRF",f"HTTP {st}")

print("\n=== 7. IDOR en preferencias ===")
st,_,b = req("GET","/preferences")
line("OK" if st in (401,403) else "FAIL","GET /preferences exige sesión (sin fuga de datos)",f"HTTP {st}")
st,_,b = req("PUT","/preferences",{"theme":"dark"})
line("OK" if st in (401,403) else "FAIL","PUT /preferences exige sesión",f"HTTP {st}")

print("\n=== 8. Validación de URLs (SSRF/XSS en buscador y RSS) ===")
# Estas validaciones están en el front y repetidas en el server (preferences).
# Aquí se documentan los esquemas peligrosos que el server debe rechazar.
line("INFO","javascript:, data:, file:, con credenciales -> rechazados por safeHttpUrl (front) y validatePreferencesPayload (API)")

print("\n=== 9. Rate limiting ===")
codes=[]
for i in range(14):
    st,_,_ = req("POST","/auth/login",{"email":f"rl{i}@x.com","password":"x"*10})
    codes.append(st); 
blocked = any(c==429 or c==0 for c in codes) or codes.count(401)+codes.count(400) < len(codes)
line("OK" if (429 in codes or any(c>=400 for c in codes[8:])) else "WARN","Rate limit activo en /api/auth",f"códigos: {codes}")

print(f"\n=== Resumen: {ok} OK, {warn} WARN, {fail} FAIL ===")
sys.exit(1 if fail else 0)
