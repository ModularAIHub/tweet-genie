import { useState, useEffect } from 'react';
import { tweets, twitter, ai, imageGeneration, scheduling, media } from '../utils/api';
import { 
  sanitizeUserInput, 
  sanitizeAIContent, 
  validateTweetContent, 
  sanitizeImagePrompt,
  validateFileUpload 
} from '../utils/sanitization';
import toast from 'react-hot-toast';

// Utility function to calculate base64 image size in bytes
const getBase64Size = (base64String) => {
  const base64Data = base64String.replace(/^data:image\/[a-z]+;base64,/, '');
  return (base64Data.length * 3) / 4;
};
// Maximum image size in bytes (5MB)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

// Helper function to convert File to base64 data URL
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const useTweetComposer = () => {
  // State
  const [content, setContentState] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [twitterAccounts, setTwitterAccounts] = useState([]);
  const [isLoadingTwitterAccounts, setIsLoadingTwitterAccounts] = useState(true);
  const [threadTweets, setThreadTweetsState] = useState(['']);
  const [threadImages, setThreadImages] = useState([]);
  const [isThread, setIsThread] = useState(false);
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPrompt, setAiPromptState] = useState('');
  const [aiStyle, setAiStyle] = useState('casual');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [imagePrompt, setImagePromptState] = useState('');
  const [imageStyle, setImageStyle] = useState('natural');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [scheduledTweets, setScheduledTweets] = useState([]);
  const [isLoadingScheduled, setIsLoadingScheduled] = useState(false);

  // Sanitized setters with proper space preservation
  const setContent = (value) => {
    // Only trim start/end and limit length, preserve all internal spaces
    const cleaned = value.length > 500 ? value.substring(0, 500) : value;
    setContentState(cleaned);
  };

  const setAiPrompt = (value) => {
    // Only trim start/end and limit length, preserve all internal spaces
    const cleaned = value.length > 1000 ? value.substring(0, 1000) : value;
    setAiPromptState(cleaned);
  };

  const setImagePrompt = (value) => {
    // Only trim start/end and limit length, preserve all internal spaces
    const cleaned = value.length > 1000 ? value.substring(0, 1000) : value;
    setImagePromptState(cleaned);
  };

  const setThreadTweets = (tweets) => {
    // Only limit length, preserve all internal spaces
    const cleanedTweets = tweets.map(tweet => 
      tweet === '---' ? tweet : (tweet.length > 300 ? tweet.substring(0, 300) : tweet)
    );
    setThreadTweetsState(cleanedTweets);
    
    // Ensure threadImages array matches threadTweets length
    setThreadImages(prev => {
      const newImages = [...prev];
      while (newImages.length < cleanedTweets.length) {
        newImages.push([]);
      }
      return newImages.slice(0, cleanedTweets.length);
    });
  };

  // Initialize
  useEffect(() => {
    fetchTwitterAccounts();
    fetchScheduledTweets();
    
    return () => {
      selectedImages.forEach(img => {
        if (img.preview && img.preview.startsWith('blob:')) {
          URL.revokeObjectURL(img.preview);
        }
      });
      // Clean up thread images
      threadImages.forEach(tweetImages => {
        tweetImages.forEach(img => {
          if (img.preview && img.preview.startsWith('blob:')) {
            URL.revokeObjectURL(img.preview);
          }
        });
      });
    };
  }, []);

  // Computed values
  const characterCount = isThread 
    ? threadTweets.reduce((total, tweet) => total + tweet.length, 0)
    : content.length;

  // API Functions
  const fetchTwitterAccounts = async () => {
    try {
      setIsLoadingTwitterAccounts(true);
      const response = await twitter.getStatus();
      console.log('Twitter status response:', response.data);
      
      if (response.data.accounts && response.data.accounts.length > 0) {
        setTwitterAccounts(response.data.accounts);
        console.log('Twitter accounts loaded:', response.data.accounts);
      } else {
        console.log('No Twitter accounts found');
        setTwitterAccounts([]);
      }
    } catch (error) {
      console.error('Error fetching Twitter accounts:', error);
      setTwitterAccounts([]);
    } finally {
      setIsLoadingTwitterAccounts(false);
    }
  };

  const fetchScheduledTweets = async () => {
    try {
      setIsLoadingScheduled(true);
      const response = await scheduling.list();
      const tweets = response.data?.scheduled_tweets || [];
      setScheduledTweets(Array.isArray(tweets) ? tweets : []);
    } catch (error) {
      console.error('Error fetching scheduled tweets:', error);
      setScheduledTweets([]); // Set empty array on error
    } finally {
      setIsLoadingScheduled(false);
    }
  };

  // Handlers
  const handleImageUpload = (event) => {
    const files = Array.from(event.target.files);
    const validFiles = [];

    for (const file of files) {
      const validation = validateFileUpload(file);
      
      if (!validation.isValid) {
        validation.errors.forEach(error => toast.error(error));
        continue;
      }

      if (validation.warnings.length > 0) {
  validation.warnings.forEach(warning => toast.error(warning));
      }

      const isValidType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type);
      const isValidSize = file.size <= MAX_IMAGE_SIZE;
      
      if (!isValidType) {
        toast.error(`${file.name} is not a valid image type`);
        continue;
      }
      if (!isValidSize) {
        toast.error(`${file.name} is too large (max 5MB)`);
        continue;
      }
      
      validFiles.push(file);
    }

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

  const handleImageRemove = (index) => {
    const imageToRemove = selectedImages[index];
    if (imageToRemove.preview && imageToRemove.preview.startsWith('blob:')) {
      URL.revokeObjectURL(imageToRemove.preview);
    }
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handlePost = async () => {
    // Validate content before posting
    if (isThread) {
      // Only validate, do NOT HTML-encode or sanitize to entities, preserve raw Unicode
      const validTweets = threadTweets.filter(tweet => tweet.trim().length > 0 && tweet !== '---');
      for (let i = 0; i < validTweets.length; i++) {
        const validation = validateTweetContent(validTweets[i]);
        if (!validation.isValid) {
          toast.error(`Tweet ${i + 1}: ${validation.errors.join(', ')}`);
          return;
        }
        if (validation.warnings.length > 0) {
          validation.warnings.forEach(warning => toast.error(`Tweet ${i + 1}: ${warning}`));
        }
        // DO NOT overwrite validTweets[i] with sanitizedContent (which is HTML-encoded)
      }
      if (validTweets.length === 0 && selectedImages.length === 0) {
        toast.error('Please enter some content or add images');
        return;
      }
    } else {
      const validation = validateTweetContent(content);
      if (!validation.isValid) {
        toast.error(validation.errors.join(', '));
        return;
      }
      if (validation.warnings.length > 0) {
        validation.warnings.forEach(warning => toast.error(warning));
      }
      if (!content.trim() && selectedImages.length === 0) {
        toast.error('Please enter some content or add images');
        return;
      }
    }

    setIsPosting(true);
    try {
      // Upload main tweet images to Twitter and get media IDs
      let mediaIds = [];
      if (selectedImages.length > 0) {
        const mediaFiles = [];
        for (const img of selectedImages) {
          if (img.isAIGenerated && img.preview.startsWith('data:')) {
            mediaFiles.push(img.preview);
          } else if (img.file) {
            const base64 = await fileToBase64(img.file);
            mediaFiles.push(base64);
          }
        }
        if (mediaFiles.length > 0) {
          const uploadRes = await media.upload(mediaFiles);
          if (uploadRes.data && uploadRes.data.mediaIds) {
            mediaIds = uploadRes.data.mediaIds;
          } else {
            throw new Error('Failed to upload images to Twitter');
          }
        }
      }

      // For threads, upload images for each tweet in the thread
      let threadMedia = [];
      if (isThread) {
        for (let i = 0; i < threadTweets.length; i++) {
          const tweet = threadTweets[i];
          if (tweet.trim().length > 0 && tweet !== '---') {
            const tweetImages = threadImages[i] || [];
            if (tweetImages.length > 0) {
              const tweetMediaFiles = [];
              for (const img of tweetImages) {
                if (img.isAIGenerated && img.preview.startsWith('data:')) {
                  tweetMediaFiles.push(img.preview);
                } else if (img.file) {
                  const base64 = await fileToBase64(img.file);
                  tweetMediaFiles.push(base64);
                }
              }
              if (tweetMediaFiles.length > 0) {
                const uploadRes = await media.upload(tweetMediaFiles);
                if (uploadRes.data && uploadRes.data.mediaIds) {
                  threadMedia.push(uploadRes.data.mediaIds);
                } else {
                  throw new Error('Failed to upload thread images to Twitter');
                }
              } else {
                threadMedia.push([]);
              }
            } else {
              threadMedia.push([]);
            }
          }
        }
      }

      if (isThread) {
        const validTweets = threadTweets.filter(tweet => tweet.trim().length > 0 && tweet !== '---');
        // threadMedia is an array of arrays of media IDs, one per tweet
        // Send only raw Unicode, do NOT HTML-encode or sanitize to entities
        await tweets.create({
          thread: validTweets,
          threadMedia,
          media: mediaIds.length > 0 ? mediaIds : undefined
        });
        toast.success(`Thread with ${validTweets.length} tweets posted successfully!`);
        setThreadTweets(['']);
        setThreadImages([]);
        setIsThread(false);
      } else {
        await tweets.create({
          content: content.trim(),
          media: mediaIds.length > 0 ? mediaIds : undefined
        });
        toast.success('Tweet posted successfully!');
        setContent('');
      }

      selectedImages.forEach(img => {
        if (img.preview && img.preview.startsWith('blob:')) {
          URL.revokeObjectURL(img.preview);
        }
      });
      setSelectedImages([]);

      // Clean up thread images
      threadImages.forEach(tweetImages => {
        tweetImages.forEach(img => {
          if (img.preview && img.preview.startsWith('blob:')) {
            URL.revokeObjectURL(img.preview);
          }
        });
      });

    } catch (error) {
      console.error('Post tweet error:', error);

      if (error.response?.data?.code === 'TWITTER_RATE_LIMIT') {
        toast.error('⏰ Twitter rate limit reached. Please try again in 15-30 minutes. Your credits have been refunded.', {
          duration: 8000
        });
        return;
      }

      if (error.response?.data?.code === 'TWITTER_TOKEN_EXPIRED') {
        toast.error('Twitter authentication expired. Please reconnect your account.');
        window.location.href = '/settings';
        return;
      }

      if (error.response?.data?.code === 'TWITTER_PERMISSIONS_ERROR') {
        toast.error('Twitter permissions expired. Please reconnect your Twitter account.', {
          duration: 6000
        });
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

  // Accepts a date string and timezone as arguments
  const handleSchedule = async (dateString, timezone) => {
    if (isThread) {
      // Validate thread content
      const validTweets = threadTweets.filter(tweet => tweet.trim().length > 0 && tweet !== '---');
      if (validTweets.length === 0) {
        toast.error('Please enter some content for the thread');
        return;
      }
    } else {
      if (!content.trim() && selectedImages.length === 0) {
        toast.error('Please enter some content or add images');
        return;
      }
    }
    if (!dateString) {
      toast.error('Please select a date and time');
      return;
    }
    setIsScheduling(true);
    try {
      let mediaIds = [];
      let threadMedia = [];
      if (isThread) {
        // Upload images for each tweet in the thread
        for (let i = 0; i < threadTweets.length; i++) {
          const tweet = threadTweets[i];
          if (tweet.trim().length > 0 && tweet !== '---') {
            const tweetImages = threadImages[i] || [];
            if (tweetImages.length > 0) {
              const tweetMediaFiles = [];
              for (const img of tweetImages) {
                if (img.isAIGenerated && img.preview.startsWith('data:')) {
                  tweetMediaFiles.push(img.preview);
                } else if (img.file) {
                  const base64 = await fileToBase64(img.file);
                  tweetMediaFiles.push(base64);
                }
              }
              if (tweetMediaFiles.length > 0) {
                const uploadRes = await media.upload(tweetMediaFiles);
                if (uploadRes.data && uploadRes.data.mediaIds) {
                  threadMedia.push(uploadRes.data.mediaIds);
                } else {
                  throw new Error('Failed to upload thread images to Twitter');
                }
              } else {
                threadMedia.push([]);
              }
            } else {
              threadMedia.push([]);
            }
          }
        }
      } else {
        // Single tweet: upload main images
        if (selectedImages.length > 0) {
          const mediaFiles = [];
          for (const img of selectedImages) {
            if (img.isAIGenerated && img.preview.startsWith('data:')) {
              mediaFiles.push(img.preview);
            } else if (img.file) {
              const base64 = await fileToBase64(img.file);
              mediaFiles.push(base64);
            }
          }
          if (mediaFiles.length > 0) {
            const uploadRes = await media.upload(mediaFiles);
            if (uploadRes.data && uploadRes.data.mediaIds) {
              mediaIds = uploadRes.data.mediaIds;
            } else {
              throw new Error('Failed to upload images to Twitter');
            }
          }
        }
      }

      if (isThread) {
        const validTweets = threadTweets.filter(tweet => tweet.trim().length > 0 && tweet !== '---');
        // threadMedia is an array of arrays of media IDs, one per tweet
        await scheduling.create({
          thread: validTweets,
          threadMedia,
          scheduled_for: dateString,
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
        });
        toast.success('Thread scheduled successfully!');
        setThreadTweets(['']);
        setThreadImages([]);
        setIsThread(false);
      } else {
        await scheduling.create({
          content: content.trim(),
          media: mediaIds.length > 0 ? mediaIds : undefined,
          scheduled_for: dateString,
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
        });
        toast.success('Tweet scheduled successfully!');
        setContent('');
      }

      setScheduledFor('');
      selectedImages.forEach(img => {
        if (img.preview && img.preview.startsWith('blob:')) {
          URL.revokeObjectURL(img.preview);
        }
      });
      setSelectedImages([]);
      fetchScheduledTweets();
    } catch (error) {
      console.error('Schedule tweet error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to schedule tweet';
      toast.error(errorMessage);
    } finally {
      setIsScheduling(false);
    }
  };

  const handleAIGenerate = async () => {
    let sanitizedPrompt = sanitizeUserInput(aiPrompt.trim(), { maxLength: 1000 });

    if (!sanitizedPrompt) {
      toast.error('Please enter a valid prompt');
      return;
    }

    // If not thread mode, force prompt to request a single tweet under 280 chars
    let aiRequestPrompt = sanitizedPrompt;
    let aiRequestIsThread = isThread;
    if (!isThread) {
      aiRequestPrompt = `Write a single tweet under 280 characters about: ${sanitizedPrompt}`;
      aiRequestIsThread = false;
    }

    setIsGenerating(true);
    try {
      // Send the prompt to the backend, always include isThread
      const response = await ai.generate({
        prompt: aiRequestPrompt,
        style: aiStyle,
        isThread: aiRequestIsThread
      });

      if (response.data && response.data.content) {
        // Sanitize AI response
        const sanitizedContent = sanitizeAIContent(response.data.content, {
          maxLength: 5000,
          preserveFormatting: true
        });

        if (!sanitizedContent || sanitizedContent.length < 10) {
          toast.error('Generated content was too short or invalid after sanitization');
          return;
        }

        if (isThread) {
          const content = sanitizedContent;
          console.log('AI Response for thread:', content);
          // Split the content by --- separators or fallback to smart splitting
          const aiTweets = splitIntoTweets(content);
          console.log('Final thread tweets:', aiTweets);
          setThreadTweets(aiTweets.length > 0 ? aiTweets : [content]);
        } else {
          // Always treat as single tweet, even if AI returns separators
          let tweet = sanitizedContent.replace(/---/g, '').trim();
          // Limit to 280 characters (Twitter limit)
          if (tweet.length > 280) tweet = tweet.substring(0, 280);
          setContent(tweet);
        }

        setShowAIPrompt(false);
        setAiPrompt('');

        // Show credits used information if available
        if (response.data.creditsUsed && response.data.threadCount) {
          toast.success(`Content generated successfully! Used ${response.data.creditsUsed} credits for ${response.data.threadCount} thread(s).`);
        } else {
          toast.success('Content generated successfully!');
        }
      } else {
        toast.error('Failed to generate content');
      }
    } catch (error) {
      console.error('AI generation error:', error);

      // Handle specific credit errors
      if (error.response?.status === 402) {
        const errorData = error.response.data;
        if (errorData.threadCount > 1) {
          toast.error(`Insufficient credits: Need ${errorData.creditsRequired} credits for ${errorData.threadCount} threads. Available: ${errorData.creditsAvailable}`);
        } else {
          toast.error(`Insufficient credits: Need ${errorData.creditsRequired} credits. Available: ${errorData.creditsAvailable || 0}`);
        }
      } else {
        toast.error('Failed to generate content');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Helper function to split content into tweets
  const splitIntoTweets = (content) => {
    // First, check if content has the --- separators from AI
    if (content.includes('---')) {
      console.log('Found --- separators, splitting by them');
      const tweets = content.split('---')
        .map(tweet => tweet.trim())
        .filter(tweet => tweet.length > 0);
      
      console.log('Split tweets by ---:', tweets);
      return tweets;
    }
    
    // Fallback to original splitting logic if no --- separators
    // Try to split by natural breaks first (double newlines, numbered points, etc.)
    let sections = content.split(/\n\n+/).filter(s => s.trim().length > 0);
    
    // If no natural breaks, split by single newlines
    if (sections.length === 1) {
      sections = content.split(/\n/).filter(s => s.trim().length > 0);
    }
    
    // If still one section, split by sentences but keep the sentence endings
    if (sections.length === 1) {
      sections = content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    }
    
    const tweets = [];
    let currentTweet = '';
    
    sections.forEach((section, index) => {
      const trimmed = section.trim();
      
      // If section is already too long, it needs to be split further
      if (trimmed.length > 280) {
        // Add current tweet if it has content
        if (currentTweet.trim()) {
          tweets.push(currentTweet.trim());
          currentTweet = '';
        }
        
        // Split long section into multiple tweets
        const words = trimmed.split(' ');
        words.forEach(word => {
          if (currentTweet.length + word.length + 1 <= 280) {
            currentTweet += (currentTweet ? ' ' : '') + word;
          } else {
            if (currentTweet.trim()) tweets.push(currentTweet.trim());
            currentTweet = word;
          }
        });
      } else {
        // Check if we can add this section to current tweet
        const separator = currentTweet && !currentTweet.endsWith('.') && !currentTweet.endsWith('!') && !currentTweet.endsWith('?') ? '. ' : (currentTweet ? ' ' : '');
        
        if (currentTweet.length + separator.length + trimmed.length <= 280) {
          currentTweet += separator + trimmed;
        } else {
          // Start new tweet
          if (currentTweet.trim()) tweets.push(currentTweet.trim());
          currentTweet = trimmed;
        }
      }
    });
    
    // IMPORTANT: Always add the last tweet if it has content
    if (currentTweet.trim()) {
      tweets.push(currentTweet.trim());
    }
    
    // If no tweets were created, return the original content as a single tweet
    if (tweets.length === 0 && content.trim()) {
      tweets.push(content.trim().substring(0, 280));
    }
    
    console.log('Split content into tweets:', {
      originalLength: content.length,
      sectionsCount: sections.length,
      tweetsGenerated: tweets.length,
      tweets: tweets.map(t => t.substring(0, 50) + '...')
    });
    
    return tweets;
  };

  const handleImageGenerate = async () => {
    const sanitizedPrompt = sanitizeImagePrompt(imagePrompt.trim());
    
    if (!sanitizedPrompt) {
      toast.error('Please enter a valid image description');
      return;
    }

    if (sanitizedPrompt.includes('[FILTERED]')) {
  toast.error('Some content was filtered from your prompt for safety reasons');
    }

    setIsGeneratingImage(true);
    try {
      const response = await imageGeneration.generate(sanitizedPrompt, imageStyle);
      
      if (response.data && response.data.success && response.data.imageUrl) {
        const imageSize = getBase64Size(response.data.imageUrl);
        
        if (imageSize > MAX_IMAGE_SIZE) {
          toast.error(`Generated image is too large (${(imageSize / (1024 * 1024)).toFixed(1)}MB). Max allowed is 5MB. Please try a different prompt.`);
          return;
        }
        
        const newImage = {
          file: null,
          preview: response.data.imageUrl,
          id: Math.random().toString(36).substr(2, 9),
          isAIGenerated: true,
          prompt: sanitizedPrompt,
          provider: response.data.provider || 'AI'
        };
        
        setSelectedImages(prev => [...prev, newImage]);
        setShowImagePrompt(false);
        setImagePrompt('');
        toast.success('Image generated successfully!');
      } else {
        toast.error('Failed to generate image - invalid response');
      }
      
    } catch (error) {
      console.error('Image generation error:', error);
      
      if (error.code === 'ECONNABORTED') {
        toast.error('Image generation timed out. Please try again.');
      } else if (error.response?.status === 413) {
        toast.error('Generated image is too large. Please try again.');
      } else if (error.response?.status === 500) {
        toast.error('Server error during image generation. Please try again.');
      } else {
        toast.error(`Failed to generate image: ${error.message}`);
      }
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleCancelScheduled = async (tweetId) => {
    try {
      await scheduling.cancel(tweetId);
      toast.success('Scheduled tweet cancelled');
      fetchScheduledTweets();
    } catch (error) {
      console.error('Cancel scheduled tweet error:', error);
      toast.error('Failed to cancel scheduled tweet');
    }
  };

  // Thread handlers
  const handleThreadTweetChange = (index, value) => {
    const sanitizedValue = value === '---' ? value : sanitizeUserInput(value, { maxLength: 300 });
    const newTweets = [...threadTweets];
    newTweets[index] = sanitizedValue;
    setThreadTweets(newTweets);
  };

  const handleThreadImageUpload = (threadIndex, event) => {
    const files = Array.from(event.target.files);
    const validFiles = [];

    for (const file of files) {
      const validation = validateFileUpload(file);
      
      if (!validation.isValid) {
        validation.errors.forEach(error => toast.error(error));
        continue;
      }

      if (validation.warnings.length > 0) {
  validation.warnings.forEach(warning => toast.error(warning));
      }

      const isValidType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type);
      const isValidSize = file.size <= MAX_IMAGE_SIZE;
      
      if (!isValidType) {
        toast.error(`${file.name} is not a valid image type`);
        continue;
      }
      if (!isValidSize) {
        toast.error(`${file.name} is too large (max 5MB)`);
        continue;
      }
      
      validFiles.push(file);
    }

    // Check if adding these images would exceed the limit for this thread tweet
    const currentImagesForThread = threadImages[threadIndex] || [];
    if (currentImagesForThread.length + validFiles.length > 4) {
      toast.error('Maximum 4 images allowed per tweet');
      return;
    }

    const newImages = validFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).substr(2, 9)
    }));

    setThreadImages(prev => {
      const updated = [...prev];
      if (!updated[threadIndex]) {
        updated[threadIndex] = [];
      }
      updated[threadIndex] = [...updated[threadIndex], ...newImages];
      return updated;
    });

    // Clear the input
    event.target.value = '';
  };

  const handleThreadImageRemove = (threadIndex, imageIndex) => {
    setThreadImages(prev => {
      const updated = [...prev];
      if (updated[threadIndex]) {
        const imageToRemove = updated[threadIndex][imageIndex];
        if (imageToRemove.preview && imageToRemove.preview.startsWith('blob:')) {
          URL.revokeObjectURL(imageToRemove.preview);
        }
        updated[threadIndex] = updated[threadIndex].filter((_, i) => i !== imageIndex);
      }
      return updated;
    });
  };

  const handleAddTweet = () => {
    if (threadTweets.length < 10) {
      setThreadTweets([...threadTweets, '']);
    }
  };

  const handleRemoveTweet = (index) => {
    if (threadTweets.length > 1) {
      // Clean up any images for this thread tweet
      if (threadImages[index]) {
        threadImages[index].forEach(img => {
          if (img.preview && img.preview.startsWith('blob:')) {
            URL.revokeObjectURL(img.preview);
          }
        });
      }
      setThreadTweets(threadTweets.filter((_, i) => i !== index));
      setThreadImages(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Button handlers
  const handleAIButtonClick = () => {
    setShowAIPrompt(!showAIPrompt);
    if (showImagePrompt) setShowImagePrompt(false);
  };

  const handleImageButtonClick = () => {
    setShowImagePrompt(!showImagePrompt);
    if (showAIPrompt) setShowAIPrompt(false);
  };

  return {
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
  };
};
