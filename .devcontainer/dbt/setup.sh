#!/usr/bin/env bash
# Installs both dbt engines in the dev container, outside the Project, so that the extension has to find them.
set -euo pipefail

# dbt-core with the BigQuery adapter, in a virtual environment of its own. `dbt-core` on PATH is a link to it
sudo python -m venv /opt/dbt-core
sudo /opt/dbt-core/bin/pip install --quiet --upgrade pip
sudo /opt/dbt-core/bin/pip install --quiet dbt-core dbt-bigquery
sudo ln -sf /opt/dbt-core/bin/dbt /usr/local/bin/dbt-core

# dbt v2 (the Fusion engine), by dbt Labs' installer, into ~/.local/bin as `dbt`: the one the extension finds first
curl -fsSL https://public.cdn.getdbt.com/fs/install/install.sh | sh -s -- --update || echo "dbt v2 was not installed: see .devcontainer/dbt/README.md"

echo
echo "dbt-core: $(/opt/dbt-core/bin/dbt --version 2>/dev/null | sed -n '2p' || echo 'not installed')"
echo "dbt v2:   $("$HOME/.local/bin/dbt" --version 2>/dev/null | head -1 || echo 'not installed')"
echo "Next: gcloud auth application-default login"
