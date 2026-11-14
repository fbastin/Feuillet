import { applyBibChanges, parseBibDocument } from '@/utils/bibDocument';
import {
	findDuplicates,
	mergeChanges,
	mergeRows,
	similarTitles,
} from '@/utils/bibDuplicates';

const pairsOf = (text: string) => {
	const document = parseBibDocument(text);
	return findDuplicates(document).map(
		(pair) =>
			`${document.entries[pair.a].key}+${document.entries[pair.b].key}:${pair.reason}`,
	);
};

describe('findDuplicates', () => {
	it('finds the same DOI, however written', () => {
		expect(
			pairsOf(`
@article{a, title = {Can Quantum-Mechanical Description}, doi = {10.1103/PhysRev.47.777}}
@article{b, title = {Can quantum-mechanical description}, doi = {https://doi.org/10.1103/physrev.47.777}}
`),
		).toEqual(['a+b:doi']);
	});

	it('does not take a chapter given its book’s DOI for the book', () => {
		expect(
			pairsOf(`
@book{book, title = {Numerical Optimization}, doi = {10.1007/978-0-387-40065-5}}
@incollection{chapter, title = {Line Search Methods}, doi = {10.1007/978-0-387-40065-5}}
`),
		).toEqual([]);
	});

	it('finds an arXiv number in eprint, a link, a DOI or Google Scholar’s journal', () => {
		expect(
			pairsOf(`
@misc{a, title = {Attention Is All You Need}, eprint = {1706.03762v7}, archiveprefix = {arXiv}}
@article{b, title = {Attention is all you need}, journal = {arXiv preprint arXiv:1706.03762}, year = {2017}}
@misc{c, title = {Attention is all you need}, url = {https://arxiv.org/abs/1706.03762v2}}
@misc{d, doi = {10.48550/arXiv.1706.03762}}
`),
		).toEqual(['a+b:arxiv', 'a+c:arxiv', 'a+d:arxiv', 'b+c:arxiv', 'b+d:arxiv', 'c+d:arxiv']);
	});

	it('compares ISBNs between books only', () => {
		expect(
			pairsOf(`
@book{a, title = {Numerical Optimization}, isbn = {0-387-30303-0}}
@book{b, title = {Numerical optimization}, isbn = {978-0-387-30303-1}}
@incollection{c, title = {Line Search Methods}, isbn = {978-0-387-30303-1}}
`),
		).toEqual(['a+b:isbn']);
	});

	it('finds the same title, first author and year, a typo apart', () => {
		expect(
			pairsOf(`
@article{CarlSode98, author = {Kenneth Carling and Hans S\\"oderberg}, title = {An experimental comparison of gradient methods in econometric duration analysis}, year = {1998}}
@article{KennHans98, author = {Carling, Kenneth and S{\\"o}derberg, Hans}, title = {An Experimental Comparison of Gradient Methods in Econometric Duration Analysis.}, year = {1998}}
@article{typo, author = {Carling, K.}, title = {An experimental comparision of gradient methods in econometric duration analysis}, year = {1998}}
`),
		).toEqual(['CarlSode98+KennHans98:title', 'CarlSode98+typo:title', 'KennHans98+typo:title']);
	});

	it('keeps apart another author, another year, a short title', () => {
		expect(
			pairsOf(`
@article{a, author = {Smith, John}, title = {A study of trust region methods in practice}, year = {2001}}
@article{b, author = {Jones, Jane}, title = {A study of trust region methods in practice}, year = {2001}}
@article{c, author = {Smith, John}, title = {A study of trust region methods in practice}, year = {2003}}
@article{d, author = {Doe, J.}, title = {Introduction}, year = {2001}}
@article{e, author = {Doe, J.}, title = {Introductions}, year = {2001}}
`),
		).toEqual([]);
	});

	it('finds the same key, whatever the case, as the strongest reason', () => {
		expect(
			pairsOf(`
@article{Benh02, title = {Smart Monte Carlo}, doi = {10.1/x}}
@article{benh02, title = {Smart {M}onte {C}arlo}, doi = {10.1/x}}
`),
		).toEqual(['Benh02+benh02:key']);
	});

	it('tells typos from other titles', () => {
		expect(
			similarTitles(
				'the best of wilmott incorporating the quantitative finance review',
				'the best of wilmott incorporatingthe quantitative finance review',
			),
		).toBe(true);
		expect(
			similarTitles(
				'convergence theory for nonconvex stochastic programming',
				'convergence theory for convex stochastic programming with recourse',
			),
		).toBe(false);
	});
});

describe('merging', () => {
	const TEXT = `@article{kept,
  author  = {Carling, Kenneth and S{\\"o}derberg, Hans},
  title   = {An experimental comparison},
  journal = {CSDA},
  year    = {1998},
}

@string{csda = "Computational Statistics \\& Data Analysis"}

@Article{other,
  Title   = {An Experimental Comparison},
  Journaltitle = csda,
  Year    = 1998,
  Volume  = {27},
  Pages   = {83--97},
}
`;
	const document = parseBibDocument(TEXT);
	const [kept, other] = document.entries;

	it('puts the fields side by side, aliases on one row', () => {
		const rows = mergeRows(kept, other);
		expect(rows.map((row) => [row.name, row.agree])).toEqual([
			['author', true],
			['title', false],
			['journaltitle', false],
			['year', true],
			['volume', true],
			['pages', true],
		]);
		expect(rows[2].fields.map((field) => field?.name)).toEqual([
			'journal',
			'Journaltitle',
		]);
	});

	it('writes the merge in the kept entry, as it writes, and deletes the other', () => {
		const merged = applyBibChanges(
			TEXT,
			mergeChanges(TEXT, kept, other, {
				type: 'article',
				fromOther: new Set(['journaltitle']),
			}),
		);
		expect(merged).toBe(`@article{kept,
  author  = {Carling, Kenneth and S{\\"o}derberg, Hans},
  title   = {An experimental comparison},
  journal = csda,
  year    = {1998},
  volume  = {27},
  pages   = {83--97},
}

@string{csda = "Computational Statistics \\& Data Analysis"}
`);
	});

	it('changes the type when asked, and only what changes', () => {
		const changes = mergeChanges(TEXT, kept, other, {
			type: 'inproceedings',
			fromOther: new Set(),
		});
		expect(changes[0].from).toBe(1);
		expect(applyBibChanges(TEXT, changes).startsWith('@inproceedings{kept,')).toBe(
			true,
		);
	});
});
