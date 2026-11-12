import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { annotationSystemExtension } from '@src/extensions/codemirror/AnnotationExtension';
import {
    reviewSystemExtension,
    setTrackChanges,
} from '@src/extensions/codemirror/ReviewExtension';
import { encodeAnnotationText } from '@src/utils/annotationTagUtils';

const reviewWrap = (id: string, original: string, current: string) =>
    `\`<### review id: ${id}, user: Claude (ann), time: 1700000000000, original: '${encodeAnnotationText(original)}', responses: [], resolved: false ###>\`${current}\`</### review id: ${id} ###>\``;

const PREFIX = 'Le ';
const DOC = `${PREFIX}${reviewWrap('r1', 'chat', 'chien')} dort.`;
const INSIDE = DOC.indexOf('chien') + 2;

let views: EditorView[] = [];
let active: (string | null)[] = [];
const onActive = (event: Event) =>
    active.push((event as CustomEvent).detail.reviewId);

const createView = (canDecide: boolean) => {
    const view = new EditorView({
        state: EditorState.create({
            doc: DOC,
            extensions: [annotationSystemExtension, reviewSystemExtension],
        }),
        parent: document.body,
    });
    views.push(view);
    setTrackChanges(view, { tracking: false, author: 'ann', canDecide });
    return view;
};

const bar = () => document.querySelector<HTMLElement>('.cm-review-tooltip');

beforeEach(() => {
    active = [];
    document.addEventListener('review-active', onActive);
});

afterEach(() => {
    document.removeEventListener('review-active', onActive);
    for (const view of views) view.destroy();
    views = [];
});

describe('the bar over the change at the cursor', () => {
    it('shows Accept and Reject, and accepting keeps the new text', () => {
        const view = createView(true);
        expect(bar()).toBeNull();

        view.dispatch({ selection: { anchor: INSIDE }, userEvent: 'select' });
        expect(bar()?.dataset.reviewId).toBe('r1');
        expect(active).toEqual(['r1']);

        bar()
            ?.querySelector<HTMLButtonElement>('[data-action="accept-change"]')
            ?.click();
        expect(view.state.doc.toString()).toBe('Le chien dort.');
        expect(bar()).toBeNull();
        expect(active).toEqual(['r1', null]);
    });

    it('rejecting brings back the original text', () => {
        const view = createView(true);
        view.dispatch({ selection: { anchor: INSIDE }, userEvent: 'select' });
        bar()
            ?.querySelector<HTMLButtonElement>('[data-action="reject-change"]')
            ?.click();
        expect(view.state.doc.toString()).toBe('Le chat dort.');
    });

    it('goes away when typing, and outside the change', () => {
        const view = createView(true);
        view.dispatch({ selection: { anchor: INSIDE }, userEvent: 'select' });
        expect(bar()).not.toBeNull();

        view.dispatch({
            changes: { from: INSIDE, insert: 'x' },
            selection: { anchor: INSIDE + 1 },
            userEvent: 'input.type',
        });
        expect(bar()).toBeNull();

        view.dispatch({ selection: { anchor: INSIDE }, userEvent: 'select' });
        expect(bar()).not.toBeNull();
        view.dispatch({ selection: { anchor: 1 }, userEvent: 'select' });
        expect(bar()).toBeNull();
    });

    it('is not offered to those who may not decide, whose card still lights up', () => {
        const view = createView(false);
        view.dispatch({ selection: { anchor: INSIDE }, userEvent: 'select' });
        expect(bar()).toBeNull();
        expect(active).toEqual(['r1']);
    });
});

describe('the bar under a selection over several changes', () => {
    const SEVERAL = `Le ${reviewWrap('r1', 'chat', 'chien')} dort, ${reviewWrap('r2', 'souvent', '')}le ${reviewWrap('r3', 'jour', 'soir')}. Fin ${reviewWrap('r4', 'ici', 'là')}.`;
    const createSeveral = (canDecide: boolean) => {
        const view = new EditorView({
            state: EditorState.create({
                doc: SEVERAL,
                extensions: [annotationSystemExtension, reviewSystemExtension],
            }),
            parent: document.body,
        });
        views.push(view);
        setTrackChanges(view, { tracking: false, author: 'ann', canDecide });
        return view;
    };
    const selectionBar = () =>
        document.querySelector<HTMLElement>('[data-role="review-selection-tooltip"]');
    // From « Le » to « soir »: r1, r2, r3, not r4.
    const selectThree = (view: EditorView) =>
        view.dispatch({
            selection: { anchor: 0, head: SEVERAL.indexOf('soir') + 2 },
            userEvent: 'select',
        });

    it('offers to accept or reject the changes it touches, counted', () => {
        const view = createSeveral(true);
        selectThree(view);
        const accept = selectionBar()?.querySelector<HTMLButtonElement>(
            '[data-action="accept-selected"]',
        );
        expect(accept?.textContent).toBe('✓Accept (3)');
        expect(bar()?.dataset.reviewId).toBeUndefined();
    });

    it('accepting decides them all at once (one transaction), the others left', () => {
        const view = createSeveral(true);
        selectThree(view);
        let transactions = 0;
        const before = view.state.doc;
        const dispatch = view.dispatch.bind(view);
        const spy = jest.spyOn(view, 'dispatch').mockImplementation((...args) => {
            transactions++;
            return dispatch(...(args as Parameters<typeof dispatch>));
        });
        selectionBar()
            ?.querySelector<HTMLButtonElement>('[data-action="accept-selected"]')
            ?.click();
        spy.mockRestore();
        expect(transactions).toBe(1);
        expect(before.toString()).toBe(SEVERAL);
        expect(view.state.doc.toString()).toBe(
            `Le chien dort, le soir. Fin ${reviewWrap('r4', 'ici', 'là')}.`,
        );
        expect(selectionBar()).toBeNull();
    });

    it('rejecting brings back their original text', () => {
        const view = createSeveral(true);
        selectThree(view);
        selectionBar()
            ?.querySelector<HTMLButtonElement>('[data-action="reject-selected"]')
            ?.click();
        expect(view.state.doc.toString()).toBe(
            `Le chat dort, souventle jour. Fin ${reviewWrap('r4', 'ici', 'là')}.`,
        );
    });

    it('not for those who may not decide, nor inside a single change', () => {
        const reader = createSeveral(false);
        selectThree(reader);
        expect(selectionBar()).toBeNull();
        reader.destroy();
        views = views.filter((view) => view !== reader);

        const view = createSeveral(true);
        const inside = SEVERAL.indexOf('chien');
        view.dispatch({ selection: { anchor: inside + 1, head: inside + 4 }, userEvent: 'select' });
        expect(selectionBar()).toBeNull();
        expect(bar()?.dataset.reviewId).toBe('r1');
    });
});
