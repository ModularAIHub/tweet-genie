import React from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import TwitterAccountInfo from '../components/TweetComposer/TwitterAccountInfo';
import TweetContentEditor from '../components/TweetComposer/TweetContentEditor';
import AIContentGenerator from '../components/TweetComposer/AIContentGenerator';
import AIImageGenerator from '../components/TweetComposer/AIImageGenerator';
import ImageUploader from '../components/TweetComposer/ImageUploader';
import ThreadComposer from '../components/TweetComposer/ThreadComposer';
import TweetActions from '../components/TweetComposer/TweetActions';
import SchedulingPanel from '../components/TweetComposer/SchedulingPanel';
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
    threadTweets,
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
    handleAddTweet,
    handleRemoveTweet,
    handleAIButtonClick,
    handleImageButtonClick,
    fetchScheduledTweets
  } = useTweetComposer();

  if (!twitterAccounts || twitterAccounts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="mt-4 text-gray-600">Loading your Twitter account...</p>
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
                  onThreadToggle={setIsThread}
                  onThreadTweetChange={handleThreadTweetChange}
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

          {/* Sidebar */}
          <div className="space-y-6">
            <SchedulingPanel
              scheduledFor={scheduledFor}
              setScheduledFor={setScheduledFor}
              scheduledTweets={scheduledTweets}
              isLoadingScheduled={isLoadingScheduled}
              onRefreshScheduled={fetchScheduledTweets}
              onCancelScheduled={handleCancelScheduled}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default TweetComposer;
