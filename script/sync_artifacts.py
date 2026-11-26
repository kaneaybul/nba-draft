#!/usr/bin/env python3
"""Sync large static binary/data artifacts from private GitHub Releases.

Verifies SHA-256 checksums before extracting and checks local disk first so
repeated runs are near-instant no-ops when artifacts are already present.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from typing import Any


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def bundle_present_and_valid(repo: pathlib.Path, entry: dict[str, Any]) -> bool:
    verify_files: dict[str, str] = entry.get("verify_files", {})
    if not verify_files:
        return False
    for rel, expected_sha in verify_files.items():
        target = repo / rel
        if not target.is_file():
            return False
        if sha256_file(target) != expected_sha:
            return False
    return True


def _download_with_gh(repo_slug: str, tag: str, asset_name: str, dest_dir: pathlib.Path) -> pathlib.Path:
    cmd = [
        "gh",
        "release",
        "download",
        tag,
        "-R",
        repo_slug,
        "--pattern",
        asset_name,
        "--dir",
        str(dest_dir),
        "--clobber",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"gh release download failed for {asset_name}: {res.stderr.strip()}")
    out = dest_dir / asset_name
    if not out.is_file():
        raise RuntimeError(f"Expected downloaded asset missing: {out}")
    return out


def _download_with_api(repo_slug: str, tag: str, asset_name: str, dest_dir: pathlib.Path) -> pathlib.Path:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError(
            f"Cannot download {asset_name}: 'gh' CLI not found and neither GH_TOKEN nor GITHUB_TOKEN is set."
        )
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "nba-draft-sync-artifacts",
    }
    meta_url = f"https://api.github.com/repos/{repo_slug}/releases/tags/{tag}"
    with urllib.request.urlopen(urllib.request.Request(meta_url, headers=headers), timeout=60) as resp:
        release = json.load(resp)
    asset = next((a for a in release.get("assets", []) if a.get("name") == asset_name), None)
    if not asset:
        raise RuntimeError(f"Asset {asset_name!r} not found in release {tag!r} of {repo_slug}")
    asset_url = asset["url"]
    dl_headers = {**headers, "Accept": "application/octet-stream"}
    out = dest_dir / asset_name
    with urllib.request.urlopen(urllib.request.Request(asset_url, headers=dl_headers), timeout=300) as resp:
        with out.open("wb") as fh:
            shutil.copyfileobj(resp, fh)
    return out


def download_asset(repo_slug: str, tag: str, asset_name: str, dest_dir: pathlib.Path) -> pathlib.Path:
    if shutil.which("gh"):
        return _download_with_gh(repo_slug, tag, asset_name, dest_dir)
    return _download_with_api(repo_slug, tag, asset_name, dest_dir)


def safe_extract_tar_gz(archive_path: pathlib.Path, repo: pathlib.Path) -> None:
    repo_resolved = repo.resolve()
    with tarfile.open(archive_path, "r:gz") as tf:
        members = tf.getmembers()
        for m in members:
            if m.issym() or m.islnk() or m.isdev():
                raise ValueError(f"Refusing unsafe tar entry (link/device): {m.name}")
            p = pathlib.PurePosixPath(m.name)
            if p.is_absolute() or ".." in p.parts:
                raise ValueError(f"Refusing unsafe tar path: {m.name}")
            dest = (repo_resolved / m.name).resolve()
            if repo_resolved != dest and repo_resolved not in dest.parents:
                raise ValueError(f"Tar entry escapes repo root: {m.name}")
        if sys.version_info >= (3, 12):
            tf.extractall(path=repo_resolved, members=members, filter="data")
        else:
            tf.extractall(path=repo_resolved, members=members)


def sync(
    repo: pathlib.Path,
    manifest_path: pathlib.Path,
    only: list[str] | None = None,
    check_only: bool = False,
    force: bool = False,
    downloader=download_asset,
) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    repo_slug = manifest["repository"]
    release_tag = manifest["release_tag"]
    bundles: dict[str, dict[str, Any]] = manifest["bundles"]

    selected = list(bundles.keys()) if not only else only
    unknown = [name for name in selected if name not in bundles]
    if unknown:
        raise ValueError(f"Unknown artifact bundle(s): {', '.join(unknown)}")

    reused: list[str] = []
    downloaded: list[str] = []
    missing: list[str] = []

    for name in selected:
        entry = bundles[name]
        if not force and bundle_present_and_valid(repo, entry):
            reused.append(name)
            continue
        if check_only:
            missing.append(name)
            continue
        asset_name = entry["asset"]
        expected_sha = entry["sha256"]
        with tempfile.TemporaryDirectory(prefix="nba-artifact-") as tmp:
            archive_path = downloader(repo_slug, release_tag, asset_name, pathlib.Path(tmp))
            actual_sha = sha256_file(archive_path)
            if actual_sha != expected_sha:
                raise ValueError(
                    f"SHA-256 mismatch for {asset_name}: expected {expected_sha}, got {actual_sha}"
                )
            safe_extract_tar_gz(archive_path, repo)
        if not bundle_present_and_valid(repo, entry):
            raise RuntimeError(f"Post-extract verification failed for bundle {name!r}")
        downloaded.append(name)

    return {
        "repository": repo_slug,
        "release_tag": release_tag,
        "reused": reused,
        "downloaded": downloaded,
        "missing": missing,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent.parent)
    parser.add_argument("--manifest", type=pathlib.Path, default=None)
    parser.add_argument("--only", nargs="+", default=None, help="Sync only named bundle(s)")
    parser.add_argument("--check", action="store_true", help="Verify local presence without downloading")
    parser.add_argument("--force", action="store_true", help="Re-download even if local files match")
    args = parser.parse_args(argv)

    repo = args.repo.resolve()
    manifest_path = (args.manifest or (repo / "script" / "artifact_manifest.json")).resolve()
    result = sync(repo, manifest_path, only=args.only, check_only=args.check, force=args.force)
    print(json.dumps(result, indent=2))
    if args.check and result["missing"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
