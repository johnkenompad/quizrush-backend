// routes/essayRoutes.js — Essay Grading with AI
import express from 'express';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ──────────────────────────────────────────────────────────
   Essay Grading Endpoint
────────────────────────────────────────────────────────── */
router.post('/grade-essay', express.json(), async (req, res) => {
  console.log('📝 /grade-essay hit!');
  console.log('Request body:', req.body);

  const {
    question,
    answer,
    rubric = {},
    max_score = 10,
    bloom_level = '',
  } = req.body;

  // Validation
  if (!question || !answer) {
    return res.status(400).json({
      error: 'Missing required fields: question and answer are required.',
    });
  }

  if (!answer.trim()) {
    return res.status(400).json({
      error: 'Answer cannot be empty.',
    });
  }

  try {
    // Build rubric criteria text
    const rubricCriteria = Object.entries(rubric)
      .map(([criterion, description]) => `- ${criterion}: ${description}`)
      .join('\n');

    // Calculate max score per criterion (equal distribution)
    const numCriteria = Object.keys(rubric).length || 4;
    const maxPerCriterion = max_score / numCriteria;

    // Build the AI prompt
    const prompt = `
You are an expert educator evaluating a student's essay response. Grade the essay based on the following criteria and return a JSON response.

**Question:** ${question}

**Student's Answer:**
${answer}

**Bloom's Taxonomy Level:** ${bloom_level || 'Not specified'}

**Rubric Criteria (${max_score} points total, ${maxPerCriterion.toFixed(1)} points per criterion):**
${rubricCriteria}

**Instructions:**
1. Evaluate the essay against each rubric criterion
2. Assign a score for each criterion (0 to ${maxPerCriterion.toFixed(1)} points)
3. Provide constructive feedback
4. Calculate the total score

**Return ONLY valid JSON in this exact format:**
{
  "score": <total score>,
  "max_score": ${max_score},
  "feedback": "<overall constructive feedback>",
  "breakdown": {
    ${Object.keys(rubric)
      .map(
        (criterion) =>
          `"${criterion}": { "score": <score>, "max": ${maxPerCriterion.toFixed(1)}, "comment": "<brief comment>" }`
      )
      .join(',\n    ')}
  }
}

Ensure scores are realistic and feedback is constructive and encouraging.
`.trim();

    console.log('🤖 Sending to OpenAI...');

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert educator who provides fair, constructive feedback on student essays. Always return valid JSON responses.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5,
      max_tokens: 1000,
    });

    let rawResponse = response.choices[0].message.content.trim();
    console.log('📥 Raw AI response:', rawResponse);

    // Clean the response (remove markdown code blocks if present)
    rawResponse = rawResponse
      .replace(/```(json)?/gi, '')
      .replace(/```/g, '')
      .trim();

    // Parse JSON response
    let gradingResult;
    try {
      gradingResult = JSON.parse(rawResponse);
    } catch (parseError) {
      console.error('❌ JSON parse failed:', parseError);
      console.error('Raw response:', rawResponse);
      return res.status(500).json({
        error: 'Failed to parse AI response.',
        details: rawResponse,
      });
    }

    // Validate the response structure
    if (
      typeof gradingResult.score !== 'number' ||
      !gradingResult.feedback ||
      !gradingResult.breakdown
    ) {
      console.error('❌ Invalid grading result structure:', gradingResult);
      return res.status(500).json({
        error: 'Invalid grading response structure from AI.',
      });
    }

    console.log('✅ Essay graded successfully:', gradingResult.score, '/', max_score);
    res.json(gradingResult);
  } catch (error) {
    console.error('❌ Error grading essay:', error);
    res.status(500).json({
      error: 'Essay grading failed.',
      details: error.message,
    });
  }
});

export default router;
