import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { strategy as strategyApi } from '../../utils/api';

const ChatInterface = ({ strategyId, onComplete }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [quickReplies, setQuickReplies] = useState(null);
  const [placeholder, setPlaceholder] = useState('Type your response...');
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [allowMultiple, setAllowMultiple] = useState(false);
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
      setQuickReplies(response.data.quickReplies);
      setPlaceholder(response.data.placeholder || 'Type your response...');
      setAllowMultiple(response.data.nextStep === 3 || response.data.nextStep === 5); // Steps 3 (Goals) and 5 (Tone) allow multi-select
      setSelectedOptions([]);
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

      console.log('💬 Chat Response:', {
        isComplete: response.data.isComplete,
        nextStep: response.data.nextStep,
        hasStrategy: !!response.data.strategy
      });

      // Simulate typing for AI response
      simulateTyping(response.data.message, 'assistant');
      
      setCurrentStep(response.data.nextStep);
      setQuickReplies(response.data.quickReplies);
      setPlaceholder(response.data.placeholder || 'Type your response...');
      
      // Steps 3 (Goals) and 5 (Tone) allow multiple selection
      setAllowMultiple(response.data.nextStep === 3 || response.data.nextStep === 5);
      setSelectedOptions([]); // Reset selected options for new step

      // If complete, call onComplete
      if (response.data.isComplete) {
        console.log('✅ Strategy Complete! Calling onComplete in 1 second...');
        setTimeout(() => {
          console.log('🔄 Switching to Overview tab');
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
    if (e.key === 'Enter' && !e.shiftKey && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickReply = (text) => {
    // Remove emoji and clean text
    const cleanText = text.replace(/^[\u{1F300}-\u{1F9FF}]\s*/u, '').trim();
    
    if (allowMultiple) {
      // Multi-select behavior (toggle on/off)
      const currentSelections = input.split(',').map(s => s.trim()).filter(Boolean);
      const isSelected = currentSelections.some(s => s === cleanText);
      
      let newSelections;
      if (isSelected) {
        // Remove if already selected
        newSelections = currentSelections.filter(s => s !== cleanText);
        setSelectedOptions(prev => prev.filter(s => s !== cleanText));
      } else {
        // Add if not selected
        newSelections = [...currentSelections, cleanText];
        setSelectedOptions(prev => [...prev, cleanText]);
      }
      
      setInput(newSelections.join(', '));
    } else {
      // Single select - replace input
      setInput(cleanText);
      setSelectedOptions([cleanText]);
    }
    
    inputRef.current?.focus();
  };

  const QuickReplyButton = ({ text, onClick }) => {
    const cleanText = text.replace(/^[\u{1F300}-\u{1F9FF}]\s*/u, '').trim();
    const isSelected = selectedOptions.includes(cleanText);
    
    return (
      <button
        onClick={onClick}
        className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border flex items-center gap-1.5 ${
          isSelected 
            ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
            : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 hover:shadow-md'
        }`}
      >
        {isSelected && <CheckCircle2 className="w-4 h-4" />}
        {text}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-lg border border-gray-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-500 to-purple-600">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-lg">Strategy Builder</h3>
            <p className="text-blue-100 text-sm">Let's create your perfect Twitter strategy</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((step) => (
            <div key={step} className="flex-1 flex flex-col items-center">
              <div
                className={`h-2 rounded-full transition-all w-full ${
                  step < currentStep
                    ? 'bg-white'
                    : step === currentStep
                    ? 'bg-yellow-300'
                    : 'bg-blue-400'
                }`}
              />
              {step < currentStep && (
                <div className="text-white text-xs mt-1">✓</div>
              )}
            </div>
          ))}
        </div>
        <p className="text-blue-100 text-xs mt-2">Question {currentStep} of 7</p>
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
        {/* Quick Reply Buttons */}
        {quickReplies && quickReplies.length > 0 && (
          <div className="mb-3">
            {allowMultiple && (
              <div className="mb-2 text-xs text-gray-500 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Click multiple options to select</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {quickReplies.map((reply, idx) => (
                <QuickReplyButton 
                  key={idx} 
                  text={reply} 
                  onClick={() => handleQuickReply(reply)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={placeholder}
            disabled={isLoading}
            rows={3}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed transition-all resize-none"
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
            💡 Ctrl+Enter to send
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
