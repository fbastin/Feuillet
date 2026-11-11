# Commands of LaTeX packages and classes, from TeXstudio

These files are derived from the completion word lists of
[TeXstudio](https://github.com/texstudio-org/texstudio) (`completion/*.cwl`,
commit 1c19b361f2dc533a93bd6d1758f8a7d2e130430b), by their authors and TeXstudio's contributors, under the
GNU General Public License version 3 (see [COPYING](COPYING)).

`scripts/generate-texstudio-commands.ts` writes them: the packages' includes
and their commands and environments, without TeXstudio's classification
(those it never offers, marks unusual or keeps for some arguments left out),
and the keys their commands and options take, with the arguments that take
them. `core.json` holds the packages that 30 or more others
include and the common ones, `core-keyvals.json` their keys; the others are
in `shard-NNN.json` by a hash of their name (`texstudioShards.ts`), with
their keys. Feuillet's editor loads those of the packages a project uses, for
its completion of commands and options.
