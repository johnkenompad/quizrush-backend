import express from 'express';
import multer from 'multer';
import axios from 'axios';
import pdf from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';

const router = express.Router();
const upload = multer();

// Helper function to process image with Azure OCR
async function processImageWithOCR(imageBuffer, mimeType) {
  const endpoint = `${process.env.AZURE_OCR_ENDPOINT}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;
  const key = process.env.AZURE_OCR_KEY;

  // Send image to Azure
  const response = await axios.post(endpoint, imageBuffer, {
    headers: {
      'Content-Type': mimeType,
      'Ocp-Apim-Subscription-Key': key
    },
    maxBodyLength: Infinity
  });

  const operationLocation = response.headers['operation-location'];
  if (!operationLocation) {
    throw new Error('Azure did not return operation-location');
  }

  // Poll for result
  for (let i = 0; i < 15; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const poll = await axios.get(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key }
    });

    if (poll.data.status === 'succeeded') {
      const lines = [];
      for (const page of poll.data.analyzeResult.pages) {
        for (const line of page.lines) {
          lines.push(line.content);
        }
      }
      return lines.join('\n');
    } else if (poll.data.status === 'failed') {
      throw new Error('Azure OCR failed');
    }
  }
  throw new Error('OCR timeout');
}

router.post('/', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = file.originalname.split('.').pop().toLowerCase();
  const supportedExtensions = ['jpg', 'jpeg', 'png', 'pdf'];
  
  if (!supportedExtensions.includes(ext)) {
    return res.status(400).json({
      error: 'Only .jpg, .jpeg, .png images or .pdf documents are supported'
    });
  }

  try {
    let extractedText = '';

    // Handle PDF files with enhanced image extraction
    if (ext === 'pdf') {
      console.log('📄 Processing PDF file...');
      
      // First, extract text layer from PDF
      const pdfData = await pdf(file.buffer);
      extractedText = pdfData.text || '';
      console.log(`✅ Extracted ${extractedText.length} chars from PDF text layer`);

      // Try to process the entire PDF with Azure OCR for images
      try {
        console.log('🔍 Attempting to extract text from PDF images with Azure OCR...');
        const ocrText = await processImageWithOCR(file.buffer, 'application/pdf');
        
        if (ocrText && ocrText.trim()) {
          console.log(`✅ Extracted ${ocrText.length} chars from PDF images via OCR`);
          // Combine both text sources
          extractedText = extractedText + '\n\n' + ocrText;
        }
      } catch (ocrError) {
        console.warn('⚠️ OCR on PDF images failed, using text layer only:', ocrError.message);
        // Continue with just the text layer if OCR fails
      }

      if (!extractedText || extractedText.trim() === '') {
        return res.status(400).json({
          error: 'No text found in PDF. The PDF may be empty or contain unsupported content.'
        });
      }

      // Remove duplicate lines and clean up
      const lines = [...new Set(extractedText.split('\n').filter(l => l.trim()))];
      extractedText = lines.join('\n');
      
      console.log(`📤 Returning ${extractedText.length} total characters`);
      return res.json({ text: extractedText });
    }

    // Handle regular images with Azure OCR
    console.log('🖼️ Processing image file...');
    extractedText = await processImageWithOCR(file.buffer, file.mimetype);
    
    if (!extractedText || extractedText.trim() === '') {
      return res.status(400).json({
        error: 'No text found in image. Please ensure the image contains clear, readable text.'
      });
    }

    console.log(`📤 Returning ${extractedText.length} characters from image`);
    return res.json({ text: extractedText });

  } catch (error) {
    console.error('❌ Text extraction error:', error);
    res.status(500).json({
      error: 'Text extraction failed',
      details: error.response?.data || error.message
    });
  }
});

export default router;
