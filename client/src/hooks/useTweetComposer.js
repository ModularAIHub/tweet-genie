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

const getCachedSelectedTwitterAccount = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  const raw = localStorage.getItem('selectedTwitterAccount');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.id) return null;

    const teamContextRaw = localStorage.getItem('activeTeamContext');
    if (teamContextRaw) {
      try {
        const teamContext = JSON.parse(teamContextRaw);
        const hasTeamMembershipContext = Boolean(teamContext?.team_id || teamContext?.teamId);
        const accountTeamId = parsed?.team_id || parsed?.teamId || null;
        if (hasTeamMembershipContext && !accountTeamId) {
          return null;
        }
      } catch {
        // Ignore malformed team context and continue with cached account.
      }
    }

    return parsed;
  } catch {
    return null;
  }
};

const normalizeIdeaPrompt = (prompt) =>
  prompt
    .replace(/^question\s*tweet\s*:\s*/i, '')
    .replace(/^tweet\s*idea\s*:\s*/i, '')
    .replace(/^idea\s*:\s*/i, '')
    .replace(/^prompt\s*:\s*/i, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();

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
  const cachedAccount = getCachedSelectedTwitterAccount();

  // State
  const [content, setContentState] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [twitterAccounts, setTwitterAccounts] = useState(() => (cachedAccount ? [cachedAccount] : []));
  const [isLoadingTwitterAccounts, setIsLoadingTwitterAccounts] = useState(() => !cachedAccount);
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
    const cleaned = value.length > 500 ? value.substring(0, 500) : value;
    setContentState(cleaned);
  };

  const setAiPrompt = (value) => {
    const cleaned = value.length > 1000 ? value.substring(0, 1000) : value;
    setAiPromptState(cleaned);
  };

  const setImagePrompt = (value) => {
    const cleaned = value.length > 1000 ? value.substring(0, 1000) : value;
    setImagePromptState(cleaned);
  };

  const setThreadTweets = (tweets) => {
    const cleanedTweets = tweets.map(tweet => 
      tweet === '---' ? tweet : (tweet.length > 300 ? tweet.substring(0, 300) : tweet)
    );
    setThreadTweetsState(cleanedTweets);
    
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
    
    return () => {
      selectedImages.forEach(img => {
        if (img.preview && img.preview.startsWith('blob:')) {
          URL.revokeObjectURL(img.preview);
        }
      });
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

  const persistSelectedTwitterAccount = (accounts) => {
    if (!Array.isArray(accounts) || accounts.length === 0) {
      localStorage.removeItem('selectedTwitterAccount');
      return;
    }

    const saved = getCachedSelectedTwitterAccount();
    const preferred = saved ? accounts.find((acc) => acc.id === saved.id) : null;
    const selected = preferred || accounts[0];

    localStorage.setItem(
      'selectedTwitterAccount',
      JSON.stringify({
        id: selected.id,
        username: selected.account_username || selected.username,
        display_name: selected.account_display_name || selected.display_name,
        team_id: selected.team_id || selected.teamId || null,
      })
    );
  };

  // API Functions
  const fetchTwitterAccounts = async () => {
    let personalAccounts = [];
    let mergedAccounts = [];

    try {
      if (twitterAccounts.length === 0) {
        setIsLoadingTwitterAccounts(true);
      }

      try {
        // Use default api timeout (30s) instead of a shorter per-call override
        const personalRes = await twitter.getStatus();
        personalAccounts = Array.isArray(personalRes?.data?.accounts) ? personalRes.data.accounts : [];
        mergedAccounts = [...personalAccounts];

        if (personalAccounts.length > 0) {
          setTwitterAccounts(personalAccounts);
          persistSelectedTwitterAccount(personalAccounts);
          setIsLoadingTwitterAccounts(false);
        }
      } catch (personalError) {
        console.error('Error fetching personal Twitter accounts:', personalError);
      }

      try {
        const teamRes = await twitter.getTeamAccounts();
        const responseTeamId = teamRes?.data?.team_id || teamRes?.data?.teamId || null;
        const rawTeamAccounts = Array.isArray(teamRes?.data?.accounts) ? teamRes.data.accounts : [];
        const teamAccounts = rawTeamAccounts.map((account) => ({
          ...account,
          team_id: account?.team_id || account?.teamId || responseTeamId || null,
        }));
        mergedAccounts = [...personalAccounts, ...teamAccounts];
      } catch (teamError) {
        console.warn('Team Twitter accounts unavailable:', teamError?.response?.status || teamError?.message || teamError);
        mergedAccounts = [...personalAccounts];
      }

      setTwitterAccounts(mergedAccounts);

      if (mergedAccounts.length > 0) {
        persistSelectedTwitterAccount(mergedAccounts);
      } else {
        localStorage.removeItem('selectedTwitterAccount');
      }
    } catch (error) {
      console.error('Error fetching Twitter accounts:', error);
      setTwitterAccounts([]);
      localStorage.removeItem('selectedTwitterAccount');
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
      setScheduledTweets([]);
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
        validation.warnings.forEach(warning => toast(warning, { icon: '⚠️' }));
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

  // ── FIXED: now accepts postToLinkedin as a parameter ──
  const handlePost = async (postToLinkedin = false) => {
    // Validate content before posting
    if (isThread) {
      const validTweets = threadTweets.filter(tweet => tweet.trim().length > 0 && tweet !== '---');
      for (let i = 0; i < validTweets.length; i++) {
        const validation = validateTweetContent(validTweets[i]);
        if (!validation.isValid) {
          toast.error(`Tweet ${i + 1}: ${validation.errors.join(', ')}`);
          return;
        }
        if (validation.warnings.length > 0) {
          validation.warnings.forEach(warning => toast(`Tweet ${i + 1}: ${warning}`, { icon: '⚠️' }));
        }
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
        validation.warnings.forEach(warning => toast(warning, { icon: '⚠️' }));
      }
      if (!content.trim() && selectedImages.length === 0) {
        toast.error('Please enter some content or add images');
        return;
      }
    }

    setIsPosting(true);
    try {
      // Upload main tweet images
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

      // For threads, upload images for each tweet
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
        const response = await tweets.create({
          thread: validTweets,
          threadMedia,
          media: mediaIds.length > 0 ? mediaIds : undefined,
          // Only include postToLinkedin in the request if it's true
          ...(postToLinkedin && { postToLinkedin: true }),
        });
        const linkedinStatus = response?.data?.linkedin;
        if (linkedinStatus === 'posted') {
          toast.success(`Thread posted & cross-posted to LinkedIn! ✓`);
        } else if (linkedinStatus === 'failed') {
          toast.success(`Thread posted!`);
          toast.error('LinkedIn cross-post failed — check your connection.');
        } else {
          toast.success(`Thread with ${validTweets.length} tweets posted successfully!`);
        }
        setThreadTweets(['']);
        setThreadImages([]);
        setIsThread(false);
      } else {
        const response = await tweets.create({
          content: content.trim(),
          media: mediaIds.length > 0 ? mediaIds : undefined,
          // Only include postToLinkedin in the request if it's true
          ...(postToLinkedin && { postToLinkedin: true }),
        });
        const linkedinStatus = response?.data?.linkedin;
        if (linkedinStatus === 'posted') {
          toast.success('Tweet posted & cross-posted to LinkedIn! ✓');
        } else if (linkedinStatus === 'failed') {
          toast.success('Tweet posted!');
          toast.error('LinkedIn cross-post failed — check your connection.');
        } else if (linkedinStatus === 'not_connected') {
          toast.success('Tweet posted!');
          toast.error('LinkedIn not connected — post was Twitter only.');
        } else {
          toast.success('Tweet posted successfully!');
        }
        setContent('');
      }

      // Cleanup previews
      selectedImages.forEach(img => {
        if (img.preview && img.preview.startsWith('blob:')) {
          URL.revokeObjectURL(img.preview);
        }
      });
      setSelectedImages([]);

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
    let sanitizedPrompt = sanitizeUserInput(aiPrompt.trim(), { 
      maxLength: 1000,
      encodeHTML: false
    });

    if (!sanitizedPrompt) {
      toast.error('Please enter a valid prompt');
      return;
    }

    let aiRequestPrompt = sanitizedPrompt;
    let aiRequestIsThread = isThread;
    if (!isThread) {
      const normalizedIdea = normalizeIdeaPrompt(sanitizedPrompt);
      aiRequestPrompt = [
        'Create ONE original tweet for X (Twitter) inspired by the idea below.',
        'Rules:',
        '1) Do not copy phrases or sentence structure from the idea.',
        '2) Use a fresh hook and different wording.',
        '3) Keep the tweet under 260 characters.',
        '4) Return only the tweet text with no labels or quotes.',
        `Idea: ${normalizedIdea}`,
      ].join('\n');
      aiRequestIsThread = false;
    }

    setIsGenerating(true);
    try {
      const response = await ai.generate({
        prompt: aiRequestPrompt,
        style: aiStyle,
        isThread: aiRequestIsThread
      });

      if (response.data && response.data.content) {
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
          const aiTweets = splitIntoTweets(content);
          setThreadTweets(aiTweets.length > 0 ? aiTweets : [content]);
        } else {
          let tweet = sanitizedContent.replace(/---/g, '').replace(/^["']+|["']+$/g, '').trim();
          if (tweet.length > 280) tweet = tweet.substring(0, 280);
          setContent(tweet);
        }

        setShowAIPrompt(false);
        setAiPrompt('');

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

      if (error.response?.status === 402) {
        const errorData = error.response.data;
        const threadCount = Number(errorData.threadCount || errorData.estimatedThreads || 1);
        const creditsRequired = errorData.creditsRequired ?? errorData.required ?? 0;
        const creditsAvailable = errorData.creditsAvailable ?? errorData.available ?? 0;

        if (threadCount > 1) {
          toast.error(`Insufficient credits: Need ${creditsRequired} credits for ${threadCount} threads. Available: ${creditsAvailable}`);
        } else {
          toast.error(`Insufficient credits: Need ${creditsRequired} credits. Available: ${creditsAvailable}`);
        }
      } else {
        toast.error('Failed to generate content');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const splitIntoTweets = (content) => {
    if (content.includes('---')) {
      const tweets = content.split('---')
        .map(tweet => tweet.trim())
        .filter(tweet => tweet.length > 0);
      return tweets;
    }
    
    let sections = content.split(/\n\n+/).filter(s => s.trim().length > 0);
    
    if (sections.length === 1) {
      sections = content.split(/\n/).filter(s => s.trim().length > 0);
    }
    
    if (sections.length === 1) {
      sections = content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    }
    
    const tweets = [];
    let currentTweet = '';
    
    sections.forEach((section) => {
      const trimmed = section.trim();
      
      if (trimmed.length > 280) {
        if (currentTweet.trim()) {
          tweets.push(currentTweet.trim());
          currentTweet = '';
        }
        
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
        const separator = currentTweet && !currentTweet.endsWith('.') && !currentTweet.endsWith('!') && !currentTweet.endsWith('?') ? '. ' : (currentTweet ? ' ' : '');
        
        if (currentTweet.length + separator.length + trimmed.length <= 280) {
          currentTweet += separator + trimmed;
        } else {
          if (currentTweet.trim()) tweets.push(currentTweet.trim());
          currentTweet = trimmed;
        }
      }
    });
    
    if (currentTweet.trim()) {
      tweets.push(currentTweet.trim());
    }
    
    if (tweets.length === 0 && content.trim()) {
      tweets.push(content.trim().substring(0, 280));
    }
    
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
    const sanitizedValue = value === '---' ? value : sanitizeUserInput(value, { 
      maxLength: 300,
      encodeHTML: false
    });
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
          validation.warnings.forEach(warning => toast(warning, { icon: '⚠️' }));
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