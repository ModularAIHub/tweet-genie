import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Sparkles, Wand2 } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  TwitterAccountInfo,
  TweetContentEditor,
  AIContentGenerator,
  AIImageGenerator,
  ImageUploader,
  ThreadComposer,
  TweetActions,
  SchedulingPanel
} from '../components/TweetComposer';
import { useTweetComposer } from '../hooks/useTweetComposer';
import { fetchApiKeyPreference } from '../utils/byok-platform';
import { useAccount } from '../contexts/AccountContext';

const TweetComposer = () => {
  const location = useLocation();
  const { selectedAccount } = useAccount();
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [apiKeyMode, setApiKeyMode] = useState('platform');
  const [hasAppliedStrategyPrompt, setHasAppliedStrategyPrompt] = useState(false);
  const [postToLinkedin, setPostToLinkedin] = useState(false);
  const [postToThreads, setPostToThreads] = useState(false);
  const [linkedinConnected, setLinkedinConnected] = useState(null);
  const [threadsConnected, setThreadsConnected] = useState(null);
  const [threadsConnectionReason, setThreadsConnectionReason] = useState('');
  const [optimizeCrossPost, setOptimizeCrossPost] = useState(true);
  const _modalDialogRef = useRef(null);
  const _modalCloseRef = useRef(null);
  const isTeamTwitterAccountSelected = Boolean(selectedAccount?.team_id || selectedAccount?.teamId);

  // Fetch BYOK/platform mode + cross-post connection statuses on mount
  useEffect(() => {
    let mounted = true;

    fetchApiKeyPreference().then(mode => {
      if (mounted) setApiKeyMode(mode);
    });

    // Check LinkedIn connection â€” hits Tweet Genie's own backend (same origin, no CORS)
    // which does a direct DB lookup on linkedin_auth table
    (async () => {
      try {
        const res = await fetch('/api/linkedin/status', { credentials: 'include' });
        if (!mounted) return;

        const data = await res.json().catch(() => ({ connected: false }));
        setLinkedinConnected(data.connected === true);
      } catch (err) {
        console.error('Failed to fetch LinkedIn status:', err);
        if (mounted) setLinkedinConnected(false);
      }
    })();

    (async () => {
      try {
        const res = await fetch('/api/threads/status', { credentials: 'include' });
        if (!mounted) return;

        const data = await res.json().catch(() => ({ connected: false, reason: 'service_unreachable' }));
        setThreadsConnected(data.connected === true);
        setThreadsConnectionReason(typeof data.reason === 'string' ? data.reason : '');
      } catch (err) {
        console.error('Failed to fetch Threads status:', err);
        if (mounted) {
          setThreadsConnected(false);
          setThreadsConnectionReason('service_unreachable');
        }
      }
    })();

    return () => { mounted = false; };
  }, []);

  // Focus the modal's close button when modal opens for keyboard users
  useEffect(() => {
    if (imageModal.open) {
      // delay to ensure element is in DOM
      setTimeout(() => {
        _modalCloseRef.current?.focus();
        _modalDialogRef.current?.focus();
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

  const crossPostSelected = Boolean(postToLinkedin || postToThreads);
  const hasAnyImagesForCurrentDraft =
    (Array.isArray(selectedImages) && selectedImages.length > 0) ||
    (Array.isArray(threadImages) && threadImages.some((items) => Array.isArray(items) && items.length > 0));
  const linkedinToggleDisabled = linkedinConnected !== true || isTeamTwitterAccountSelected;
  const threadsToggleDisabled = threadsConnected !== true || isTeamTwitterAccountSelected;

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
                onPost={() => handlePost({
                  linkedin: postToLinkedin,
                  threads: postToThreads,
                  optimizeCrossPost,
                })}
                onSchedule={(dateString, timezone) => handleSchedule(dateString, timezone, {
                  linkedin: postToLinkedin,
                  threads: postToThreads,
                  optimizeCrossPost,
                })}
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
                {[
                  {
                    key: 'x',
                    label: 'X',
                    statusText: 'Primary posting platform',
                    connected: true,
                    enabled: true,
                    toggleable: false,
                    bg: '#111827',
                    icon: 'X',
                  },
                  {
                    key: 'linkedin',
                    label: 'LinkedIn',
                    statusText: linkedinConnected === null ? 'Checking...' : linkedinConnected ? 'Connected' : 'Not connected',
                    connected: linkedinConnected === true,
                    enabled: !!postToLinkedin,
                    toggleable: true,
                    disabled: linkedinToggleDisabled,
                    onToggle: () => setPostToLinkedin(prev => !prev),
                    bg: '#0A66C2',
                    icon: 'in',
                    disabledTitle: isTeamTwitterAccountSelected
                      ? 'Cross-post is available for personal account posting only in Phase 1'
                      : 'Connect LinkedIn in settings first',
                  },
                  {
                    key: 'threads',
                    label: 'Threads',
                    statusText: threadsConnected === null
                      ? 'Checking...'
                      : threadsConnected
                        ? 'Connected'
                        : threadsConnectionReason === 'not_configured'
                          ? 'Unavailable'
                          : 'Not connected',
                    connected: threadsConnected === true,
                    enabled: !!postToThreads,
                    toggleable: true,
                    disabled: threadsToggleDisabled,
                    onToggle: () => setPostToThreads(prev => !prev),
                    bg: '#111111',
                    icon: '@',
                    disabledTitle: isTeamTwitterAccountSelected
                      ? 'Cross-post is available for personal account posting only in Phase 1'
                      : 'Connect Threads in Social Genie first',
                  },
                ].map(platform => (
                  <div
                    key={platform.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      background: '#f9fafb',
                      border: `1px solid ${platform.toggleable && !platform.connected ? '#fecaca' : '#e5e7eb'}`,
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
                          color: platform.toggleable && !platform.connected ? '#ef4444' : '#6b7280',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {platform.statusText}
                        </div>
                      </div>
                    </div>

                    {platform.toggleable ? (
                      <button
                        type="button"
                        aria-label={`Post to ${platform.label}`}
                        role="switch"
                        aria-checked={platform.enabled && !platform.disabled}
                        aria-disabled={platform.disabled}
                        onClick={() => { if (!platform.disabled) platform.onToggle(); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!platform.disabled) platform.onToggle();
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
                          opacity:
                            (platform.key === 'linkedin' && linkedinConnected === null) ||
                            (platform.key === 'threads' && threadsConnected === null)
                              ? 0.5
                              : 1,
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
                    ) : (
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
                    )}
                  </div>
                ))}
              </div>

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
                  Cross-post is available for personal account posting only in Phase 1.
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
                  Images will post to X only. LinkedIn/Threads cross-post is text-only in Phase 1.
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
