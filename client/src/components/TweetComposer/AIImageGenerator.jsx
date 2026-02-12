import React from 'react';
import { Wand2, ArrowRight } from 'lucide-react';

const AIImageGenerator = ({
  showImagePrompt,
  imagePrompt,
  setImagePrompt,
  imageStyle,
  setImageStyle,
  isGeneratingImage,
  onGenerate,
  onCancel
}) => {
  if (!showImagePrompt) return null;

  return (
    <div className="border border-purple-200 rounded-lg p-4 mb-4 bg-purple-50">
      <div className="mb-3 p-2 bg-yellow-100 border border-yellow-300 text-yellow-900 rounded text-sm">
        <strong>Note:</strong> AI image generation is not supported yet. This feature will be available in a future update.
      </div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <Wand2 className="h-5 w-5 text-purple-600 mr-2" />
          <h3 className="font-medium text-purple-900">AI Image Generator</h3>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>
      
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Describe the image you want to generate
          </label>
          <textarea
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            placeholder="e.g., A serene mountain landscape at sunset, A modern office workspace..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            rows={3}
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Style
          </label>
          <select
            value={imageStyle}
            onChange={(e) => setImageStyle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="natural">Natural</option>
            <option value="artistic">Artistic</option>
            <option value="professional">Professional</option>
            <option value="vintage">Vintage</option>
            <option value="modern">Modern</option>
          </select>
        </div>
        
        <button
          onClick={onGenerate}
          disabled={!imagePrompt.trim() || isGeneratingImage}
          className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGeneratingImage ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Generating...
            </>
          ) : (
            <>
              <ArrowRight className="h-4 w-4 mr-2" />
              Generate Image
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default AIImageGenerator;
