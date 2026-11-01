import { collaboratorJumpService } from '@src/services/CollaboratorJumpService';

describe('collaboratorJumpService', () => {
    it('gives every listener the same jump, though the first finishes it', () => {
        const seen: unknown[] = [];
        const first = collaboratorJumpService.subscribe((jump) => {
            seen.push(jump);
            collaboratorJumpService.done(jump);
        });
        const second = collaboratorJumpService.subscribe((jump) => seen.push(jump));
        collaboratorJumpService.request({ username: 'ann', documentId: 'd1' });
        first();
        second();
        expect(seen).toHaveLength(2);
        expect(seen[0]).toBe(seen[1]);
        expect(seen[1]).toMatchObject({ username: 'ann', documentId: 'd1' });
        expect(collaboratorJumpService.pending('d1')).toBeNull();
    });

    it('waits in the document it is for, for a while', () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
        collaboratorJumpService.request({ username: 'ann', documentId: 'd1' });
        expect(collaboratorJumpService.pending('d2')).toBeNull();
        expect(collaboratorJumpService.pending('d1')).toMatchObject({ username: 'ann' });
        now.mockReturnValue(1000 + 11000);
        expect(collaboratorJumpService.pending('d1')).toBeNull();
        now.mockRestore();
    });

    it('knows the person by account id, or else by name', () => {
        const byId = { userId: 'u1', username: 'Ann', requestedAt: 0 };
        expect(collaboratorJumpService.matches(byId, { id: 'u1', username: 'x' })).toBe(true);
        expect(collaboratorJumpService.matches(byId, { id: 'u2', username: 'Ann' })).toBe(false);
        const byName = { username: 'Ann', requestedAt: 0 };
        expect(collaboratorJumpService.matches(byName, { username: 'ann' })).toBe(true);
        expect(collaboratorJumpService.matches(byName, null)).toBe(false);
    });
});
