import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Calendar, 
  Image, 
  Sparkles, 
  X, 
  Clock,
  Plus,
  Trash2,
  ArrowRight,
  RefreshCw,
  Wand2
} from 'lucide-react';
import { tweets, twitter, ai, imageGeneration } from '../utils/api';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';

// Utility function to calculate base64 image size in bytes
const getBase64Size = (base64String) => {
  // Remove data:image/png;base64, prefix if present
  const base64Data = base64String.replace(/^data:image\/[a-z]+;base64,/, '');
  // Calculate size: each base64 character represents 6 bits, so 4 chars = 3 bytes
  return (base64Data.length * 3) / 4;
};

// Maximum image size in bytes (5MB)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const TweetComposer = () => {
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [twitterAccounts, setTwitterAccounts] = useState([]);
  const [threadTweets, setThreadTweets] = useState(['']);
  const [isThread, setIsThread] = useState(false);
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStyle, setAiStyle] = useState('casual');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStyle, setImageStyle] = useState('natural');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  useEffect(() => {
    fetchTwitterAccounts();
  }, []);

  // Cleanup image URLs on unmount
  useEffect(() => {
    return () => {
      selectedImages.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, [selectedImages]);

  const fetchTwitterAccounts = async () => {
    try {
      const response = await twitter.getStatus();
      setTwitterAccounts(response.data.accounts || []);
    } catch (error) {
      console.error('Failed to fetch Twitter accounts:', error);
    }
  };

  const handleImageUpload = (event) => {
    const files = Array.from(event.target.files);
    const validFiles = files.filter(file => {
      const isValidType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type);
      const isValidSize = file.size <= 5 * 1024 * 1024; // 5MB limit
      
      if (!isValidType) {
        toast.error(`${file.name} is not a valid image type`);
        return false;
      }
      if (!isValidSize) {
        toast.error(`${file.name} is too large (max 5MB)`);
        return false;
      }
      return true;
    });

    if (selectedImages.length + validFiles.length > 4) {
      toast.error('Maximum 4 images allowed per tweet');
      return;
    }

    const newImages = validFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).substr(2, 9)
    }));

    setSelectedImages(prev => [...prev, ...newImages]);
  };

  const removeImage = (imageId) => {
    setSelectedImages(prev => {
      const imageToRemove = prev.find(img => img.id === imageId);
      if (imageToRemove && imageToRemove.preview && !imageToRemove.isAIGenerated) {
        // Only revoke URL for local images, not AI generated ones
        URL.revokeObjectURL(imageToRemove.preview);
      }
      return prev.filter(img => img.id !== imageId);
    });
  };

  const convertImagesToBase64 = async (images) => {
    return Promise.all(
      images.map(image => {
        if (image.isAIGenerated) {
          // AI generated images are already in base64 format
          return Promise.resolve(image.preview);
        } else {
          // Convert local files to base64
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(image.file);
          });
        }
      })
    );
  };

  const handlePost = async () => {
    if (!content.trim()) {
      toast.error('Please enter some content');
      return;
    }

    if (twitterAccounts.length === 0) {
      toast.error('Please connect a Twitter account first');
      return;
    }

    try {
      setIsPosting(true);

      let mediaData = [];
      if (selectedImages.length > 0) {
        setIsUploadingImages(true);
        try {
          mediaData = await convertImagesToBase64(selectedImages);
        } catch (error) {
          toast.error('Failed to process images');
          return;
        } finally {
          setIsUploadingImages(false);
        }
      }

      const tweetData = {
        content: content.trim(),
        ...(mediaData.length > 0 && { media: mediaData }),
        ...(isThread && threadTweets.filter(t => t.trim()).length > 0 && {
          thread: threadTweets.filter(t => t.trim()).map(t => ({ content: t.trim() }))
        })
      };

      const response = await tweets.create(tweetData);

      if (response.data.success) {
        toast.success('Tweet posted successfully!');
        setContent('');
        setThreadTweets(['']);
        setIsThread(false);
        // Clean up image previews
        selectedImages.forEach(img => URL.revokeObjectURL(img.preview));
        setSelectedImages([]);
      }
    } catch (error) {
      console.error('Post tweet error:', error);
      
      // Handle Twitter rate limit errors (429)
      if (error.response?.data?.code === 'TWITTER_RATE_LIMIT') {
        toast.error('⏰ Twitter rate limit reached. Please try again in 15-30 minutes. Your credits have been refunded.', {
          duration: 8000
        });
        return;
      }
      
      // Handle specific Twitter token errors
      if (error.response?.data?.code === 'TWITTER_TOKEN_EXPIRED') {
        toast.error('Twitter authentication expired. Please reconnect your account.');
        // Redirect to settings to reconnect
        window.location.href = '/settings';
        return;
      }
      
      // Handle Twitter API 403 errors (permissions issue)
      if (error.response?.data?.code === 'TWITTER_PERMISSIONS_ERROR') {
        toast.error('Twitter permissions expired. Please reconnect your Twitter account.', {
          duration: 6000
        });
        // Auto-redirect to settings after showing error
        setTimeout(() => {
          window.location.href = '/settings';
        }, 2000);
        return;
      }
      
      const errorMessage = error.response?.data?.error || 'Failed to post tweet';
      toast.error(errorMessage);
    } finally {
      setIsPosting(false);
    }
  };

  const handleSchedule = async () => {
    if (!content.trim()) {
      toast.error('Please enter some content');
      return;
    }

    if (!scheduledFor) {
      toast.error('Please select a date and time');
      return;
    }

    // Implementation would create a draft tweet first, then schedule it
    toast.info('Scheduling feature coming soon!');
  };

  const addThreadTweet = () => {
    setThreadTweets([...threadTweets, '']);
  };

  const updateThreadTweet = (index, value) => {
    const newThreadTweets = [...threadTweets];
    newThreadTweets[index] = value;
    setThreadTweets(newThreadTweets);
  };

  const removeThreadTweet = (index) => {
    if (threadTweets.length > 1) {
      const newThreadTweets = threadTweets.filter((_, i) => i !== index);
      setThreadTweets(newThreadTweets);
    }
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    try {
      setIsGenerating(true);
      
      const response = await ai.generate(aiPrompt.trim(), aiStyle);
      
      if (response.data.success) {
        setContent(response.data.content);
        setShowAIPrompt(false);
        setAiPrompt('');
        toast.success(`Content generated using ${response.data.provider}!`);
      }
    } catch (error) {
      console.error('AI generation error:', error);
      
      const errorMessage = error.response?.data?.details || 
                          error.response?.data?.error || 
                          'Failed to generate content';
      
      toast.error(`AI Generation failed: ${errorMessage}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAIButtonClick = () => {
    setShowAIPrompt(!showAIPrompt);
    if (showAIPrompt) {
      setAiPrompt('');
    }
  };

  const handleImageGenerate = async () => {
    if (!imagePrompt.trim()) {
      toast.error('Please enter an image description');
      return;
    }

    try {
      setIsGeneratingImage(true);
      
      console.log('Generating image with prompt:', imagePrompt.trim());
      const response = await imageGeneration.generate(imagePrompt.trim(), imageStyle);
      
      console.log('Image generation response status:', response.status);
      console.log('Image generation response data keys:', response.data ? Object.keys(response.data) : 'no data');
      console.log('Response success:', response.data?.success);
      console.log('Response imageUrl type:', typeof response.data?.imageUrl);
      console.log('Response imageUrl length:', response.data?.imageUrl ? response.data.imageUrl.length : 'null');
      
      if (response.data && response.data.success && response.data.imageUrl) {
        // Check if the generated image exceeds 5MB
        const imageSize = getBase64Size(response.data.imageUrl);
        console.log('Generated image size:', (imageSize / (1024 * 1024)).toFixed(2), 'MB');
        
        if (imageSize > MAX_IMAGE_SIZE) {
          toast.error(`Generated image is too large (${(imageSize / (1024 * 1024)).toFixed(1)}MB). Max allowed is 5MB. Please try a different prompt.`);
          return;
        }
        
        // Add generated image to selected images
        const newImage = {
          file: null, // No actual file for AI generated
          preview: response.data.imageUrl, // base64 image data
          id: Math.random().toString(36).substr(2, 9),
          isAIGenerated: true,
          prompt: imagePrompt.trim(),
          provider: response.data.provider || 'AI'
        };

        console.log('Adding new image to state:', { ...newImage, preview: newImage.preview.substring(0, 100) + '...' });
        setSelectedImages(prev => [...prev, newImage]);
        setShowImagePrompt(false);
        setImagePrompt('');
        toast.success(`Image generated successfully!`);
      } else {
        console.error('Image generation failed - invalid response structure:', response.data);
        toast.error('Image generation failed - invalid response');
      }
    } catch (error) {
      console.error('AI image generation error:', error);
      console.error('Error details:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        code: error.code,
        config: {
          timeout: error.config?.timeout,
          maxContentLength: error.config?.maxContentLength,
          url: error.config?.url
        }
      });
      
      let errorMessage = 'Failed to generate image';
      
      if (error.code === 'ECONNABORTED') {
        errorMessage = 'Request timeout - image generation took too long';
      } else if (error.response?.status === 413) {
        errorMessage = 'Response too large - please try a simpler prompt';
      } else if (error.response?.data?.details) {
        errorMessage = error.response.data.details;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(`Image generation failed: ${errorMessage}`);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleImageButtonClick = () => {
    setShowImagePrompt(!showImagePrompt);
    if (showImagePrompt) {
      setImagePrompt('');
    }
  };

  const characterCount = content.length;
  const isOverLimit = characterCount > 280;
  const charactersLeft = 280 - characterCount;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Compose Tweet</h1>
        <p className="mt-2 text-gray-600">
          Create and share your thoughts with the world
        </p>
      </div>

      {/* Twitter Account Status */}
      {twitterAccounts.length === 0 ? (
        <div className="card bg-yellow-50 border-yellow-200">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              <div className="h-10 w-10 bg-yellow-100 rounded-full flex items-center justify-center">
                <X className="h-5 w-5 text-yellow-600" />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-yellow-800">
                No Twitter Account Connected
              </h3>
              <p className="text-sm text-yellow-700">
                You need to connect a Twitter account to post tweets.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="card bg-green-50 border-green-200">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              <img
                src={twitterAccounts[0].profile_image_url}
                alt="Profile"
                className="h-10 w-10 rounded-full"
              />
            </div>
            <div>
              <h3 className="text-sm font-medium text-green-800">
                Connected as @{twitterAccounts[0].username}
              </h3>
              <p className="text-sm text-green-700">
                {twitterAccounts[0].display_name}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tweet Composer */}
      <div className="card">
        {/* Thread toggle */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={isThread}
                onChange={(e) => setIsThread(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="ml-2 text-sm font-medium text-gray-700">
                Create thread
              </span>
            </label>
          </div>
          <button
            onClick={handleAIButtonClick}
            className={`btn btn-sm ${showAIPrompt ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            {showAIPrompt ? 'Cancel AI' : 'AI Generate'}
          </button>
        </div>

        {/* Main tweet */}
        <div className="space-y-4">
          <div className="relative">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What's happening?"
              className={`textarea ${isOverLimit ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
              rows={4}
            />
            <div className="absolute bottom-3 right-3 flex items-center space-x-2">
              <span className={`text-sm font-medium ${
                isOverLimit ? 'text-red-600' : 
                charactersLeft <= 20 ? 'text-yellow-600' : 
                'text-gray-500'
              }`}>
                {charactersLeft}
              </span>
            </div>
          </div>

          {/* AI Prompt Bar */}
          {showAIPrompt && (
            <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
              <div className="flex items-center space-x-3 mb-3">
                <Sparkles className="h-5 w-5 text-blue-600" />
                <span className="font-medium text-blue-900">AI Content Generator</span>
                <div className="flex-1"></div>
                <select
                  value={aiStyle}
                  onChange={(e) => setAiStyle(e.target.value)}
                  className="text-sm border border-blue-300 rounded px-2 py-1 bg-white"
                >
                  <option value="casual">Casual</option>
                  <option value="professional">Professional</option>
                  <option value="witty">Witty</option>
                  <option value="inspirational">Inspirational</option>
                  <option value="informative">Informative</option>
                </select>
              </div>
              
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="What should I tweet about? (e.g., productivity tips, tech trends...)"
                  className="flex-1 px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !isGenerating) {
                      handleAIGenerate();
                    }
                  }}
                />
                <button
                  onClick={handleAIGenerate}
                  disabled={isGenerating || !aiPrompt.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight className="h-4 w-4" />
                      <span>Generate</span>
                    </>
                  )}
                </button>
              </div>
              
              <div className="mt-2 text-xs text-blue-600">
                Fallback: Perplexity AI → Google Gemini → OpenAI GPT
              </div>
            </div>
          )}

          {/* Thread tweets */}
          {isThread && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <div className="h-0.5 w-8 bg-gray-300"></div>
                <span className="text-sm font-medium text-gray-600">Thread</span>
              </div>
              
              {threadTweets.map((tweet, index) => (
                <div key={index} className="relative">
                  <textarea
                    value={tweet}
                    onChange={(e) => updateThreadTweet(index, e.target.value)}
                    placeholder={`Tweet ${index + 2}`}
                    className="textarea"
                    rows={3}
                  />
                  {threadTweets.length > 1 && (
                    <button
                      onClick={() => removeThreadTweet(index)}
                      className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <div className="absolute bottom-2 right-2">
                    <span className="text-xs text-gray-500">
                      {280 - tweet.length}
                    </span>
                  </div>
                </div>
              ))}
              
              <button
                onClick={addThreadTweet}
                className="btn btn-secondary btn-sm"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Tweet
              </button>
            </div>
          )}

          {/* Media upload */}
          <div className="space-y-3">
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleImageUpload}
              className="hidden"
              id="image-upload"
            />
            
            {selectedImages.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {selectedImages.map((image) => {
                  console.log('Rendering image:', image);
                  return (
                  <div key={image.id} className="relative group">
                    <img
                      src={image.preview}
                      alt={image.isAIGenerated ? `AI Generated: ${image.prompt}` : "Upload preview"}
                      className="w-full h-32 object-cover rounded-lg border border-gray-300"
                      onError={(e) => {
                        console.error('Image failed to load:', image);
                        console.error('Image src:', image.preview);
                      }}
                    />
                    {image.isAIGenerated && (
                      <div className="absolute top-2 left-2 bg-purple-600 text-white text-xs px-2 py-1 rounded">
                        AI Generated ({image.provider})
                      </div>
                    )}
                    <button
                      onClick={() => removeImage(image.id)}
                      className="absolute top-2 right-2 p-1 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
            
            {/* Image options */}
            <div className="flex gap-3">
              <label
                htmlFor="image-upload"
                className="flex-1 border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-gray-400 transition-colors"
              >
                <Image className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600">Upload Images</p>
                <p className="text-xs text-gray-500">PNG, JPG, GIF, WebP up to 10MB</p>
              </label>
              
              <button
                onClick={handleImageButtonClick}
                className={`flex-1 border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                  showImagePrompt ? 'border-purple-400 bg-purple-50' : 'border-gray-300 hover:border-purple-400'
                }`}
              >
                <Wand2 className="h-6 w-6 text-purple-500 mx-auto mb-2" />
                <p className="text-sm text-gray-600">Generate AI Image</p>
                <p className="text-xs text-gray-500">Gemini → OpenAI</p>
              </button>
            </div>

            {/* AI Image Generation Prompt */}
            {showImagePrompt && (
              <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                <div className="flex items-center space-x-3 mb-3">
                  <Wand2 className="h-5 w-5 text-purple-600" />
                  <span className="font-medium text-purple-900">AI Image Generator</span>
                  <div className="flex-1"></div>
                  <select
                    value={imageStyle}
                    onChange={(e) => setImageStyle(e.target.value)}
                    className="text-sm border border-purple-300 rounded px-2 py-1 bg-white"
                  >
                    <option value="natural">Natural</option>
                    <option value="artistic">Artistic</option>
                  </select>
                </div>
                
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder="Describe the image you want to generate..."
                    className="flex-1 px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !isGeneratingImage) {
                        handleImageGenerate();
                      }
                    }}
                  />
                  <button
                    onClick={handleImageGenerate}
                    disabled={isGeneratingImage || !imagePrompt.trim()}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-purple-300 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    {isGeneratingImage ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4" />
                        <span>Generate</span>
                      </>
                    )}
                  </button>
                </div>
                
                <div className="mt-2 text-xs text-purple-600">
                  Fallback: Google Gemini → OpenAI DALL-E
                </div>
              </div>
            )}
          </div>

          {/* Schedule section */}
          {isScheduling && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Schedule for
              </label>
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="input"
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setIsScheduling(!isScheduling)}
                className="btn btn-secondary btn-sm"
              >
                <Clock className="h-4 w-4 mr-1" />
                {isScheduling ? 'Cancel Schedule' : 'Schedule'}
              </button>
            </div>

            <div className="flex items-center space-x-3">
              {isScheduling ? (
                <button
                  onClick={handleSchedule}
                  disabled={!content.trim() || !scheduledFor}
                  className="btn btn-primary btn-md"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Schedule Tweet
                </button>
              ) : (
                <button
                  onClick={handlePost}
                  disabled={isPosting || isUploadingImages || !content.trim() || isOverLimit || twitterAccounts.length === 0}
                  className="btn btn-primary btn-md"
                >
                  {isPosting ? (
                    <>
                      <LoadingSpinner size="sm" className="mr-2" />
                      {isUploadingImages ? 'Processing images...' : 'Posting...'}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Post Tweet
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TweetComposer;
