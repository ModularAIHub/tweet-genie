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

  // Guard: if instruction is near-identical to idea, blank it to avoid confusion
  if (normalized.instruction && normalized.idea) {
    const ideaWords = new Set(
      normalized.idea.toLowerCase().split(/\s+/).filter((w) => w.length > 4)
    );
    const instrWords = normalized.instruction
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);
    if (instrWords.length > 0) {
      const overlap = instrWords.filter((w) => ideaWords.has(w)).length;
      if (overlap / instrWords.length > 0.65) {
        normalized.instruction = '';
      }
    }
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
  const MAX_PROVIDER_PROMPT_CHARS = 2200;

  const compactIdea = normalizeText(sp.idea, 420);
  const compactInstruction = normalizeText(sp.instruction, 320);
  const compactCategory = normalizeText(sp.category, 80);
  const compactGoal = normalizeText(sp.goal, 120);
  const compactHashtagsHint = normalizeText(sp.hashtagsHint, 100);

  const lines = [];

  // --- INSTRUCTION FIRST (highest priority) ---
  // Put this before everything else so the AI anchors on it
  if (compactInstruction) {
    lines.push(
      `MANDATORY FORMAT INSTRUCTION — you MUST follow this exactly: ${compactInstruction}`,
      `This instruction is not optional. Your output will be rejected if it does not comply.`,
      ``
    );
  }

  // --- Task definition ---
  lines.push(
    isThread
      ? 'Write ONE complete X (Twitter) thread.'
      : 'Write ONE complete X (Twitter) post (single tweet).',
    styleInstruction(style),
    'Return ONLY the final content — no labels, no quotes, no preface, no explanation.',
    'Do NOT start with meta text like "Okay", "Sure", "Here is", or "Here\'s".',
    'Do NOT leave the output unfinished or cut off mid-sentence.',
    'Write every sentence completely. Do not trail off.'
  );

  // --- Format requirements ---
  if (isThread) {
    lines.push(
      '',
      'Thread requirements:',
      '- Produce exactly 3 to 5 tweets.',
      '- Separate tweets using --- on its own line.',
      '- Keep each tweet under 280 characters.',
      '- Make the thread flow logically: hook → body → takeaway.',
      '- Complete every tweet fully — no unfinished sentences.'
    );
  } else {
    lines.push(
      '',
      'Single tweet requirements:',
      '- Keep it under 260 characters.',
      '- Make it complete, punchy, and publish-ready.',
      '- One complete thought — nothing trailing off.'
    );
  }

  // --- Core content ---
  lines.push('', `Core idea to write about: ${compactIdea}`);

  if (compactCategory) lines.push(`Content category: ${compactCategory}`);
  if (compactGoal) lines.push(`Primary goal: ${compactGoal}`);
  if (compactHashtagsHint) lines.push(`Hashtag hint: ${compactHashtagsHint}`);

  // --- Retry context with surgical guidance ---
  if (retryContext && Array.isArray(retryContext.issues) && retryContext.issues.length > 0) {
    lines.push(
      '',
      'YOUR PREVIOUS DRAFT WAS REJECTED. Do NOT repeat it. Fix ALL of these problems:',
      ...retryContext.issues.map((issue) => `  ✗ ${issue}`),
      'Generate a completely different draft that resolves every issue above.',
      'Use a different opening, structure, and angle from your previous attempt.'
    );
  }

  // --- Extra context (budget-aware) ---
  if (sp.extraContext) {
    const extraContextPrefix = 'Additional context about the product/brand: ';
    const currentLength = lines.join('\n').length;
    const remainingBudget =
      MAX_PROVIDER_PROMPT_CHARS - currentLength - extraContextPrefix.length - 1;
    if (remainingBudget > 40) {
      const compactExtraContext = normalizeText(
        sp.extraContext,
        Math.min(remainingBudget, 600)
      );
      if (compactExtraContext) {
        lines.push(``, `${extraContextPrefix}${compactExtraContext}`);
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
    () =>
      raw
        .split(/(?=^\s*\d+\s*[\).\-\:]\s*)/m)
        .map(stripLeadingThreadMarkers)
        .filter(Boolean),
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
    if (
      bestParts.length === 0 ||
      Math.abs(normalized.length - minParts) < Math.abs(bestParts.length - minParts)
    ) {
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

  const normalizedContent = threadParts.join('\n---\n');

  return {
    valid: issues.length === 0,
    critical: threadParts.length === 0 || threadParts.length < minParts,
    issues,
    threadParts,
    normalizedContent,
  };
};

const META_PREFIX_RE =
  /^(?:okay|ok|sure|absolutely|great|here(?:'s| is)|tweet:|thread:|of course|certainly|happy to)/i;

const UNFINISHED_END_RE =
  /(?:[:(\[]|(?:\b(?:and|or|because|with|for|to|like|example|including|such)\b))\s*$/i;

// Lazy generic openers that signal the AI ignored the instruction and defaulted
const GENERIC_OPENER_RE =
  /^(in today's (digital|social media|fast-paced|ever-changing|competitive)|are you (tired of|struggling with|looking to)|did you know that|let's (talk about|face it|be honest)|we all know that|have you ever wondered|it's time to (talk|stop|start)|the secret to|stop (wasting|losing|missing))/i;

// Marketing filler that signals generic, low-effort output
const FILLER_WORDS_RE =
  /\b(streamline your|optimize your|leverage the|unlock your|harness the power|empower your|robust solution|seamlessly integrates|cutting-edge solution|game-changing|revolutionize your|synergy|scalable solution|next-level|supercharge your)\b/gi;

/**
 * Checks whether the output shows basic signals of following the instruction.
 * Returns an array of issue strings (empty = compliant).
 */
const checkInstructionCompliance = (raw, instruction) => {
  if (!instruction || instruction.length < 5) return [];
  const issues = [];
  const instrLower = instruction.toLowerCase();
  const rawLower = raw.toLowerCase();

  // Example / case study requirement
  if (
    /\b(example|case study|case|scenario|story|e\.g|for instance)\b/i.test(instrLower) &&
    !/\b(for example|e\.g|such as|for instance|like when|here'?s one|case:|imagine)\b/i.test(rawLower)
  ) {
    issues.push('Instruction required a concrete example but none was found in output');
  }

  // Question requirement
  if (/\b(question|ask)\b/i.test(instrLower) && !/\?/.test(raw)) {
    issues.push('Instruction required a question but output contains no question mark');
  }

  // List / numbered / steps requirement
  if (
    /\b(list|steps|tips|numbered|bullet)\b/i.test(instrLower) &&
    !/(\n[-•*]|\d+[.)]\s|\n\d+\s)/.test(raw)
  ) {
    issues.push('Instruction required a list or numbered format but none was found');
  }

  // CTA / encouragement requirement
  if (
    /\b(cta|call.to.action|encouragement|encourage|end with)\b/i.test(instrLower) &&
    !/\b(start |try |join |click |dm |share |reply|follow|reach out|let me know|comment|drop|check out)\b/i.test(
      rawLower
    )
  ) {
    issues.push('Instruction required a CTA or encouragement line but none was found');
  }

  // Before/after requirement
  if (
    /\b(before.and.after|before\/after|before vs after)\b/i.test(instrLower) &&
    !/\b(before|after|used to|now|then|vs\.?|versus)\b/i.test(rawLower)
  ) {
    issues.push('Instruction required a before/after structure but it was not present');
  }

  // Short / brief requirement
  if (/\b(short|brief|concise|one sentence|one line)\b/i.test(instrLower) && raw.length > 240) {
    issues.push('Instruction asked for short/brief content but output is too long');
  }

  return issues;
};

export const evaluateStrategyGeneratedContent = ({
  content = '',
  isThread = false,
  instruction = '',
}) => {
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

  // 1. Meta prefix check
  if (META_PREFIX_RE.test(raw)) {
    issues.push('Output starts with meta/preface text (e.g. "Sure", "Here is", "Okay")');
  }

  // 2. Generic lazy opener check (skip for threads — first part checked separately)
  if (!isThread && GENERIC_OPENER_RE.test(raw)) {
    issues.push(
      'Output starts with a generic overused opener — use a more specific or direct hook'
    );
  }

  // 3. Excessive filler word check
  const fillerMatches = (raw.match(FILLER_WORDS_RE) || []).length;
  if (fillerMatches >= 4) {
    issues.push(
      `Output contains ${fillerMatches} generic marketing filler phrases — be more specific and concrete`
    );
  }

  // 4. Instruction compliance check
  const complianceIssues = checkInstructionCompliance(raw, instruction);
  issues.push(...complianceIssues);

  if (!isThread) {
    // 5. Single tweet: length check
    if (raw.length < 25) issues.push('Single tweet output is too short (under 25 chars)');

    // 6. Single tweet: unfinished check
    if (UNFINISHED_END_RE.test(raw)) issues.push('Single tweet appears unfinished or cut off');

    return {
      passed: issues.length === 0,
      critical: raw.length < 10,
      issues,
      normalizedContent: raw,
      threadParts: [],
    };
  }

  // --- Thread evaluation ---
  const threadResult = normalizeThreadContent(raw, { minParts: 3, maxParts: 5 });
  if (!threadResult.valid) {
    issues.push(...threadResult.issues);
  }

  // Check first tweet of thread for meta prefix and generic opener
  const firstPart = threadResult.threadParts[0] || '';
  if (firstPart && META_PREFIX_RE.test(firstPart)) {
    issues.push('Thread first tweet starts with meta/preface text');
  }
  if (firstPart && GENERIC_OPENER_RE.test(firstPart)) {
    issues.push('Thread first tweet uses a generic opener — use a stronger hook');
  }

  // Check last tweet for unfinished content
  const lastPart = threadResult.threadParts[threadResult.threadParts.length - 1] || '';
  if (lastPart && UNFINISHED_END_RE.test(lastPart)) {
    issues.push('Thread final tweet appears unfinished or cut off');
  }

  // Check each part is not too short
  const tooShortParts = threadResult.threadParts.filter((p) => p.trim().length < 20);
  if (tooShortParts.length > 0) {
    issues.push(`${tooShortParts.length} thread tweet(s) are too short (under 20 chars)`);
  }

  return {
    passed: issues.length === 0,
    critical: threadResult.critical,
    issues: Array.from(new Set(issues)),
    normalizedContent: threadResult.normalizedContent || raw,
    threadParts: threadResult.threadParts,
  };
};