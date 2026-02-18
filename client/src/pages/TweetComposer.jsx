import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
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

const TweetComposer = () => {
  const location = useLocation();
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [apiKeyMode, setApiKeyMode] = useState('platform');
  const [hasAppliedStrategyPrompt, setHasAppliedStrategyPrompt] = useState(false);
  const [postToLinkedin, setPostToLinkedin] = useState(false);
  const [linkedinConnected, setLinkedinConnected] = useState(null);
  const _modalDialogRef = useRef(null);
  const _modalCloseRef = useRef(null);

  // Fetch BYOK/platform mode + LinkedIn status on mount
  useEffect(() => {
    let mounted = true;

    fetchApiKeyPreference().then(mode => {
      if (mounted) setApiKeyMode(mode);
    });

    // Check LinkedIn connection — hits Tweet Genie's own backend (same origin, no CORS)
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
    aiPrompt,
    setAiPrompt,
    aiStyle,
    setAiStyle,
    isGenerating,
    showImagePrompt,
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
    const statePayload = location?.state?.composerPromptPayload;

    if (statePayload?.text) {
      promptText = String(statePayload.text);
    } else {
      const storedPayload = localStorage.getItem('composerPromptPayload');
      if (storedPayload) {
        try {
          const parsed = JSON.parse(storedPayload);
          promptText = parsed?.text ? String(parsed.text) : '';
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
      localStorage.removeItem('composerPrompt');
      localStorage.removeItem('composerPromptPayload');
      setTimeout(() => {
        if (!showAIPrompt) handleAIButtonClick();
      }, 80);
    }

    setHasAppliedStrategyPrompt(true);
  }, [hasAppliedStrategyPrompt, location, setAiPrompt, handleAIButtonClick, showAIPrompt]);

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
            <div className="text-6xl mb-4">🐦</div>
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

          {/* ── Main Composer (2/3 width) ── */}
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

                <TweetContentEditor
                  content={content}
                  setContent={setContent}
                  isThread={isThread}
                  characterCount={characterCount}
                  onAIButtonClick={handleAIButtonClick}
                  onImageButtonClick={handleImageButtonClick}
                  showAIPrompt={showAIPrompt}
                  showImagePrompt={showImagePrompt}
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
                onPost={() => handlePost(postToLinkedin)}
                onSchedule={handleSchedule}
              />
            </div>
          </div>

          {/* ── Sidebar (1/3 width) ── */}
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

              {/* LinkedIn row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                background: '#f9fafb',
                border: `1px solid ${linkedinConnected === false ? '#fecaca' : '#e5e7eb'}`,
                borderRadius: '10px',
                padding: '10px 14px',
                marginBottom: '12px',
              }}>
                {/* Icon + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{
                    height: '36px',
                    width: '36px',
                    flexShrink: 0,
                    borderRadius: '7px',
                    background: '#0A66C2',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '16px',
                    userSelect: 'none',
                  }}>
                    in
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                      LinkedIn
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: linkedinConnected === false ? '#ef4444' : '#9ca3af',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {linkedinConnected === null
                        ? 'Checking...'
                        : linkedinConnected
                          ? 'Connected'
                          : 'Not connected'}
                    </div>
                  </div>
                </div>

                {/* Toggle — disabled + greyed out when not connected. Use a button with ARIA for keyboard access */}
                <button
                  aria-label="Post to LinkedIn"
                  role="switch"
                  aria-checked={!!(postToLinkedin && linkedinConnected)}
                  aria-disabled={linkedinConnected === false}
                  onClick={() => { if (!linkedinConnected) return; setPostToLinkedin(prev => !prev); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (!linkedinConnected) return;
                      setPostToLinkedin(prev => !prev);
                    }
                  }}
                  title={!linkedinConnected ? 'Connect LinkedIn in settings first' : ''}
                  style={{
                    position: 'relative',
                    width: '44px',
                    height: '24px',
                    borderRadius: '999px',
                    background: !linkedinConnected
                      ? '#e5e7eb'
                      : postToLinkedin ? '#2563eb' : '#d1d5db',
                    cursor: linkedinConnected ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                    transition: 'background 0.2s ease',
                    opacity: linkedinConnected === null ? 0.5 : 1,
                    border: 'none',
                    padding: 0,
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    top: '3px',
                    left: postToLinkedin && linkedinConnected ? '23px' : '3px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: 'white',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                    transition: 'left 0.2s ease',
                  }} />
                </button>
              </div>

              {/* Status hint */}
              <p style={{
                fontSize: '11px',
                textAlign: 'center',
                color: linkedinConnected === false
                  ? '#ef4444'
                  : postToLinkedin ? '#2563eb' : '#9ca3af',
                transition: 'color 0.2s',
              }}>
                {linkedinConnected === null
                  ? 'Checking LinkedIn...'
                  : linkedinConnected === false
                    ? <>Not connected</>
                    : postToLinkedin
                      ? '✓ Will also post to LinkedIn'
                      : 'Toggle to cross-post'}
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default TweetComposer;
