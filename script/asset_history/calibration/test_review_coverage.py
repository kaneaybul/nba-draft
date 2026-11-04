import unittest
from .coverage import documented_missing_endpoint

class EndpointCoverage(unittest.TestCase):
    def test_only_a_documented_missing_rating_can_be_reported_unavailable(self):
        grade=dict(status='unavailable',reason='Missing completed endpoint rating')
        excluded=[dict(key='wendellmoore',reason='endpoint service without rating')]
        self.assertTrue(documented_missing_endpoint('Wendell Moore, Jr.',grade,excluded))
        self.assertFalse(documented_missing_endpoint('Another Player',grade,excluded))
        self.assertFalse(documented_missing_endpoint('Wendell Moore, Jr.',dict(status='unavailable',reason='broken computation'),excluded))
        self.assertFalse(documented_missing_endpoint('Wendell Moore, Jr.',dict(status='priced',value=0),excluded))
if __name__=='__main__':unittest.main()
