import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { strategy as strategyApi } from '../../utils/api';

const TOTAL_STEPS = 7;

const ChatInterface = ({ strategyId, onComplete }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [isTyping, setIsTyping] = useState(false);
  const [quickReplies, setQuickReplies] = useState(null);
  const [placeholder, setPlaceholder] = useState('Type your response...');
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const hasInitialized = useRef(false);

  const normalizedStep = Math.min(Math.max(Number(currentStep) || 1, 1), TOTAL_STEPS);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (messages.length === 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      handleInitialMessage();
    }
  }, []);

  const handleInitialMessage = async () => {
    setIsLoading(true);
    try {
      const response = await strategyApi.chat('start', strategyId, 0);
      const data = response?.data || {};

      simulateTyping(data.message || 'Let us set up your strategy.');
      setCurrentStep(Math.max(1, Number(data.nextStep) || 1));
      setQuickReplies(data.quickReplies || null);
      setPlaceholder(data.placeholder || 'Type your response...');
      setAllowMultiple(data.nextStep === 3 || data.nextStep === 5);
      setSelectedOptions([]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: error.response?.data?.error || 'Unable to start setup. Please try again.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const simulateTyping = (text) => {
    setIsTyping(true);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: text,
          timestamp: new Date(),
        },
      ]);
      setIsTyping(false);
    }, 400);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');

    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      },
    ]);

    setIsLoading(true);

    try {
      const response = await strategyApi.chat(userMessage, strategyId, currentStep);
      const data = response?.data || {};

      simulateTyping(data.message || 'Thanks. Let us continue.');
      setCurrentStep(Math.max(1, Number(data.nextStep) || normalizedStep));
      setQuickReplies(data.quickReplies || null);
      setPlaceholder(data.placeholder || 'Type your response...');
      setAllowMultiple(data.nextStep === 3 || data.nextStep === 5);
      setSelectedOptions([]);

      if (data.isComplete) {
        setTimeout(() => {
          if (onComplete && data.strategy) {
            onComplete(data.strategy);
          }
        }, 500);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: error.response?.data?.error || 'Failed to send message. Please try again.',
          timestamp: new Date(),
        },
      ]);
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

  const normalizeReplyText = (text) => text.replace(/^[\u{1F300}-\u{1F9FF}]\s*/u, '').trim();

  const handleQuickReply = (text) => {
    const cleanText = normalizeReplyText(text);

    if (allowMultiple) {
      const currentSelections = input
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const isSelected = currentSelections.some((value) => value === cleanText);

      let newSelections;
      if (isSelected) {
        newSelections = currentSelections.filter((value) => value !== cleanText);
        setSelectedOptions((prev) => prev.filter((value) => value !== cleanText));
      } else {
        newSelections = [...currentSelections, cleanText];
        setSelectedOptions((prev) => [...prev, cleanText]);
      }

      setInput(newSelections.join(', '));
    } else {
      setInput(cleanText);
      setSelectedOptions([cleanText]);
    }

    inputRef.current?.focus();
  };

  const QuickReplyButton = ({ text, onClick }) => {
    const cleanText = normalizeReplyText(text);
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
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-indigo-600">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-lg">Strategy Setup</h3>
            <p className="text-blue-100 text-sm">Answer a few guided questions to finish your plan</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((step) => (
            <div key={step} className="flex-1 flex flex-col items-center">
              <div
                className={`h-2 rounded-full transition-all w-full ${
                  step < normalizedStep
                    ? 'bg-white'
                    : step === normalizedStep
                    ? 'bg-amber-300'
                    : 'bg-blue-400'
                }`}
              />
            </div>
          ))}
        </div>
        <p className="text-blue-100 text-xs mt-2">Question {normalizedStep} of {TOTAL_STEPS}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
            <div
              className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                msg.role === 'user'
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white'
                  : msg.role === 'assistant'
                  ? 'bg-gray-100 text-gray-800'
                  : 'bg-red-50 text-red-600 border border-red-200'
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 mt-1 flex-shrink-0 text-blue-600" />
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                </div>
              )}
              {msg.role === 'user' && <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>}
              {msg.role === 'system' && <div className="text-sm">{msg.content}</div>}
            </div>
          </div>
        ))}

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

      <div className="border-t border-gray-200 p-4 bg-gray-50">
        {quickReplies && quickReplies.length > 0 && (
          <div className="mb-3">
            {allowMultiple && (
              <div className="mb-2 text-xs text-gray-500 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Select multiple options if needed</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {quickReplies.map((reply, idx) => (
                <QuickReplyButton key={idx} text={reply} onClick={() => handleQuickReply(reply)} />
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
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md hover:shadow-lg"
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

        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <div className="flex items-center gap-1">
              {[...Array(TOTAL_STEPS)].map((_, index) => (
                <div
                  key={index}
                  className={`w-2 h-2 rounded-full transition-all ${
                    index + 1 < normalizedStep
                      ? 'bg-green-500'
                      : index + 1 === normalizedStep
                      ? 'bg-blue-500 w-3 h-3'
                      : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs">
              {normalizedStep < TOTAL_STEPS ? `Step ${normalizedStep} of ${TOTAL_STEPS}` : 'Complete'}
            </span>
          </div>
          <div className="text-xs text-gray-500">Enter to send, Shift+Enter for newline</div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
