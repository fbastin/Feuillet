#!/bin/sh
# server/texlive/check-biber.sh
# Unpacks Biber into $BIBER_DIR when the image is built, then compiles a
# biblatex document as a session uid would (server.js): its own directory of
# links to the unpacked files, its own home, no write access to $BIBER_DIR.
#
# Biber unpacks its compiled libraries only when a run needs them, next to
# the unpacked copy. At run time the session directories are on a tmpfs where
# nothing may run, so the libraries a session run unpacks are added to
# $BIBER_DIR, and the check fails if a second session run still unpacks any.
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

# Compiles the document in a new directory as uid 20000 and prints what the
# run unpacked next to the links.
session_run() {
	dir=$(mktemp -d)
	document "$dir"
	mkdir "$dir/biber" "$dir/home"
	chown -R 20000:20000 "$dir"
	find "$BIBER_DIR" -mindepth 1 -maxdepth 1 ! -name inc.lock \
		-exec ln -s {} "$dir/biber/" \;
	if ! (cd "$dir" && setpriv --reuid=20000 --regid=20000 --clear-groups \
		env -i PATH="$PATH" LANG=C.UTF-8 HOME="$dir/home" TMPDIR="$dir/home" \
		PAR_GLOBAL_TEMP="$dir/biber" \
		latexmk -norc -pdf -interaction=nonstopmode main.tex >latexmk.out 2>&1); then
		tail -n 30 "$dir/latexmk.out" >&2
		exit 1
	fi
	grep -q Knuth "$dir/main.bbl"
	echo "$dir"
}

unpacked() {
	find "$1/biber" -mindepth 1 -maxdepth 1 ! -type l ! -name inc.lock
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
echo "Unpacked copy: $(find "$BIBER_DIR" -maxdepth 1 -name '*.so' | wc -l) libraries"

first=$(session_run)
for file in $(unpacked "$first"); do
	install -m 0755 -o root -g root "$file" "$BIBER_DIR/"
	echo "Added $(basename "$file") from the session run"
done
rm -rf "$first"

second=$(session_run)
if [ -n "$(unpacked "$second")" ]; then
	echo 'A session run still unpacks files:' >&2
	for file in $(unpacked "$second"); do
		ls -la "$file" "$BIBER_DIR/$(basename "$file")" >&2 || true
	done
	exit 1
fi
rm -rf "$second"
echo 'Biber works for session uids.'
