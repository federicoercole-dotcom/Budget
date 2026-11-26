#!/usr/bin/env python3
"""Prepara un rilascio: versione, integrità dei file (SRI), elenco per il funzionamento offline.
Uso: python3 tools/release.py 2026.11.26-2"""
import sys,re,json,hashlib,base64,os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)));os.chdir(root)
V=sys.argv[1]
def sri(p):return 'sha384-'+base64.b64encode(hashlib.sha384(open(p,'rb').read()).digest()).decode()
# versione dentro app.js
a=open('app.js').read();a=re.sub(r"const APP_V='[^']*'",f"const APP_V='{V}'",a);open('app.js','w').write(a)
h=open('index.html').read()
for f in ['style.css','vendor/supabase.js','config.js','app.js']:
    pat=re.compile(r'(href|src)="'+re.escape(f)+r'(\?v=[^"]*)?"( integrity="[^"]*")?( crossorigin="[^"]*")?')
    h,n=pat.subn(lambda m:f'{m.group(1)}="{f}?v={V}" integrity="{sri(f)}"',h);assert n==1,(f,n)
open('index.html','w').write(h)
open('version.json','w').write(json.dumps({'v':V})+'\n')
assets=['./index.html',f'style.css?v={V}',f'vendor/supabase.js?v={V}',f'config.js?v={V}',f'app.js?v={V}','manifest.webmanifest','icon.svg','icon-192.png','apple-touch-icon.png']+['fonts/'+x for x in sorted(os.listdir('fonts'))]
s=open('sw.js').read();s=re.sub(r"const VERSION='[^']*';","const VERSION='"+V+"';",s);s=re.sub(r"const ASSETS=.*?;\n","const ASSETS="+json.dumps(assets)+";\n",s,flags=re.S);s=s.replace('__V__',V).replace('__ASSETS__',json.dumps(assets))
open('sw.js','w').write(s)
print('ok',V)
