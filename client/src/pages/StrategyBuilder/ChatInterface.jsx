import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { strategy as strategyApi } from '../../utils/api';

const ChatInterface = ({ strategyId, onComplete }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const hasInitialized = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Send initial welcome message (only once)
    if (messages.length === 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      handleInitialMessage();
    }
  }, []);

  const handleInitialMessage = async () => {
    setIsLoading(true);
    try {
      const response = await strategyApi.chat('start', strategyId, 0);

      // Simulate typing effect for welcome message
      simulateTyping(response.data.message, 'assistant');
      setCurrentStep(response.data.nextStep);
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, {
        role: 'system',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const simulateTyping = (text, role) => {
    setIsTyping(true);
    
    // Show typing indicator briefly
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role,
        content: text,
        timestamp: new Date()
      }]);
      setIsTyping(false);
    }, 500);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');

    // Add user message immediately
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);

    setIsLoading(true);

    try {
      const response = await strategyApi.chat(userMessage, strategyId, currentStep);

      // Simulate typing for AI response
      simulateTyping(response.data.message, 'assistant');
      
      setCurrentStep(response.data.nextStep);

      // If complete, call onComplete
      if (response.data.isComplete) {
        setTimeout(() => {
          onComplete && onComplete(response.data.strategy);
        }, 1000);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        role: 'system',
        content: error.response?.data?.error || 'Failed to send message. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const QuickReplyButton = ({ text, onClick }) => (
    <button
      onClick={() => {
        setInput(text);
        inputRef.current?.focus();
      }}
      className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors"
    >
      {text}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-lg border border-gray-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-500 to-purple-600">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-lg">Strategy Builder</h3>
            <p className="text-blue-100 text-sm">Let's create your perfect Twitter strategy</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                msg.role === 'user'
                  ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white'
                  : msg.role === 'assistant'
                  ? 'bg-gray-100 text-gray-800'
                  : 'bg-red-50 text-red-600 border border-red-200'
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 mt-1 flex-shrink-0 text-purple-500" />
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                </div>
              )}
              {msg.role === 'user' && (
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              )}
              {msg.role === 'system' && (
                <div className="text-sm">{msg.content}</div>
              )}
            </div>
          </div>
        ))}

        {/* Typing Indicator */}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-5 py-3 flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
              <span className="text-gray-500 text-sm">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4 bg-gray-50">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed transition-all"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md hover:shadow-lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                <span>Send</span>
              </>
            )}
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <div className="flex items-center gap-1">
              {[...Array(7)].map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i < currentStep 
                      ? 'bg-green-500' 
                      : i === currentStep 
                      ? 'bg-blue-500 w-3 h-3' 
                      : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs">
              {currentStep < 7 ? `Step ${currentStep} of 7` : 'Complete!'}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            💡 Press Enter to send
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default ChatInterface;
