import hashlib,json,tempfile,unittest,zipfile
from pathlib import Path
from runtime_archive import split_archive,resolved_archive
from run_player_refresh import unpack

class ArchiveParts(unittest.TestCase):
 def seed(self,root):
  archive=root/'canonical_runtime_seed.zip';payload=b'Verified canonical model inputs.'*100
  with zipfile.ZipFile(archive,'w')as z:
   z.writestr('data/input.txt',payload)
   z.writestr('runtime_input_manifest.json',json.dumps({'data/input.txt':hashlib.sha256(payload).hexdigest()}))
  return archive,payload
 def test_parts_reassemble_and_extract_exact_payload_then_remove_temporary(self):
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);archive,payload=self.seed(root);original=archive.read_bytes()
   split_archive(archive,root/'runtime_seed',part_bytes=127);archive.unlink()
   with resolved_archive(archive)as rebuilt:
    self.assertEqual(rebuilt.read_bytes(),original);temporary=rebuilt
   self.assertFalse(temporary.exists())
   unpack(archive,root/'runtime');self.assertEqual((root/'runtime/data/input.txt').read_bytes(),payload)
 def test_corrupted_or_reordered_parts_fail_before_extraction(self):
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);archive,_=self.seed(root);parts=root/'runtime_seed';manifest=split_archive(archive,parts,127);archive.unlink()
   part=parts/manifest['parts'][0]['path'];original=part.read_bytes();part.write_bytes(b'x'+original[1:])
   with self.assertRaisesRegex(ValueError,'part integrity'):
    with resolved_archive(archive):pass
   part.write_bytes(original);manifest['parts'].reverse();(parts/'manifest.json').write_text(json.dumps(manifest))
   with self.assertRaisesRegex(ValueError,'digest mismatch'):
    with resolved_archive(archive):pass

if __name__=='__main__':unittest.main()
