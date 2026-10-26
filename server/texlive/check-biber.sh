#!/bin/sh
# server/texlive/check-biber.sh
# Unpacks Biber into $BIBER_DIR when the image is built, then compiles a
# biblatex document as a session uid would (server.js): its own directory of
# links to the unpacked files, its own home, no write access to $BIBER_DIR.
set -eu

mkdir -p "$BIBER_DIR"
PAR_GLOBAL_TEMP=$BIBER_DIR biber --version
chmod -R a+rX "$BIBER_DIR"

check=$(mktemp -d)
mkdir "$check/biber" "$check/home"
cat >"$check/main.tex" <<'TEX'
\documentclass{article}
\usepackage[backend=biber]{biblatex}
\addbibresource{refs.bib}
\begin{document}
\cite{knuth}
\printbibliography
\end{document}
TEX
cat >"$check/refs.bib" <<'BIB'
@book{knuth, author = {Donald Knuth}, title = {The TeXbook}, year = {1984}}
BIB
chown -R 20000:20000 "$check"
find "$BIBER_DIR" -mindepth 1 -maxdepth 1 ! -name inc.lock \
	-exec ln -s {} "$check/biber/" \;

cd "$check"
if ! setpriv --reuid=20000 --regid=20000 --clear-groups \
	env -i PATH="$PATH" LANG=C.UTF-8 HOME="$check/home" TMPDIR="$check/home" \
	PAR_GLOBAL_TEMP="$check/biber" \
	latexmk -norc -pdf -interaction=nonstopmode main.tex >latexmk.out 2>&1; then
	tail -n 30 latexmk.out
	exit 1
fi
grep -q Knuth main.bbl
cd /
rm -rf "$check"
echo 'Biber works for session uids.'
