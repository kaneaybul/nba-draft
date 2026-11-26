#!/usr/bin/env python3
"""Restore only reviewed pinned static history/UI. Never restore current data.
No credentials. All replacements are deferred until every required byte is verified.
"""
import argparse,hashlib,json,os,pathlib,re,tempfile,urllib.request
from urllib.parse import urlsplit
MAX=25*1024*1024
HOSTING={'_headers':'19a6b9d0c6397525a189cbbb43b32273c7f60995','_redirects':'7797f7c6a7356b0d451d11a49925df854c22e978'}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Redirect forbidden for pinned deployment')
def download(url):
 req=urllib.request.Request(url,headers={'Accept-Encoding':'identity','User-Agent':'Mozilla/5.0'})
 with urllib.request.build_opener(NoRedirect).open(req,timeout=60) as r:
  if r.status!=200 or r.geturl()!=url:raise ValueError('Unexpected pinned response')
  data=r.read(MAX+1)
  if len(data)>MAX:raise ValueError('Asset too large')
  return data

def approved(name):
 if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_./-]+',name):return False
 p=pathlib.PurePosixPath(name)
 if p.is_absolute() or str(p)!=name or any(x in ('.','..','') for x in name.split('/')):return False
 return name in {'data/asset_history_release.json','index.html','logo.svg','favicon.svg',*HOSTING} or (name.startswith('assets/') and p.suffix in ('.js','.css','.svg')) or (name.startswith(('data/asset_history/v19/','data/asset_history/v20/')) and p.suffix=='.json')
def no_symlink(path):
 for p in [path,*path.parents]:
  if p.is_symlink():raise ValueError('Symlink in output/source path')
def sha(data):return hashlib.sha256(data).hexdigest()
def restore(dist,policy_path,policy_sha,tracked_public,fetch=download):
 dist=pathlib.Path(dist).absolute();no_symlink(dist);policy_path=pathlib.Path(policy_path);raw=policy_path.read_bytes()
 if sha(raw)!=policy_sha:raise ValueError('Unreviewed policy bytes')
 p=json.loads(raw);u=urlsplit(p['restore_origin']);host=u.hostname or ''
 if u.scheme!='https' or u.netloc!=host or not re.fullmatch(r'[0-9a-f]{8}\.nba-impact-lab\.pages\.dev',host) or u.path not in ('','/') or u.query or u.fragment:raise ValueError('Not an immutable approved deployment origin')
 files=p.get('protected_files',{})
 if p.get('schema')!=1 or not 1<=len(files)<=1000:raise ValueError('Invalid policy schema/count')
 for name,digest in files.items():
  if not approved(name) or not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('Disallowed protected path/hash: '+name)
  no_symlink(dist/name)
 if 'data/asset_history_release.json' not in files or 'data/asset_history/v20/manifest.json' not in files:raise ValueError('Incomplete history policy')
 staged=[];reused=0;dist.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='.verified-static-',dir=dist.parent) as tmp:
  for i,(name,digest) in enumerate(sorted(files.items())):
   dest=dist/name
   if dest.is_file() and dest.stat().st_size<=MAX and sha(dest.read_bytes())==digest:reused+=1;continue
   if name in HOSTING:
    src=pathlib.Path(tracked_public)/name;no_symlink(src);b=src.read_bytes()
    if hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()!=HOSTING[name]:raise ValueError('Unverified tracked hosting control')
   else:b=fetch(p['restore_origin'].rstrip('/')+'/'+name)
   if not isinstance(b,bytes) or len(b)>MAX or sha(b)!=digest:raise ValueError('Pinned bytes mismatch: '+name)
   f=pathlib.Path(tmp)/str(i);f.write_bytes(b);staged.append((f,dest))
  # No changes occurred before all downloads and hosting controls passed.
  for f,dest in staged:no_symlink(dest);dest.parent.mkdir(parents=True,exist_ok=True);os.replace(f,dest)
 for name,digest in files.items():
  if sha((dist/name).read_bytes())!=digest:raise ValueError('Post-restore verification failed')
 return {'passed':True,'protected':len(files),'reused':reused,'restored':len(staged),'current_data_restored':False,'policy_sha256':policy_sha}
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--dist',required=True);a.add_argument('--policy',required=True);a.add_argument('--policy-sha256',required=True);a.add_argument('--tracked-public',required=True);x=a.parse_args();print(json.dumps(restore(x.dist,x.policy,x.policy_sha256,x.tracked_public),indent=2))
