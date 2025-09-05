import React from 'react';
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

const TweetComposer = () => {
  const {
    // State
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
    
    // Handlers
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

  // Show loading state while checking Twitter account
  if (isLoadingTwitterAccounts) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="mt-4 text-gray-600">Loading your Twitter account...</p>
        </div>
      </div>
    );
  }

  // Show connect message if no Twitter account is connected
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Twitter Account Info */}
            <TwitterAccountInfo twitterAccounts={twitterAccounts} />

            {/* Tweet Composer */}
            <div className="card">
              {/* Thread Toggle and Content Editor */}
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

              {/* AI Content Generator */}
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

              {/* AI Image Generator */}
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

              {/* Image Uploader */}
              <div className="mb-4">
                <ImageUploader
                  selectedImages={selectedImages}
                  onImageUpload={handleImageUpload}
                  onImageRemove={handleImageRemove}
                  isUploadingImages={isUploadingImages}
                />
              </div>

              {/* Tweet Actions */}
              <TweetActions
                isThread={isThread}
                content={content}
                threadTweets={threadTweets}
                selectedImages={selectedImages}
                isPosting={isPosting}
                isScheduling={isScheduling}
                onPost={handlePost}
                onSchedule={handleSchedule}
              />
            </div>
          </div>

          {/* Sidebar intentionally left empty: Scheduled Tweets panel removed (see dedicated scheduling page) */}
          <div className="space-y-6"></div>
        </div>
      </div>
    </div>
  );
};

export default TweetComposer;
