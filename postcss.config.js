import rtlcss from 'postcss-rtlcss';

import dropPicoGroupRules from './scripts/postcss/drop-pico-group-rules.cjs';

export default {
	plugins: [
		dropPicoGroupRules(),
		rtlcss({
			mode: 'combined',
			ltrPrefix: '[dir="ltr"]',
			rtlPrefix: '[dir="rtl"]',
		}),
	],
};
