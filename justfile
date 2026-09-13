# Release helpers for the Dataform tools VS Code extension.
#
# Typical flow:
#   just changes          # what ships since the last tag
#   just preview patch    # dry-run the bump + changelog
#   just release patch    # local commit + tag (no push)
#   just push-release     # push main + tag -> deploy.yml publishes
#   just watch-deploy     # follow the publish run
#
# Odd minor versions (1.11.x, 1.13.x) publish as pre-releases, matching
# .github/workflows/deploy.yml.

set shell := ["bash", "-euo", "pipefail", "-c"]

# List available recipes
default:
    @just --list --unsorted

# Current version, release channel, and commits since the last tag
version:
    #!/usr/bin/env bash
    set -euo pipefail
    v=$(just _version)
    tag=$(git describe --tags --abbrev=0)
    echo "version:  $v ($(just _channel "$v"))"
    echo "last tag: $tag"
    echo "commits since $tag: $(git rev-list --count "$tag"..HEAD)"

# Commits since the last tag (what the next release would ship)
changes:
    #!/usr/bin/env bash
    set -euo pipefail
    tag=$(git describe --tags --abbrev=0)
    git log --oneline --no-decorate "$tag"..HEAD

# Fail unless on a clean main that matches origin/main
preflight:
    #!/usr/bin/env bash
    set -euo pipefail
    branch=$(git rev-parse --abbrev-ref HEAD)
    if [ "$branch" != "main" ]; then
        echo "error: releases are cut from main (currently on '$branch')" >&2
        exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
        echo "error: working tree is not clean" >&2
        git status --short >&2
        exit 1
    fi
    git fetch --quiet --tags origin main
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
        echo "error: local main differs from origin/main (pull or push first)" >&2
        exit 1
    fi
    echo "preflight ok: clean main at $(git rev-parse --short HEAD)"

# Type-check, lint, lint README, and run a production build
check:
    npm run check-types
    npm run lint
    markdownlint-cli2 README.md
    npm run package

# Run the extension test suite (slow, macOS only)
test:
    npm run test

# Dry-run the version bump and changelog (bump: patch | minor | major | X.Y.Z)
preview bump="patch":
    #!/usr/bin/env bash
    set -euo pipefail
    out=$(standard-version --dry-run --release-as {{bump}})
    echo "$out"
    next=$(echo "$out" | grep -oE 'to [0-9]+\.[0-9]+\.[0-9]+' | head -1 | cut -d' ' -f2 || true)
    if [ -n "$next" ]; then
        echo
        echo "next version: $next ($(just _channel "$next"))"
        just _warn-if-prerelease "$next"
    fi

# Build a local VSIX the same way CI does (pre-release flag for odd minors)
package:
    #!/usr/bin/env bash
    set -euo pipefail
    v=$(just _version)
    if [ "$(just _channel "$v")" = "pre-release" ]; then
        npx --yes @vscode/vsce@3 package --pre-release
    else
        npx --yes @vscode/vsce@3 package
    fi

# Bump version, update CHANGELOG, commit and tag locally (does NOT push)
release bump="patch": preflight check
    #!/usr/bin/env bash
    set -euo pipefail
    standard-version --release-as {{bump}}
    v=$(just _version)
    echo
    echo "created v$v ($(just _channel "$v")) locally"
    just _warn-if-prerelease "$v"
    echo "review:  git show --stat HEAD"
    echo "publish: just push-release"
    echo "abort:   just undo-release"

# Drop an unpushed local release commit and its tag
undo-release:
    #!/usr/bin/env bash
    set -euo pipefail
    v=$(just _version)
    tag="v$v"
    subject=$(git log -1 --format=%s)
    if [ "$subject" != "chore(release): $v" ]; then
        echo "error: HEAD is not the release commit for $v (HEAD: '$subject')" >&2
        exit 1
    fi
    if [ "$(git rev-parse -q --verify "refs/tags/$tag^{commit}" || true)" != "$(git rev-parse HEAD)" ]; then
        echo "error: local tag $tag does not point at HEAD" >&2
        exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
        echo "error: working tree is not clean; refusing to reset" >&2
        exit 1
    fi
    if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
        echo "error: $tag is already on origin; it has been published, do not undo it locally" >&2
        exit 1
    fi
    if git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
        echo "error: the release commit is already on origin/main" >&2
        exit 1
    fi
    read -r -p "Delete tag $tag and reset main to HEAD~1? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }
    git tag -d "$tag"
    git reset --hard HEAD~1
    echo "undid local release $tag"

# Push main and the release tag; this publishes to the marketplaces
push-release:
    #!/usr/bin/env bash
    set -euo pipefail
    v=$(just _version)
    tag="v$v"
    if [ "$(git log -1 --format=%s)" != "chore(release): $v" ]; then
        echo "error: HEAD is not the release commit for $v; run 'just release' first" >&2
        exit 1
    fi
    if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
        echo "error: tag $tag does not exist locally" >&2
        exit 1
    fi
    just _warn-if-prerelease "$v"
    read -r -p "Push main + $tag and publish $v ($(just _channel "$v")) to VS Marketplace and Open VSX? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }
    git push --follow-tags origin main
    echo "pushed $tag; follow the publish with: just watch-deploy"

# Watch the deploy.yml run for a tag (default: current version)
watch-deploy tag="":
    #!/usr/bin/env bash
    set -euo pipefail
    tag="{{tag}}"
    [ -n "$tag" ] || tag="v$(just _version)"
    run=""
    for _ in $(seq 1 12); do
        run=$(gh run list --workflow deploy.yml --branch "$tag" --limit 1 --json databaseId -q '.[0].databaseId')
        [ -n "$run" ] && break
        echo "waiting for the deploy run for $tag to appear..."
        sleep 5
    done
    if [ -z "$run" ]; then
        echo "error: no deploy.yml run found for $tag" >&2
        exit 1
    fi
    gh run watch "$run" --exit-status

# Download the VSIX built by CI for a tag (default: current version)
download-vsix tag="":
    #!/usr/bin/env bash
    set -euo pipefail
    tag="{{tag}}"
    [ -n "$tag" ] || tag="v$(just _version)"
    run=$(gh run list --workflow deploy.yml --branch "$tag" --limit 1 --json databaseId -q '.[0].databaseId')
    if [ -z "$run" ]; then
        echo "error: no deploy.yml run found for $tag" >&2
        exit 1
    fi
    dir="release-vsix/$tag"
    gh run download "$run" -n extension-vsix -D "$dir"
    echo "downloaded to $dir"

# Release, push, and watch the publish in one go
ship bump="patch": (release bump)
    just push-release
    just watch-deploy

_version:
    @node -p "require('./package.json').version"

_channel v:
    @if [ $(( $(echo "{{v}}" | cut -d. -f2) % 2 )) -ne 0 ]; then echo pre-release; else echo stable; fi

_warn-if-prerelease v:
    @if [ "$(just _channel {{v}})" = "pre-release" ]; then echo "warning: {{v}} has an odd minor version and will publish as a PRE-RELEASE"; fi
