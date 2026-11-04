// src/components/settings/GrammarRulesEditor.tsx
// The grammar rules turned off from the editor's tooltip, each of which can
// be turned on again.
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	GRAMMAR_RULES_CHANGED,
	disabledGrammarRules,
	enableGrammarRule,
} from '../../utils/grammarRules';

const GrammarRulesEditor: React.FC = () => {
	const { user } = useAuth();
	const userId = user?.id ?? null;
	const [rules, setRules] = useState(() =>
		userId ? disabledGrammarRules(userId) : [],
	);

	useEffect(() => {
		if (!userId) return;
		const refresh = () => setRules(disabledGrammarRules(userId));
		refresh();
		window.addEventListener(GRAMMAR_RULES_CHANGED, refresh);
		return () => window.removeEventListener(GRAMMAR_RULES_CHANGED, refresh);
	}, [userId]);

	if (!userId || rules.length === 0) return null;

	return (
		<div className='ui-field grammar-rules' data-role='grammar-rules-off'>
			<div className='ui-control-label'>{t('Grammar rules turned off')}</div>
			<ul className='grammar-rules-list'>
				{rules.map((rule) => (
					<li key={rule.id} data-rule={rule.id}>
						<span title={rule.id}>{rule.description || rule.id}</span>
						<button
							type='button'
							className='button secondary'
							data-action='enable-grammar-rule'
							onClick={() => enableGrammarRule(userId, rule.id)}
						>
							{t('Turn on again')}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
};

export default GrammarRulesEditor;
