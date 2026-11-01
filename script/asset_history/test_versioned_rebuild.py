import copy,json,tempfile,unittest
from pathlib import Path
from publish import METHOD,TEAMS,publish
from versioned_rebuild import reconstruct

def player(team,day,value=200):
    return {'team':team,'date':day,'source_cutoff':day,'method':METHOD,'reporting_cap':164961000,
        'assets':[{'id':'player:'+team,'name':team+' player','kind':'player','value':value,'exposure':4,'source':'fixture'}],
        'unpriced_players':[],'coverage':dict.fromkeys(('ownership','contracts','skill','injury_review'),True)}
def pick(team,value=10):
    return {'id':'pick:'+team,'name':team+' pick','kind':'pick','value':value,'source':'fixture'}
def fixtures():
    days=['2026-09-30','2026-10-31']
    legacy={t:{d:{'date':d,'assets':[pick(t)],'assumptions':[]}for d in days}for t in TEAMS}
    players=[player(t,d)for d in days+['2026-11-01']for t in TEAMS]
    picks={'complete':True,'teams':{t:[pick(t,11)]for t in TEAMS},'assumptions':[]}
    sources=dict.fromkeys(('ownership','contracts','epm','darko','skill'),'2026-11-01')
    return legacy,players,picks,sources

class Reconstruction(unittest.TestCase):
    def test_full_history_uses_new_players_and_preserves_old_pick_observations(self):
        legacy,players,picks,sources=fixtures();before=copy.deepcopy(legacy)
        rows=reconstruct(players,picks,legacy,[],'2026-11-01',sources)
        self.assertEqual(len(rows),90)
        self.assertEqual(legacy,before)
        for row in rows:
            self.assertEqual(row['method'],METHOD)
            self.assertEqual(row['assets'][0]['value'],200)
            self.assertEqual(row['total'],211 if row['date']=='2026-11-01'else 210)
            self.assertEqual(row['vintage'],'published'if row['date']=='2026-11-01'else'reconstructed')
        with tempfile.TemporaryDirectory()as folder:
            manifest=publish(rows,Path(folder))
            self.assertTrue(all(t['count']==3 for t in manifest['teams']))
            self.assertTrue(all('/v3/'in t['path']for t in manifest['teams']))
            saved=json.loads((Path(folder)/'teams/UTA.json').read_text())
            self.assertEqual([s['date']for s in saved['snapshots']],['2026-09-30','2026-10-31','2026-11-01'])
            self.assertEqual([s['closed']for s in saved['snapshots']],[True,True,False])
    def test_missing_historical_team_is_rejected(self):
        legacy,players,picks,sources=fixtures();players=[p for p in players if(p['date'],p['team'])!=('2026-10-31','UTA')]
        with self.assertRaisesRegex(ValueError,'complete player'):reconstruct(players,picks,legacy,[],'2026-11-01',sources)
    def test_missing_legacy_observation_is_rejected(self):
        legacy,players,picks,sources=fixtures();del legacy['UTA']['2026-09-30']
        with self.assertRaisesRegex(ValueError,'common legacy'):reconstruct(players,picks,legacy,[],'2026-11-01',sources)

if __name__=='__main__':unittest.main()
