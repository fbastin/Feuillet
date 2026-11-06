import { branchNameProblem, suggestBranchName } from '@src/utils/gitBranch';

jest.mock('@/i18n', () => ({ t: (key: string) => key }));

describe('branchNameProblem', () => {
	it.each(['relecture', 'feuillet-2026-11-06', 'chapitre/2', 'v1.2', 'été'])(
		'accepts %s',
		(name) => expect(branchNameProblem(name)).toBeNull(),
	);

	it.each([
		'',
		'a b',
		'a..b',
		'a//b',
		'/a',
		'a/',
		'.a',
		'a.',
		'a.lock',
		'a/.b',
		'@',
		'a@{b',
		'a~b',
		'a^b',
		'a:b',
		'a?b',
		'a*b',
		'a[b',
		'a\\b',
		'-a',
		'a\u0001b',
		'x'.repeat(101),
	])('refuses %j', (name) => expect(branchNameProblem(name)).not.toBeNull());
});

describe('suggestBranchName', () => {
	const day = new Date(2026, 10, 6);
	it('names the branch for the day', () =>
		expect(suggestBranchName([], day)).toBe('feuillet-2026-11-06'));
	it('adds a number when the name is taken, whatever its case', () =>
		expect(
			suggestBranchName(['Feuillet-2026-11-06', 'feuillet-2026-11-06-2'], day),
		).toBe('feuillet-2026-11-06-3'));
});
