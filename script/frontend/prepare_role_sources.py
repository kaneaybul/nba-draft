"""Run canonical R source prep, stopping before any minute or injury allocation."""
import argparse
import os
from datetime import date
from pathlib import Path
import subprocess
from dated_source_receipts import make_r_receipt


def prepare(repo, output, asof, season):
    repo = Path(repo).resolve(strict=True)
    output = Path(output).resolve()
    scripts = Path(__file__).resolve().parent
    if str(date.fromisoformat(asof)) != asof or type(season) is not int:
        raise ValueError("Invalid date or season")
    if output == repo or repo in output.parents:
        raise ValueError("Role source prep must stage private intermediate outputs outside the checkout")
    output.mkdir(exist_ok=False)
    artifacts = {}
    for name, script in {"demographics": "prepare_role_demographics.R", "schedule": "prepare_role_schedule.R"}.items():
        artifact = output / f"{name}.json"
        args = ["Rscript", "--vanilla", str(scripts / script), str(repo), str(artifact), str(season)]
        with (output / f"{name}.log").open("x") as log:
            subprocess.run(args, cwd=repo, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=600,
                           env={**os.environ, "NBA_REFRESH_SCHEDULES": "false", "NBA_ROLLING_ROLE_FILE": "",
                                "NBA_ROLLING_ROLE_AS_OF": "", "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"})
        artifacts[name] = artifact
    make_r_receipt(output/"receipt.json", **artifacts, asof=asof, season=season)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asof", required=True)
    parser.add_argument("--season", type=int, required=True)
    prepare(**vars(parser.parse_args()))
