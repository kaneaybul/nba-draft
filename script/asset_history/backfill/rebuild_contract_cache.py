"""Reparse downloaded contract HTML with current parser, without network."""
import argparse,json
from pathlib import Path
from contracts import load_players,fetch_one,write_outputs

def main():
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--raw',type=Path);p.add_argument('--live-pool',type=Path);a=p.parse_args()
 a.output.mkdir(parents=True,exist_ok=True);raw=a.raw or a.output/'raw'
 players=load_players(a.sources,a.live_pool);results=[]
 canonical={}
 for f in raw.glob('index_*.json'):
  for name,url in json.loads(f.read_text()):canonical[name]='https://www.salaryswish.com'+url
 for player in players:
  if player['player_name'] in canonical:player['source_url']=canonical[player['player_name']]
  if not (raw/f"{player['nba_id']}.html").exists():continue
  results.append(fetch_one(player,a.output,raw_dir=raw))
 write_outputs(results,players,a.output)
 print(json.dumps({'cached_players':len(results),'available':sum(r['status']=='available'for r in results),'agreements':sum(len(r['agreements'])for r in results)}))
if __name__=='__main__':main()
