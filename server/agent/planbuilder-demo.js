import PlanBuilder from './PlanBuilder.js';

console.log('=== PlanBuilder Demo ===\n');

const planBuilder = new PlanBuilder();

// Sample skill tree
const skillTree = {
  domain: 'backend_development',
  domainName: 'Backend Development',
  skills: [
    {
      id: 'rest_apis',
      name: 'REST API Design',
      level: 'intermediate',
      days: 3,
      topics: ['HTTP methods', 'REST principles', 'status codes', 'authentication', 'versioning']
    },
    {
      id: 'databases',
      name: 'Database Design',
      level: 'intermediate',
      days: 3,
      topics: ['SQL basics', 'normalization', 'indexing', 'transactions', 'NoSQL']
    },
    {
      id: 'nodejs',
      name: 'Node.js Fundamentals',
      level: 'beginner',
      days: 2,
      topics: ['event loop', 'modules', 'async/await', 'streams', 'error handling']
    }
  ]
};

// Sample diagnostic scores (weakest to strongest)
const diagnosticScores = [
  { skillId: 'databases', score: 25 },    // Weakest - will get 1.3x multiplier
  { skillId: 'nodejs', score: 55 },       // Medium - will get 1.0x multiplier
  { skillId: 'rest_apis', score: 85 }     // Strongest - will get 0.4x multiplier
];

console.log('1. Building initial learning plan...\n');
console.log('Diagnostic Scores:');
diagnosticScores.forEach(ds => {
  const skill = skillTree.skills.find(s => s.id === ds.skillId);
  console.log(`  - ${skill.name}: ${ds.score}/100`);
});

const plan = planBuilder.build(skillTree, diagnosticScores);

console.log(`\nGenerated Learning Plan (${plan.totalDays} days):\n`);
plan.days.forEach(day => {
  const skill = skillTree.skills.find(s => s.id === day.skillId);
  console.log(`  Day ${day.day}: ${skill.name} - ${day.topic}`);
  console.log(`    Challenge: ${day.challengeId}`);
  console.log(`    Review: ${day.isReview ? 'Yes' : 'No'}\n`);
});

console.log('\n2. Simulating session completion and adaptation...\n');

// Simulate 3 sessions with low scores (should trigger adding review days)
const sessions = [
  { day: 1, skillId: 'databases', score: 42 },
  { day: 2, skillId: 'databases', score: 45 },
  { day: 3, skillId: 'databases', score: 48 }
];

console.log('Completed Sessions:');
sessions.forEach(s => {
  console.log(`  Day ${s.day}: Score ${s.score}/100`);
});

const avgScore = sessions.reduce((sum, s) => sum + s.score, 0) / sessions.length;
console.log(`\nAverage Score: ${Math.round(avgScore)}/100`);

const adaptResult = planBuilder.adapt(plan, sessions);

console.log('\nAdaptation Result:');
if (adaptResult.adaptations.length > 0) {
  adaptResult.adaptations.forEach(adaptation => {
    console.log(`  ${adaptation.note}`);
    console.log(`  Days Added: ${adaptation.daysAdded}`);
    console.log(`  Days Removed: ${adaptation.daysRemoved}`);
  });
  
  console.log(`\nUpdated Plan (${adaptResult.updatedPlan.totalDays} days):`);
  const newDays = adaptResult.updatedPlan.days.slice(plan.totalDays);
  if (newDays.length > 0) {
    console.log('\nNewly Added Days:');
    newDays.forEach(day => {
      const skill = skillTree.skills.find(s => s.id === day.skillId);
      console.log(`  Day ${day.day}: ${skill.name} - ${day.topic} (Review: ${day.isReview})`);
    });
  }
} else {
  console.log('  No adaptations needed.');
}

console.log('\n=== Demo Complete ===');
