// src/utils/grammarRules.ts
// The grammar rules a user turned off (« Désactiver cette règle »), kept in
// this browser, with what the rule says, for Settings to list them.

export interface DisabledGrammarRule {
	id: string;
	description: string;
}

/** Sent on window when the rules turned off change. */
export const GRAMMAR_RULES_CHANGED = 'feuillet-grammar-rules-changed';

const keyOf = (userId: string) => `feuillet-grammar-rules-off-${userId}`;
const RULE_ID = /^[A-Za-z0-9_]{1,100}$/;

export function disabledGrammarRules(userId: string): DisabledGrammarRule[] {
	try {
		const stored = JSON.parse(localStorage.getItem(keyOf(userId)) ?? '[]');
		return (Array.isArray(stored) ? stored : []).filter(
			(rule): rule is DisabledGrammarRule =>
				typeof rule?.id === 'string' &&
				RULE_ID.test(rule.id) &&
				typeof rule.description === 'string',
		);
	} catch {
		return [];
	}
}

const save = (userId: string, rules: DisabledGrammarRule[]) => {
	localStorage.setItem(keyOf(userId), JSON.stringify(rules.slice(0, 100)));
	window.dispatchEvent(
		new CustomEvent(GRAMMAR_RULES_CHANGED, { detail: { userId } }),
	);
};

export function disableGrammarRule(
	userId: string,
	rule: DisabledGrammarRule,
): void {
	if (!RULE_ID.test(rule.id)) return;
	const rules = disabledGrammarRules(userId).filter(
		(known) => known.id !== rule.id,
	);
	save(userId, [
		...rules,
		{ id: rule.id, description: rule.description.slice(0, 200) },
	]);
}

export function enableGrammarRule(userId: string, id: string): void {
	save(
		userId,
		disabledGrammarRules(userId).filter((rule) => rule.id !== id),
	);
}
