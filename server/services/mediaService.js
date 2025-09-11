import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import FormData from 'form-data';
import { createClient } from '@supabase/supabase-js';

class MediaService {
  constructor() {
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '5242880'); // 5MB (5 * 1024 * 1024)
    this.allowedTypes = (process.env.ALLOWED_IMAGE_TYPES || 'image/jpeg,image/png,image/gif,image/webp').split(',');
    
    // Initialize Supabase client (required for production)
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Supabase credentials are required for media uploads');
    }
    
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    console.log('✅ Supabase storage initialized');
  }

  async uploadMedia(mediaFiles, twitterClient, oauth1Tokens = null) {
    const mediaIds = [];
    
    console.log('uploadMedia called with:', {
      mediaFilesLength: mediaFiles?.length,
      mediaFilesType: typeof mediaFiles,
      isArray: Array.isArray(mediaFiles),
      hasOAuth1Tokens: !!oauth1Tokens
    });

    if (!oauth1Tokens) {
      throw new Error('OAuth 1.0a tokens required for media upload');
    }

    for (const mediaFile of mediaFiles) {
      try {
        let buffer, mimetype;
        
        console.log('Processing media file:', {
          type: typeof mediaFile,
          isString: typeof mediaFile === 'string',
          startsWithData: typeof mediaFile === 'string' && mediaFile.startsWith('data:'),
          length: typeof mediaFile === 'string' ? mediaFile.length : 'N/A'
        });

        // Handle base64 data from frontend
        if (typeof mediaFile === 'string' && mediaFile.startsWith('data:')) {
          const base64Data = mediaFile.split(',')[1];
          const mimeMatch = mediaFile.match(/data:([^;]+);/);
          mimetype = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          buffer = Buffer.from(base64Data, 'base64');
          
          console.log('Base64 processing result:', {
            mimetype,
            bufferSize: buffer.length,
            base64Length: base64Data.length
          });
        } else if (typeof mediaFile === 'string') {
          // Handle other string formats (this shouldn't happen with the frontend fix)
          throw new Error(`Invalid media format: received string without data: prefix. Length: ${mediaFile.length}`);
        } else {
          // Handle file upload (existing logic)
          buffer = mediaFile.buffer;
          mimetype = mediaFile.mimetype;
          
          console.log('File upload processing:', {
            mimetype,
            bufferSize: buffer?.length
          });
        }

        // Validate that we have a valid buffer
        if (!buffer || !Buffer.isBuffer(buffer)) {
          throw new Error('Invalid media data: buffer is required');
        }

        // Validate file
        if (!this.validateFileData(buffer, mimetype)) {
          const sizeInMB = (buffer.length / (1024 * 1024)).toFixed(1);
          if (buffer.length > this.maxFileSize) {
            throw new Error(`Image too large: ${sizeInMB}MB. Maximum allowed: 5MB`);
          } else {
            throw new Error(`Invalid file type: ${mimetype}. Allowed types: ${this.allowedTypes.join(', ')}`);
          }
        }

        // Process image if needed
        const processedBuffer = await this.processImage(buffer, mimetype);
        
        console.log('Image processed:', {
          originalSize: buffer.length,
          processedSize: processedBuffer.length,
          mimetype
        });

        // Upload to Twitter using OAuth 1.0a
        console.log('Uploading to Twitter using OAuth 1.0a...');
        const mediaId = await this.uploadWithOAuth1(processedBuffer, mimetype, oauth1Tokens);
        
        console.log('Twitter upload successful, mediaId:', mediaId);
        mediaIds.push(mediaId);

        // Save to Supabase (primary) and local (backup)
        const supabaseResult = await this.saveToSupabase(processedBuffer, `uploaded_${Date.now()}.jpg`);
        if (supabaseResult) {
          console.log('✅ Saved to Supabase:', supabaseResult.url);
        }

      } catch (error) {
        console.error('Media upload error:', error);
        throw new Error(`Failed to upload media: ${error.message}`);
      }
    }

    return mediaIds;
  }

  async uploadWithOAuth1(buffer, mimetype, oauth1Tokens) {
    try {
      // Initialize OAuth 1.0a
      const oauth = OAuth({
        consumer: {
          key: process.env.TWITTER_CONSUMER_KEY,
          secret: process.env.TWITTER_CONSUMER_SECRET,
        },
        signature_method: 'HMAC-SHA1',
        hash_function(base_string, key) {
          return crypto.createHmac('sha1', key).update(base_string).digest('base64');
        },
      });

      // Prepare OAuth request
      const requestData = {
        url: 'https://upload.twitter.com/1.1/media/upload.json',
        method: 'POST',
      };

      // Get OAuth headers
      const oauthHeaders = oauth.toHeader(oauth.authorize(requestData, {
        key: oauth1Tokens.accessToken,
        secret: oauth1Tokens.accessTokenSecret,
      }));

      console.log('Making OAuth 1.0a media upload request...');

      // Create form data using URLSearchParams approach instead of FormData
      const boundary = '----formdata-tweetgenie-' + Math.random().toString(36);
      
      // Create multipart body manually
      let body = '';
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="media"; filename="image.jpg"\r\n`;
      body += `Content-Type: ${mimetype}\r\n\r\n`;
      
      // Convert buffer to binary string for body
      const binaryString = buffer.toString('binary');
      body += binaryString;
      body += `\r\n--${boundary}--\r\n`;
      
      // Convert to buffer
      const bodyBuffer = Buffer.from(body, 'binary');

      // Make the upload request
      const response = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
        method: 'POST',
        headers: {
          ...oauthHeaders,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': bodyBuffer.length.toString(),
        },
        body: bodyBuffer,
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        console.error('Upload failed:', response.status, responseText);
        throw new Error(`Upload failed with status ${response.status}: ${responseText}`);
      }

      const result = JSON.parse(responseText);
      return result.media_id_string;

    } catch (error) {
      console.error('OAuth 1.0a upload error:', error);
      throw error;
    }
  }

  validateFile(file) {
    // Check file size
    if (file.size > this.maxFileSize) {
      return false;
    }

    // Check file type
    if (!this.allowedTypes.includes(file.mimetype)) {
      return false;
    }

    return true;
  }

  validateFileData(buffer, mimetype) {
    // Check file size
    if (buffer.length > this.maxFileSize) {
      return false;
    }

    // Check file type
    if (!this.allowedTypes.includes(mimetype)) {
      return false;
    }

    return true;
  }

  async processImage(buffer, mimetype) {
    try {
      // Skip processing for GIFs to preserve animation
      if (mimetype === 'image/gif') {
        return buffer;
      }

      // Process other images with sharp
      const processed = await sharp(buffer)
        .resize(1200, 1200, { 
          fit: 'inside', 
          withoutEnlargement: true 
        })
        .jpeg({ 
          quality: 85,
          progressive: true 
        })
        .toBuffer();

      return processed;
    } catch (error) {
      console.error('Image processing error:', error);
      // Return original buffer if processing fails
      return buffer;
    }
  }

  // Supabase Storage Methods
  async saveToSupabase(buffer, originalName, folder = 'uploads') {
    if (!this.supabase) {
      console.warn('Supabase not configured, skipping cloud upload');
      return null;
    }

    try {
      const ext = path.extname(originalName);
      const filename = `${uuidv4()}${ext}`;
      const filePath = `${folder}/${filename}`;

      const { data, error } = await this.supabase.storage
        .from('uploads')
        .upload(filePath, buffer, {
          cacheControl: '3600',
          upsert: false,
          contentType: this.getMimeType(ext)
        });

      if (error) {
        console.error('Supabase upload error:', error);
        return null;
      }

      // Get public URL
      const { data: urlData } = this.supabase.storage
        .from('uploads')
        .getPublicUrl(filePath);

      return {
        filename,
        path: filePath,
        url: urlData.publicUrl,
        storage: 'supabase'
      };
    } catch (error) {
      console.error('Supabase save error:', error);
      return null;
    }
  }

  async deleteFromSupabase(filePath) {
    if (!this.supabase) {
      return false;
    }

    try {
      const { error } = await this.supabase.storage
        .from('uploads')
        .remove([filePath]);

      if (error) {
        console.error('Supabase delete error:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Supabase delete error:', error);
      return false;
    }
  }

  getMimeType(ext) {
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo'
    };
    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
  }

  getMediaInfo(buffer, mimetype) {
    return {
      size: buffer.length,
      mimetype,
      isVideo: mimetype.startsWith('video/'),
      isImage: mimetype.startsWith('image/'),
      isGif: mimetype === 'image/gif'
    };
  }
}

// Export the class as default
export default MediaService;

// Create a lazy singleton instance
let mediaServiceInstance = null;

export const getMediaService = () => {
  if (!mediaServiceInstance) {
    mediaServiceInstance = new MediaService();
  }
  return mediaServiceInstance;
};

// For backward compatibility - but this will be lazy loaded
export const mediaService = new Proxy({}, {
  get(target, prop) {
    const instance = getMediaService();
    return typeof instance[prop] === 'function' 
      ? instance[prop].bind(instance) 
      : instance[prop];
  }
});
