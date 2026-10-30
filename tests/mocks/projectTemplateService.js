// The bundled templates are loaded with Vite's import.meta.glob, which Jest
// does not have; tests/unit/utils/projectTemplates.test.ts reads the files.
module.exports = {
	projectTemplateService: {
		previewUrls: async () => ({}),
		createFiles: async () => [],
	},
};
