import { render } from '@testing-library/react';
import OverflowControls, {
    type OverflowItem,
} from '@src/components/common/OverflowControls';

// The header's controls are measured when they come and go (and, in the
// browser, when a size changes), not at each render of the editor: each
// measure lays the whole page out again.
describe('OverflowControls', () => {
    const items = (keys: string[], label = 'x'): OverflowItem[] =>
        keys.map((key) => ({
            key,
            priority: 1,
            node: <button type="button">{`${key} ${label}`}</button>,
        }));
    const inHeader = (list: OverflowItem[]) => (
        <div className="ui-panel-header">
            <div>
                <OverflowControls items={list} />
            </div>
        </div>
    );

    let measures: jest.SpyInstance;
    beforeEach(() => {
        measures = jest.spyOn(Element.prototype, 'getBoundingClientRect');
    });
    afterEach(() => measures.mockRestore());

    it('measures on the first render', () => {
        render(inHeader(items(['review', 'file'])));
        expect(measures).toHaveBeenCalled();
    });

    it('does not measure again when the editor renders with the same controls', () => {
        const { rerender } = render(inHeader(items(['review', 'file'])));
        measures.mockClear();
        rerender(inHeader(items(['review', 'file'], 'y')));
        rerender(inHeader(items(['review', 'file'], 'z')));
        expect(measures).not.toHaveBeenCalled();
    });

    it('measures again when a control comes or goes', () => {
        const { rerender } = render(inHeader(items(['review', 'file'])));
        measures.mockClear();
        rerender(inHeader(items(['review', 'file', 'formatter'])));
        expect(measures).toHaveBeenCalled();
        measures.mockClear();
        rerender(inHeader(items(['review'])));
        expect(measures).toHaveBeenCalled();
    });
});
