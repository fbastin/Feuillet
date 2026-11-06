import {
	nextReleaseTag,
	releaseAssetName,
	tagNameProblem,
} from '../../../src/utils/githubRelease';
import {
	ReleaseUploadError,
	publishRelease,
} from '../../../src/services/GitHubReleaseService';
import type { GitRemoteReleases } from '../../../src/types/gitRemote';

describe('the tag of a GitHub release', () => {
	it('suggests the one after the latest', () => {
		expect(nextReleaseTag(null)).toBe('v1');
		expect(nextReleaseTag('v1')).toBe('v2');
		expect(nextReleaseTag('v9')).toBe('v10');
		expect(nextReleaseTag('1.3')).toBe('1.4');
		expect(nextReleaseTag('v2.0.9')).toBe('v2.0.10');
		expect(nextReleaseTag('soumission')).toBe('v1');
	});

	it('refuses what Git refuses', () => {
		expect(tagNameProblem('')).toBe('empty');
		for (const tag of ['v 1', 'a..b', 'x~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', '-v1', 'v1.', 'v1.lock', 'a//b', '.v1', 'a/.b', '@', 'a@{1}', 'v1/']) {
			expect([tag, tagNameProblem(tag)]).toEqual([tag, 'invalid']);
		}
		for (const tag of ['v1', '2.0', 'v2.0.1', 'soumission-revue', 'thèse/v1', 'release_2026']) {
			expect([tag, tagNameProblem(tag)]).toEqual([tag, null]);
		}
	});

	it('names the PDF after the project and the tag', () => {
		expect(releaseAssetName('Ma thèse', 'v1')).toBe('Ma-these-v1.pdf');
		expect(releaseAssetName('rapport', 'thèse/v2')).toBe('rapport-th-se-v2.pdf');
		expect(releaseAssetName('', 'v1')).toBe('output-v1.pdf');
	});
});

describe('publishing a release', () => {
	const make = () => {
		const calls: string[] = [];
		const releases: GitRemoteReleases = {
			latestTag: jest.fn(),
			tagExists: jest.fn(),
			createDraft: jest.fn(async () => {
				calls.push('draft');
				return { id: 7 };
			}),
			publish: jest.fn(async () => {
				calls.push('publish');
				return { url: 'https://github.com/o/r/releases/tag/v1', tagName: 'v1' };
			}),
			remove: jest.fn(async () => {
				calls.push('remove');
			}),
		};
		return { releases, calls };
	};
	const input = { tagName: 'v1', name: 'v1', body: '', targetCommitish: 'abc', prerelease: false };
	const asset = { name: 'a-v1.pdf', type: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) };

	it('makes a draft, attaches the PDF, then publishes', async () => {
		const { releases, calls } = make();
		const upload = jest.fn(async (id: number) => {
			calls.push(`upload ${id}`);
			return 'https://github.com/o/r/releases/download/v1/a-v1.pdf';
		});
		const result = await publishRelease({ releases, token: 't', repositoryId: 'o/r', input, asset, upload });
		expect(calls).toEqual(['draft', 'upload 7', 'publish']);
		expect(result).toEqual({
			url: 'https://github.com/o/r/releases/tag/v1',
			tagName: 'v1',
			assetUrl: 'https://github.com/o/r/releases/download/v1/a-v1.pdf',
		});
		expect(releases.createDraft).toHaveBeenCalledWith('t', 'o/r', input);
	});

	it('removes the draft when the PDF cannot be attached', async () => {
		const { releases, calls } = make();
		const upload = jest.fn(async () => {
			throw new ReleaseUploadError('upstream_status', 422, 'Validation Failed');
		});
		await expect(
			publishRelease({ releases, token: 't', repositoryId: 'o/r', input, asset, upload }),
		).rejects.toMatchObject({ code: 'upstream_status', status: 422 });
		expect(calls).toEqual(['draft', 'remove']);
	});

	it('removes the draft when publishing fails, and without a PDF uploads nothing', async () => {
		const { releases, calls } = make();
		(releases.publish as jest.Mock).mockRejectedValueOnce(new Error('boom'));
		const upload = jest.fn();
		await expect(
			publishRelease({ releases, token: 't', repositoryId: 'o/r', input, upload }),
		).rejects.toThrow('boom');
		expect(upload).not.toHaveBeenCalled();
		expect(calls).toEqual(['draft', 'remove']);
	});
});
