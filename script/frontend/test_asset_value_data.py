import json,tempfile,unittest
from pathlib import Path
from build_asset_value_data import build,TEAMS


class PublishedAppValues(unittest.TestCase):
    def test_a_missing_current_version_cannot_silently_export_the_old_method(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);public=self.seed(root)
            public.rename(public.with_name('v4'))
            with self.assertRaises(FileNotFoundError):build(root)

    def seed(self,root):
        version=root/'script/asset_history/model_version.py';version.parent.mkdir(parents=True)
        version.write_text("DATA_VERSION='v7'\nLEGACY_VERSION='v6'\nMETHOD='peak4-payroll-0.8-v7'\n")
        public=root/'frontend/public/data/asset_history/v7';(public/'teams').mkdir(parents=True)
        manifest={'method':'peak4-payroll-0.8-v7','generated_at':'2026-11-01T14:00:00Z',
                  'teams':[{'team':team,'status':'available','latest':'2026-11-01'}for team in TEAMS]}
        (public/'manifest.json').write_text(json.dumps(manifest))
        for i,team in enumerate(TEAMS):
            annual=[{'season':2027+h,'production':20.,'asset':28.,'exposure':1.}for h in range(4)]
            assets=[{'id':f'player:nba:{i+1}','kind':'player','value':112.,'details':{'annual_values':annual}},
                    {'id':f'pick:{team}:2028:1','kind':'pick','physical_origin':team,'draft_year':2028,'round':1,'value':30.}]
            (public/'teams'/f'{team}.json').write_text(json.dumps({'snapshots':[{'date':'2026-11-01','assets':assets}]}))
        model=root/'processed/asset_history/picks/trained_pick_model.json';model.parent.mkdir(parents=True)
        model.write_text(json.dumps({'production_policy':'year-four-production-endpoint-paths-v2','stock_policy':'year-four-endpoint-picks-rolling-players-v3','pick_curve':[{'pick':i,'quote':100-i}for i in range(1,61)]}))
        return public

    def test_preserves_published_quotes_and_the_complete_annual_path(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);self.seed(root);data=build(root)
            self.assertEqual(len(data['players']),30)
            self.assertEqual(data['players']['1']['value'],112.)
            self.assertEqual(data['players']['1']['annual'][0]['asset'],28.)
            self.assertEqual(data['picks'][0]['value'],30.)
            self.assertEqual(len(data['slots']),60)
            self.assertEqual(data['season'],2027)

    def test_current_release_rejects_the_old_point_forecast_pick_model(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);self.seed(root)
            path=root/'processed/asset_history/picks/trained_pick_model.json'
            model=json.loads(path.read_text());model['production_policy']='year-four-production-endpoint-v1'
            path.write_text(json.dumps(model))
            with self.assertRaisesRegex(ValueError,'career-path'):build(root)

    def test_endpoint_appraisal_cannot_replace_rolling_quote_or_its_distribution(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);public=self.seed(root);path=public/'teams/ATL.json';data=json.loads(path.read_text())
            asset=data['snapshots'][0]['assets'][0];asset['value']=132.
            grade=dict(status='priced',value=190.,original_expectation=160.,gain=30.,contract_effect=0.)
            asset['details'].update(peak_production=100.,contract_adjustment=32.,draft_development=grade,
                development_window_basis=-90.,endpoint_stock_policy='year-four-endpoint-picks-rolling-players-v3',
                path_calibration=dict(status='priced',mean=132.,mean_path_quote=112.,production_quote=100.,
                    contract_adjustment_sum=32.,p10=20.,p50=100.,p90=200.,nba_weight=.95))
            path.write_text(json.dumps(data));quote=build(root)['players']['1']
            self.assertEqual(quote['value'],132.)
            self.assertEqual(quote['draft_development']['value'],190.)
            self.assertEqual(quote['distribution']['p90'],200.)

    def test_annual_path_must_reconcile_with_the_published_quote(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);public=self.seed(root);path=public/'teams/ATL.json';data=json.loads(path.read_text())
            data['snapshots'][0]['assets'][0]['value']=111.;path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'disagrees'):build(root)

    def test_scenario_peak_reconciles_separately_from_the_mean_annual_path(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);public=self.seed(root);path=public/'teams/ATL.json';data=json.loads(path.read_text())
            asset=data['snapshots'][0]['assets'][0]
            asset['value']=132.
            asset['details']['path_calibration']=dict(status='priced',mean=132.,mean_path_quote=112.,
                production_quote=100.,contract_adjustment_sum=32.,p10=20.,p50=100.,p90=200.,nba_weight=.95)
            path.write_text(json.dumps(data))
            quote=build(root)['players']['1']
            self.assertEqual(quote['value'],132.)
            self.assertEqual(quote['distribution']['production_quote'],100.)

    def test_exported_player_path_keeps_the_production_and_contract_legs(self):
        import csv,sys
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'asset_history/backfill'))
        from run_player_refresh import export
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);team=root/'ATL';team.mkdir()
            (team/'league_player_coverage.json').write_text(json.dumps({'coverage':[{
                'date':'2026-11-01','contracts_complete':True,'skill_complete':True,'injury_review_complete':True}]}))
            player={'cutoff_date':'2026-11-01','active_asset':'True','all_four_year_app_quote_priced':'True',
                    'player_name':'Fixture','source_nba_id':'7.0','app_style_four_year_asset_quote_with_draft_prior':'112',
                    'app_priced_season_equivalents':'4'}
            annual=[{'cutoff_date':'2026-11-01','source_nba_id':'7.0','season':2027+h,'exposure':1,
                     'app_annual_quote_production_reporting_rate':20,'app_annual_stock_reporting_rate':28}for h in range(4)]
            for name,rows in [('monthly_player_values.csv',[player]),('monthly_annual_values.csv',annual)]:
                with(team/name).open('w')as file:
                    writer=csv.DictWriter(file,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
            exported=export(root,'2026-11-01')['snapshots'][0]['assets'][0]
            self.assertEqual(exported['value'],112.)
            self.assertEqual(len(exported['details']['annual_values']),4)
            self.assertEqual(exported['details']['annual_values'][0]['asset'],28.)


if __name__=='__main__':unittest.main()


