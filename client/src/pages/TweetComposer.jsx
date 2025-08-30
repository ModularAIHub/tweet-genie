import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Calendar, 
  Image, 
  Sparkles, 
  X, 
  Clock,
  Plus,
  Trash2
} from 'lucide-react';
import { tweets, twitter } from '../utils/api';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';

const TweetComposer = () => {
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [twitterAccounts, setTwitterAccounts] = useState([]);
  const [threadTweets, setThreadTweets] = useState(['']);
  const [isThread, setIsThread] = useState(false);
  const [showAIGenerator, setShowAIGenerator] = useState(false);

  useEffect(() => {
    fetchTwitterAccounts();
  }, []);

  const fetchTwitterAccounts = async () => {
    try {
      const response = await twitter.getAccounts();
      setTwitterAccounts(response.data.accounts || []);
    } catch (error) {
      console.error('Failed to fetch Twitter accounts:', error);
    }
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

      const tweetData = {
        content: content.trim(),
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
      }
    } catch (error) {
      console.error('Post tweet error:', error);
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
            onClick={() => setShowAIGenerator(!showAIGenerator)}
            className="btn btn-secondary btn-sm"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            AI Generate
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

          {/* Media upload placeholder */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
            <Image className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Drag & drop images or click to upload</p>
            <p className="text-xs text-gray-500 mt-1">PNG, JPG, GIF up to 10MB</p>
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
                  disabled={isPosting || !content.trim() || isOverLimit || twitterAccounts.length === 0}
                  className="btn btn-primary btn-md"
                >
                  {isPosting ? (
                    <>
                      <LoadingSpinner size="sm" className="mr-2" />
                      Posting...
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

      {/* AI Generator Panel */}
      {showAIGenerator && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">AI Content Generator</h3>
            <button
              onClick={() => setShowAIGenerator(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                What would you like to tweet about?
              </label>
              <textarea
                placeholder="E.g., Share tips about productivity, thoughts on the latest tech trends..."
                className="textarea"
                rows={3}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Style
                </label>
                <select className="input">
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="witty">Witty</option>
                  <option value="inspirational">Inspirational</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  AI Provider
                </label>
                <select className="input">
                  <option value="openai">OpenAI GPT</option>
                  <option value="perplexity">Perplexity AI</option>
                  <option value="google">Google Gemini</option>
                </select>
              </div>
            </div>
            
            <button className="btn btn-primary btn-md w-full">
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Content
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TweetComposer;
