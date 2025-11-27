/**
 * Aggregates verdicts from multiple AI models into a consensus.
 * Uses weighted voting based on confidence levels.
 */
export function aggregateVerdicts(responses) {
  if (responses.length === 0) {
    return {
      verdict: 'error',
      confidence: 0,
      summary: 'No AI models responded.',
      spokenResponse: 'I could not verify this claim. Please try again.'
    };
  }

  // Count verdicts weighted by confidence
  const verdictScores = {
    true: 0,
    false: 0,
    partially_true: 0,
    unverifiable: 0
  };

  let totalConfidence = 0;

  responses.forEach(response => {
    const verdict = response.verdict?.toLowerCase() || 'unverifiable';
    const confidence = Math.min(100, Math.max(0, response.confidence || 50));
    
    if (verdictScores.hasOwnProperty(verdict)) {
      verdictScores[verdict] += confidence;
    } else {
      verdictScores.unverifiable += confidence;
    }
    totalConfidence += confidence;
  });

  // Find the winning verdict
  let winningVerdict = 'unverifiable';
  let maxScore = 0;

  Object.entries(verdictScores).forEach(([verdict, score]) => {
    if (score > maxScore) {
      maxScore = score;
      winningVerdict = verdict;
    }
  });

  // Calculate consensus confidence
  const consensusConfidence = Math.round(
    (maxScore / totalConfidence) * (totalConfidence / responses.length)
  );

  // Get explanations from models that agree with consensus
  const agreeingModels = responses.filter(r => 
    r.verdict?.toLowerCase() === winningVerdict
  );
  
  const explanations = agreeingModels
    .map(r => r.explanation)
    .filter(Boolean)
    .slice(0, 2); // Take up to 2 explanations

  // Generate summary
  const summary = generateSummary(winningVerdict, consensusConfidence, responses.length, explanations);
  const spokenResponse = generateSpokenResponse(winningVerdict, consensusConfidence, explanations[0]);

  return {
    verdict: winningVerdict,
    confidence: consensusConfidence,
    summary,
    spokenResponse
  };
}

function generateSummary(verdict, confidence, modelCount, explanations) {
  const verdictLabels = {
    true: 'TRUE',
    false: 'FALSE',
    partially_true: 'PARTIALLY TRUE',
    unverifiable: 'UNVERIFIABLE'
  };

  const label = verdictLabels[verdict] || 'UNKNOWN';
  const explanation = explanations.length > 0 
    ? explanations[0] 
    : 'Multiple AI models analyzed this claim.';

  return `${label} (${confidence}% confidence, ${modelCount} models). ${explanation}`;
}

function generateSpokenResponse(verdict, confidence, explanation) {
  const responses = {
    true: [
      `This appears to be true with ${confidence}% confidence.`,
      explanation ? ` ${explanation}` : ''
    ].join(''),
    
    false: [
      `This appears to be false with ${confidence}% confidence.`,
      explanation ? ` ${explanation}` : ''
    ].join(''),
    
    partially_true: [
      `This is partially true with ${confidence}% confidence.`,
      explanation ? ` ${explanation}` : ' The claim contains some accurate elements but may be misleading.'
    ].join(''),
    
    unverifiable: [
      `I cannot verify this claim with certainty.`,
      explanation ? ` ${explanation}` : ' More information may be needed.'
    ].join('')
  };

  return responses[verdict] || 'Unable to determine the accuracy of this claim.';
}

