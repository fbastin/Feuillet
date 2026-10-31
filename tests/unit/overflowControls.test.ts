import { overflowingKeys } from '@src/components/common/OverflowControls';

const items = [
    { key: 'visual', priority: 6, node: null },
    { key: 'toolbar', priority: 1, node: null },
    { key: 'formatter', priority: 2, node: null },
    { key: 'file', priority: 1, node: null },
    { key: 'review', priority: Number.POSITIVE_INFINITY, node: null },
    { key: 'plugins', priority: 3, node: null },
];
const widths = new Map(items.map((item) => [item.key, 100]));

describe('overflowingKeys', () => {
    it('keeps everything when it fits', () => {
        expect(overflowingKeys(items, widths, 600, 0, 30)).toEqual([]);
    });

    it('moves the least used first, the rightmost among equals, leaving room for « … »', () => {
        expect(overflowingKeys(items, widths, 590, 0, 30)).toEqual(['file']);
        expect(overflowingKeys(items, widths, 450, 0, 30)).toEqual([
            'toolbar',
            'file',
        ]);
    });

    it('never moves what must stay', () => {
        expect(overflowingKeys(items, widths, 50, 0, 30)).toEqual([
            'visual',
            'toolbar',
            'formatter',
            'file',
            'plugins',
        ]);
    });

    it('ignores what shows nothing', () => {
        const empty = new Map(widths);
        empty.set('plugins', 0);
        expect(overflowingKeys(items, empty, 500, 0, 30)).toEqual([]);
    });
});
