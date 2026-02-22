const normalizeText = (value, maxLength = 500) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

export const normalizeStrategyPromptPayload = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const recommendedFormat = normalizeText(raw.recommendedFormat || raw.recommended_format || '', 40).toLowerCase();
  const normalized = {
    strategyId: raw.strategyId ?? null,
    promptId: raw.promptId ?? raw.id ?? null,
    idea: normalizeText(raw.idea, 600),
    instruction: normalizeText(raw.instruction, 500),
    category: normalizeText(raw.category, 120),
    recommendedFormat: recommendedFormat || 'single_tweet',
    goal: normalizeText(raw.goal, 160),
    hashtagsHint: normalizeText(raw.hashtagsHint || raw.hashtags_hint, 160),
    extraContext: normalizeText(raw.extraContext || raw.extra_context, 2000),
  };

  if (!normalized.idea || normalized.idea.length < 5) {
    return null;
  }

  if (!['single_tweet', 'thread', 'question', 'poll'].includes(normalized.recommendedFormat)) {
    normalized.recommendedFormat = 'single_tweet';
  }

  return normalized;
};

const styleInstruction = (style = 'casual') => {
  const map = {
    professional: 'Use a professional, business-appropriate tone.',
    casual: 'Use a casual, conversational tone.',
    humorous: 'Use light humor where appropriate, but keep it clear.',
    inspirational: 'Use an encouraging, motivational tone grounded in specifics.',
    informative: 'Use an informative, educational tone with clear takeaways.',
  };
  return map[style] || map.casual;
};

export const buildStrategyGenerationPrompt = ({
  strategyPrompt,
  isThread = false,
  style = 'casual',
  retryContext = null,
}) => {
  const sp = normalizeStrategyPromptPayload(strategyPrompt);
  if (!sp) return null;
  const MAX_PROVIDER_PROMPT_CHARS = 1900;

  const lines = [
    isThread
      ? 'Write ONE complete X (Twitter) thread.'
      : 'Write ONE complete X (Twitter) post (single tweet).',
    styleInstruction(style),
    'Return only the final content. No labels, no quotes, no preface.',
    'Do not start with meta text like "Okay", "Sure", "Here is", or "Here\'s".',
    'Do not leave the output unfinished or cut off mid-sentence.',
  ];

  if (isThread) {
    lines.push(
      'Thread requirements:',
      '- Produce 3 to 5 tweets.',
      '- Separate tweets using --- exactly.',
      '- Keep each tweet under 280 characters.',
      '- Make the thread flow logically from hook to takeaway.'
    );
  } else {
    lines.push(
      'Single tweet requirements:',
      '- Keep it under 260 characters unless the prompt explicitly requires more detail.',
      '- Make it complete and publish-ready.'
    );
  }

  const compactIdea = normalizeText(sp.idea, 420);
  const compactInstruction = normalizeText(sp.instruction, 320);
  const compactCategory = normalizeText(sp.category, 80);
  const compactGoal = normalizeText(sp.goal, 120);
  const compactHashtagsHint = normalizeText(sp.hashtagsHint, 100);

  lines.push(`Core idea: ${compactIdea}`);

  if (compactInstruction) lines.push(`Execution instruction: ${compactInstruction}`);
  if (compactCategory) lines.push(`Content category: ${compactCategory}`);
  if (compactGoal) lines.push(`Primary goal: ${compactGoal}`);
  if (compactHashtagsHint) lines.push(`Hashtag hint: ${compactHashtagsHint}`);

  if (retryContext && Array.isArray(retryContext.issues) && retryContext.issues.length > 0) {
    lines.push(
      'Your previous draft failed quality checks. Fix these issues in the new output:',
      ...retryContext.issues.map((issue) => `- ${issue}`)
    );
  }

  if (sp.extraContext) {
    const extraContextPrefix = 'Additional user context: ';
    const currentLength = lines.join('\n').length;
    const remainingBudget = MAX_PROVIDER_PROMPT_CHARS - currentLength - extraContextPrefix.length - 1;
    if (remainingBudget > 40) {
      const compactExtraContext = normalizeText(sp.extraContext, Math.min(remainingBudget, 550));
      if (compactExtraContext) {
        lines.push(`${extraContextPrefix}${compactExtraContext}`);
      }
    }
  }

  return lines.join('\n');
};

const stripLeadingThreadMarkers = (part = '') =>
  String(part || '')
    .trim()
    .replace(/^\s*\d+\s*[\).\-\:]\s*/, '')
    .trim();

const splitSentences = (text = '') =>
  String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const buildPartsFromSentences = (text = '', maxChars = 250) => {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];
  const parts = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if ((current + ' ' + sentence).length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      parts.push(current.trim());
      current = sentence;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const mergePartsToMax = (parts = [], maxParts = 5) => {
  const next = parts.map((p) => p.trim()).filter(Boolean);
  if (next.length <= maxParts) return next;

  while (next.length > maxParts) {
    // Merge the shortest adjacent pair to preserve readability.
    let bestIndex = 0;
    let bestScore = Infinity;
    for (let i = 0; i < next.length - 1; i += 1) {
      const score = next[i].length + next[i + 1].length;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    next.splice(bestIndex, 2, `${next[bestIndex]} ${next[bestIndex + 1]}`.trim());
  }

  return next;
};

export const normalizeThreadContent = (content = '', { minParts = 3, maxParts = 5 } = {}) => {
  const raw = String(content || '').trim();
  const issues = [];

  if (!raw) {
    return {
      valid: false,
      critical: true,
      issues: ['Empty output'],
      threadParts: [],
      normalizedContent: '',
    };
  }

  const splitStrategies = [
    () => raw.split(/---+/).map(stripLeadingThreadMarkers).filter(Boolean),
    () => raw.split(/(?=^\s*\d+\s*[\).\-\:]\s*)/m).map(stripLeadingThreadMarkers).filter(Boolean),
    () => raw.split(/\n\s*\n+/).map(stripLeadingThreadMarkers).filter(Boolean),
    () => raw.split('\n').map(stripLeadingThreadMarkers).filter(Boolean),
    () => buildPartsFromSentences(raw, 250).map(stripLeadingThreadMarkers).filter(Boolean),
  ];

  let bestParts = [];
  for (const strategy of splitStrategies) {
    const parts = strategy();
    if (parts.length === 0) continue;
    let normalized = parts;
    if (normalized.length > maxParts) {
      normalized = mergePartsToMax(normalized, maxParts);
    }
    if (normalized.length >= minParts && normalized.length <= maxParts) {
      bestParts = normalized;
      break;
    }
    if (bestParts.length === 0 || Math.abs(normalized.length - minParts) < Math.abs(bestParts.length - minParts)) {
      bestParts = normalized;
    }
  }

  const threadParts = bestParts.map((part) => part.trim()).filter(Boolean);
  if (threadParts.length < minParts || threadParts.length > maxParts) {
    issues.push(`Thread must have ${minParts}-${maxParts} tweets (got ${threadParts.length || 0})`);
  }

  const tooLongParts = threadParts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.length > 280);
  if (tooLongParts.length > 0) {
    issues.push('One or more thread parts exceed 280 characters');
  }

  const normalizedContent = threadParts.join('---');

  return {
    valid: issues.length === 0,
    critical: threadParts.length === 0 || threadParts.length < minParts,
    issues,
    threadParts,
    normalizedContent,
  };
};

const META_PREFIX_RE = /^(?:okay|ok|sure|absolutely|great|here(?:'s| is)|tweet:|thread:)\b/i;
const UNFINISHED_END_RE = /(?:[:(\[]|(?:\b(?:and|or|because|with|for|to|like|example)\b))\s*$/i;

export const evaluateStrategyGeneratedContent = ({ content = '', isThread = false }) => {
  const raw = String(content || '').trim();
  const issues = [];

  if (!raw) {
    return {
      passed: false,
      critical: true,
      issues: ['Empty output'],
      normalizedContent: '',
      threadParts: [],
    };
  }

  if (META_PREFIX_RE.test(raw)) {
    issues.push('Output starts with meta/preface text');
  }

  if (!isThread) {
    if (raw.length < 25) issues.push('Single tweet output is too short');
    if (UNFINISHED_END_RE.test(raw)) issues.push('Single tweet appears unfinished');
    return {
      passed: issues.length === 0,
      critical: raw.length < 10,
      issues,
      normalizedContent: raw,
      threadParts: [],
    };
  }

  const threadResult = normalizeThreadContent(raw, { minParts: 3, maxParts: 5 });
  if (!threadResult.valid) {
    issues.push(...threadResult.issues);
  }
  if (threadResult.threadParts[0] && META_PREFIX_RE.test(threadResult.threadParts[0])) {
    issues.push('Thread first tweet starts with meta/preface text');
  }
  const lastPart = threadResult.threadParts[threadResult.threadParts.length - 1] || '';
  if (lastPart && UNFINISHED_END_RE.test(lastPart)) {
    issues.push('Thread final tweet appears unfinished');
  }

  return {
    passed: issues.length === 0,
    critical: threadResult.critical,
    issues: Array.from(new Set(issues)),
    normalizedContent: threadResult.normalizedContent || raw,
    threadParts: threadResult.threadParts,
  };
};
