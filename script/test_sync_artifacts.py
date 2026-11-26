#!/usr/bin/env python3
"""Unit tests for script/sync_artifacts.py."""
from __future__ import annotations

import hashlib
import json
import pathlib
import tarfile
import tempfile
import unittest

import sync_artifacts


class SyncArtifactsTest(unittest.TestCase):
    def _make_bundle(self, src_root: pathlib.Path, archive_path: pathlib.Path, rel_file: str, content: bytes) -> tuple[str, str]:
        f = src_root / rel_file
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(content)
        with tarfile.open(archive_path, "w:gz") as tf:
            tf.add(f, arcname=rel_file)
        return (
            hashlib.sha256(archive_path.read_bytes()).hexdigest(),
            hashlib.sha256(content).hexdigest(),
        )

    def test_download_verify_and_reuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            src = tmp_path / "src"
            repo = tmp_path / "repo"
            repo.mkdir()
            archive = tmp_path / "bundle.tar.gz"
            archive_sha, file_sha = self._make_bundle(src, archive, "processed/demo/data.bin", b"hello-nba")

            manifest_path = repo / "artifact_manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "repository": "kaneaybul/nba-draft",
                        "release_tag": "artifacts-active-v1",
                        "bundles": {
                            "demo": {
                                "asset": "bundle.tar.gz",
                                "sha256": archive_sha,
                                "paths": ["processed/demo"],
                                "verify_files": {"processed/demo/data.bin": file_sha},
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            calls = []

            def fake_dl(repo_slug, tag, asset_name, dest_dir):
                calls.append((repo_slug, tag, asset_name))
                out = dest_dir / asset_name
                out.write_bytes(archive.read_bytes())
                return out

            # Check-only reports missing
            res_check = sync_artifacts.sync(repo, manifest_path, check_only=True, downloader=fake_dl)
            self.assertEqual(res_check["missing"], ["demo"])
            self.assertEqual(calls, [])

            # First sync downloads and extracts
            res1 = sync_artifacts.sync(repo, manifest_path, downloader=fake_dl)
            self.assertEqual(res1["downloaded"], ["demo"])
            self.assertEqual(res1["reused"], [])
            self.assertEqual((repo / "processed/demo/data.bin").read_bytes(), b"hello-nba")
            self.assertEqual(len(calls), 1)

            # Second sync reuses local file without downloading
            res2 = sync_artifacts.sync(repo, manifest_path, downloader=fake_dl)
            self.assertEqual(res2["reused"], ["demo"])
            self.assertEqual(res2["downloaded"], [])
            self.assertEqual(len(calls), 1)

    def test_rejects_sha_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            src = tmp_path / "src"
            repo = tmp_path / "repo"
            repo.mkdir()
            archive = tmp_path / "bundle.tar.gz"
            _, file_sha = self._make_bundle(src, archive, "processed/demo/data.bin", b"hello")

            manifest_path = repo / "artifact_manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "repository": "kaneaybul/nba-draft",
                        "release_tag": "artifacts-active-v1",
                        "bundles": {
                            "demo": {
                                "asset": "bundle.tar.gz",
                                "sha256": "0" * 64,
                                "paths": ["processed/demo"],
                                "verify_files": {"processed/demo/data.bin": file_sha},
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            def fake_dl(repo_slug, tag, asset_name, dest_dir):
                out = dest_dir / asset_name
                out.write_bytes(archive.read_bytes())
                return out

            with self.assertRaises(ValueError):
                sync_artifacts.sync(repo, manifest_path, downloader=fake_dl)


if __name__ == "__main__":
    unittest.main()
