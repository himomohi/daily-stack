import json, subprocess, sys
import os
APP=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def iw(*a, inp=None):
    cmd=['npx','iwsdk',*a]
    if inp is not None: cmd+=['--input-json',json.dumps(inp)]
    r=subprocess.run(cmd,cwd=APP,capture_output=True,text=True,timeout=120)
    try: return json.loads(r.stdout)
    except Exception: return {'raw':r.stdout[-500:],'err':r.stderr[-500:]}
t=iw('browser','run','scripts/targets.mjs')['data']['result']['out']
tray={int(n.split('-')[1]):x for n,_,(x,_y,_z),_r in iw('browser','run','scripts/blocks.mjs')['data']['result']['res']}
iw('xr','look-at',inp={'device':'headset','target':{'x':0,'y':1.22,'z':-0.42}})
hands=['hand-right','hand-left']
for i,o in enumerate(t):
    hand = 'hand-left' if tray[o['id']] < 0 else 'hand-right'
    p=dict(o['pos'])
    if o['kind']=='bar': p['z']+=0.06
    seq={'device':hand,'steps':[
      {'label':'hover','anchor':'grip','target':f"block-{o['id']}",'approach':{'distance':0.07,'normal':'down'},'duration':0.6},
      {'label':'grab','pinch':1,'duration':0.25},
      {'label':'lift','position':{'x':p['x'],'y':p['y']+0.08,'z':p['z']},'duration':0.6},
      {'label':'place','position':p,'duration':0.35},
      {'label':'release','pinch':0,'duration':0.15},
      {'label':'away','position':{'x':p['x']*0.5+(0.18 if hand=='hand-right' else -0.18),'y':p['y']+0.1,'z':p['z']+0.15},'duration':0.4}]}
    r=iw('xr','run-sequence',inp=seq)
    res=r.get('data',{}).get('result',{})
    print(o['id'], hand, res.get('completed'), [e['type'] for e in res.get('events',[])], res.get('warnings',[])[:1], r.get('error',{}).get('message','')[:200])
    if len(sys.argv)>1 and i+1>=int(sys.argv[1]): break
print(json.dumps(iw('browser','run','scripts/inspect.mjs')['data']['result'].get('solved')))
