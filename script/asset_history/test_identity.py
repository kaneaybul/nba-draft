import unittest
from assemble import bridge
from identity import indexed_assets

class IdentityTransition(unittest.TestCase):
    def test_signing_revalues_existing_right_without_fake_entry_or_exit(self):
        old={'id':'player:name:richiesaunders','kind':'player','name':'Richie Saunders','value':33.1e6}
        new={**old,'id':'player:nba:1643563','value':25.4e6}
        result=bridge({'assets':[old],'total':old['value']},{'assets':[new],'total':new['value']})
        self.assertEqual(result,[{'key':'player_repriced','label':'Continuing player values','value':-7.7e6}])
        self.assertEqual(old['id'],'player:name:richiesaunders')
        with self.assertRaisesRegex(ValueError,'Duplicate canonical'):
            indexed_assets([old,new])

if __name__=='__main__':unittest.main()
