import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from './logger';

export class S3Uploader {
  private client: S3Client;
  private bucketName: string;

  constructor() {
    this.client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    });
    this.bucketName = process.env.S3_BUCKET_NAME || 'playwright-chatbot-screenshots-v2';
  }

  async uploadScreenshot(filePath: string): Promise<string> {
    try {
      const fs = require('fs');
      
      // Handle different file path formats
      let actualPath = filePath;
      if (filePath.startsWith("../Downloads/")) {
        actualPath = filePath.replace("../Downloads/", "/home/ubuntu/Downloads/");
      } else if (!filePath.startsWith("/")) {
        actualPath = `/home/ubuntu/Downloads/${filePath}`;
      }
      
      const fileBuffer = fs.readFileSync(actualPath);
      const fileName = filePath.split('/').pop() || 'screenshot.png';
      
      const key = `screenshots/${Date.now()}-${fileName}`;
      
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: 'image/png'
      });

      await this.client.send(command);
      
      const url = `https://${this.bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
      logger.info(`Screenshot uploaded to S3: ${url}`);
      
      return url;
    } catch (error) {
      logger.error('Failed to upload screenshot to S3:', error);
      throw error;
    }
  }

  async uploadFile(filePath: string, contentType: string = 'application/octet-stream'): Promise<string> {
    try {
      const fs = require('fs');
      
      const fileBuffer = fs.readFileSync(filePath);
      const fileName = filePath.split('/').pop() || 'file';
      
      const key = `uploads/${Date.now()}-${fileName}`;
      
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType
      });

      await this.client.send(command);
      
      const url = `https://${this.bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
      logger.info(`File uploaded to S3: ${url}`);
      
      return url;
    } catch (error) {
      logger.error('Failed to upload file to S3:', error);
      throw error;
    }
  }

  async getFileUrl(key: string): Promise<string> {
    return `https://${this.bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  }
}
