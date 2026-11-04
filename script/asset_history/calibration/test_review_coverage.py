import unittest
from .coverage import documented_missing_endpoint,documented_unobserved_endpoint

class EndpointCoverage(unittest.TestCase):
    def test_only_a_documented_missing_rating_can_be_reported_unavailable(self):
        grade=dict(status='unavailable',reason='Missing completed endpoint rating')
        excluded=[dict(key='wendellmoore',reason='endpoint service without rating')]
        self.assertTrue(documented_missing_endpoint('Wendell Moore, Jr.',grade,excluded))
        self.assertFalse(documented_missing_endpoint('Another Player',grade,excluded))
        self.assertFalse(documented_missing_endpoint('Wendell Moore, Jr.',dict(status='unavailable',reason='broken computation'),excluded))
        self.assertFalse(documented_missing_endpoint('Wendell Moore, Jr.',dict(status='priced',value=0),excluded))

    def test_a_missing_past_assessment_is_reported_without_faking_a_grade(self):
        grade=dict(status='unavailable',reason='No shared year-four assessment in the observed history',endpoint='2026-07-31')
        self.assertTrue(documented_unobserved_endpoint('diop','2026-09-30',grade,set()))
        self.assertFalse(documented_unobserved_endpoint('diop','2026-06-30',grade,set()))
        self.assertFalse(documented_unobserved_endpoint('diop','2026-09-30',grade,{('diop','2026-07-31')}))
        self.assertFalse(documented_unobserved_endpoint('diop','2026-09-30',dict(grade,value=0.),set()))
if __name__=='__main__':unittest.main()

