import json, os, types, unittest
from unittest.mock import patch
from nba_transport import nba_table, fetch_json, NBARequestError

class TransportTests(unittest.TestCase):
    def test_timeout_is_retried_with_longer_budget_and_audited(self):
        response=dict(resultSets=[dict(name='SeasonMatchups',headers=['SEASON_ID'],rowSet=[['22026']])],parameters={'SeasonYear':'2026-27'})
        audit=[]
        with patch('nba_transport.fetch_json',side_effect=[NBARequestError('response_headers timeout'),response]) as fetch,patch('nba_transport.time.sleep'):
            rows,params=nba_table('leagueseasonmatchups',{'Season':'2026-27'},'SeasonMatchups',audit)
        self.assertEqual([call.args[1] for call in fetch.call_args_list],[60,90])
        self.assertEqual(rows,[{'SEASON_ID':'22026'}]);self.assertEqual(params['SeasonYear'],'2026-27')
        self.assertEqual(audit[0]['error_type'],'NBARequestError')
        self.assertEqual(audit[1]['rows'],1)
    def test_tls_complete_but_no_first_byte_identifies_server_response_timeout(self):
        timing=dict(http_code=0,time_appconnect=.3,time_connect=.1,time_starttransfer=0,time_total=60)
        result=types.SimpleNamespace(returncode=28,stdout=json.dumps(timing),stderr='Operation timed out')
        audit={}
        with patch('nba_transport.subprocess.run',return_value=result):
            with self.assertRaises(NBARequestError):fetch_json('https://stats.nba.com/test',60,audit)
        self.assertEqual(audit['failure_phase'],'response_headers')
        self.assertEqual(audit['elapsed_seconds'],60)
    def test_non_json_http_success_is_not_accepted(self):
        def run(*args,**kwargs):
            os.write(kwargs['pass_fds'][0],b'<html>blocked</html>')
            return types.SimpleNamespace(returncode=0,stdout=json.dumps(dict(http_code=200)),stderr='')
        audit={}
        with patch('nba_transport.subprocess.run',side_effect=run):
            with self.assertRaises(NBARequestError):fetch_json('https://stats.nba.com/test',60,audit)
        self.assertEqual(audit['failure_phase'],'json_decode')

if __name__=='__main__':unittest.main()
