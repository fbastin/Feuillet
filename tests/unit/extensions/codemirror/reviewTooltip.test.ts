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
