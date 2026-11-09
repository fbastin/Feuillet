// scripts/postcss/drop-pico-group-rules.cjs
// Pico styles input groups ([role="group"], [role="search"]) by what they
// hold, with :has(); Feuillet has none. In Chrome, these selectors had every
// change anywhere in the page restyle all its buttons (a thousand versions
// listed: 0.3 s at each item drawn), so they are left out of Pico's styles.
const PICO_GROUP = /\[role=["']?(?:group|search)["']?\]:has\(/;

const dropPicoGroupRules = () => ({
	postcssPlugin: 'feuillet-drop-pico-group-rules',
	Rule(rule) {
		if (!rule.source?.input.file?.includes('@picocss')) return;
		if (!PICO_GROUP.test(rule.selector)) return;
		const kept = rule.selectors.filter(
			(selector) => !PICO_GROUP.test(selector),
		);
		if (kept.length === 0) rule.remove();
		else rule.selectors = kept;
	},
});
dropPicoGroupRules.postcss = true;

module.exports = dropPicoGroupRules;
