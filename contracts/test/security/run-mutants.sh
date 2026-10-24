#!/usr/bin/env bash
# Mutation testing for ReceivablesPool.sol and ClaimRegistry.sol (security campaign, Workstream D).
#
# Generates mutants with Gambit, runs the forge suite (fork tests excluded) against each one in parallel
# throwaway copies of contracts/, and writes results.tsv: id, file, line, operator, status (killed/survived/timeout).
# The real src/ is never touched; every worker mutates its own copy.
#
# Usage (from anywhere):
#   test/security/run-mutants.sh                  # generate + run all mutants, 4 workers
#   JOBS=6 test/security/run-mutants.sh
#   MUTANTS_DIR=/path/to/gambit_out test/security/run-mutants.sh       # reuse a previous generation
#   ONLY="12 57 301" MUTANTS_DIR=... test/security/run-mutants.sh      # rerun selected ids (e.g. last survivors)
#   ONLY="$(awk -F'\t' '$5=="survived"{print $1}' old/results.tsv)" MUTANTS_DIR=... test/security/run-mutants.sh
# Env:
#   SOLC         solc 0.8.28 binary (default: foundry's svm copy)
#   WORK_DIR     where workers, mutants and results go (default: $TMPDIR/mutation-<pid>)
#   JOBS         parallel workers (default 4)
#   TEST_TIMEOUT seconds per mutant test run (default 600)
#   FORGE_ARGS   extra args for forge test (default: --no-match-path 'test/fork/*')
#   OPERATORS    gambit operators (default below: arithmetic/relational, unary, require, assignment,
#                if-condition, statement deletion, operand swap)
set -euo pipefail
set -f # no globbing: FORGE_ARGS carries path patterns

CONTRACTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JOBS="${JOBS:-4}"
TEST_TIMEOUT="${TEST_TIMEOUT:-600}"
WORK_DIR="${WORK_DIR:-${TMPDIR:-/tmp}/mutation-$$}"
SOLC="${SOLC:-}"
if [[ -z "$SOLC" ]]; then
    for c in "$HOME/.svm/0.8.28/solc-0.8.28" "$HOME/Library/Application Support/svm/0.8.28/solc-0.8.28"; do
        [[ -x "$c" ]] && SOLC="$c" && break
    done
fi
OPERATORS="${OPERATORS:-binary-op-mutation unary-operator-mutation require-mutation assignment-mutation if-statement-mutation delete-expression-mutation swap-arguments-operator-mutation}"
FILES=(src/ReceivablesPool.sol src/ClaimRegistry.sol)
read -r -a FARGS <<<"${FORGE_ARGS:---no-match-path test/fork/*}"

mkdir -p "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"
echo "work dir: $WORK_DIR"

# gambit chokes on paths with spaces, so link solc into the work dir
if [[ -z "${MUTANTS_DIR:-}" ]]; then
    [[ -n "$SOLC" ]] || { echo "set SOLC to a solc 0.8.28 binary" >&2; exit 1; }
    ln -sf "$SOLC" "$WORK_DIR/solc"
    ops_json="$(printf '"%s",' $OPERATORS)"; ops_json="[${ops_json%,}]"
    {
        echo "["
        sep=""
        for f in "${FILES[@]}"; do
            # gambit resolves relative paths against the config file's directory, so pass absolute ones
            printf '%s{"filename":"%s","sourceroot":"%s","solc":"%s","solc_remappings":["@openzeppelin/contracts/=%s/lib/openzeppelin-contracts/contracts/"],"mutations":%s}\n' \
                "$sep" "$CONTRACTS/$f" "$CONTRACTS" "$WORK_DIR/solc" "$CONTRACTS" "$ops_json"
            sep=","
        done
        echo "]"
    } >"$WORK_DIR/gambit.json"
    # gambit writes ./gambit_out relative to the cwd when run with --json
    rm -rf "$WORK_DIR/gambit_out"
    (cd "$WORK_DIR" && gambit mutate --json "$WORK_DIR/gambit.json")
    MUTANTS_DIR="$WORK_DIR/gambit_out"
fi
MUTANTS_DIR="$(cd "$MUTANTS_DIR" && pwd)"
RESULTS="$WORK_DIR/results.tsv"

if [[ -n "${ONLY:-}" ]]; then
    IDS=($ONLY)
else
    IDS=($(jq -r '.[].id' "$MUTANTS_DIR/gambit_results.json"))
fi
echo "${#IDS[@]} mutants, $JOBS workers"

# foundry.toml grants fs access to ../deployments (Deploy.t.sol reads it); give the workers a private copy
rm -rf "$WORK_DIR/deployments"
[[ -d "$CONTRACTS/../deployments" ]] && cp -R "$CONTRACTS/../deployments" "$WORK_DIR/deployments"

# one throwaway copy of contracts/ per worker; lib/ is shared read-only through a symlink
for ((w = 0; w < JOBS; w++)); do
    wd="$WORK_DIR/w$w"
    rm -rf "$wd"
    mkdir -p "$wd"
    rsync -a --exclude lib --exclude out --exclude cache --exclude 'out-*' --exclude 'cache-*' "$CONTRACTS/" "$wd/"
    ln -s "$CONTRACTS/lib" "$wd/lib"
    # the linter only adds build time here
    sed -i.bak 's/^\[lint\]$/[lint]\nlint_on_build = false/' "$wd/foundry.toml" && rm -f "$wd/foundry.toml.bak"
    (cd "$wd" && forge build >/dev/null 2>&1) || { echo "worker $w baseline build failed" >&2; exit 1; }
done
# the unmutated suite must pass, or every mutant would count as killed
(cd "$WORK_DIR/w0" && forge test "${FARGS[@]}" >"$WORK_DIR/baseline.txt" 2>&1) ||
    { echo "baseline test run fails on unmutated src, see $WORK_DIR/baseline.txt" >&2; exit 1; }

run_one() {
    local w="$1" id="$2"
    local wd="$WORK_DIR/w$w"
    local orig desc line status
    orig="$(jq -r --arg id "$id" '.[] | select(.id == $id) | .original' "$MUTANTS_DIR/gambit_results.json")"
    desc="$(jq -r --arg id "$id" '.[] | select(.id == $id) | .description' "$MUTANTS_DIR/gambit_results.json")"
    line="$(diff "$CONTRACTS/$orig" "$MUTANTS_DIR/mutants/$id/$orig" | grep -m1 -oE '^[0-9]+' || true)"
    cp "$MUTANTS_DIR/mutants/$id/$orig" "$wd/$orig"
    local rc=0
    (cd "$wd" && perl -e 'alarm shift; exec @ARGV' "$TEST_TIMEOUT" \
        forge test --fail-fast "${FARGS[@]}" >"$WORK_DIR/log-$id.txt" 2>&1) || rc=$?
    cp "$CONTRACTS/$orig" "$wd/$orig"
    if [[ $rc -eq 0 ]]; then
        status=survived
    elif [[ $rc -eq 142 ]]; then
        status=timeout
    else
        status=killed
        rm -f "$WORK_DIR/log-$id.txt"
    fi
    printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$orig" "$line" "$desc" "$status" >>"$RESULTS"
    echo "[$w] mutant $id ($orig:$line $desc): $status"
}

: >"$RESULTS"
for ((w = 0; w < JOBS; w++)); do
    (
        for ((i = w; i < ${#IDS[@]}; i += JOBS)); do
            run_one "$w" "${IDS[$i]}"
        done
    ) &
done
wait

sort -n -o "$RESULTS" "$RESULTS"
total=$(wc -l <"$RESULTS" | tr -d ' ')
killed=$(awk -F'\t' '$5=="killed"' "$RESULTS" | wc -l | tr -d ' ')
survived=$(awk -F'\t' '$5=="survived"' "$RESULTS" | wc -l | tr -d ' ')
timeout=$(awk -F'\t' '$5=="timeout"' "$RESULTS" | wc -l | tr -d ' ')
echo "total $total, killed $killed, survived $survived, timeout $timeout"
echo "survivors (diffs):"
awk -F'\t' '$5=="survived"{print $1}' "$RESULTS" | while read -r id; do
    jq -r --arg id "$id" '.[] | select(.id == $id) | "--- mutant \(.id) \(.original)\n\(.diff)"' "$MUTANTS_DIR/gambit_results.json"
done | tee "$WORK_DIR/survivors.diff" | grep -E '^(--- mutant|\+ *///)' || true
echo "results: $RESULTS"
