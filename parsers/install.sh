#!/usr/bin/env bash

SCRIPT_DIR=$(c\d $(dirname "${BASH_SOURCE[0]}") && pwd)
cd ${SCRIPT_DIR}
if [[ $# > 0 ]]
then
    dirs=($(realpath --relative-to=${SCRIPT_DIR} "$@"))
else
    dirs=$(ls -d sv*/)
fi
for dir in ${dirs[@]}
do
    cd ${dir}
    tree-sitter generate
    tree-sitter build-wasm
    [[ -f package.json ]] && mv -f package.json package.orig.json || true
    cd -
done
