// Knowledge Bank Validation Script
// Validates the structure and content of domains.json, questions.json, and challenges.json

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load JSON files
function loadJSON(filename) {
  try {
    const filePath = path.join(__dirname, filename);
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error loading ${filename}:`, error.message);
    process.exit(1);
  }
}

// Validation functions
function validateDomains(domains) {
  console.log('\n📋 Validating domains.json...');
  
  const domainIds = Object.keys(domains);
  
  // Check domain count
  if (domainIds.length !== 5) {
    console.error(`❌ Expected 5 domains, found ${domainIds.length}`);
    return false;
  }
  console.log(`✅ Domain count: ${domainIds.length}`);
  
  // Validate each domain
  for (const domainId of domainIds) {
    const domain = domains[domainId];
    
    // Check skills count
    if (!domain.skills || domain.skills.length < 3) {
      console.error(`❌ Domain ${domainId} has fewer than 3 skills`);
      return false;
    }
    
    // Validate each skill
    for (const skill of domain.skills) {
      if (!skill.id || !skill.name || !skill.description || !skill.level || !skill.days || !skill.topics) {
        console.error(`❌ Skill ${skill.id || 'unknown'} in domain ${domainId} is missing required fields`);
        return false;
      }
      
      if (skill.days <= 0) {
        console.error(`❌ Skill ${skill.id} has invalid days: ${skill.days}`);
        return false;
      }
      
      if (!Array.isArray(skill.topics) || skill.topics.length === 0) {
        console.error(`❌ Skill ${skill.id} has empty or invalid topics array`);
        return false;
      }
      
      if (!['beginner', 'intermediate', 'advanced'].includes(skill.level)) {
        console.error(`❌ Skill ${skill.id} has invalid level: ${skill.level}`);
        return false;
      }
    }
    
    console.log(`✅ Domain ${domainId}: ${domain.skills.length} skills validated`);
  }
  
  return true;
}

function validateQuestions(questions, domains) {
  console.log('\n📋 Validating questions.json...');
  
  // Get all skill IDs from domains
  const allSkillIds = [];
  for (const domain of Object.values(domains)) {
    for (const skill of domain.skills) {
      allSkillIds.push(skill.id);
    }
  }
  
  let totalQuestions = 0;
  
  // Validate questions for each skill
  for (const skillId of allSkillIds) {
    if (!questions[skillId]) {
      console.error(`❌ No questions found for skill: ${skillId}`);
      return false;
    }
    
    const skillQuestions = questions[skillId];
    const levels = Object.keys(skillQuestions);
    
    if (levels.length === 0) {
      console.error(`❌ Skill ${skillId} has no question levels`);
      return false;
    }
    
    for (const level of levels) {
      const levelQuestions = skillQuestions[level];
      
      if (!Array.isArray(levelQuestions) || levelQuestions.length < 4) {
        console.error(`❌ Skill ${skillId} level ${level} has fewer than 4 questions`);
        return false;
      }
      
      // Validate each question
      for (const q of levelQuestions) {
        if (!q.id || !q.question || !q.type || !q.explanation || !q.key_concepts || !q.score_keywords) {
          console.error(`❌ Question ${q.id || 'unknown'} in skill ${skillId} is missing required fields`);
          return false;
        }
        
        if (!['multiple_choice', 'open_ended'].includes(q.type)) {
          console.error(`❌ Question ${q.id} has invalid type: ${q.type}`);
          return false;
        }
        
        if (q.type === 'multiple_choice' && (!q.options || q.options.length === 0 || !q.correct)) {
          console.error(`❌ Multiple choice question ${q.id} is missing options or correct answer`);
          return false;
        }
        
        if (!Array.isArray(q.key_concepts) || q.key_concepts.length === 0) {
          console.error(`❌ Question ${q.id} has empty key_concepts`);
          return false;
        }
        
        if (!Array.isArray(q.score_keywords) || q.score_keywords.length === 0) {
          console.error(`❌ Question ${q.id} has empty score_keywords`);
          return false;
        }
        
        totalQuestions++;
      }
    }
  }
  
  console.log(`✅ Total questions validated: ${totalQuestions}`);
  console.log(`✅ All ${allSkillIds.length} skills have at least 4 questions`);
  
  return true;
}

function validateChallenges(challenges, domains) {
  console.log('\n📋 Validating challenges.json...');
  
  // Get all skill IDs from domains
  const allSkillIds = [];
  for (const domain of Object.values(domains)) {
    for (const skill of domain.skills) {
      allSkillIds.push(skill.id);
    }
  }
  
  let totalChallenges = 0;
  
  // Validate challenges for each skill
  for (const skillId of allSkillIds) {
    if (!challenges[skillId]) {
      console.error(`❌ No challenges found for skill: ${skillId}`);
      return false;
    }
    
    const skillChallenges = challenges[skillId];
    
    if (!Array.isArray(skillChallenges) || skillChallenges.length < 2) {
      console.error(`❌ Skill ${skillId} has fewer than 2 challenges`);
      return false;
    }
    
    // Validate each challenge
    for (const ch of skillChallenges) {
      if (!ch.id || !ch.day_range || !ch.type || !ch.title || !ch.description || !ch.hints || !ch.evaluation_criteria || !ch.model_solution) {
        console.error(`❌ Challenge ${ch.id || 'unknown'} in skill ${skillId} is missing required fields`);
        return false;
      }
      
      if (!Array.isArray(ch.day_range) || ch.day_range.length !== 2) {
        console.error(`❌ Challenge ${ch.id} has invalid day_range`);
        return false;
      }
      
      if (!Array.isArray(ch.hints) || ch.hints.length === 0) {
        console.error(`❌ Challenge ${ch.id} has empty hints`);
        return false;
      }
      
      if (!Array.isArray(ch.evaluation_criteria) || ch.evaluation_criteria.length === 0) {
        console.error(`❌ Challenge ${ch.id} has empty evaluation_criteria`);
        return false;
      }
      
      totalChallenges++;
    }
  }
  
  console.log(`✅ Total challenges validated: ${totalChallenges}`);
  console.log(`✅ All ${allSkillIds.length} skills have at least 2 challenges`);
  
  return true;
}

// Main validation
function main() {
  console.log('🔍 Starting Knowledge Bank Validation...\n');
  
  // Load files
  const domains = loadJSON('domains.json');
  const questions = loadJSON('questions.json');
  const challenges = loadJSON('challenges.json');
  
  // Run validations
  const domainsValid = validateDomains(domains);
  const questionsValid = validateQuestions(questions, domains);
  const challengesValid = validateChallenges(challenges, domains);
  
  // Summary
  console.log('\n' + '='.repeat(50));
  if (domainsValid && questionsValid && challengesValid) {
    console.log('✅ All validations passed!');
    console.log('✅ Knowledge bank is ready to use.');
    process.exit(0);
  } else {
    console.log('❌ Validation failed!');
    console.log('❌ Please fix the errors above.');
    process.exit(1);
  }
}

// Run validation
main();
