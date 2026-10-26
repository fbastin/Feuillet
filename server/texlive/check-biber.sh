#!/bin/sh
# server/texlive/check-biber.sh
# Unpacks Biber into $BIBER_DIR when the image is built, then compiles a
# biblatex document as a session uid would (server.js): its own directory of
# links to the unpacked files, its own home, no write access to $BIBER_DIR.
#
# Biber unpacks some of its modules only when a run first needs them. At run
# time the session directories are on a tmpfs where nothing may run, so a
# full run here unpacks them into $BIBER_DIR, and the check fails if the
# session run still had to unpack anything.
set -eu

document() {
	mkdir -p "$1"
	cat >"$1/main.tex" <<'TEX'
\documentclass{article}
\usepackage[french,english]{babel}
\usepackage[backend=biber,style=authoryear,sorting=nyt]{biblatex}
\addbibresource{refs.bib}
\begin{document}
\cite{knuth,lamport}
\printbibliography
\end{document}
TEX
	cat >"$1/refs.bib" <<'BIB'
@book{knuth, author = {Donald Knuth}, title = {The TeXbook}, year = {1984}}
@book{lamport, author = {Leslie Lamport}, title = {\LaTeX}, year = {1994}}
BIB
}

mkdir -p "$BIBER_DIR"
warm=$(mktemp -d)
document "$warm"
(cd "$warm" && PAR_GLOBAL_TEMP=$BIBER_DIR \
	latexmk -norc -pdf -interaction=nonstopmode main.tex >latexmk.out 2>&1) || {
	tail -n 30 "$warm/latexmk.out"
	exit 1
}
rm -rf "$warm"
chmod -R a+rX "$BIBER_DIR"

check=$(mktemp -d)
document "$check"
mkdir "$check/biber" "$check/home"
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
unpacked=$(find "$check/biber" -mindepth 1 ! -type l ! -name inc.lock)
if [ -n "$unpacked" ]; then
	echo "Biber unpacked files for the session uid:" >&2
	echo "$unpacked" >&2
	exit 1
fi
cd /
rm -rf "$check"
echo 'Biber works for session uids.'
