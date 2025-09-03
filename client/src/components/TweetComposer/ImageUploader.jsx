import React from 'react';
import { Image, X, Upload } from 'lucide-react';

const ImageUploader = ({
  selectedImages,
  onImageUpload,
  onImageRemove,
  isUploadingImages
}) => {
  return (
    <div className="space-y-4">
      {/* Image Upload Button */}
      <div className="flex items-center space-x-2">
        <label className="flex items-center px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer">
          <Image className="h-4 w-4 mr-2" />
          Add Images
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={onImageUpload}
            className="hidden"
          />
        </label>
        <span className="text-sm text-gray-500">
          Max 4 images, 5MB each
        </span>
      </div>

      {/* Image Previews */}
      {selectedImages.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {selectedImages.map((image, index) => (
            <div key={image.id || index} className="relative group">
              <img
                src={image.preview || image.url}
                alt={`Preview ${index + 1}`}
                className="w-full h-32 object-cover rounded-lg border"
              />
              <button
                onClick={() => onImageRemove(index)}
                className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
              {image.isAIGenerated && (
                <div className="absolute bottom-1 left-1 bg-purple-600 text-white text-xs px-2 py-1 rounded">
                  AI Generated
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload Progress */}
      {isUploadingImages && (
        <div className="flex items-center space-x-2 text-blue-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          <span className="text-sm">Uploading images...</span>
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
