import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, useEffect, useRef } from 'react';
import Modal from '@src/components/common/Modal';

describe('Modal Component', () => {
    it('should not render when closed', () => {
        render(
            <Modal isOpen={false} onClose={jest.fn()} title="Test Modal">
                <div>Modal content</div>
            </Modal>
        );

        expect(screen.queryByText('Test Modal')).not.toBeInTheDocument();
    });

    it('should render when open', () => {
        render(
            <Modal isOpen={true} onClose={jest.fn()} title="Test Modal">
                <div>Modal content</div>
            </Modal>
        );

        expect(screen.getByText('Test Modal')).toBeInTheDocument();
        expect(screen.getByText('Modal content')).toBeInTheDocument();
    });

    it('should call onClose when clicking close button', async () => {
        const user = userEvent.setup();
        const onClose = jest.fn();

        render(
            <Modal isOpen={true} onClose={onClose} title="Test Modal">
                <div>Modal content</div>
            </Modal>
        );

        const closeButton = screen.getByRole('button');

        await act(async () => {
            await user.click(closeButton);
        });

        expect(onClose).toHaveBeenCalled();
    });

    describe('clicks outside', () => {
        // A window over the first one, with a button the click removes, as an
        // editor's gutter redrawn on the click (the merge window's arrows).
        // CodeMirror redraws at once: the button is out of the page before
        // the click reaches the document.
        const Above = () => {
            const holder = useRef<HTMLDivElement>(null);
            useEffect(() => {
                if (!holder.current || holder.current.childElementCount > 0) return;
                const button = document.createElement('button');
                button.textContent = 'Take this change';
                button.addEventListener('mousedown', () => {
                    button.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Taken' }));
                });
                holder.current?.append(button);
            }, []);
            return (
                <Modal isOpen onClose={jest.fn()} title="Above" closeOnClickOutside={false}>
                    <div ref={holder} />
                </Modal>
            );
        };

        it('closes the window for a click outside any window', () => {
            const onClose = jest.fn();
            render(
                <Modal isOpen onClose={onClose} title="Below">
                    <div>Below content</div>
                </Modal>,
            );
            fireEvent.mouseDown(document.body);
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('keeps it for a click inside another window', () => {
            const onClose = jest.fn();
            render(
                <>
                    <Modal isOpen onClose={onClose} title="Below">
                        <div>Below content</div>
                    </Modal>
                    <Above />
                </>,
            );
            fireEvent.mouseDown(screen.getByText('Above'));
            expect(onClose).not.toHaveBeenCalled();
        });

        it('keeps it when the click removes what it clicked, in another window', () => {
            const onClose = jest.fn();
            render(
                <>
                    <Modal isOpen onClose={onClose} title="Below">
                        <div>Below content</div>
                    </Modal>
                    <Above />
                </>,
            );
            fireEvent.mouseDown(screen.getByText('Take this change'));
            expect(screen.getByText('Taken')).toBeInTheDocument();
            expect(onClose).not.toHaveBeenCalled();
        });
    });

    it('should render different sizes', () => {
        const { rerender, baseElement } = render(
            <Modal isOpen={true} onClose={jest.fn()} title="Test Modal" size="small">
                <div>Content</div>
            </Modal>
        );

        expect(
            baseElement.querySelector('[data-role="modal"][data-size="small"]')
        ).toBeInTheDocument();

        rerender(
            <Modal isOpen={true} onClose={jest.fn()} title="Test Modal" size="large">
                <div>Content</div>
            </Modal>
        );

        expect(
            baseElement.querySelector('[data-role="modal"][data-size="large"]')
        ).toBeInTheDocument();
    });
});
