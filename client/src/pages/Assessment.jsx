import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Assessment() {
  const { assessmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [assessment, setAssessment] = useState(null);
  const [responses, setResponses] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/');
      return;
    }
    loadAssessment();
  }, [user, assessmentId, navigate]);

  const loadAssessment = async () => {
    try {
      setLoading(true);
      // For now, we'll assume the assessment ID is passed via URL params
      // In a real implementation, you'd fetch the assessment details
      // For demo purposes, we'll create a mock assessment
      const mockAssessment = {
        id: assessmentId,
        title: 'End of Session Assessment',
        description: 'Please provide feedback on your learning experience.',
        questions: [
          {
            question: 'How would you rate your understanding of the material covered?',
            type: 'rating',
            required: true
          },
          {
            question: 'What did you find most challenging about this session?',
            type: 'text',
            required: false
          },
          {
            question: 'Would you recommend this learning approach to others?',
            type: 'yesno',
            required: true
          }
        ]
      };
      setAssessment(mockAssessment);
    } catch (err) {
      setError('Failed to load assessment: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResponseChange = (questionIndex, value) => {
    setResponses({
      ...responses,
      [questionIndex]: value
    });
  };

  const handleSubmit = async () => {
    // Validate required questions
    const missingRequired = assessment.questions.some((q, index) => {
      return q.required && (!responses[index] || responses[index].toString().trim() === '');
    });

    if (missingRequired) {
      setError('Please answer all required questions.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      await api.submitAssessment(assessment.id, {
        userId: user.learningUUID,
        responses: Object.keys(responses).map(index => ({
          questionIndex: parseInt(index),
          answer: responses[index]
        }))
      });

      // Redirect back to dashboard or show success message
      navigate('/dashboard', {
        state: { message: 'Assessment submitted successfully!' }
      });
    } catch (err) {
      setError('Failed to submit assessment: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderQuestion = (question, index) => {
    const value = responses[index] || '';

    switch (question.type) {
      case 'rating':
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(rating => (
                <button
                  key={rating}
                  onClick={() => handleResponseChange(index, rating)}
                  className={`w-10 h-10 rounded-lg border-2 transition-colors ${
                    value === rating
                      ? 'border-indigo-500 bg-indigo-500 text-white'
                      : 'border-slate-600 hover:border-slate-500 text-slate-400'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-500 flex justify-between">
              <span>Poor</span>
              <span>Excellent</span>
            </div>
          </div>
        );

      case 'yesno':
        return (
          <div className="flex gap-4">
            <button
              onClick={() => handleResponseChange(index, 'yes')}
              className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                value === 'yes'
                  ? 'border-green-500 bg-green-500 text-white'
                  : 'border-slate-600 hover:border-slate-500 text-slate-400'
              }`}
            >
              Yes
            </button>
            <button
              onClick={() => handleResponseChange(index, 'no')}
              className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                value === 'no'
                  ? 'border-red-500 bg-red-500 text-white'
                  : 'border-slate-600 hover:border-slate-500 text-slate-400'
              }`}
            >
              No
            </button>
          </div>
        );

      case 'text':
      default:
        return (
          <textarea
            value={value}
            onChange={(e) => handleResponseChange(index, e.target.value)}
            className="w-full p-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none resize-none"
            rows={3}
            placeholder="Enter your answer..."
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060B14] flex items-center justify-center">
        <div className="text-white">Loading assessment...</div>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="min-h-screen bg-[#060B14] flex items-center justify-center">
        <div className="text-center text-white">
          <h2 className="text-2xl font-bold mb-4">Assessment Not Found</h2>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060B14] text-white p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-indigo-400 mb-2">{assessment.title}</h1>
          <p className="text-slate-400">{assessment.description}</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* Questions */}
        <div className="space-y-8 mb-8">
          {assessment.questions.map((question, index) => (
            <div key={index} className="p-6 bg-slate-800/50 border border-slate-700 rounded-lg">
              <div className="flex items-start gap-3 mb-4">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-sm flex items-center justify-center font-bold">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <p className="text-slate-200 mb-2">{question.question}</p>
                  {question.required && (
                    <span className="text-xs text-red-400">* Required</span>
                  )}
                </div>
              </div>

              {renderQuestion(question, index)}
            </div>
          ))}
        </div>

        {/* Submit Button */}
        <div className="flex justify-center">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
          >
            {submitting ? 'Submitting...' : 'Submit Assessment'}
          </button>
        </div>
      </div>
    </div>
  );
}