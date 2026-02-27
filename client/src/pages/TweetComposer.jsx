import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Sparkles, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  TwitterAccountInfo,
  TweetContentEditor,
  AIContentGenerator,
  AIImageGenerator,
  ImageUploader,
  ThreadComposer,
  TweetActions
} from '../components/TweetComposer';
import { useTweetComposer } from '../hooks/useTweetComposer';
import { fetchApiKeyPreference } from '../utils/byok-platform';
import { useAccount } from '../contexts/AccountContext';

const CROSS_POST_PLATFORM_KEYS = ['twitter', 'linkedin', 'threads'];

const normalizeTargetUsername = (value) => {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!raw) return '';
  return raw.startsWith('@') ? raw : `@${raw}`;
};

const getTargetLabel = (target = {}, fallback = 'Account') => {
  const display = String(target?.displayName || '').trim();
  const username = normalizeTargetUsername(target?.username);
  if (display && username) return `${display} (${username})`;
  if (display) return display;
  if (username) return username;
  return fallback;
};

const TweetComposer = () => {
  const location = useLocation();
  const { selectedAccount } = useAccount();
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [apiKeyMode, setApiKeyMode] = useState('platform');
  const [hasAppliedStrategyPrompt, setHasAppliedStrategyPrompt] = useState(false);
  const [postToTwitter, setPostToTwitter] = useState(false);
  const [postToLinkedin, setPostToLinkedin] = useState(false);
  const [postToThreads, setPostToThreads] = useState(false);
  const [optimizeCrossPost, setOptimizeCrossPost] = useState(true);
  const [crossPostTargets, setCrossPostTargets] = useState({ twitter: [], linkedin: [], threads: [] });
  const [isLoadingCrossPostTargets, setIsLoadingCrossPostTargets] = useState(false);
  const [crossPostTargetsError, setCrossPostTargetsError] = useState('');
  const [selectedCrossPostTargetAccountIds, setSelectedCrossPostTargetAccountIds] = useState({
    twitter: '',
    linkedin: '',
    threads: '',
  });
  const _modalDialogRef = useRef(null);
  const _modalCloseRef = useRef(null);
  const isTeamTwitterAccountSelected = Boolean(selectedAccount?.team_id || selectedAccount?.teamId);

  // Fetch BYOK/platform mode on mount.
  useEffect(() => {
    let mounted = true;

    fetchApiKeyPreference().then(mode => {
      if (mounted) setApiKeyMode(mode);
    });

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const selectedTeamId = selectedAccount?.team_id || selectedAccount?.teamId || null;
    const sourceAccountId = selectedAccount?.id ? String(selectedAccount.id) : '';

    if (!sourceAccountId) {
      setCrossPostTargets({ twitter: [], linkedin: [], threads: [] });
      setCrossPostTargetsError('');
      setSelectedCrossPostTargetAccountIds({ twitter: '', linkedin: '', threads: '' });
      setPostToTwitter(false);
      setPostToLinkedin(false);
      setPostToThreads(false);
      setIsLoadingCrossPostTargets(false);
      return () => { mounted = false; };
    }

    (async () => {
      setIsLoadingCrossPostTargets(true);
      setCrossPostTargetsError('');
      try {
        const params = new URLSearchParams();
        params.set('excludeAccountId', sourceAccountId);
        params.set('excludePlatform', 'twitter');
        const res = await fetch(`/api/cross-post/targets?${params.toString()}`, {
          credentials: 'include',
          headers: selectedTeamId ? { 'x-team-id': String(selectedTeamId) } : {},
        });

        const data = await res.json().catch(() => ({ targets: {} }));
        if (!mounted) return;

        if (!res.ok) {
          setCrossPostTargets({ twitter: [], linkedin: [], threads: [] });
          setCrossPostTargetsError(data?.error || 'Failed to load cross-post accounts');
          setPostToTwitter(false);
          setPostToLinkedin(false);
          setPostToThreads(false);
          return;
        }

        const normalizedTargets = CROSS_POST_PLATFORM_KEYS.reduce((acc, platform) => {
          const rows = Array.isArray(data?.targets?.[platform]) ? data.targets[platform] : [];
          const normalizedRows = rows
            .map((target) => ({
              id: target?.id !== undefined && target?.id !== null ? String(target.id) : '',
              platform,
              username: target?.username ? String(target.username) : '',
              displayName: target?.displayName ? String(target.displayName) : '',
              avatar: target?.avatar || null,
              scope: target?.scope ? String(target.scope) : '',
            }))
            .filter((target) => target.id && target.id !== sourceAccountId);
          acc[platform] = normalizedRows;
          return acc;
        }, { twitter: [], linkedin: [], threads: [] });

        setCrossPostTargets(normalizedTargets);
      } catch (err) {
        if (!mounted) return;
        console.error('Failed to fetch cross-post targets:', err);
        setCrossPostTargets({ twitter: [], linkedin: [], threads: [] });
        setCrossPostTargetsError('Failed to load cross-post accounts');
        setPostToTwitter(false);
        setPostToLinkedin(false);
        setPostToThreads(false);
      } finally {
        if (mounted) setIsLoadingCrossPostTargets(false);
      }
    })();

    return () => { mounted = false; };
  }, [
    selectedAccount?.id,
    selectedAccount?.team_id,
    selectedAccount?.teamId,
  ]);

  useEffect(() => {
    setSelectedCrossPostTargetAccountIds((current) => {
      const next = { ...current };
      let changed = false;
      CROSS_POST_PLATFORM_KEYS.forEach((platform) => {
        const targets = Array.isArray(crossPostTargets?.[platform]) ? crossPostTargets[platform] : [];
        const currentId = String(current?.[platform] || '').trim();
        if (targets.length === 0) {
          if (currentId) {
            next[platform] = '';
            changed = true;
          }
          return;
        }
        const hasCurrent = targets.some((target) => String(target?.id) === currentId);
        if (!hasCurrent) {
          next[platform] = targets.length === 1 ? String(targets[0].id) : '';
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [crossPostTargets]);

  useEffect(() => {
    if (!Array.isArray(crossPostTargets.twitter) || crossPostTargets.twitter.length === 0) {
      setPostToTwitter(false);
    }
    if (!Array.isArray(crossPostTargets.linkedin) || crossPostTargets.linkedin.length === 0) {
      setPostToLinkedin(false);
    }
    if (!Array.isArray(crossPostTargets.threads) || crossPostTargets.threads.length === 0) {
      setPostToThreads(false);
    }
  }, [crossPostTargets]);

  // Focus the modal's close button when modal opens for keyboard users
  useEffect(() => {
    if (imageModal.open) {
      // delay to ensure element is in DOM
      setTimeout(() => {
        _modalCloseRef.current?.focus();
      }, 0);
    }
  }, [imageModal.open]);

  const {
    content,
    setContent,
    isPosting,
    isScheduling,
    scheduledFor,
    setScheduledFor,
    twitterAccounts,
    isLoadingTwitterAccounts,
    threadTweets,
    threadImages,
    isThread,
    setIsThread,
    showAIPrompt,
    setShowAIPrompt,
    aiPrompt,
    setAiPrompt,
    setStrategyPromptContext,
    setStrategyPromptSeedText,
    aiStyle,
    setAiStyle,
    isGenerating,
    showImagePrompt,
    setShowImagePrompt,
    imagePrompt,
    setImagePrompt,
    imageStyle,
    setImageStyle,
    isGeneratingImage,
    selectedImages,
    isUploadingImages,
    scheduledTweets,
    isLoadingScheduled,
    characterCount,
    charLimit,
    effectiveCharLimit,
    handleImageUpload,
    handleImageRemove,
    handlePost,
    handleSchedule,
    handleAIGenerate,
    handleImageGenerate,
    handleCancelScheduled,
    handleThreadTweetChange,
    handleThreadImageUpload,
    handleThreadImageRemove,
    handleAddTweet,
    handleRemoveTweet,
    handleAIButtonClick,
    handleImageButtonClick,
    fetchScheduledTweets
  } = useTweetComposer();
  
  // Added: char limit for TweetContentEditor

  // Check for prompt from Strategy Builder
  useEffect(() => {
    if (hasAppliedStrategyPrompt) return;

    let promptText = '';
    let structuredStrategyPrompt = null;
    let recommendedFormat = '';
    const statePayload = location?.state?.composerPromptPayload;

    if (statePayload?.text) {
      promptText = String(statePayload.text);
      if (statePayload?.version === 2 && statePayload?.strategyPrompt && typeof statePayload.strategyPrompt === 'object') {
        structuredStrategyPrompt = statePayload.strategyPrompt;
        recommendedFormat = String(statePayload.recommendedFormat || statePayload?.strategyPrompt?.recommendedFormat || '').toLowerCase();
      }
    } else {
      const storedPayload = localStorage.getItem('composerPromptPayload');
      if (storedPayload) {
        try {
          const parsed = JSON.parse(storedPayload);
          promptText = parsed?.text ? String(parsed.text) : '';
          if (parsed?.version === 2 && parsed?.strategyPrompt && typeof parsed.strategyPrompt === 'object') {
            structuredStrategyPrompt = parsed.strategyPrompt;
            recommendedFormat = String(parsed.recommendedFormat || parsed?.strategyPrompt?.recommendedFormat || '').toLowerCase();
          }
        } catch {
          promptText = '';
        }
      }
      if (!promptText) {
        const storedPrompt = localStorage.getItem('composerPrompt');
        promptText = storedPrompt ? String(storedPrompt) : '';
      }
    }

    if (promptText && setAiPrompt && handleAIButtonClick) {
      setAiPrompt(promptText);
      if (structuredStrategyPrompt && setStrategyPromptContext && setStrategyPromptSeedText) {
        setStrategyPromptContext(structuredStrategyPrompt);
        setStrategyPromptSeedText(promptText);
        if (recommendedFormat === 'thread' && typeof setIsThread === 'function') {
          setIsThread(true);
        }
      }
      localStorage.removeItem('composerPrompt');
      localStorage.removeItem('composerPromptPayload');
      setTimeout(() => {
        if (!showAIPrompt) handleAIButtonClick();
      }, 80);
    }

    setHasAppliedStrategyPrompt(true);
  }, [
    hasAppliedStrategyPrompt,
    location,
    setAiPrompt,
    setStrategyPromptContext,
    setStrategyPromptSeedText,
    setIsThread,
    handleAIButtonClick,
    showAIPrompt,
  ]);

  if (isLoadingTwitterAccounts && (!twitterAccounts || twitterAccounts.length === 0)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="mt-4 text-gray-600">Loading your Twitter account...</p>
        </div>
      </div>
    );
  }

  if (!twitterAccounts || twitterAccounts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto">
          <div className="bg-white rounded-lg shadow-md p-8">
            <div className="text-6xl mb-4">ðŸ¦</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Connect Your Twitter Account</h2>
            <p className="text-gray-600 mb-6">
              To start composing tweets, you need to connect your Twitter account first.
            </p>
            <button
              onClick={() => window.location.href = '/settings'}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  const platformTargets = {
    twitter: Array.isArray(crossPostTargets?.twitter) ? crossPostTargets.twitter : [],
    linkedin: Array.isArray(crossPostTargets?.linkedin) ? crossPostTargets.linkedin : [],
    threads: Array.isArray(crossPostTargets?.threads) ? crossPostTargets.threads : [],
  };
  const crossPostEnabledFlags = {
    twitter: Boolean(postToTwitter),
    linkedin: Boolean(postToLinkedin),
    threads: Boolean(postToThreads),
  };
  const crossPostSelected = Boolean(postToTwitter || postToLinkedin || postToThreads);
  const hasAnyImagesForCurrentDraft =
    (Array.isArray(selectedImages) && selectedImages.length > 0) ||
    (Array.isArray(threadImages) && threadImages.some((items) => Array.isArray(items) && items.length > 0));
  const platformMeta = {
    twitter: {
      key: 'twitter',
      label: 'X (Other Accounts)',
      toggleLabel: 'Post to another X account',
      noTargetsMessage: 'No additional X accounts connected',
      icon: 'X',
      bg: '#111827',
      targetLabel: 'Target X account',
    },
    linkedin: {
      key: 'linkedin',
      label: 'LinkedIn',
      toggleLabel: 'Post to LinkedIn',
      noTargetsMessage: 'No LinkedIn accounts connected',
      icon: 'in',
      bg: '#0A66C2',
      targetLabel: 'Target LinkedIn account',
    },
    threads: {
      key: 'threads',
      label: 'Threads',
      toggleLabel: 'Post to Threads',
      noTargetsMessage: 'No Threads accounts connected',
      icon: '@',
      bg: '#111111',
      targetLabel: 'Target Threads account',
    },
  };
  const platformToggleRows = CROSS_POST_PLATFORM_KEYS.map((platform) => {
    const targets = platformTargets[platform];
    const targetCount = targets.length;
    const disabled = isLoadingCrossPostTargets || targetCount === 0;
    const statusText = isLoadingCrossPostTargets
      ? 'Loading accounts...'
      : targetCount > 0
        ? `${targetCount} account${targetCount === 1 ? '' : 's'} available`
        : platformMeta[platform].noTargetsMessage;
    return {
      ...platformMeta[platform],
      targets,
      targetCount,
      disabled,
      enabled: crossPostEnabledFlags[platform],
      statusText,
      disabledTitle: disabled
        ? (isLoadingCrossPostTargets ? 'Loading cross-post accounts...' : platformMeta[platform].noTargetsMessage)
        : '',
    };
  });

  const ensureCrossPostTargetsSelected = () => {
    const missingPlatforms = [];
    CROSS_POST_PLATFORM_KEYS.forEach((platform) => {
      if (!crossPostEnabledFlags[platform]) return;
      const targetId = String(selectedCrossPostTargetAccountIds?.[platform] || '').trim();
      if (!targetId) missingPlatforms.push(platformMeta[platform].label);
    });
    if (missingPlatforms.length > 0) {
      toast.error(`Choose target account for: ${missingPlatforms.join(', ')}`);
      return false;
    }
    return true;
  };

  const buildCrossPostInput = () => {
    const crossPostTargetAccountIds = {};
    const crossPostTargetAccountLabels = {};

    CROSS_POST_PLATFORM_KEYS.forEach((platform) => {
      if (!crossPostEnabledFlags[platform]) return;
      const targetId = String(selectedCrossPostTargetAccountIds?.[platform] || '').trim();
      if (!targetId) return;
      crossPostTargetAccountIds[platform] = targetId;
      const target = platformTargets[platform].find((item) => String(item?.id) === targetId);
      if (target) {
        crossPostTargetAccountLabels[platform] = getTargetLabel(target, `${platformMeta[platform].label} account`);
      }
    });

    return {
      twitter: crossPostEnabledFlags.twitter,
      linkedin: crossPostEnabledFlags.linkedin,
      threads: crossPostEnabledFlags.threads,
      optimizeCrossPost,
      ...(Object.keys(crossPostTargetAccountIds).length > 0 && { crossPostTargetAccountIds }),
      ...(Object.keys(crossPostTargetAccountLabels).length > 0 && { crossPostTargetAccountLabels }),
    };
  };

  const toggleCrossPostPlatform = (platform) => {
    const row = platformToggleRows.find((item) => item.key === platform);
    if (!row || row.disabled) return;
    const shouldEnable = !crossPostEnabledFlags[platform];
    if (platform === 'twitter') {
      setPostToTwitter(shouldEnable);
    } else if (platform === 'linkedin') {
      setPostToLinkedin(shouldEnable);
    } else if (platform === 'threads') {
      setPostToThreads(shouldEnable);
    }
    if (shouldEnable && row.targets.length === 1) {
      setSelectedCrossPostTargetAccountIds((current) => ({
        ...current,
        [platform]: String(row.targets[0].id),
      }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* BYOK/platform mode indicator */}
      <div className="w-full flex justify-center pt-4 pb-2">
        <span className="inline-block px-4 py-2 rounded-full text-sm font-semibold bg-blue-100 text-blue-700 shadow">
          {apiKeyMode === 'byok' ? 'Using Your Own API Key (BYOK)' : 'Using Platform API Key'}
        </span>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* â”€â”€ Main Composer (2/3 width) â”€â”€ */}
          <div className="lg:col-span-2 space-y-6">
            <TwitterAccountInfo twitterAccounts={twitterAccounts} />

            <div className="card">
              <div className="space-y-4">
                <ThreadComposer
                  isThread={isThread}
                  threadTweets={threadTweets}
                  threadImages={threadImages}
                  onThreadToggle={setIsThread}
                  onThreadTweetChange={handleThreadTweetChange}
                  onThreadImageUpload={handleThreadImageUpload}
                  onThreadImageRemove={handleThreadImageRemove}
                  onAddTweet={handleAddTweet}
                  onRemoveTweet={handleRemoveTweet}
                />

                {/* AI Action Buttons - Always visible */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleAIButtonClick}
                    className={`btn btn-sm ${showAIPrompt ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <Sparkles className="h-4 w-4 mr-1" />
                    {showAIPrompt ? 'Cancel AI' : 'AI Generate'}
                  </button>
                  
                  <button
                    onClick={handleImageButtonClick}
                    className={`btn btn-sm ${showImagePrompt ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <Wand2 className="h-4 w-4 mr-1" />
                    {showImagePrompt ? 'Cancel' : 'AI Image'}
                  </button>
                </div>

                <TweetContentEditor
                  content={content}
                  setContent={setContent}
                  isThread={isThread}
                  characterCount={characterCount}
                  charLimit={effectiveCharLimit}
                />
              </div>

              <AIContentGenerator
                showAIPrompt={showAIPrompt}
                aiPrompt={aiPrompt}
                setAiPrompt={setAiPrompt}
                aiStyle={aiStyle}
                setAiStyle={setAiStyle}
                isGenerating={isGenerating}
                onGenerate={handleAIGenerate}
                onCancel={() => setShowAIPrompt(false)}
              />

              <AIImageGenerator
                showImagePrompt={showImagePrompt}
                imagePrompt={imagePrompt}
                setImagePrompt={setImagePrompt}
                imageStyle={imageStyle}
                setImageStyle={setImageStyle}
                isGeneratingImage={isGeneratingImage}
                onGenerate={handleImageGenerate}
                onCancel={() => setShowImagePrompt(false)}
              />

              <div className="mb-4">
                <ImageUploader
                  selectedImages={selectedImages}
                  onImageUpload={handleImageUpload}
                  onImageRemove={handleImageRemove}
                  isUploadingImages={isUploadingImages}
                  onImagePreview={img => setImageModal({ open: true, src: img.preview || img.url })}
                />
                {imageModal.open && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70"
                    onClick={() => setImageModal({ open: false, src: null })}
                  >
                    <div
                      ref={_modalDialogRef}
                      className="relative max-w-3xl w-full flex flex-col items-center"
                      onClick={e => e.stopPropagation()}
                      role="dialog"
                      aria-modal="true"
                      tabIndex={-1}
                      onKeyDown={e => { if (e.key === 'Escape') setImageModal({ open: false, src: null }); }}
                    >
                      <img
                        src={imageModal.src}
                        alt="Full preview"
                        className="max-h-[80vh] max-w-full rounded shadow-lg border-4 border-white"
                      />
                      <button
                        ref={_modalCloseRef}
                        className="mt-4 px-6 py-2 bg-white text-black rounded shadow font-semibold"
                        onClick={() => setImageModal({ open: false, src: null })}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <TweetActions
                isThread={isThread}
                content={content}
                threadTweets={threadTweets}
                selectedImages={selectedImages}
                isPosting={isPosting}
                isScheduling={isScheduling}
                postToLinkedin={postToLinkedin}
                onPost={() => {
                  if (!ensureCrossPostTargetsSelected()) return;
                  handlePost(buildCrossPostInput());
                }}
                onSchedule={(dateString, timezone) => {
                  if (!ensureCrossPostTargetsSelected()) return;
                  handleSchedule(dateString, timezone, buildCrossPostInput());
                }}
              />
            </div>
          </div>

          {/* â”€â”€ Sidebar (1/3 width) â”€â”€ */}
          <div className="space-y-6">

            {/* Post To card */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">

              {/* Section label */}
              <p style={{
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: '#9ca3af',
                marginBottom: '16px',
              }}>
                Post to
              </p>

              {/* Platform rows */}
              <div style={{ display: 'grid', gap: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    padding: '10px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div style={{
                      height: '36px',
                      width: '36px',
                      flexShrink: 0,
                      borderRadius: '7px',
                      background: '#111827',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '16px',
                      userSelect: 'none',
                    }}>
                      X
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>X</div>
                      <div style={{ fontSize: '11px', color: '#6b7280' }}>Primary posting platform</div>
                    </div>
                  </div>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#2563eb',
                    background: '#dbeafe',
                    border: '1px solid #bfdbfe',
                    borderRadius: '999px',
                    padding: '4px 8px',
                    flexShrink: 0,
                  }}>
                    Always On
                  </div>
                </div>

                {platformToggleRows.map((platform) => (
                  <div
                    key={platform.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      background: '#f9fafb',
                      border: `1px solid ${platform.targetCount === 0 && !isLoadingCrossPostTargets ? '#fecaca' : '#e5e7eb'}`,
                      borderRadius: '10px',
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div style={{
                        height: '36px',
                        width: '36px',
                        flexShrink: 0,
                        borderRadius: '7px',
                        background: platform.bg,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: platform.key === 'threads' ? '14px' : '16px',
                        userSelect: 'none',
                      }}>
                        {platform.icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                          {platform.label}
                        </div>
                        <div style={{
                          fontSize: '11px',
                          color: platform.targetCount === 0 && !isLoadingCrossPostTargets ? '#ef4444' : '#6b7280',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {platform.statusText}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-label={platform.toggleLabel}
                      role="switch"
                      aria-checked={platform.enabled && !platform.disabled}
                      aria-disabled={platform.disabled}
                      onClick={() => toggleCrossPostPlatform(platform.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleCrossPostPlatform(platform.key);
                        }
                      }}
                      title={platform.disabled ? platform.disabledTitle : ''}
                      style={{
                        position: 'relative',
                        width: '44px',
                        height: '24px',
                        borderRadius: '999px',
                        background: platform.disabled
                          ? '#e5e7eb'
                          : platform.enabled ? '#2563eb' : '#d1d5db',
                        cursor: platform.disabled ? 'not-allowed' : 'pointer',
                        flexShrink: 0,
                        transition: 'background 0.2s ease',
                        opacity: isLoadingCrossPostTargets ? 0.5 : 1,
                        border: 'none',
                        padding: 0,
                      }}
                    >
                      <div style={{
                        position: 'absolute',
                        top: '3px',
                        left: platform.enabled && !platform.disabled ? '23px' : '3px',
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: 'white',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                        transition: 'left 0.2s ease',
                      }} />
                    </button>
                  </div>
                ))}
              </div>

              {crossPostTargetsError && (
                <div style={{
                  marginTop: '12px',
                  fontSize: '11px',
                  color: '#b91c1c',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  padding: '10px 12px',
                }}>
                  {crossPostTargetsError}
                </div>
              )}

              {crossPostSelected && CROSS_POST_PLATFORM_KEYS.map((platform) => {
                if (!crossPostEnabledFlags[platform]) return null;
                const row = platformToggleRows.find((item) => item.key === platform);
                if (!row) return null;
                const selectedTargetId = String(selectedCrossPostTargetAccountIds?.[platform] || '').trim();
                return (
                  <div
                    key={`${platform}-crosspost-target`}
                    style={{
                      marginTop: '12px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '10px',
                      padding: '12px',
                      background: '#ffffff',
                    }}
                  >
                    <label
                      htmlFor={`${platform}-crosspost-target`}
                      style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}
                    >
                      {row.targetLabel}
                    </label>
                    <select
                      id={`${platform}-crosspost-target`}
                      value={selectedTargetId}
                      onChange={(e) => setSelectedCrossPostTargetAccountIds((current) => ({
                        ...current,
                        [platform]: String(e.target.value || ''),
                      }))}
                      disabled={isLoadingCrossPostTargets || row.targets.length === 0}
                      style={{
                        width: '100%',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: '#111827',
                        background: isLoadingCrossPostTargets ? '#f9fafb' : '#fff',
                      }}
                    >
                      <option value="">
                        {isLoadingCrossPostTargets
                          ? 'Loading accounts...'
                          : row.targets.length === 0
                            ? row.noTargetsMessage
                            : row.targets.length === 1
                              ? 'Auto-selected target'
                              : `Select ${row.label} target`}
                      </option>
                      {row.targets.map((target) => (
                        <option key={String(target.id)} value={String(target.id)}>
                          {getTargetLabel(target, `${row.label} account`)}
                        </option>
                      ))}
                    </select>
                    <div style={{
                      marginTop: '8px',
                      fontSize: '11px',
                      color: selectedTargetId ? '#374151' : '#92400e',
                    }}>
                      {selectedTargetId
                        ? `Cross-post target: ${
                          getTargetLabel(
                            row.targets.find((target) => String(target?.id) === selectedTargetId) || {},
                            `${row.label} account`
                          )
                        }`
                        : `Choose one ${row.label} account for this post.`}
                    </div>
                  </div>
                );
              })}

              <div style={{
                marginTop: '12px',
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '10px 12px',
                background: '#ffffff',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>Optimize formatting per platform</div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>Format-only optimization. No wording changes.</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Optimize formatting per platform"
                    role="switch"
                    aria-checked={optimizeCrossPost}
                    onClick={() => setOptimizeCrossPost(prev => !prev)}
                    style={{
                      position: 'relative',
                      width: '44px',
                      height: '24px',
                      borderRadius: '999px',
                      background: optimizeCrossPost ? '#2563eb' : '#d1d5db',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'background 0.2s ease',
                      border: 'none',
                      padding: 0,
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      top: '3px',
                      left: optimizeCrossPost ? '23px' : '3px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: 'white',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                      transition: 'left 0.2s ease',
                    }} />
                  </button>
                </div>
              </div>

              {isTeamTwitterAccountSelected && (
                <div style={{
                  marginTop: '12px',
                  fontSize: '11px',
                  color: '#92400e',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '10px',
                  padding: '10px 12px',
                }}>
                  Team scope is active. Only accounts connected to this team are shown as cross-post targets.
                </div>
              )}

              {crossPostSelected && hasAnyImagesForCurrentDraft && (
                <div style={{
                  marginTop: '12px',
                  fontSize: '11px',
                  color: '#1f2937',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '10px',
                  padding: '10px 12px',
                }}>
                  Media is forwarded to selected platforms when supported. Unsupported formats may post as text only.
                </div>
              )}

              <p style={{
                marginTop: '12px',
                fontSize: '11px',
                textAlign: 'center',
                color: '#6b7280',
              }}>
                {crossPostSelected
                  ? 'Selected cross-post targets will publish after X posts successfully.'
                  : 'Post publishes to X. Toggle platforms to cross-post after X succeeds.'}
              </p>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TweetComposer;
