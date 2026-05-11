const fs = require('fs');
const questions = {};
fs.writeFileSync('server/knowledge/questions.json', JSON.stringify(questions, null, 2));
console.log('done');
