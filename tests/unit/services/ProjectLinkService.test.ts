type Service = typeof import('@src/services/ProjectLinkService').projectLinkService;

const load = (): Service => {
	let service: Service | undefined;
	jest.isolateModules(() => {
		service = require('@src/services/ProjectLinkService').projectLinkService;
	});
	return service as Service;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ProjectLinkService', () => {
	beforeEach(() => localStorage.clear());

	it('opens a project under its own id until its link is replaced', () => {
		const links = load();
		expect(links.serverId('local')).toBe('local');

		links.setServerId('local', 'new-link');

		expect(links.serverId('local')).toBe('new-link');
		expect(links.localId('new-link')).toBe('local');
		expect(links.localId('someone-else')).toBe('someone-else');
	});

	it('remembers the new link across reloads', () => {
		load().setServerId('local', 'new-link');

		expect(load().serverId('local')).toBe('new-link');
	});

	it('shows the link others can open in the address bar, and back', () => {
		const links = load();
		links.setServerId('local', 'new-link');

		expect(links.toServerUrl('yjs:local&doc:abc')).toBe('yjs:new-link&doc:abc');
		expect(links.toLocalUrl('yjs:new-link&doc:abc')).toBe('yjs:local&doc:abc');
		expect(links.toServerUrl('yjs:other')).toBe('yjs:other');
	});

	it('tells listeners when a project moves to a new link', () => {
		const links = load();
		const listener = jest.fn();
		links.addListener(listener);

		links.setServerId('local', 'new-link');
		links.setServerId('local', 'new-link');

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith('local', 'new-link');
	});

	it("moves an owner's device to the current link when the old one is refused", async () => {
		const links = load();
		const recovery = jest.fn(async () => 'current-link');
		links.setRecovery(recovery);

		links.reportRefused('local', 'local');
		links.reportRefused('local', 'local');
		await settle();

		expect(recovery).toHaveBeenCalledTimes(1);
		expect(links.serverId('local')).toBe('current-link');
		expect(links.isCutOff('local')).toBe(false);
	});

	it('cuts off anyone else', async () => {
		const links = load();
		const cutOff = jest.fn();
		links.addCutOffListener(cutOff);
		links.setRecovery(async () => {
			throw new Error('link_replaced');
		});

		links.reportRefused('local', 'local');
		await settle();

		expect(links.isCutOff('local')).toBe(true);
		expect(links.serverId('local')).toBe('local');
		expect(cutOff).toHaveBeenCalledWith('local');
	});

	it('ignores refusals of a link the project already left', async () => {
		const links = load();
		const recovery = jest.fn(async () => null);
		links.setRecovery(recovery);
		links.setServerId('local', 'current-link');

		links.reportRefused('local', 'local');
		await settle();

		expect(recovery).not.toHaveBeenCalled();
		expect(links.isCutOff('local')).toBe(false);
	});
});
