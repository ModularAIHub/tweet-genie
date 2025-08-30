import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

class MediaService {
  constructor() {
    this.uploadPath = process.env.UPLOAD_PATH || './uploads';
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '10485760'); // 10MB
    this.allowedTypes = (process.env.ALLOWED_IMAGE_TYPES || 'image/jpeg,image/png,image/gif,image/webp').split(',');
    
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath, { recursive: true });
    }
  }

  async uploadMedia(mediaFiles, twitterClient) {
    const mediaIds = [];

    for (const mediaFile of mediaFiles) {
      try {
        // Validate file
        if (!this.validateFile(mediaFile)) {
          throw new Error('Invalid file type or size');
        }

        // Process image if needed
        const processedBuffer = await this.processImage(mediaFile.buffer, mediaFile.mimetype);

        // Upload to Twitter
        const mediaId = await twitterClient.v1.uploadMedia(processedBuffer, {
          mimeType: mediaFile.mimetype
        });

        mediaIds.push(mediaId);

        // Save locally for reference
        await this.saveLocal(processedBuffer, mediaFile.originalname);

      } catch (error) {
        console.error('Media upload error:', error);
        throw new Error(`Failed to upload media: ${error.message}`);
      }
    }

    return mediaIds;
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

  async saveLocal(buffer, originalName) {
    try {
      const ext = path.extname(originalName);
      const filename = `${uuidv4()}${ext}`;
      const filepath = path.join(this.uploadPath, filename);

      await fs.promises.writeFile(filepath, buffer);
      
      return filename;
    } catch (error) {
      console.error('Local save error:', error);
      // Don't throw error for local save failures
      return null;
    }
  }

  async deleteLocal(filename) {
    try {
      const filepath = path.join(this.uploadPath, filename);
      if (fs.existsSync(filepath)) {
        await fs.promises.unlink(filepath);
      }
    } catch (error) {
      console.error('Local delete error:', error);
      // Don't throw error for delete failures
    }
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

export const mediaService = new MediaService();
